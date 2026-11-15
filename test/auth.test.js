// Contas com apelido + senha: regras do apelido, hash da senha, sessões e as rotas /api.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/index.js';
import { Accounts, SESSION_DAYS, hashPassword, verifyPassword } from '../server/auth.js';
import { openDatabase } from '../server/db.js';
import { nicknameError, nicknameKey, tidyNickname } from '../shared/names.js';

const servers = [];
const dirs = [];

after(async () => {
  for (const s of servers) await s.shutdown();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function start(options = {}) {
  const s = createGameServer({ client: null, databaseFile: ':memory:', ...options });
  servers.push(s);
  await new Promise((resolve) => s.server.listen(0, resolve));
  s.url = `http://localhost:${s.server.address().port}`;
  return s;
}

// Pedido JSON para a API; devolve { status, body, headers }.
async function api(s, method, path, { body, session, headers = {} } = {}) {
  const res = await fetch(`${s.url}/api${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(session && { Authorization: `Bearer ${session}` }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const PASS = 'senha-boa-123';

test('apelido de conta: tamanho, caracteres, bots e comparação sem acento nem caixa', () => {
  assert.equal(nicknameError('Zé Maria'), null);
  assert.equal(nicknameError('ana_2.0-x'), null);
  assert.match(nicknameError('ab'), /pelo menos 3/);
  assert.match(nicknameError('a'.repeat(17)), /até 16/);
  assert.match(nicknameError('Ana​'), /Use só/); // caractere invisível
  assert.match(nicknameError('Ana <3'), /Use só/);
  assert.match(nicknameError('Robô Nina'), /bots/);
  assert.match(nicknameError('robo nina'), /bots/);
  assert.equal(tidyNickname('  Zé   Maria '), 'Zé Maria');
  assert.equal(nicknameKey('ZÉ  maria'), nicknameKey('ze Maria'));
  // NFC e NFD dão a mesma chave
  assert.equal(nicknameKey('José'), nicknameKey('José'));
});

test('hash da senha: confere a certa, recusa a errada, sal diferente a cada vez', async () => {
  const a = await hashPassword(PASS);
  const b = await hashPassword(PASS);
  assert.match(a, /^scrypt\$15\$8\$1\$/);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(PASS, a), true);
  assert.equal(await verifyPassword('outra-senha', a), false);
  assert.equal(await verifyPassword(PASS, 'lixo'), false);
});

test('sessão vence em 90 dias, renova com o uso e o banco guarda só o hash', async () => {
  let now = 1_000_000;
  const accounts = new Accounts(openDatabase(':memory:'), { now: () => now });
  const reg = await accounts.register({ nickname: 'Bia', password: PASS });
  assert.ok(reg.ok);
  if (!reg.ok) return;
  const { session } = reg;
  assert.equal(accounts.userForSession(session)?.nickname, 'Bia');
  const stored = accounts.db.prepare('SELECT token_hash FROM sessions').all();
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].token_hash, session);
  assert.ok(!JSON.stringify(accounts.db.prepare('SELECT * FROM users').all()).includes(PASS));

  const DAY = 24 * 60 * 60 * 1000;
  now += 60 * DAY; // passou da metade: usar renova
  assert.ok(accounts.userForSession(session));
  now += 80 * DAY; // 140 dias desde o login, mas só 80 desde a renovação
  assert.ok(accounts.userForSession(session));
  now += (SESSION_DAYS + 1) * DAY; // parada por mais de 90 dias: venceu
  assert.equal(accounts.userForSession(session), null);
  assert.equal(accounts.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  assert.equal(accounts.userForSession('nao-existe'), null);
  assert.equal(accounts.userForSession(null), null);
  accounts.db.close();
});

test('as contas ficam no arquivo entre um processo e outro', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'om-db-'));
  dirs.push(dir);
  const file = join(dir, 'sub', 'contas.db'); // a pasta é criada se faltar
  let accounts = new Accounts(openDatabase(file));
  assert.ok((await accounts.register({ nickname: 'Caio', password: PASS })).ok);
  accounts.db.close();
  accounts = new Accounts(openDatabase(file));
  assert.equal(accounts.db.pragma('user_version', { simple: true }), 2);
  const res = await accounts.login({ nickname: 'caio', password: PASS });
  assert.ok(res.ok);
  accounts.db.close();
});

test('cadastro, entrar, /me, sair', async () => {
  const s = await start();
  const reg = await api(s, 'POST', '/auth/register', { body: { nickname: '  Zé   Maria ', password: PASS } });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.ok, true);
  assert.deepEqual(reg.body.user, { id: reg.body.user.id, nickname: 'Zé Maria', hasPassword: true, hasGoogle: false });
  assert.equal(typeof reg.body.session, 'string');
  assert.equal(reg.headers.get('cache-control'), 'no-store');

  const me = await api(s, 'GET', '/me', { session: reg.body.session });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.nickname, 'Zé Maria');

  // o apelido vale sem acento nem caixa no login
  const login = await api(s, 'POST', '/auth/login', { body: { nickname: 'ZE MARIA', password: PASS } });
  assert.equal(login.status, 200);
  assert.notEqual(login.body.session, reg.body.session);

  assert.equal((await api(s, 'POST', '/auth/logout', { session: login.body.session })).status, 200);
  assert.equal((await api(s, 'GET', '/me', { session: login.body.session })).status, 401);
  // a outra sessão (o cadastro) continua valendo
  assert.equal((await api(s, 'GET', '/me', { session: reg.body.session })).status, 200);
  assert.equal((await api(s, 'GET', '/me')).status, 401);
});

test('cadastro recusa apelido repetido, de bot ou inválido e senha curta', async () => {
  const s = await start();
  assert.equal((await api(s, 'POST', '/auth/register', { body: { nickname: 'Duda', password: PASS } })).status, 201);
  const dup = await api(s, 'POST', '/auth/register', { body: { nickname: 'DÚDA', password: PASS } });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /já tem dono/);
  const bot = await api(s, 'POST', '/auth/register', { body: { nickname: 'Robô Duda', password: PASS } });
  assert.equal(bot.status, 400);
  const short = await api(s, 'POST', '/auth/register', { body: { nickname: 'Outra', password: '1234567' } });
  assert.equal(short.status, 400);
  assert.match(short.body.error, /8 caracteres/);
  const empty = await api(s, 'POST', '/auth/register', { body: {} });
  assert.equal(empty.status, 400);
  const array = await api(s, 'POST', '/auth/register', { body: ['Duda', PASS] });
  assert.equal(array.status, 400);
});

test('entrar com senha errada ou apelido que não existe dá a mesma resposta', async () => {
  const s = await start();
  await api(s, 'POST', '/auth/register', { body: { nickname: 'Edu', password: PASS } });
  const wrong = await api(s, 'POST', '/auth/login', { body: { nickname: 'Edu', password: 'errada-123' } });
  const missing = await api(s, 'POST', '/auth/login', { body: { nickname: 'Ninguém', password: PASS } });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(wrong.body.error, missing.body.error);
  assert.equal(wrong.body.session, undefined);
});

test('apagar a conta pede a senha e derruba as sessões', async () => {
  const s = await start();
  const reg = await api(s, 'POST', '/auth/register', { body: { nickname: 'Fabi', password: PASS } });
  const { session } = reg.body;
  assert.equal((await api(s, 'DELETE', '/account', { session, body: { password: 'errada-123' } })).status, 401);
  assert.equal((await api(s, 'DELETE', '/account', { session })).status, 401);
  assert.equal((await api(s, 'DELETE', '/account', { body: { password: PASS } })).status, 401); // sem sessão
  assert.equal((await api(s, 'DELETE', '/account', { session, body: { password: PASS } })).status, 200);
  assert.equal((await api(s, 'GET', '/me', { session })).status, 401);
  // o apelido fica livre de novo
  assert.equal((await api(s, 'POST', '/auth/register', { body: { nickname: 'Fabi', password: PASS } })).status, 201);
});

test('limite de tentativas por apelido, por IP e de cadastros', async () => {
  const s = await start({
    authLimits: {
      loginNickname: { max: 2, windowMs: 60_000 },
      loginIp: { max: 4, windowMs: 60_000 },
      registerIp: { max: 2, windowMs: 60_000 },
    },
  });
  const login = (nickname) => api(s, 'POST', '/auth/login', { body: { nickname, password: 'errada-123' } });
  assert.equal((await login('Gabi')).status, 401);
  assert.equal((await login('GABI')).status, 401);
  const blocked = await login('gabi'); // mesma chave do apelido
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Muitas tentativas/);
  assert.equal((await login('Hugo')).status, 401); // outro apelido: 4ª tentativa do IP ainda cabe
  assert.equal((await login('Iara')).status, 429); // a 5ª do IP não

  const reg = (nickname) => api(s, 'POST', '/auth/register', { body: { nickname, password: PASS } });
  assert.equal((await reg('Juca')).status, 201);
  assert.equal((await reg('Kika')).status, 201);
  assert.equal((await reg('Lulu')).status, 429);
});

test('origens: de fora só as liberadas (com CORS), JSON quebrado e rota desconhecida', async () => {
  const s = await start({ allowedOrigins: ['capacitor://localhost'] });
  const evil = await api(s, 'POST', '/auth/login', {
    body: { nickname: 'x', password: 'y' },
    headers: { Origin: 'https://malvado.example' },
  });
  assert.equal(evil.status, 403);

  const pre = await fetch(`${s.url}/api/auth/login`, {
    method: 'OPTIONS',
    headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);

  const same = await api(s, 'GET', '/me', { headers: { Origin: s.url } });
  assert.equal(same.status, 401); // mesma origem passa (e cai no "sem sessão")
  assert.equal(same.headers.get('access-control-allow-origin'), null);

  const broken = await api(s, 'POST', '/auth/login', { body: '{"nickname":' });
  assert.equal(broken.status, 400);
  assert.equal(broken.body.ok, false);
  const big = await api(s, 'POST', '/auth/login', { body: { nickname: 'x', password: 'y'.repeat(5000) } });
  assert.equal(big.status, 413);
  const unknown = await api(s, 'GET', '/nada');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.ok, false);
});
