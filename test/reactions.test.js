import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, takeSlot } from '../server/rooms.js';
import { REACTIONS, REACTION_LIMIT, isReaction } from '../shared/reactions.js';

// io de mentira: guarda tudo o que a sala emitiria para os sockets.
function fakeIo() {
  const sent = [];
  return {
    sent,
    to: (target) => ({ emit: (event, payload) => sent.push({ target, event, payload }) }),
    sockets: { sockets: new Map() },
  };
}

function fakeSocket(id) {
  return { id, data: {}, join() {}, leave() {}, emit() {} };
}

function roomWithPlayer() {
  const io = fakeIo();
  const manager = new RoomManager(io);
  const room = manager.create();
  const { ok } = room.join(fakeSocket('s1'), { token: 'tok-1', name: 'Ana' });
  assert.ok(ok);
  const me = room.members[0].id;
  const reactions = () => io.sent.filter((s) => s.event === 'reaction');
  return { room, me, reactions, done: () => room.dispose() };
}

test('só aceita reações da lista', () => {
  assert.ok(REACTIONS.length >= 4 && REACTIONS.length <= 8);
  for (const r of REACTIONS) assert.ok(isReaction(r.id));
  for (const bad of ['', 'xss<script>', null, 42, {}, 'BOA']) assert.equal(isReaction(bad), false);

  const { room, me, reactions, done } = roomWithPlayer();
  assert.equal(room.react(me, 'nada').ok, false);
  assert.equal(room.react('ninguem', 'boa').ok, false);
  assert.equal(reactions().length, 0);
  done();
});

test('reação válida vai para a sala toda com quem mandou', () => {
  const { room, me, reactions, done } = roomWithPlayer();
  assert.deepEqual(room.react(me, 'haha', 1000), { ok: true });
  assert.deepEqual(reactions(), [{ target: room.code, event: 'reaction', payload: { from: me, id: 'haha' } }]);
  done();
});

test('limite de frequência por pessoa, com a janela deslizando', () => {
  const { max, windowMs } = REACTION_LIMIT;
  const { room, me, reactions, done } = roomWithPlayer();
  const t0 = 10_000;
  for (let i = 0; i < max; i++) assert.equal(room.react(me, 'boa', t0 + i).ok, true);
  const blocked = room.react(me, 'boa', t0 + max);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /reagir/);
  assert.equal(reactions().length, max);
  // passada a janela da primeira, abre uma vaga
  assert.equal(room.react(me, 'ops', t0 + windowMs).ok, true);
  assert.equal(reactions().length, max + 1);
  done();
});

test('takeSlot descarta horários velhos e não muda a lista recebida', () => {
  const times = [0, 100, 200];
  const full = takeSlot(times, 300, { max: 3, windowMs: 1000 });
  assert.equal(full.ok, false);
  assert.deepEqual(times, [0, 100, 200]);
  const later = takeSlot(times, 1150, { max: 3, windowMs: 1000 });
  assert.deepEqual(later, { ok: true, times: [200, 1150] });
});
