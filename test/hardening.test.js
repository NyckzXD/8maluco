// Snapshot periódico, cabeçalhos de segurança/cache e sessão do socket que acaba no logout ou
// ao apagar a conta. Servidor de verdade, banco na memória.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect } from 'socket.io-client';
import { RoomManager } from '../server/rooms.js';
import { startSnapshots } from '../server/snapshot.js';
import { contentSecurityPolicy, createGameServer } from '../server/index.js';

const dir = mkdtempSync(join(tmpdir(), '8maluco-hard-'));
const servers = [];
const sockets = [];
after(async () => {
  for (const s of sockets) s.close();
  for (const s of servers) {
    for (const code of [...s.rooms.rooms.keys()]) s.rooms.delete(code);
    await s.shutdown();
  }
  rmSync(dir, { recursive: true, force: true });
});

const fakeIo = () => ({ to: () => ({ emit() {} }), emit() {}, sockets: { sockets: new Map() } });
const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(options = {}) {
  const s = createGameServer({ client: null, databaseFile: ':memory:', snapshotFile: null, ...options });
  servers.push(s);
  await new Promise((resolve) => s.server.listen(0, resolve));
  s.url = `http://localhost:${s.server.address().port}`;
  return s;
}

// ---------- snapshot periódico ----------

test('snapshot periódico: grava sozinho, só quando muda, apaga quando a última sala esvazia', async () => {
  const file = join(dir, 'periodic', 'rooms.json');
  const manager = new RoomManager(fakeIo());
  const auto = startSnapshots(manager, file, { intervalMs: 40 });
  try {
    assert.equal(auto.save(), true, 'a primeira passada sempre conta');
    assert.ok(!existsSync(file), 'sem sala com gente, nada no disco');
    assert.equal(auto.save(), false, 'nada mudou');

    const r = manager.create();
    r.join(fakeSocket('a'), { token: 'tok-a', name: 'Ana' });
    await wait(150); // o timer grava sem ninguém chamar
    const first = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(
      first.rooms.map((x) => x.code),
      [r.code],
    );
    assert.equal(auto.save(), false, 'a mesma sala de novo não reescreve');
    assert.deepEqual(readdirSync(join(dir, 'periodic')), ['rooms.json'], 'escrita atômica: nenhum .tmp sobrando');

    r.say(r.hostId, 'mudou');
    assert.equal(auto.save(), true, 'chat novo grava de novo');
    assert.ok(readFileSync(file, 'utf8').includes('mudou'));

    manager.delete(r.code);
    assert.equal(auto.save(), true);
    assert.ok(!existsSync(file), 'sem salas, o arquivo velho some');
  } finally {
    auto.stop();
    for (const code of [...manager.rooms.keys()]) manager.delete(code);
  }
});

test('snapshot periódico: um erro de disco fica no log e a próxima passada tenta de novo', () => {
  const blocker = join(dir, 'blocker');
  writeFileSync(blocker, 'arquivo no lugar da pasta');
  const manager = new RoomManager(fakeIo());
  const r = manager.create();
  r.join(fakeSocket('a'), { token: 'tok-a', name: 'Ana' });
  const errors = [];
  const auto = startSnapshots(manager, join(blocker, 'rooms.json'), {
    intervalMs: 60_000,
    log: { error: (...a) => errors.push(a) },
  });
  try {
    assert.equal(auto.save(), false);
    assert.equal(errors.length, 1);
    rmSync(blocker);
    mkdirSync(blocker);
    assert.equal(auto.save(), true, 'depois que o disco volta, grava');
    assert.ok(existsSync(join(blocker, 'rooms.json')));
  } finally {
    auto.stop();
    manager.delete(r.code);
  }
});

test('startAutosave respeita SNAPSHOT_FILE=off e para no desligamento, que ainda grava', async () => {
  const off = await start({ snapshotFile: null });
  assert.equal(off.startAutosave(), null, 'sem arquivo, sem gravação periódica');

  const file = join(dir, 'server', 'rooms.json');
  const s = await start({ snapshotFile: file });
  const auto = s.startAutosave(file, 30);
  assert.ok(auto);
  assert.equal(s.startAutosave(file, 30), auto, 'um timer só');
  const r = s.rooms.create();
  r.join(fakeSocket('a'), { token: 'tok-a', name: 'Ana' });
  await wait(120);
  assert.ok(existsSync(file), 'gravou com o servidor rodando');
  await s.shutdown({ snapshotFile: file });
  servers.splice(servers.indexOf(s), 1);
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).rooms.length === 1, 'o desligamento grava a última versão');
});

// ---------- cabeçalhos ----------

test('cabeçalhos de segurança e cache dos arquivos do cliente', async () => {
  const client = join(dir, 'dist');
  mkdirSync(join(client, 'assets'), { recursive: true });
  writeFileSync(join(client, 'index.html'), '<!doctype html><title>8</title>');
  writeFileSync(join(client, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(client, 'sw.js'), '');
  const s = await start({ client, production: true });

  for (const path of ['/', '/index.html', '/assets/index-abc123.js', '/api/config', '/health']) {
    const res = await fetch(s.url + path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', path);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.match(csp, /default-src 'self'/, path);
  }
  const asset = await fetch(`${s.url}/assets/index-abc123.js`);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  for (const path of ['/', '/index.html', '/sw.js']) {
    const res = await fetch(s.url + path);
    assert.equal(res.headers.get('cache-control'), 'no-cache', path);
  }
});

test('CSP: o que o cliente usa continua liberado', () => {
  const prod = contentSecurityPolicy({ production: true });
  const dir = Object.fromEntries(
    prod.split('; ').map((d) => {
      const [name, ...values] = d.split(' ');
      return [name, values];
    }),
  );
  assert.ok(dir['img-src'].includes('data:'), 'SVGs em data: no CSS');
  assert.ok(dir['style-src'].includes("'self'"));
  assert.ok(dir['font-src'].includes("'self'"), 'fontes em /fonts');
  assert.ok(dir['connect-src'].includes("'self'"), 'socket.io (CSP3: self cobre ws/wss da mesma origem)');
  assert.ok(dir['script-src'].includes('https://accounts.google.com/gsi/client'), 'Entrar com o Google');
  assert.ok(dir['frame-src'].includes('https://accounts.google.com/gsi/'));
  assert.ok(!dir['script-src'].includes("'unsafe-inline'") && !dir['script-src'].includes("'unsafe-eval'"));
  assert.ok(!dir['connect-src'].includes('ws:'), 'produção não libera WebSocket para qualquer lugar');
  assert.match(contentSecurityPolicy({ production: false }), /connect-src [^;]*ws:/, 'HMR do Vite no desenvolvimento');
});

// ---------- sessão do socket ----------

async function account(s, nickname) {
  const res = await s.accounts().register({ nickname, password: 'senha-de-teste' });
  if (!res.ok) throw new Error(res.error);
  return { session: res.session, id: s.accounts().userForSession(res.session).id };
}

async function player(s, session) {
  const c = connect(s.url, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { session } });
  sockets.push(c);
  await new Promise((resolve) => c.once('connect', resolve));
  const p = { c, ended: null, gone: null, last: null };
  c.on('session:ended', (e) => (p.ended = e));
  c.on('disconnect', (reason) => (p.gone = reason));
  c.on('state', (st) => (p.last = st));
  p.call = (event, data) => c.timeout(2000).emitWithAck(event, data);
  return p;
}

const api = (s, method, path, session, body) =>
  fetch(s.url + '/api' + path, {
    method,
    headers: { Authorization: `Bearer ${session}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  }).then((r) => r.json());

test('logout derruba as conexões daquela sessão (e só delas); quem volta entra como convidado', async () => {
  const s = await start();
  const ana = await account(s, 'AnaLogout');
  const other = (await s.accounts().login({ nickname: 'AnaLogout', password: 'senha-de-teste' })).session;
  const bia = await account(s, 'BiaFica');

  const p1 = await player(s, ana.session);
  const p2 = await player(s, other); // a mesma conta, outro aparelho (outra sessão)
  const pb = await player(s, bia.session);
  const created = await p1.call('room:create', { token: 'tok-ana', name: 'x' });
  assert.ok(created.ok);
  await wait(50);
  assert.equal(p1.last.members.find((m) => m.id === p1.last.me).name, 'AnaLogout');

  assert.deepEqual(await api(s, 'POST', '/auth/logout', ana.session), { ok: true });
  await wait(100);
  assert.deepEqual(p1.ended, { reason: 'logout' });
  assert.equal(p1.gone, 'io server disconnect');
  assert.equal(p2.ended, null, 'a outra sessão da conta continua');
  assert.ok(p2.c.connected);
  assert.ok(pb.c.connected && pb.ended === null, 'outra conta não é afetada');

  // volta sem sessão, com o mesmo token: o mesmo lugar, agora como convidado
  const back = await player(s);
  const rejoin = await back.call('room:join', { code: created.code, token: 'tok-ana', name: 'Ana Convidada' });
  assert.ok(rejoin.ok, rejoin.error);
  await wait(50);
  const me = back.last.members.find((m) => m.id === back.last.me);
  assert.equal(me.account, false);
  assert.equal(me.name, 'Ana Convidada');

  // a sessão velha não vale mais nem para conectar como conta
  const stale = await player(s, ana.session);
  const solo = await stale.call('room:create', { token: 'tok-stale', name: 'Zé' });
  await wait(50);
  assert.equal(stale.last.members.find((m) => m.id === stale.last.me).account, false);
  assert.ok(solo.ok);
});

test('apagar a conta derruba todas as conexões dela', async () => {
  const s = await start();
  const caio = await account(s, 'CaioApaga');
  const second = (await s.accounts().login({ nickname: 'CaioApaga', password: 'senha-de-teste' })).session;
  const guest = await player(s);
  const p1 = await player(s, caio.session);
  const p2 = await player(s, second);

  // senha errada: nada acontece
  const wrong = await api(s, 'DELETE', '/account', caio.session, { password: 'errada-errada' });
  assert.equal(wrong.ok, false);
  await wait(50);
  assert.ok(p1.c.connected && p2.c.connected);

  const res = await api(s, 'DELETE', '/account', caio.session, { password: 'senha-de-teste' });
  assert.deepEqual(res, { ok: true });
  await wait(100);
  for (const p of [p1, p2]) {
    assert.deepEqual(p.ended, { reason: 'deleted' });
    assert.equal(p.gone, 'io server disconnect');
  }
  assert.ok(guest.c.connected && guest.ended === null);
  assert.equal(s.endSessions({ userId: caio.id }), 0, 'não sobrou conexão nenhuma com ela');
});
