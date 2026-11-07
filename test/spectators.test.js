// Plateia (34): 8 na mesa, até 4 assistindo, e a mesa nova pela ordem de chegada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, MAX_PLAYERS, MAX_SPECTATORS } from '../server/rooms.js';

const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });
const enter = (r, i) => r.join(fakeSocket(`s${i}`), { token: `tok-${i}`, name: `P${i}` });

function setup() {
  const manager = new RoomManager(fakeIo());
  return { manager, r: manager.create() };
}

test('mesa cheia ainda aceita até 4 na plateia, e depois fecha', () => {
  const { manager, r } = setup();
  for (let i = 0; i < MAX_PLAYERS; i++) assert.equal(enter(r, i).spectator, false);
  for (let i = 0; i < MAX_SPECTATORS; i++) {
    const res = enter(r, 100 + i);
    assert.equal(res.ok, true);
    assert.equal(res.spectator, true, 'quem chega com a mesa cheia vai para a plateia');
  }
  assert.deepEqual(enter(r, 999), { ok: false, error: 'A sala está cheia' });

  const view = r.viewFor(r.members[0].id, []);
  assert.equal(view.spectators.length, MAX_SPECTATORS);
  assert.equal(view.maxSpectators, MAX_SPECTATORS);
  const [listed] = manager.listPublic();
  assert.equal(listed.players, MAX_PLAYERS);
  assert.equal(listed.watching, MAX_SPECTATORS);
  assert.equal(listed.full, true);
  r.dispose();
});

test('quem entra no meio da partida é plateia, e a lista mostra que dá para assistir', () => {
  const { manager, r } = setup();
  enter(r, 0);
  enter(r, 1);
  r.start(r.hostId);
  const res = enter(r, 2);
  assert.equal(res.spectator, true);
  const [listed] = manager.listPublic();
  assert.equal(listed.playing, true);
  assert.equal(listed.players, 2);
  assert.equal(listed.watching, 1);
  assert.equal(listed.full, false);
  // não segura a rodada nem tem mão
  const view = r.viewFor(r.members[2].id, []);
  assert.deepEqual(view.spectators, [r.members[2].id]);
  assert.deepEqual(view.game.hand, []);
  r.dispose();
});

test('na partida nova sentam os 8 primeiros a chegar; o resto continua na plateia', () => {
  const { r } = setup();
  for (let i = 0; i < MAX_PLAYERS + 2; i++) enter(r, i);
  const ids = r.members.map((m) => m.id);
  r.start(r.hostId);
  assert.deepEqual(r.game.players.map((p) => p.id), ids.slice(0, MAX_PLAYERS));

  // um da mesa sai: na revanche, o primeiro da plateia senta
  r.leave(ids[3]);
  r.game.phase = 'gameOver';
  r.clearTimer();
  const nextTable = ids.filter((id) => id !== ids[3]).slice(0, MAX_PLAYERS);
  // a revanche espera só quem vai sentar (o último da plateia não segura)
  assert.deepEqual(r.rematchWaitingOn().sort(), [...nextTable].sort());
  for (const id of nextTable) r.rematch(id);
  assert.equal(r.game.phase, 'playing');
  assert.deepEqual(r.game.players.map((p) => p.id), nextTable);
  assert.deepEqual(r.viewFor(ids[0], []).spectators, [ids.at(-1)]);
  r.dispose();
});
