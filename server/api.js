// Rotas HTTP das contas, em /api. A sessão vai no cabeçalho `Authorization: Bearer <token>`
// (nada de cookie: o app Capacitor fala de outra origem). As respostas seguem o formato dos
// eventos do socket: { ok: true, ... } ou { ok: false, error }, com o status HTTP certo.
import express from 'express';
import { nicknameKey } from '../shared/names.js';
import { takeSlot } from './rooms.js';

// Tentativas por IP e por apelido (o apelido segura quem tenta adivinhar a senha de alguém
// trocando de IP; o IP segura quem testa vários apelidos).
export const AUTH_LIMITS = {
  loginIp: { max: 10, windowMs: 60_000 },
  loginNickname: { max: 5, windowMs: 60_000 },
  registerIp: { max: 5, windowMs: 60 * 60_000 },
};
const TOO_MANY = 'Muitas tentativas. Espere um pouco e tente de novo.';

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// Janela deslizante por chave (IP ou apelido). `hit` conta e diz se cabia; `full` só olha.
// De vez em quando tira as chaves paradas, para o mapa não crescer para sempre.
function limiter({ max, windowMs }) {
  const hits = new Map();
  let calls = 0;
  const hit = (key, now = Date.now()) => {
    if (++calls % 1000 === 0)
      for (const [k, times] of hits) if (!times.length || now - times.at(-1) >= windowMs) hits.delete(k);
    const slot = takeSlot(hits.get(key), now, { max, windowMs });
    hits.set(key, slot.times);
    return slot.ok;
  };
  const full = (key, now = Date.now()) => (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= max;
  return { hit, full };
}

/**
 * @param {{
 *   accounts: () => import('./auth.js').Accounts,
 *   originAllowed: (origin: string | undefined, host: string | undefined) => boolean,
 *   allowedOrigins: string[],
 *   limits?: Partial<typeof AUTH_LIMITS>,
 *   googleClientId?: string | null,
 *   verifyGoogle?: ((credential: unknown) => Promise<string | null>) | null,
 *   onSessionEnded?: (ended: { token?: string | null, userId?: number | null }) => void,
 * }} options
 */
export function createApi({
  accounts,
  originAllowed,
  allowedOrigins,
  limits = {},
  googleClientId = null,
  verifyGoogle = null,
  onSessionEnded = () => {},
}) {
  const L = { ...AUTH_LIMITS, ...limits };
  const loginIp = limiter(L.loginIp);
  const loginNickname = limiter(L.loginNickname);
  const registerIp = limiter(L.registerIp);

  const api = express.Router();

  // Origem: a mesma de sempre ou uma de ALLOWED_ORIGINS (com CORS só para essas).
  api.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!originAllowed(origin, req.headers.host))
      return res.status(403).json({ ok: false, error: 'Origem não permitida' });
    if (origin && allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '4kb' }));

  const bearer = (req) => /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
  const send = (res, result, okStatus = 200) => {
    const { status, ...body } = result;
    res.status(result.ok ? okStatus : (status ?? 400)).json(body);
  };
  // Express 4 não pega erro de função async: sem isso, uma exceção deixava o pedido pendurado.
  const handle = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => fn(req, res, asObject(req.body)))
      .catch((err) => {
        console.error(`[api] ${req.method} ${req.path}:`, err);
        if (!res.headersSent) res.status(500).json({ ok: false, error: 'Erro no servidor' });
      });
  // Rotas que pedem sessão: o usuário vai em req.user.
  const signedIn = (fn) =>
    handle((req, res, body) => {
      const user = accounts().userForSession(bearer(req));
      // `code: 'session'` separa "sessão vencida" de "senha errada" (os dois são 401)
      if (!user) return res.status(401).json({ ok: false, error: 'Entre na sua conta de novo', code: 'session' });
      return fn(req, res, body, user);
    });

  // O que o navegador precisa saber antes de mostrar o login (o id do Google não é segredo).
  api.get('/config', (_req, res) => res.json({ ok: true, googleClientId: verifyGoogle ? googleClientId : null }));

  const GOOGLE_OFF = { ok: false, error: 'O login com o Google não está ligado neste servidor', status: 404 };
  const GOOGLE_FAIL = { ok: false, error: 'Não deu para confirmar com o Google. Tente de novo.', status: 401 };

  // Entrar com o Google: conta existente recebe a sessão; primeira vez recebe { needsNickname, ticket }.
  api.post(
    '/auth/google',
    handle(async (req, res, body) => {
      if (!verifyGoogle) return send(res, GOOGLE_OFF);
      if (!loginIp.hit(req.ip)) return send(res, { ok: false, error: TOO_MANY, status: 429 });
      const sub = await verifyGoogle(body.credential);
      if (!sub) return send(res, GOOGLE_FAIL);
      send(res, accounts().loginGoogle(sub));
    }),
  );

  // Primeira vez com o Google: a conta nasce quando a pessoa escolhe o apelido.
  api.post(
    '/auth/google/complete',
    handle((req, res, body) => {
      if (!verifyGoogle) return send(res, GOOGLE_OFF);
      if (registerIp.full(req.ip)) return send(res, { ok: false, error: TOO_MANY, status: 429 });
      const result = accounts().registerGoogle(body);
      if (result.ok && 'session' in result) registerIp.hit(req.ip);
      send(res, result, 201);
    }),
  );

  api.post(
    '/auth/register',
    handle(async (req, res, body) => {
      // só conta cadastro feito: errar o apelido ou a senha no formulário não gasta a vez
      if (registerIp.full(req.ip)) return send(res, { ok: false, error: TOO_MANY, status: 429 });
      const result = await accounts().register(body);
      if (result.ok) registerIp.hit(req.ip);
      send(res, result, 201);
    }),
  );

  api.post(
    '/auth/login',
    handle(async (req, res, body) => {
      // os dois contam sempre (não dá para "economizar" tentativas trocando a ordem)
      const ipOk = loginIp.hit(req.ip);
      const nickOk = loginNickname.hit(nicknameKey(String(body.nickname ?? '').slice(0, 64)));
      if (!ipOk || !nickOk) return send(res, { ok: false, error: TOO_MANY, status: 429 });
      send(res, await accounts().login(body));
    }),
  );

  api.post(
    '/auth/logout',
    handle((req, res) => {
      const token = bearer(req);
      accounts().logout(token);
      if (token) onSessionEnded({ token });
      res.json({ ok: true });
    }),
  );

  // Ranking: os primeiros e, com sessão, a posição de quem pediu (mesmo fora dos primeiros).
  api.get(
    '/leaderboard',
    handle((req, res) => {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const all = accounts().leaderboard();
      const user = bearer(req) ? accounts().userForSession(bearer(req)) : null;
      res.json({
        ok: true,
        total: all.length,
        top: all.slice(0, limit),
        me: (user && all.find((r) => r.id === user.id)) ?? null,
      });
    }),
  );

  api.get(
    '/me',
    signedIn((_req, res, _body, user) => res.json({ ok: true, user })),
  );

  api.delete(
    '/account',
    signedIn(async (_req, res, body, user) => {
      // conta do Google confirma entrando com o Google de novo (o sub sai do token, nunca do pedido)
      const googleSub = verifyGoogle && body.credential ? await verifyGoogle(body.credential) : null;
      const password = typeof body.password === 'string' ? body.password : '';
      const result = await accounts().deleteAccount(user.id, { password, googleSub });
      // todas as sessões da conta sumiram junto (CASCADE): as conexões abertas também caem
      if (result.ok) onSessionEnded({ userId: user.id });
      send(res, result);
    }),
  );

  api.use((_req, res) => res.status(404).json({ ok: false, error: 'Não encontrado' }));
  // JSON quebrado ou grande demais (o express.json joga erro com status)
  api.use((err, _req, res, _next) => {
    const status = err?.status ?? 500;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ ok: false, error: status === 413 ? 'Pedido grande demais' : 'Pedido inválido' });
  });

  return api;
}
