// Conta dentro da sala: a sessão vem no handshake do socket, o nome é o apelido da conta e
// convidado não usa apelido de conta. Servidor de verdade, com o banco na memória.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/index.js';
import { RESERVED_NAME_ERROR } from '../shared/names.js';

let srv;
let url;
const sockets = [];

before(async () => {
  srv = createGameServer({ client: null, databaseFile: ':memory:', timing: { hostGraceMs: 200 } });
  await new Promise((resolve) => srv.server.listen(0, resolve));
  url = `http://localhost:${srv.server.address().port}`;
});

after(async () => {
  for (const s of sockets) s.close();
  for (const code of [...srv.rooms.rooms.keys()]) srv.rooms.delete(code);
  await srv.shutdown();
});

let n = 0;
async function account(nickname) {
  const res = await srv.accounts().register({ nickname, password: 'senha-de-teste' });
  assert.ok(res.ok);
  if (!res.ok) throw new Error(res.error);
  return res.session;
}

// Um jogador: socket (com ou sem sessão), o último estado e atalhos.
async function player({ name = `P${++n}`, session, token = `tok-${Math.random()}` } = {}) {
  const s = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { session } });
  sockets.push(s);
  await new Promise((resolve) => s.once('connect', resolve));
  const p = { s, token, name, last: null };
  s.on('state', (st) => (p.last = st));
  p.call = (event, data) => s.timeout(2000).emitWithAck(event, data);
  p.create = () => p.call('room:create', { token: p.token, name: p.name });
  p.join = (code) => p.call('room:join', { code, token: p.token, name: p.name });
  // o membro de quem tem esse id, no último estado que chegou para `p`
  p.names = () => Object.fromEntries(p.last.members.map((m) => [m.id, m.name]));
  p.me = () => p.last.members.find((m) => m.id === p.last.me);
  return p;
}

const settle = () => new Promise((r) => setTimeout(r, 80));

test('logado entra com o apelido da conta, seja qual for o nome que mandar', async () => {
  const session = await account('Marta');
  const p = await player({ name: 'Outro Nome', session });
  const res = await p.create();
  assert.ok(res.ok);
  await settle();
  assert.equal(p.me().name, 'Marta');
  assert.equal(p.me().account, true);
});

test('sessão inválida entra como convidado', async () => {
  const p = await player({ name: 'Convidada', session: 'nao-existe' });
  assert.ok((await p.create()).ok);
  await settle();
  assert.equal(p.me().name, 'Convidada');
  assert.equal(p.me().account, false);
});

test('convidado não usa apelido de conta (nem com outra caixa ou sem acento)', async () => {
  await account('Zé Lima');
  const host = await player({ name: 'Anfitriã' });
  const { code } = await host.create();
  for (const name of ['Zé Lima', 'ze lima', 'ZE LIMA']) {
    const g = await player({ name });
    const res = await g.join(code);
    assert.equal(res.ok, false, name);
    assert.equal(res.error, RESERVED_NAME_ERROR);
  }
  // criar sala com o nome também não dá
  const g = await player({ name: 'Zé Lima' });
  assert.equal((await g.create()).error, RESERVED_NAME_ERROR);
});

test('convidado que já estava com o nome antes da conta existir volta normalmente; a conta fica com o nome', async () => {
  const guest = await player({ name: 'Rafa' });
  const { code } = await guest.create();
  const session = await account('Rafa'); // a conta nasce depois
  // cai e volta com o mesmo token: não perde o lugar
  guest.s.close();
  await settle();
  const back = await player({ name: 'Rafa', token: guest.token });
  assert.ok((await back.join(code)).ok);
  await settle();
  assert.equal(back.me().name, 'Rafa');
  // a dona da conta chega: o nome é dela, o convidado vira "Rafa 2"
  const owner = await player({ session });
  assert.ok((await owner.join(code)).ok);
  await settle();
  assert.equal(owner.me().name, 'Rafa');
  assert.equal(owner.names()[back.me().id], 'Rafa 2');
});

test('a mesma conta em outro aparelho assume o mesmo lugar', async () => {
  const session = await account('Téo');
  const a = await player({ session });
  const { code } = await a.create();
  await settle();
  const seat = a.me().id;
  const replaced = new Promise((resolve) => a.s.once('room:replaced', resolve));
  const b = await player({ session, token: 'outro-aparelho' });
  assert.ok((await b.join(code)).ok);
  await replaced;
  await settle();
  assert.equal(b.me().id, seat);
  assert.equal(b.last.members.filter((m) => m.name === 'Téo').length, 1);
});

test('conta removida pelo anfitrião não volta nem por outro aparelho', async () => {
  const session = await account('Vivi');
  const host = await player({ name: 'Dona' });
  const { code } = await host.create();
  const v = await player({ session });
  assert.ok((await v.join(code)).ok);
  await settle();
  const id = v.me().id;
  assert.ok((await host.call('room:kick', { id })).ok);
  const other = await player({ session, token: 'token-novo' });
  const res = await other.join(code);
  assert.equal(res.ok, false);
  assert.match(res.error, /removido/);
});

test('o snapshot guarda de quem é cada lugar', async () => {
  const session = await account('Yuri');
  const p = await player({ session });
  const { code } = await p.create();
  const saved = srv.rooms.get(code).toJSON();
  const user = srv.accounts().userForSession(session);
  assert.equal(saved.members[0].userId, user.id);
});
