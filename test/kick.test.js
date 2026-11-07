// Removido pelo anfitrião (35): não volta pelo mesmo link enquanto a sala existir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';

const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });
const enter = (r, token, name = token) => r.join(fakeSocket(`s-${token}-${Math.random()}`), { token, name });

test('quem foi removido não entra de novo com o mesmo token', () => {
  const r = new RoomManager(fakeIo()).create();
  enter(r, 'host');
  enter(r, 'chato');
  const host = r.hostId;
  const chato = r.members[1].id;
  assert.deepEqual(r.kick(host, chato), { ok: true });
  assert.deepEqual(enter(r, 'chato'), { ok: false, error: 'Você foi removido desta sala' });
  assert.equal(r.members.length, 1);
  // outras pessoas continuam entrando normalmente
  assert.equal(enter(r, 'outra').ok, true);
  r.dispose();
});

test('a barreira é só desta sala', () => {
  const manager = new RoomManager(fakeIo());
  const a = manager.create();
  enter(a, 'host');
  enter(a, 'chato');
  a.kick(a.hostId, a.members[1].id);
  const b = manager.create();
  assert.equal(enter(b, 'chato').ok, true);
  a.dispose();
  b.dispose();
});

test('remover bot não barra nada e dá para adicionar bot de novo', () => {
  const r = new RoomManager(fakeIo()).create();
  enter(r, 'host');
  r.addBot(r.hostId);
  r.kick(r.hostId, r.members[1].id);
  assert.equal(r.banned.size, 0);
  assert.equal(r.addBot(r.hostId).ok, true);
  r.dispose();
});
