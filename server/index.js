import compression from 'compression';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { createApi } from './api.js';
import { Accounts } from './auth.js';
import { openDatabase } from './db.js';
import { RoomManager, takeSlot } from './rooms.js';
import { loadSnapshot, saveSnapshot } from './snapshot.js';

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
    production,
    // origens de fora que podem conectar (o app Capacitor, por exemplo); a própria origem sempre pode
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // quantos proxies na frente (Render/Railway/Fly = 1): é de onde sai o IP de verdade
    trustProxy: Number(env.TRUST_PROXY ?? (production ? 1 : 0)) || 0,
    maxRooms: Number(env.MAX_ROOMS) || 500,
    maxConnectionsPerIp: Number(env.MAX_CONNECTIONS_PER_IP) || 20,
    // onde as salas ficam entre um processo e outro; "off" desliga (o reinício perde as partidas)
    snapshotFile: env.SNAPSHOT_FILE === 'off' ? null : env.SNAPSHOT_FILE || `${root}data/rooms.json`,
    // contas (SQLite); precisa do mesmo disco persistente do SNAPSHOT_FILE. ":memory:" nos testes
    databaseFile: env.DATABASE_FILE || `${root}data/oito-maluco.db`,
  };
}

// IP de quem conectou. Atrás de proxy, o x-forwarded-for tem o IP real na posição de quem
// confiamos (contando da direita); sem proxy, o cabeçalho é ignorado (qualquer um pode inventar).
export function clientIp(headers, address, trustProxy) {
  if (trustProxy > 0) {
    const chain = String(headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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
// O cliente vem de `client`: um middleware (o Vite, no desenvolvimento) ou uma pasta pronta
// (o `dist/` do `npm run build`, em produção). Sem nenhum dos dois, só o tempo real responde.
/**
 * @param {Partial<ReturnType<typeof configFromEnv>> & {
 *   client?: string | import('express').RequestHandler | null,
 *   timing?: object,
 *   rateLimits?: Record<string, { max: number, windowMs: number, error?: string }>,
 *   authLimits?: Partial<typeof import('./api.js').AUTH_LIMITS>,
 * }} [options]
 */
export function createGameServer(options = {}) {
  /** @type {ReturnType<typeof configFromEnv> & typeof options} */
  const config = { ...configFromEnv(), ...options };
  const app = express();
  app.set('trust proxy', config.trustProxy);
  // gzip/brotli nos arquivos de texto (app.js e style.css passam de 100KB cada); imagens e
  // fontes já vêm comprimidas e o pacote as deixa como estão
  app.use(compression());
  // Contas: o banco só abre no primeiro uso (os testes que não mexem em conta não criam arquivo);
  // em produção, a subida já chama accounts() para um disco com problema aparecer logo.
  let accounts = null;
  const getAccounts = () => (accounts ??= new Accounts(openDatabase(config.databaseFile)));
  // antes do cliente: no desenvolvimento, o Vite responderia /api/... com a página
  app.use(
    '/api',
    createApi({
      accounts: getAccounts,
      allowedOrigins: config.allowedOrigins,
      originAllowed: (origin, host) => originAllowed(origin, host, config.allowedOrigins),
      limits: config.authLimits,
    }),
  );
  const client = options.client ?? `${root}dist`;
  if (typeof client === 'function') app.use(client);
  else if (client && existsSync(client)) app.use(express.static(client));
  const missingClient = typeof client === 'string' && !existsSync(client) && config.production;
  if (missingClient)
    console.error(
      `[client] ${client} não existe: o deploy precisa rodar "npm run build" antes do "npm start" ` +
        '(no Render: Build Command = "npm ci --include=dev && npm run build")',
    );

  const server = createServer(app);
  const io = new Server(server, {
    // CORS só para as origens liberadas; a checagem de verdade é o allowRequest (vale para WebSocket também)
    cors: { origin: config.allowedOrigins, credentials: false },
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, req.headers.host, config.allowedOrigins)),
    maxHttpBufferSize: 16 * 1024, // a maior mensagem de verdade (entrar com avatar) tem ~300 bytes
    // celular: o navegador segura timers em segundo plano, então dá mais folga antes de dar a queda
    pingInterval: 20_000,
    pingTimeout: 30_000,
  });
  const rooms = new RoomManager(io, { timing: config.timing });

  app.get('/health', (_req, res) =>
    res.json({ ok: true, ...rooms.stats(), connections: io.engine.clientsCount, uptime: Math.round(process.uptime()) }),
  );

  // Publicado sem o build: em vez de um "Cannot GET /" mudo, diz o que falta (o /health continua respondendo).
  if (missingClient)
    app.use((_req, res) =>
      res
        .status(503)
        .type('text')
        .send(
          '8 Maluco: a página não foi gerada neste deploy. Rode "npm run build" no build (veja o README, "Publicando").',
        ),
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
        const limit =
          config.rateLimits?.[event] ?? RATE_LIMITS[event] ?? config.rateLimits?.default ?? RATE_LIMITS.default;
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
      if (rooms.rooms.size >= config.maxRooms) return { ok: false, error: 'Servidor cheio, tente daqui a pouco' };
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

  // Desligamento limpo: avisa as salas, para os timers, grava as salas (com `snapshotFile`),
  // fecha as conexões e a porta.
  let closing = null;
  const shutdown = ({ snapshotFile = null } = {}) =>
    (closing ??= new Promise(
      /** @param {(value?: void) => void} resolve */ (resolve) => {
        rooms.shutdown(
          snapshotFile
            ? 'O servidor vai reiniciar. A partida continua quando ele voltar!'
            : 'O servidor vai reiniciar. Volte em instantes!',
        );
        if (snapshotFile) {
          try {
            const saved = saveSnapshot(rooms, snapshotFile);
            console.log(`${saved} sala(s) gravada(s) em ${snapshotFile}`);
          } catch (err) {
            console.error('[snapshot] não deu para gravar as salas:', err);
          }
        }
        // um instante para o aviso chegar antes de cortar as conexões
        setTimeout(() => {
          io.close();
          server.close(() => {
            accounts?.db.close();
            resolve();
          });
        }, 500);
      },
    ));

  return { app, server, io, rooms, config, shutdown, accounts: getAccounts };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = Number(process.env.PORT) || 3000;
  // Um erro que escapou fica no log em vez de derrubar todas as salas.
  process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
  // Fora de produção o Vite monta o cliente na hora (com recarga ao salvar), na mesma porta.
  let client;
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({ configFile: `${root}vite.config.js`, server: { middlewareMode: true } });
    client = vite.middlewares;
  }
  const game = createGameServer({ client });
  const pruned = game.accounts().prune();
  console.log(`Contas em ${game.config.databaseFile}${pruned ? ` (${pruned} sessão(ões) vencida(s) apagada(s))` : ''}`);
  // salas gravadas no último desligamento: voltam antes de abrir a porta
  if (game.config.snapshotFile) {
    const restored = loadSnapshot(game.rooms, game.config.snapshotFile);
    if (restored) console.log(`${restored} sala(s) de volta do último desligamento`);
  }
  game.server.listen(PORT, () => {
    console.log(`8 Maluco rodando em http://localhost:${PORT}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, async () => {
      console.log(`${signal}: avisando as salas e desligando`);
      // se algo travar, sai mesmo assim (as plataformas matam o processo uns 10s depois do SIGTERM)
      setTimeout(() => process.exit(0), 5000).unref();
      await game.shutdown({ snapshotFile: game.config.snapshotFile });
      process.exit(0);
    });
  }
}
