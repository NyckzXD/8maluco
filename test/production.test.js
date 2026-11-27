// Limites (36) e configuração de produção (37), com servidor e clientes reais.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { fileURLToPath } from 'node:url';
import { createGameServer, clientIp, originAllowed, configFromEnv } from '../server/index.js';

const servers = [];
const clients = [];

after(async () => {
  for (const c of clients) c.close();
  for (const s of servers) {
    for (const code of [...s.rooms.rooms.keys()]) s.rooms.delete(code);
    s.io.close();
  }
});

async function start(options = {}) {
  const s = createGameServer(options);
  servers.push(s);
  await new Promise((resolve) => s.server.listen(0, resolve));
  s.url = `http://localhost:${s.server.address().port}`;
  return s;
}

// Conecta e devolve o socket, ou o erro de conexão.
function client(s, opts = {}) {
  const c = connect(s.url, { transports: ['websocket'], forceNew: true, reconnection: false, ...opts });
  clients.push(c);
  return new Promise((resolve) => {
    c.once('connect', () => resolve(c));
    c.once('connect_error', (err) => resolve({ error: err.message }));
  });
}

const call = (c, event, data) => c.timeout(2000).emitWithAck(event, data);

test('IP real atrás de proxy e cabeçalho ignorado sem proxy', () => {
  const headers = { 'x-forwarded-for': '6.6.6.6, 1.2.3.4' };
  assert.equal(clientIp(headers, '10.0.0.1', 0), '10.0.0.1', 'sem proxy, não confia no cabeçalho');
  assert.equal(clientIp(headers, '10.0.0.1', 1), '1.2.3.4', 'um proxy: o último da lista');
  assert.equal(clientIp(headers, '10.0.0.1', 2), '6.6.6.6');
  assert.equal(clientIp({}, '10.0.0.1', 1), '10.0.0.1');
});

test('origens: a própria e as liberadas', () => {
  const allowed = ['capacitor://localhost'];
  assert.ok(originAllowed(undefined, 'jogo.com', allowed), 'sem Origin (app nativo, curl)');
  assert.ok(originAllowed('https://jogo.com', 'jogo.com', allowed));
  assert.ok(originAllowed('capacitor://localhost', 'jogo.com', allowed));
  assert.ok(!originAllowed('https://outro.site', 'jogo.com', allowed));
  assert.ok(!originAllowed('lixo', 'jogo.com', allowed));
});

test('configuração pelo ambiente', () => {
  const c = configFromEnv({ ALLOWED_ORIGINS: 'capacitor://localhost, http://localhost', NODE_ENV: 'production' });
  assert.deepEqual(c.allowedOrigins, ['capacitor://localhost', 'http://localhost']);
  assert.equal(c.trustProxy, 1, 'em produção, um proxy na frente');
  assert.equal(configFromEnv({}).trustProxy, 0);
  assert.deepEqual(configFromEnv({}).allowedOrigins, []);
});

test('site de outra origem não conecta', async () => {
  const s = await start();
  const evil = await client(s, { extraHeaders: { origin: 'https://outro.site' } });
  assert.ok(evil.error);
  const own = await client(s, { extraHeaders: { origin: s.url } });
  assert.ok(own.connected);
});

test('mensagem maior que 16KB derruba só aquela conexão', async () => {
  const s = await start();
  const c = await client(s);
  const dropped = new Promise((resolve) => c.once('disconnect', resolve));
  c.emit('chat', { text: 'x'.repeat(20_000) });
  await dropped;
  const other = await client(s);
  assert.equal((await call(other, 'room:list')).ok, true, 'o servidor segue de pé');
});

test('criar salas tem teto geral', async () => {
  const s = await start({ maxRooms: 2 });
  for (const name of ['Ana', 'Bia']) {
    const c = await client(s);
    assert.equal((await call(c, 'room:create', { token: name, name })).ok, true);
  }
  const late = await client(s);
  assert.deepEqual(await call(late, 'room:create', { token: 'Edu', name: 'Edu' }), {
    ok: false,
    error: 'Servidor cheio, tente daqui a pouco',
  });
});

test('criar salas tem limite por conexão', async () => {
  const s = await start();
  const c = await client(s);
  for (let i = 0; i < 5; i++) assert.equal((await call(c, 'room:create', { token: `a${i}`, name: 'Ana' })).ok, true);
  const sixth = await call(c, 'room:create', { token: 'a5', name: 'Ana' });
  assert.equal(sixth.ok, false);
  assert.match(sixth.error, /muitas salas/);
  assert.equal(s.rooms.rooms.size, 1, 'cada sala nova fecha a anterior dessa conexão');
});

test('tentativas de código de sala têm limite', async () => {
  const s = await start();
  const c = await client(s);
  for (let i = 0; i < 12; i++)
    assert.equal((await call(c, 'room:join', { code: 'ZZZZZ', token: 't' })).error, 'Sala não encontrada');
  assert.match((await call(c, 'room:join', { code: 'ZZZZZ', token: 't' })).error, /Muitas tentativas/);
});

test('ações de jogo seguidas sem pausa são cortadas', async () => {
  const s = await start({ rateLimits: { 'game:draw': { max: 3, windowMs: 60_000 } } });
  const c = await client(s);
  await call(c, 'room:create', { token: 'x', name: 'Ana' });
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await call(c, 'game:draw')).error);
  assert.equal(results[3], 'Muitas ações seguidas. Espere um pouquinho.');
});

test('conexões por IP têm limite', async () => {
  const s = await start({ maxConnectionsPerIp: 2 });
  assert.ok((await client(s)).connected);
  assert.ok((await client(s)).connected);
  assert.equal((await client(s)).error, 'Muitas conexões deste endereço');
});

test('arquivos de texto vão comprimidos', async () => {
  // public/ no lugar do dist/ (o build não precisa existir para o teste)
  const s = await start({ client: fileURLToPath(new URL('../public', import.meta.url)) });
  for (const path of ['/sw.js', '/bg-pattern.svg']) {
    const res = await fetch(`${s.url}${path}`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-encoding'), 'gzip', path);
  }
});

test('/health mostra salas, partidas e conexões', async () => {
  const s = await start();
  const c = await client(s);
  await call(c, 'room:create', { token: 'h', name: 'Ana' });
  await call(c, 'room:addBot');
  await call(c, 'room:start');
  const health = await (await fetch(`${s.url}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.rooms, 1);
  assert.equal(health.games, 1);
  assert.equal(health.players, 1);
  assert.equal(health.connections, 1);
  // chat de voz: quantos estão no voz e se dá para atravessar as redes (o segredo do TURN não aparece)
  assert.equal(health.inVoice, 0);
  await call(c, 'voice:join', {});
  const after = await (await fetch(`${s.url}/health`)).json();
  assert.equal(after.inVoice, 1);
  assert.deepEqual(after.voice, { stun: true, turn: false });

  const withTurn = await start({ stunUrls: [], turnUrls: ['turn:t.test:3478'], turnSecret: 'segredo' });
  const body = await (await fetch(`${withTurn.url}/health`)).text();
  assert.deepEqual(JSON.parse(body).voice, { stun: false, turn: true });
  assert.ok(!body.includes('segredo'));
});

test('desligamento avisa as salas, para os timers e fecha', async () => {
  const s = await start();
  const c = await client(s);
  await call(c, 'room:create', { token: 'z', name: 'Ana' });
  await call(c, 'room:addBot');
  await call(c, 'room:start');
  const warned = new Promise((resolve) => c.once('server:restart', resolve));
  const chat = new Promise((resolve) => c.on('chat', (m) => m.text.includes('reiniciar') && resolve(m)));
  const done = s.shutdown();
  assert.match((await warned).message, /reiniciar/);
  assert.ok((await chat).system);
  const [room] = s.rooms.rooms.values();
  assert.equal(room.timer, null, 'nenhum bot joga enquanto fecha');
  await done;
  assert.equal(s.server.listening, false);
});

test('publicado sem o build: a página explica o que falta e o /health continua no ar', async () => {
  const s = await start({ client: 'pasta-que-nao-existe', production: true });
  const page = await fetch(`${s.url}/`);
  assert.equal(page.status, 503);
  assert.match(await page.text(), /npm run build/);
  assert.equal((await (await fetch(`${s.url}/health`)).json()).ok, true);
});
