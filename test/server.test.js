// Servidor de verdade numa porta qualquer, com clientes socket.io reais.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/index.js';

let srv;
let url;
const clients = [];

before(async () => {
  srv = createGameServer();
  await new Promise((resolve) => srv.server.listen(0, resolve));
  url = `http://localhost:${srv.server.address().port}`;
});

after(async () => {
  for (const c of clients) c.close();
  for (const code of [...srv.rooms.rooms.keys()]) srv.rooms.delete(code);
  srv.io.close();
  await new Promise((resolve) => srv.server.close(resolve));
});

async function client() {
  const c = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  await new Promise((resolve) => c.once('connect', resolve));
  return c;
}

const call = (c, event, ...args) => c.timeout(2000).emitWithAck(event, ...args);
const next = (c, event) => new Promise((resolve) => c.once(event, resolve));

test('mensagens malformadas respondem erro e não derrubam o servidor', async () => {
  const c = await client();
  const events = [
    'room:list', 'room:create', 'room:join', 'room:leave', 'room:addBot', 'room:kick',
    'room:settings', 'room:start', 'room:lobby', 'game:rematch', 'chat', 'reaction',
    'game:play', 'game:draw', 'game:pass', 'game:ready',
  ];
  const payloads = [null, 42, 'texto', [1, 2], { code: { a: 1 }, token: ['x'], name: 7 }, { text: null }];
  for (const event of events) {
    for (const payload of payloads) {
      const res = await call(c, event, payload);
      assert.equal(typeof res.ok, 'boolean', `${event} com ${JSON.stringify(payload)}`);
    }
    c.emit(event, null); // sem ack também não pode derrubar
  }
  // ainda de pé: um cliente novo cria uma sala normalmente
  const other = await client();
  const created = await call(other, 'room:create', { token: 'tok-ok', name: 'Ana' });
  assert.equal(created.ok, true);
});

test('segunda aba com o mesmo token assume o lugar e a primeira perde o acesso', async () => {
  const first = await client();
  const created = await call(first, 'room:create', { token: 'tok-abas', name: 'Bia' });
  assert.equal(created.ok, true);
  const room = srv.rooms.get(created.code);

  const second = await client();
  const replaced = next(first, 'room:replaced');
  assert.equal((await call(second, 'room:join', { code: created.code, token: 'tok-abas', name: 'Bia' })).ok, true);
  assert.deepEqual(await replaced, { code: created.code });
  assert.equal(room.members.length, 1, 'continua sendo um jogador só');

  // a aba antiga não fala nem mexe mais na sala
  assert.equal((await call(first, 'chat', { text: 'oi' })).ok, false);
  assert.equal((await call(first, 'room:addBot')).ok, false);
  assert.equal(room.members.length, 1);
  // e a nova continua no comando
  assert.equal((await call(second, 'room:addBot')).ok, true);
  assert.equal(room.members.length, 2);

  // a queda da aba antiga não desconecta o jogador
  first.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(room.members.find((m) => !m.isBot).connected, true);
});
