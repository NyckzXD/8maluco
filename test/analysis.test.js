// Análise do bot forte: só para as contas liberadas (ANALYSIS_USERS), só na própria vez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { configFromEnv } from '../server/index.js';
import { nicknameKey } from '../shared/names.js';
import { randomAvatar } from '../shared/avatar.js';

const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
const fakeSocket = (id, user = null) => ({ id, data: { user }, join() {}, leave() {}, emit() {} });

const ana = { id: 1, nickname: 'Ána' };
const bia = { id: 2, nickname: 'Bia' };

// Ana, Bia, um convidado e um bot, já jogando. Só a Ana está liberada.
function playingRoom() {
  const allowed = configFromEnv({ ANALYSIS_USERS: ' ana , Zé ' }).analysisUsers;
  const manager = new RoomManager(fakeIo(), { isAnalyst: (u) => allowed.includes(nicknameKey(u.nickname)) });
  const room = manager.create();
  const ids = [];
  [ana, bia, null].forEach((user, i) => {
    room.join(fakeSocket(`s${i}`, user), { token: `tok-${i}`, name: `Gente ${i}`, avatar: randomAvatar() });
    ids.push(room.members.at(-1).id);
  });
  room.addBot(room.hostId);
  assert.equal(room.start(room.hostId).ok, true);
  room.clearTimer();
  return { room, ids };
}

test('ANALYSIS_USERS: apelidos separados por vírgula, sem acento nem caixa', () => {
  assert.deepEqual(configFromEnv({ ANALYSIS_USERS: ' Ana ,Zé,, ' }).analysisUsers, ['ana', 'ze']);
  assert.deepEqual(configFromEnv({}).analysisUsers, []);
});

test('só a conta liberada vê a análise, e só na própria vez', () => {
  const { room, ids } = playingRoom();
  const [anaId, biaId, guestId] = ids;
  assert.equal(room.viewFor(anaId, []).analyst, true);
  assert.equal(room.viewFor(biaId, []).analyst, false);
  assert.equal(room.viewFor(guestId, []).analyst, false);

  const g = room.game;
  g.turn = g.players.findIndex((p) => p.id === biaId);
  assert.match(room.analyze(biaId).error, /não liberada/);
  assert.match(room.analyze(anaId).error, /sua vez/);

  g.turn = g.players.findIndex((p) => p.id === anaId);
  const r = room.analyze(anaId);
  assert.equal(r.ok, true);
  assert.ok(r.samples > 0);
  assert.equal(r.moves.filter((m) => m.best).length, 1);
  assert.equal(r.moves[0].best, true, 'a melhor vem primeiro');
  assert.equal(r.moves[0].loss, 0);
  assert.ok(r.moves.every((m) => m.loss >= 0));
  assert.ok(
    r.moves.some((m) => m.type === 'draw'),
    'comprar também é opção',
  );
  // a jogada sugerida é válida
  const best = r.moves[0];
  if (best.type === 'play') assert.ok(g.players[g.turn].hand.some((c) => c.id === best.cardId));
  // mesma situação: a mesma análise, sem pensar de novo
  assert.equal(room.analyze(anaId).key, r.key);
  assert.equal(room.analyze(anaId).moves, r.moves);
  room.dispose();
});

test('quem volta sem a conta perde a análise', () => {
  const { room, ids } = playingRoom();
  room.join(fakeSocket('s9', null), { token: 'tok-0', name: 'Gente 0', avatar: randomAvatar() });
  assert.equal(room.viewFor(ids[0], []).analyst, false);
  room.dispose();
});

test('os bots da mesa jogam com a heurística simples (rápidos)', () => {
  const { room } = playingRoom();
  const g = room.game;
  const bot = room.members.find((m) => m.isBot);
  g.turn = g.players.findIndex((p) => p.id === bot.id);
  const t = Date.now();
  for (let i = 0; i < 50 && g.phase === 'playing' && g.players[g.turn].id === bot.id; i++) room.autoplay(bot.id, true);
  assert.ok(Date.now() - t < 100, 'a busca forte levaria bem mais');
  room.dispose();
});
