import compression from 'compression';
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager, takeSlot } from './rooms.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// Só objetos simples chegam aos handlers: null, número, string ou array viram {}.
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// Limite de cada evento por conexão (janela deslizante, com o takeSlot das reações).
// Folgados para quem joga de verdade: a lista de salas se atualiza a cada 5s (12 por minuto).
const SLOW_DOWN = 'Muitas ações seguidas. Espere um pouquinho.';
export const RATE_LIMITS = {
  'room:create': { max: 5, windowMs: 60_000, error: 'Você criou muitas salas seguidas. Espere um minuto.' },
  'room:join': { max: 12, windowMs: 60_000, error: 'Muitas tentativas de entrar. Espere um minuto.' },
  'room:list': { max: 30, windowMs: 60_000 },
  'game:play': { max: 10, windowMs: 5_000 },
  'game:draw': { max: 10, windowMs: 5_000 },
  'game:pass': { max: 10, windowMs: 5_000 },
  default: { max: 20, windowMs: 10_000 },
};

// Configuração por variável de ambiente (README, "Publicando").
export function configFromEnv(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return {
    // origens de fora que podem conectar (o app Capacitor, por exemplo); a própria origem sempre pode
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    // quantos proxies na frente (Render/Railway/Fly = 1): é de onde sai o IP de verdade
    trustProxy: Number(env.TRUST_PROXY ?? (production ? 1 : 0)) || 0,
    maxRooms: Number(env.MAX_ROOMS) || 500,
    maxConnectionsPerIp: Number(env.MAX_CONNECTIONS_PER_IP) || 20,
  };
}

// IP de quem conectou. Atrás de proxy, o x-forwarded-for tem o IP real na posição de quem
// confiamos (contando da direita); sem proxy, o cabeçalho é ignorado (qualquer um pode inventar).
export function clientIp(headers, address, trustProxy) {
  if (trustProxy > 0) {
    const chain = String(headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const ip = chain[chain.length - trustProxy];
    if (ip) return ip;
  }
  return address ?? '?';
}

// Mesma origem (o site servido por este servidor) ou uma das liberadas. Sem Origin (app nativo,
// curl, testes) também passa: o CORS só existe para navegadores.
export function originAllowed(origin, host, allowed) {
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Monta o servidor sem ligar a porta (os testes sobem um em porta qualquer).
export function createGameServer(options = {}) {
  const config = { ...configFromEnv(), ...options };
  const app = express();
  app.set('trust proxy', config.trustProxy);
  // gzip/brotli nos arquivos de texto (app.js e style.css passam de 100KB cada); imagens e
  // fontes já vêm comprimidas e o pacote as deixa como estão
  app.use(compression());
  app.use(express.static(`${root}/public`));
  app.use('/shared', express.static(`${root}/shared`));

  const server = createServer(app);
  const io = new Server(server, {
    // CORS só para as origens liberadas; a checagem de verdade é o allowRequest (vale para WebSocket também)
    cors: { origin: config.allowedOrigins, credentials: false },
    allowRequest: (req, cb) =>
      cb(null, originAllowed(req.headers.origin, req.headers.host, config.allowedOrigins)),
    maxHttpBufferSize: 16 * 1024, // a maior mensagem de verdade (entrar com avatar) tem ~300 bytes
    // celular: o navegador segura timers em segundo plano, então dá mais folga antes de dar a queda
    pingInterval: 20_000,
    pingTimeout: 30_000,
  });
  const rooms = new RoomManager(io);

  app.get('/health', (_req, res) =>
    res.json({ ok: true, ...rooms.stats(), connections: io.engine.clientsCount, uptime: Math.round(process.uptime()) }),
  );

  // Conexões por IP: barra quem abre conexões sem parar (cada uma ocupa memória e timers).
  const perIp = new Map();
  io.use((socket, next) => {
    const ip = clientIp(socket.handshake.headers, socket.handshake.address, config.trustProxy);
    const count = perIp.get(ip) ?? 0;
    if (count >= config.maxConnectionsPerIp) return next(new Error('Muitas conexões deste endereço'));
    perIp.set(ip, count + 1);
    socket.data.ip = ip;
    socket.once('disconnect', () => {
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left > 0) perIp.set(ip, left);
      else perIp.delete(ip);
    });
    next();
  });

  io.on('connection', (socket) => {
    const reply = (ack, result) => ack && ack(result ?? { ok: true });
    const current = () => {
      const room = socket.data.code && rooms.get(socket.data.code);
      return room && room.member(socket.data.memberId) ? room : null;
    };
    const leaveCurrent = () => {
      const room = current();
      if (room) room.leave(socket.data.memberId);
      socket.data.code = null;
      socket.data.memberId = null;
    };
    const rate = {}; // horários recentes de cada evento desta conexão

    // Todo evento passa por aqui: o ack (se veio) é sempre o último argumento, os dados viram
    // objeto, o limite de frequência vale para todos e um erro num handler responde
    // "Erro no servidor" em vez de derrubar todas as salas.
    const on = (event, fn) =>
      socket.on(event, (...args) => {
        const ack = typeof args.at(-1) === 'function' ? args.pop() : null;
        const limit = config.rateLimits?.[event] ?? RATE_LIMITS[event] ?? config.rateLimits?.default ?? RATE_LIMITS.default;
        const slot = takeSlot(rate[event], Date.now(), limit);
        rate[event] = slot.times;
        if (!slot.ok) return reply(ack, { ok: false, error: limit.error ?? SLOW_DOWN });
        try {
          reply(ack, fn(asObject(args[0])));
        } catch (err) {
          console.error(`[${event}] sala ${socket.data.code ?? '-'}:`, err);
          reply(ack, { ok: false, error: 'Erro no servidor' });
        }
      });
    // Executa algo na sala atual do socket, respondendo erro se ele não estiver em nenhuma.
    const inRoom = (event, fn) =>
      on(event, (data) => {
        const room = current();
        if (!room) return { ok: false, error: 'Você não está em uma sala' };
        room.touch(socket.data.memberId); // qualquer ação tira o "ausente"
        return fn(room, socket.data.memberId, data);
      });

    on('room:list', () => ({ ok: true, rooms: rooms.listPublic() }));

    on('room:create', (data) => {
      if (rooms.rooms.size >= config.maxRooms)
        return { ok: false, error: 'Servidor cheio, tente daqui a pouco' };
      leaveCurrent();
      const room = rooms.create({ isPublic: data.isPublic !== false });
      const result = room.join(socket, data);
      if (!result.ok) rooms.delete(room.code);
      return result;
    });

    on('room:join', (data) => {
      const room = rooms.get(data.code);
      if (!room) return { ok: false, error: 'Sala não encontrada' };
      if (socket.data.code && socket.data.code !== room.code) leaveCurrent();
      return room.join(socket, data);
    });

    on('room:leave', () => leaveCurrent());

    inRoom('room:addBot', (room, me) => room.addBot(me));
    inRoom('room:kick', (room, me, d) => room.kick(me, d.id));
    inRoom('room:settings', (room, me, d) => room.updateSettings(me, d));
    inRoom('room:start', (room, me) => room.start(me));
    inRoom('room:lobby', (room, me) => room.backToLobby(me));
    inRoom('game:rematch', (room, me) => room.rematch(me));
    inRoom('chat', (room, me, d) => room.say(me, d.text));
    inRoom('reaction', (room, me, d) => room.react(me, d.id));
    inRoom('game:play', (room, me, d) => room.act(me, { type: 'play', cardId: d.cardId, suit: d.suit }));
    inRoom('game:draw', (room, me) => room.act(me, { type: 'draw' }));
    inRoom('game:pass', (room, me) => room.act(me, { type: 'pass' }));
    inRoom('game:ready', (room, me) => room.setReady(me));
    // o cliente avisa que a pessoa mexeu na tela enquanto estava ausente (o touch acima já resolve)
    inRoom('presence', () => ({ ok: true }));

    socket.on('disconnect', () => {
      try {
        const room = current();
        if (room) room.disconnect(socket.data.memberId, socket.id);
      } catch (err) {
        console.error(`[disconnect] sala ${socket.data.code ?? '-'}:`, err);
      }
    });
  });

  // Desligamento limpo: avisa as salas, para os timers, fecha as conexões e a porta.
  let closing = null;
  const shutdown = (message = 'O servidor vai reiniciar. Volte em instantes!') =>
    (closing ??= new Promise((resolve) => {
      rooms.shutdown(message);
      // um instante para o aviso chegar antes de cortar as conexões
      setTimeout(() => {
        io.close();
        server.close(() => resolve());
      }, 500);
    }));

  return { app, server, io, rooms, config, shutdown };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = Number(process.env.PORT) || 3000;
  // Um erro que escapou fica no log em vez de derrubar todas as salas.
  process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
  const game = createGameServer();
  game.server.listen(PORT, () => {
    console.log(`8 Maluco rodando em http://localhost:${PORT}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, async () => {
      console.log(`${signal}: avisando as salas e desligando`);
      // se algo travar, sai mesmo assim (as plataformas matam o processo uns 10s depois do SIGTERM)
      setTimeout(() => process.exit(0), 5000).unref();
      await game.shutdown();
      process.exit(0);
    });
  }
}
