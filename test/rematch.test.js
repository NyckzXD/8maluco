import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';

function fakeIo() {
  return {
    to: () => ({ emit() {} }),
    sockets: { sockets: new Map() },
  };
}

const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });

// Sala com os humanos pedidos (+ bots), já no fim de uma partida.
function finishedRoom({ humans = 1, bots = 1, turnSeconds = 45 } = {}) {
  const room = new RoomManager(fakeIo()).create();
  const ids = [];
  for (let i = 0; i < humans; i++) {
    room.join(fakeSocket(`s${i}`), { token: `tok-${i}`, name: `Jogador ${i}` });
    ids.push(room.members.at(-1).id);
  }
  for (let i = 0; i < bots; i++) room.addBot(room.hostId);
  room.updateSettings(room.hostId, { turnSeconds });
  assert.equal(room.start(room.hostId).ok, true);
  room.game.phase = 'gameOver';
  room.clearTimer();
  return { room, ids, finished: room.game };
}

test('sozinho com bots: "Jogar de novo" recomeça na hora, com a mesma mesa e configurações', () => {
  const { room, ids, finished } = finishedRoom({ humans: 1, bots: 2, turnSeconds: 45 });
  const seats = room.members.map((m) => m.id);
  assert.deepEqual(room.rematch(ids[0]), { ok: true });
  assert.notEqual(room.game, finished);
  assert.equal(room.game.phase, 'playing');
  assert.deepEqual(
    room.game.players.map((p) => p.id),
    seats,
  );
  assert.ok(room.game.players.every((p) => p.score === 0 && !p.eliminated));
  assert.equal(room.settings.turnSeconds, 45);
  assert.equal(room.rematchVotes.size, 0);
  room.dispose();
});

test('com mais humanos, a revanche espera todo mundo ficar pronto', () => {
  const { room, ids, finished } = finishedRoom({ humans: 3, bots: 1 });
  room.rematch(ids[0]);
  assert.equal(room.game, finished);
  assert.deepEqual(room.viewFor(ids[0], []).rematch, [ids[0]]);
  assert.deepEqual(room.rematchWaitingOn().sort(), [ids[1], ids[2]].sort());
  // clicar de novo não conta duas vezes
  room.rematch(ids[0]);
  room.rematch(ids[1]);
  assert.equal(room.game, finished);
  assert.deepEqual(room.rematchWaitingOn(), [ids[2]]);
  room.rematch(ids[2]);
  assert.notEqual(room.game, finished);
  assert.equal(room.game.phase, 'playing');
  room.dispose();
});

test('quem caiu não segura a revanche e fica fora da mesa nova', () => {
  const { room, ids, finished } = finishedRoom({ humans: 2, bots: 1 });
  room.rematch(ids[0]);
  assert.equal(room.game, finished);
  room.disconnect(ids[1], 's1');
  assert.notEqual(room.game, finished);
  assert.equal(room.game.phase, 'playing');
  assert.equal(room.member(ids[1]), undefined);
  assert.equal(room.game.players.length, 2);
  room.dispose();
});

test('quem sai da sala também libera a revanche', () => {
  const { room, ids, finished } = finishedRoom({ humans: 2, bots: 1 });
  room.rematch(ids[1]);
  room.leave(ids[0]);
  assert.notEqual(room.game, finished);
  assert.equal(room.game.phase, 'playing');
  room.dispose();
});

test('revanche só no fim da partida e só para humanos da sala', () => {
  const { room, ids } = finishedRoom({ humans: 1, bots: 1 });
  const bot = room.members.find((m) => m.isBot).id;
  assert.equal(room.rematch(bot).ok, false);
  assert.equal(room.rematch('ninguem').ok, false);
  room.rematch(ids[0]); // recomeça
  assert.equal(room.rematch(ids[0]).ok, false); // partida rolando
  room.dispose();
});

test('voltar para a sala apaga os pedidos de revanche', () => {
  const { room, ids } = finishedRoom({ humans: 2, bots: 0 });
  room.rematch(ids[1]);
  assert.equal(room.backToLobby(room.hostId).ok, true);
  assert.equal(room.game, null);
  assert.equal(room.rematchVotes.size, 0);
  room.dispose();
});
