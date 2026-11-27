import compression from 'compression';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { createApi } from './api.js';
import { appLinks, defaultAppId } from './app-links.js';
import { Accounts } from './auth.js';
import { openDatabase } from './db.js';
import { googleVerifier } from './google.js';
import { RoomManager, takeSlot } from './rooms.js';
import { nicknameKey } from '../shared/names.js';
import { loadSnapshot, saveSnapshot, startSnapshots } from './snapshot.js';
import { iceServers } from './voice.js';

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
  // cada análise pensa ~0,4s: poucas por vez bastam
  'game:analyze': { max: 6, windowMs: 10_000 },
  // negociação do voz: oferta/resposta e uns 10 candidatos de rede por par, e são até 11 pares
  // quando a mesa cheia entra junta (ou a rede troca e todos renegociam)
  'voice:signal': { max: 400, windowMs: 10_000 },
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
    // "Entrar com o Google": o Client ID do Google Cloud (README). Sem ele, o botão nem aparece.
    googleClientId: env.GOOGLE_CLIENT_ID?.trim() || null,
    // convites que abrem direto no app (app-links.js): id do app, certificados do Android, time da Apple
    appId: env.APP_ID?.trim() || defaultAppId(),
    androidCertFingerprints: (env.ANDROID_CERT_SHA256 ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    appleTeamId: env.APPLE_TEAM_ID?.trim() || null,
    // contas (apelidos, separados por vírgula) que veem a análise do bot forte na própria vez
    analysisUsers: (env.ANALYSIS_USERS ?? '')
      .split(',')
      .map((s) => nicknameKey(s))
      .filter(Boolean),
    // chat de voz (voice.js): STUN para achar o endereço público; TURN para retransmitir o áudio
    // quando a conexão direta não passa. Sem TURN o voz funciona, mas falha em parte das redes.
    stunUrls: list(env.STUN_URLS ?? 'stun:stun.l.google.com:19302'),
    turnUrls: list(env.TURN_URLS),
    turnSecret: env.TURN_SECRET?.trim() || null,
    turnTtlSeconds: Number(env.TURN_TTL_SECONDS) || 6 * 3600,
  };
}

const list = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Content-Security-Policy da página. Tudo vem da própria origem (fontes em /fonts, cartas, sons,
// o tempo real em /socket.io), menos o "Entrar com o Google" (script, estilo, iframe e chamadas
// em accounts.google.com/gsi) e as fotos de perfil dele. `data:` cobre os SVGs dentro do CSS;
// 'unsafe-inline' no estilo é pelos style="" que o cliente monta (cards.js, lobby.js) e pelo
// Vite, que injeta o CSS em <style> no desenvolvimento. Fora de produção, o HMR do Vite fala
// por WebSocket noutra porta, então o connect-src libera ws: lá.
export function contentSecurityPolicy({ production = true } = {}) {
  const gsi = 'https://accounts.google.com/gsi/';
  return [
    "default-src 'self'",
    `script-src 'self' ${gsi}client`,
    `style-src 'self' 'unsafe-inline' ${gsi}style`,
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' ${gsi}${production ? '' : ' ws: wss:'}`,
    `frame-src ${gsi}`,
    "media-src 'self' blob: data:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Cache dos arquivos do cliente: /assets/ tem hash no nome (um build novo gera nomes novos),
// então guarda por um ano; a página, o manifest e o service worker sempre revalidam, para o
// build novo chegar logo. O resto (fontes, cartas, sons) fica no padrão do express (ETag).
export function setStaticCache(res, file) {
  const path = file.replaceAll('\\', '/');
  if (/\/assets\//.test(path)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
  else if (/\.html$|\/sw\.js$|\/manifest\.json$/.test(path)) res.set('Cache-Control', 'no-cache');
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
 *   verifyGoogle?: (credential: unknown) => Promise<string | null>,
 * }} [options]
 */
export function createGameServer(options = {}) {
  /** @type {ReturnType<typeof configFromEnv> & typeof options} */
  const config = { ...configFromEnv(), ...options };
  const app = express();
  app.set('trust proxy', config.trustProxy);
  // gzip/brotli nos arquivos de texto (o JS e o CSS do build passam de 70KB cada); imagens e
  // fontes já vêm comprimidas e o pacote as deixa como estão
  app.use(compression());
  // Cabeçalhos de segurança em tudo: CSP, nada de ser posto em iframe de outro site, nada de o
  // navegador adivinhar o tipo do arquivo.
  const csp = contentSecurityPolicy({ production: config.production });
  app.use((_req, res, next) => {
    res.set('Content-Security-Policy', csp);
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  // Contas: o banco só abre no primeiro uso (os testes que não mexem em conta não criam arquivo);
  // em produção, a subida já chama accounts() para um disco com problema aparecer logo.
  let accounts = null;
  const getAccounts = () => (accounts ??= new Accounts(openDatabase(config.databaseFile)));
  // antes do cliente, pelo mesmo motivo do /api abaixo
  app.use(appLinks(config));
  // antes do cliente: no desenvolvimento, o Vite responderia /api/... com a página
  app.use(
    '/api',
    createApi({
      accounts: getAccounts,
      allowedOrigins: config.allowedOrigins,
      originAllowed: (origin, host) => originAllowed(origin, host, config.allowedOrigins),
      limits: config.authLimits,
      googleClientId: config.googleClientId,
      // os testes trocam o verificador (não dá para pedir token de verdade ao Google)
      verifyGoogle: options.verifyGoogle ?? (config.googleClientId ? googleVerifier(config.googleClientId) : null),
      // saiu da conta ou apagou: as conexões abertas com ela não continuam valendo
      onSessionEnded: (ended) => endSessions(ended),
    }),
  );
  const client = options.client ?? `${root}dist`;
  if (typeof client === 'function') app.use(client);
  else if (client && existsSync(client)) app.use(express.static(client, { setHeaders: setStaticCache }));
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
  const rooms = new RoomManager(io, {
    timing: config.timing,
    // sem banco aberto não há conta nenhuma (em produção a subida já abre)
    nicknameTaken: (name) => !!accounts?.nicknameTaken(name),
    // só chega aqui partida com alguém logado, e logar já abriu o banco
    onGameOver: (summary) => getAccounts().recordGame(summary),
    isTop1: (userId) => !!accounts?.isTop1(userId),
    isAnalyst: (user) => (config.analysisUsers ?? []).includes(nicknameKey(user.nickname)),
    iceServers: () => iceServers(config),
  });
  if (config.production && !(config.turnUrls?.length && config.turnSecret))
    console.warn(
      '[voz] sem TURN_URLS/TURN_SECRET: o chat de voz não conecta em parte das redes (README, "Chat de voz")',
    );

  // `voice` diz o que o chat de voz tem para atravessar as redes (sem TURN, parte do 4G não conecta)
  const voice = {
    stun: (config.stunUrls?.length ?? 0) > 0,
    turn: !!(config.turnUrls?.length && config.turnSecret),
  };
  app.get('/health', (_req, res) =>
    res.json({
      ok: true,
      ...rooms.stats(),
      connections: io.engine.clientsCount,
      uptime: Math.round(process.uptime()),
      voice,
    }),
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

  // Conta: a sessão vem no handshake (`io({ auth: { session } })`). Sessão inválida ou vencida
  // não barra ninguém, só entra como convidado (o cliente descobre pelo /api/me e limpa a dele).
  io.use((socket, next) => {
    const session = socket.handshake.auth?.session;
    socket.data.user = null;
    socket.data.session = null;
    if (typeof session === 'string' && session) {
      try {
        socket.data.user = getAccounts().userForSession(session);
        if (socket.data.user) socket.data.session = session;
      } catch (err) {
        console.error('[auth] sessão do socket:', err);
      }
    }
    next();
  });

  // Sessão encerrada (logout: aquele token; conta apagada: todas as sessões da conta). As conexões
  // que entraram com ela deixam de valer na hora: o servidor avisa (`session:ended`, o cliente
  // limpa a sessão guardada) e derruba a conexão; o cliente reconecta como convidado e volta
  // para a sala pelo token, como numa queda. Devolve quantas conexões caíram.
  /** @param {{ token?: string | null, userId?: number | null }} ended */
  function endSessions({ token = null, userId = null }) {
    let count = 0;
    for (const socket of io.sockets.sockets.values()) {
      const { user, session } = socket.data;
      if (!user) continue;
      if (!((token && session === token) || (userId != null && user.id === userId))) continue;
      socket.data.user = null;
      socket.data.session = null;
      socket.emit('session:ended', { reason: userId != null ? 'deleted' : 'logout' });
      socket.disconnect(true);
      count++;
    }
    return count;
  }

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
    // `touch: false` nos eventos que o cliente manda sozinho, sem a pessoa mexer em nada.
    const inRoom = (event, fn, { touch = true } = {}) =>
      on(event, (data) => {
        const room = current();
        if (!room) return { ok: false, error: 'Você não está em uma sala' };
        if (touch) room.touch(socket.data.memberId); // qualquer ação tira o "ausente"
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
    inRoom('game:analyze', (room, me) => room.analyze(me));
    // o cliente avisa que a pessoa mexeu na tela enquanto estava ausente (o touch acima já resolve)
    inRoom('presence', () => ({ ok: true }));
    // Chat de voz (voice.js). Entrar de novo depois de reconectar e negociar são automáticos:
    // não contam como a pessoa ter voltado para a tela.
    inRoom('voice:join', (room, me, d) => room.voiceJoin(me, { muted: d.muted === true }), { touch: false });
    inRoom('voice:leave', (room, me) => room.voiceLeave(me));
    inRoom('voice:mute', (room, me, d) => room.voiceMute(me, d.muted === true));
    inRoom('voice:signal', (room, me, d) => room.voiceSignal(me, d), { touch: false });

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
  // Gravação periódica das salas (um crash ou kill não perde tudo); o desligamento para o timer
  // e grava uma última vez.
  /** @type {ReturnType<typeof startSnapshots> | null} */
  let autosave = null;
  const startAutosave = (file = config.snapshotFile, intervalMs = undefined) => {
    if (file && !autosave) autosave = startSnapshots(rooms, file, { intervalMs });
    return autosave;
  };
  const shutdown = ({ snapshotFile = null } = {}) =>
    (closing ??= new Promise(
      /** @param {(value?: void) => void} resolve */ (resolve) => {
        autosave?.stop();
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

  return { app, server, io, rooms, config, shutdown, startAutosave, endSessions, accounts: getAccounts };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // Variáveis do arquivo .env na raiz (fora do git; o modelo é o .env.example). O que já vier do
  // ambiente (o painel da plataforma, o terminal) vale mais que o arquivo. Sem arquivo, segue.
  try {
    process.loadEnvFile(`${root}.env`);
  } catch (err) {
    if (err?.code !== 'ENOENT') console.error('[env] não deu para ler o .env:', err.message);
  }
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
    game.startAutosave();
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
