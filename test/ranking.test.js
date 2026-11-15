// Ranking: o que a sala manda no fim da partida (quem tinha conta, se valeu), o que o banco
// grava e a ordem do /api/leaderboard.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { Accounts } from '../server/auth.js';
import { openDatabase } from '../server/db.js';
import { createGameServer } from '../server/index.js';
import { RANKED_MIN_HUMANS } from '../shared/ranking.js';
import { randomAvatar } from '../shared/avatar.js';

function fakeIo() {
  return { to: () => ({ emit() {} }), sockets: { sockets: new Map() } };
}
// `user`: a conta do socket (o que o handshake põe em socket.data.user)
const fakeSocket = (id, user = null) => ({ id, data: { user }, join() {}, leave() {}, emit() {} });

// Sala com os jogadores pedidos ({ user } para quem tem conta, { bot } para bot), já jogando.
function playingRoom(seats) {
  const summaries = [];
  const manager = new RoomManager(fakeIo(), { onGameOver: (s) => summaries.push(s) });
  const room = manager.create();
  const ids = [];
  seats.forEach((seat, i) => {
    if (seat.bot) room.addBot(room.hostId);
    else
      room.join(fakeSocket(`s${i}`, seat.user ?? null), {
        token: `tok-${i}`,
        name: `Gente ${i}`,
        avatar: randomAvatar(),
      });
    ids.push(room.members.at(-1).id);
  });
  assert.equal(room.start(room.hostId).ok, true);
  room.clearTimer();
  return { room, ids, summaries, manager };
}

// Termina a partida do jeito que o motor avisa: fim da rodada e fim de jogo.
function finish(room, winnerId, round = 1) {
  room.game.phase = 'gameOver';
  room.apply({
    events: [
      { type: 'roundEnd', winnerId, round, results: [] },
      { type: 'gameOver', winnerId },
    ],
  });
}

const ana = { id: 1, nickname: 'Ana' };
const bia = { id: 2, nickname: 'Bia' };
const caio = { id: 3, nickname: 'Caio' };

test(`vale com ${RANKED_MIN_HUMANS} pessoas na mesa; bots não contam e convidado conta para chegar lá`, () => {
  const { room, ids, summaries } = playingRoom([{ user: ana }, { user: bia }, {}, { bot: true }]);
  assert.equal(room.viewFor(ids[0], []).ranked, true);
  finish(room, ids[1]);
  assert.equal(summaries.length, 1);
  const s = summaries[0];
  assert.equal(s.ranked, true);
  assert.equal(s.humans, 3);
  assert.equal(s.bots, 1);
  // só quem tem conta entra no resumo
  assert.deepEqual(
    s.players.map((p) => [p.userId, p.won, p.roundsWon]),
    [
      [1, false, 0],
      [2, true, 1],
    ],
  );
  assert.ok(s.players[0].avatar, 'leva o avatar junto');
  room.dispose();
});

test('duas pessoas e bots não valem', () => {
  const { room, ids, summaries } = playingRoom([{ user: ana }, { user: bia }, { bot: true }, { bot: true }]);
  assert.equal(room.viewFor(ids[0], []).ranked, false);
  finish(room, ids[0]);
  assert.equal(summaries.length, 1); // grava no histórico, mas marcada como não valendo
  assert.equal(summaries[0].ranked, false);
  room.dispose();
});

test('ninguém com conta: nada vai para o banco', () => {
  const { room, ids, summaries } = playingRoom([{}, {}, {}]);
  finish(room, ids[0]);
  assert.equal(summaries.length, 0);
  room.dispose();
});

test('quem sai no meio conta a partida (sem vitória) e o fim só é gravado uma vez', () => {
  const { room, ids, summaries } = playingRoom([{ user: ana }, { user: bia }, { user: caio }]);
  room.leave(ids[0]);
  room.leave(ids[1]); // sobra o Caio: o motor dá o jogo para ele
  assert.equal(room.game.phase, 'gameOver');
  assert.equal(summaries.length, 1);
  assert.deepEqual(
    summaries[0].players.map((p) => [p.userId, p.won]),
    [
      [1, false],
      [2, false],
      [3, true],
    ],
  );
  finish(room, ids[2]); // um gameOver repetido não grava de novo
  assert.equal(summaries.length, 1);
  room.dispose();
});

test('rodadas vencidas contam e a revanche começa um registro novo', () => {
  const { room, ids, summaries } = playingRoom([{ user: ana }, { user: bia }, {}]);
  room.apply({ events: [{ type: 'roundEnd', winnerId: ids[0], round: 1, results: [] }] });
  room.apply({ events: [{ type: 'roundEnd', winnerId: ids[0], round: 2, results: [] }] });
  room.clearTimer();
  finish(room, ids[1], 3);
  assert.deepEqual(
    summaries[0].players.map((p) => [p.userId, p.roundsWon]),
    [
      [1, 2],
      [2, 1],
    ],
  );
  room.newGame('Revanche!');
  room.clearTimer();
  finish(room, ids[0]);
  assert.equal(summaries.length, 2);
  assert.deepEqual(
    summaries[1].players.map((p) => [p.userId, p.won, p.roundsWon]),
    [
      [1, true, 1],
      [2, false, 0],
    ],
  );
  room.dispose();
});

test('o registro da partida sobrevive ao reinício do servidor', () => {
  const { room, ids, manager } = playingRoom([{ user: ana }, { user: bia }, {}]);
  const data = JSON.parse(JSON.stringify(manager.snapshot()));
  room.dispose();
  const summaries = [];
  const manager2 = new RoomManager(fakeIo(), { onGameOver: (s) => summaries.push(s) });
  assert.equal(manager2.restore(data), 1);
  const back = manager2.get(room.code);
  back.clearTimer();
  finish(back, ids[1]);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].ranked, true);
  assert.deepEqual(
    summaries[0].players.map((p) => p.userId),
    [1, 2],
  );
  back.dispose();
});

// ---------- banco ----------

async function accountsWith(...names) {
  const accounts = new Accounts(openDatabase(':memory:'));
  const ids = {};
  for (const nickname of names) {
    const res = await accounts.register({ nickname, password: 'senha-de-teste' });
    assert.ok(res.ok);
    if (res.ok) ids[nickname] = /** @type {any} */ (res.user).id;
  }
  return { accounts, ids };
}

const game = (ranked, players) => ({ code: 'ABCDE', ranked, humans: 3, bots: 0, players });
const seat = (userId, won, roundsWon = 0, avatar = null) => ({ userId, won, roundsWon, avatar });

test('ranking: só partidas que valem, mais vitórias primeiro, empate desfeito por menos partidas', async () => {
  const { accounts, ids } = await accountsWith('Ana', 'Bia', 'Caio', 'Duda');
  const { Ana, Bia, Caio, Duda } = ids;
  accounts.recordGame(game(true, [seat(Ana, true, 3, { skin: 2 }), seat(Bia, false, 1)]));
  accounts.recordGame(game(true, [seat(Ana, true), seat(Bia, false), seat(Caio, false)]));
  accounts.recordGame(game(true, [seat(Bia, true), seat(Caio, false)]));
  accounts.recordGame(game(true, [seat(Caio, true)]));
  // não vale: não muda nada
  accounts.recordGame(game(false, [seat(Duda, true), seat(Caio, true)]));

  const board = accounts.leaderboard();
  assert.deepEqual(
    board.map((r) => [r.nickname, r.rank, r.wins, r.games]),
    [
      ['Ana', 1, 2, 2],
      ['Caio', 2, 1, 3], // 1 vitória em 3 partidas...
      ['Bia', 2, 1, 3], // ...empata com a Bia: mesma posição (ordem pelo apelido)
    ].sort((a, b) => Number(a[1]) - Number(b[1]) || String(a[0]).localeCompare(String(b[0]))),
  );
  assert.equal(
    board.find((r) => r.nickname === 'Duda'),
    undefined,
  ); // só jogou partida que não vale
  assert.deepEqual(board[0].avatar, { skin: 2 });
  assert.equal(board[0].rounds, 3);
  accounts.db.close();
});

test('conta apagada sai do ranking; partida com conta já apagada grava o resto', async () => {
  const { accounts, ids } = await accountsWith('Edu', 'Fabi');
  accounts.recordGame(game(true, [seat(ids.Edu, true), seat(ids.Fabi, false)]));
  assert.equal(accounts.leaderboard().length, 2);
  assert.ok((await accounts.deleteAccount(ids.Edu, { password: 'senha-de-teste' })).ok);
  assert.deepEqual(
    accounts.leaderboard().map((r) => r.nickname),
    ['Fabi'],
  );
  accounts.recordGame(game(true, [seat(ids.Edu, true), seat(ids.Fabi, true)]));
  assert.equal(accounts.leaderboard()[0].wins, 1);
  accounts.db.close();
});

// ---------- rota ----------

const servers = [];
after(async () => {
  for (const s of servers) await s.shutdown();
});

test('/api/leaderboard: os primeiros e a sua posição', async () => {
  const s = createGameServer({ client: null, databaseFile: ':memory:' });
  servers.push(s);
  await new Promise((resolve) => s.server.listen(0, resolve));
  const url = `http://localhost:${s.server.address().port}/api/leaderboard`;
  const accounts = s.accounts();
  const sessions = {};
  const users = {};
  for (const nickname of ['Gabi', 'Hugo', 'Iara']) {
    const res = await accounts.register({ nickname, password: 'senha-de-teste' });
    if (!res.ok) throw new Error(res.error);
    sessions[nickname] = res.session;
    users[nickname] = /** @type {any} */ (res.user).id;
  }
  accounts.recordGame(game(true, [seat(users.Gabi, true), seat(users.Hugo, false), seat(users.Iara, false)]));
  accounts.recordGame(game(true, [seat(users.Hugo, true), seat(users.Iara, false)]));

  const anon = await (await fetch(url)).json();
  assert.equal(anon.total, 3);
  assert.equal(anon.me, null);
  assert.deepEqual(
    anon.top.map((r) => r.nickname),
    ['Gabi', 'Hugo', 'Iara'],
  );
  assert.equal(anon.top[0].password_hash, undefined);

  const mine = await (await fetch(`${url}?limit=1`, { headers: { Authorization: `Bearer ${sessions.Iara}` } })).json();
  assert.equal(mine.top.length, 1);
  assert.equal(mine.me.nickname, 'Iara');
  assert.equal(mine.me.rank, 3);
  assert.equal(mine.me.games, 2);
});

// ---------- TOP 1 ----------

test('TOP 1: quem está em 1º (empate divide), ninguém sem vitória, e muda com a partida nova', async () => {
  const { accounts, ids } = await accountsWith('Lia', 'Max', 'Nina');
  // ranking vazio: ninguém é TOP 1
  assert.equal(accounts.isTop1(ids.Lia), false);
  // só derrotas valendo: ninguém tem vitória, ninguém é TOP 1
  accounts.recordGame(game(true, [seat(ids.Lia, false), seat(ids.Max, false)]));
  assert.equal(accounts.isTop1(ids.Lia), false);
  accounts.recordGame(game(true, [seat(ids.Lia, true), seat(ids.Max, false)]));
  assert.equal(accounts.isTop1(ids.Lia), true);
  assert.equal(accounts.isTop1(ids.Max), false);
  // a Nina empata em vitórias e partidas: as duas em 1º
  accounts.recordGame(game(true, [seat(ids.Nina, true)]));
  accounts.recordGame(game(true, [seat(ids.Nina, false)]));
  assert.equal(accounts.isTop1(ids.Lia), true);
  assert.equal(accounts.isTop1(ids.Nina), true);
  // mais uma vitória da Nina: só ela
  accounts.recordGame(game(true, [seat(ids.Nina, true)]));
  assert.equal(accounts.isTop1(ids.Lia), false);
  assert.equal(accounts.isTop1(ids.Nina), true);
  // conta apagada sai do topo
  assert.ok((await accounts.deleteAccount(ids.Nina, { password: 'senha-de-teste' })).ok);
  assert.equal(accounts.isTop1(ids.Lia), true);
  accounts.db.close();
});

test('TOP 1 aparece na sala só para a conta que está em 1º', () => {
  const manager = new RoomManager(fakeIo(), { isTop1: (userId) => userId === 1 });
  const room = manager.create();
  room.join(fakeSocket('s0', ana), { token: 't0', name: 'x' });
  room.join(fakeSocket('s1', bia), { token: 't1', name: 'x' });
  room.join(fakeSocket('s2'), { token: 't2', name: 'Convidado' });
  room.addBot(room.hostId);
  const view = room.viewFor(room.members[0].id, []);
  assert.deepEqual(
    view.members.map((m) => [m.name.startsWith('Robô') ? 'bot' : m.name, m.top1]),
    [
      ['Ana', true],
      ['Bia', false],
      ['Convidado', false],
      ['bot', false],
    ],
  );
  room.dispose();
});
