// Entrar com o Google: a conferência do token (com chaves geradas aqui, no lugar das do Google)
// e as rotas /api/auth/google com um verificador falso.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createGameServer } from '../server/index.js';
import { googleVerifier } from '../server/google.js';

const servers = [];
after(async () => {
  for (const s of servers) await s.shutdown();
});

// Verificador falso: "ok:<sub>" vale, o resto não.
const fakeVerify = async (credential) =>
  typeof credential === 'string' && credential.startsWith('ok:') ? credential.slice(3) : null;

async function start(options = {}) {
  const s = createGameServer({
    client: null,
    databaseFile: ':memory:',
    googleClientId: 'cliente-teste.apps.googleusercontent.com',
    verifyGoogle: fakeVerify,
    ...options,
  });
  servers.push(s);
  await new Promise((resolve) => s.server.listen(0, resolve));
  s.url = `http://localhost:${s.server.address().port}`;
  return s;
}

async function api(s, method, path, { body, session } = {}) {
  const res = await fetch(`${s.url}/api${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(session && { Authorization: `Bearer ${session}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('o token do Google: assinatura, emissor, destinatário e validade', async () => {
  const CLIENT = 'meu-cliente.apps.googleusercontent.com';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const verify = googleVerifier(CLIENT, { keys: createLocalJWKSet({ keys: [jwk] }) });
  const sign = (claims = {}, { key = privateKey, exp = '5m' } = {}) =>
    new SignJWT({ email: 'nao-usado@example.com', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(claims.iss ?? 'https://accounts.google.com')
      .setAudience(claims.aud ?? CLIENT)
      .setSubject('1234567890')
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(key);

  assert.equal(await verify(await sign()), '1234567890');
  assert.equal(await verify(await sign({ iss: 'accounts.google.com' })), '1234567890'); // as duas formas valem
  assert.equal(await verify(await sign({ aud: 'outro-cliente' })), null);
  assert.equal(await verify(await sign({ iss: 'https://malvado.example' })), null);
  assert.equal(await verify(await sign({}, { exp: Math.floor(Date.now() / 1000) - 3600 })), null);
  const other = await generateKeyPair('RS256');
  assert.equal(await verify(await sign({}, { key: other.privateKey })), null); // assinado por outra chave
  assert.equal(await verify('nao.e.jwt'), null);
  assert.equal(await verify(null), null);
});

test('/config diz se o Google está ligado; desligado, as rotas recusam', async () => {
  const on = await start();
  assert.equal((await api(on, 'GET', '/config')).body.googleClientId, 'cliente-teste.apps.googleusercontent.com');
  const off = await start({ googleClientId: null, verifyGoogle: undefined });
  assert.equal((await api(off, 'GET', '/config')).body.googleClientId, null);
  assert.equal((await api(off, 'POST', '/auth/google', { body: { credential: 'ok:1' } })).status, 404);
});

test('primeira vez com o Google: escolhe o apelido e a conta nasce sem senha', async () => {
  const s = await start();
  const first = await api(s, 'POST', '/auth/google', { body: { credential: 'ok:sub-ana' } });
  assert.equal(first.status, 200);
  assert.equal(first.body.needsNickname, true);
  assert.equal(first.body.session, undefined);
  const { ticket } = first.body;

  await api(s, 'POST', '/auth/register', { body: { nickname: 'Ocupado', password: 'senha-de-teste' } });
  const taken = await api(s, 'POST', '/auth/google/complete', { body: { ticket, nickname: 'ocupado' } });
  assert.equal(taken.status, 409);
  const bad = await api(s, 'POST', '/auth/google/complete', { body: { ticket, nickname: 'Robô Ana' } });
  assert.equal(bad.status, 400);

  const done = await api(s, 'POST', '/auth/google/complete', { body: { ticket, nickname: 'Ana do Google' } });
  assert.equal(done.status, 201);
  assert.deepEqual(done.body.user, {
    id: done.body.user.id,
    nickname: 'Ana do Google',
    hasPassword: false,
    hasGoogle: true,
  });
  assert.equal((await api(s, 'GET', '/me', { session: done.body.session })).body.user.nickname, 'Ana do Google');

  // o ticket vale uma vez só
  const again = await api(s, 'POST', '/auth/google/complete', { body: { ticket, nickname: 'Outra Ana' } });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /expirou/);

  // da segunda vez em diante, entra direto
  const next = await api(s, 'POST', '/auth/google', { body: { credential: 'ok:sub-ana' } });
  assert.equal(next.body.needsNickname, undefined);
  assert.equal(next.body.user.nickname, 'Ana do Google');
  assert.ok(next.body.session);

  // conta só do Google não entra com apelido e senha
  const pass = await api(s, 'POST', '/auth/login', { body: { nickname: 'Ana do Google', password: '' } });
  assert.equal(pass.status, 401);
});

test('token do Google que não vale e ticket que não existe', async () => {
  const s = await start();
  const res = await api(s, 'POST', '/auth/google', { body: { credential: 'falso' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.session, undefined);
  assert.equal((await api(s, 'POST', '/auth/google', { body: {} })).status, 401);
  assert.equal(
    (await api(s, 'POST', '/auth/google/complete', { body: { ticket: 'inventado', nickname: 'Bia' } })).status,
    400,
  );
});

test('o ticket vence em 10 minutos', async () => {
  const s = await start();
  let now = Date.now();
  s.accounts().now = () => now;
  const { ticket } = (await api(s, 'POST', '/auth/google', { body: { credential: 'ok:sub-lento' } })).body;
  now += 11 * 60_000;
  const res = await api(s, 'POST', '/auth/google/complete', { body: { ticket, nickname: 'Lento' } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /expirou/);
});

test('apagar conta do Google pede para entrar com o Google de novo (a mesma conta)', async () => {
  const s = await start();
  const { ticket } = (await api(s, 'POST', '/auth/google', { body: { credential: 'ok:sub-caio' } })).body;
  const { session } = (await api(s, 'POST', '/auth/google/complete', { body: { ticket, nickname: 'Caio G' } })).body;

  const none = await api(s, 'DELETE', '/account', { session, body: {} });
  assert.equal(none.status, 401);
  assert.equal(none.body.code, undefined); // não é sessão vencida: falta confirmar
  assert.match(none.body.error, /Google/);
  assert.equal((await api(s, 'DELETE', '/account', { session, body: { credential: 'ok:sub-outro' } })).status, 401);
  // mandar o sub direto no pedido não adianta: ele só sai de um token conferido
  assert.equal((await api(s, 'DELETE', '/account', { session, body: { googleSub: 'sub-caio' } })).status, 401);
  assert.equal((await api(s, 'DELETE', '/account', { session, body: { credential: 'ok:sub-caio' } })).status, 200);
  const gone = await api(s, 'GET', '/me', { session });
  assert.equal(gone.status, 401);
  assert.equal(gone.body.code, 'session');
});

test('limite de tentativas também no Google', async () => {
  const s = await start({ authLimits: { loginIp: { max: 2, windowMs: 60_000 } } });
  assert.equal((await api(s, 'POST', '/auth/google', { body: { credential: 'ok:a' } })).status, 200);
  assert.equal((await api(s, 'POST', '/auth/google', { body: { credential: 'ok:b' } })).status, 200);
  assert.equal((await api(s, 'POST', '/auth/google', { body: { credential: 'ok:c' } })).status, 429);
});
