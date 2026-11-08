// Salas (23): entrar, sair, remover, reconectar, bots e jogada automática por tempo.
// Outros arquivos cobrem o resto do server/rooms.js: host.test.js (anfitrião), away.test.js
// (queda na vez e ausente), names.test.js (apelidos e saída da mesa), kick.test.js (barreira),
// spectators.test.js (plateia), rematch.test.js (revanche) e reactions.test.js;
// multiplayer.test.js passa pela rede de verdade.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, MAX_PLAYERS, BOT_NAMES } from '../server/rooms.js';

// io falso que guarda o que foi enviado para cada socket
function fakeIo() {
  const sent = [];
  return {
    sent,
    to: (target) => ({ emit: (event, data) => sent.push({ target, event, data }) }),
    sockets: { sockets: new Map() },
  };
}
const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });

beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }));
afterEach(() => mock.timers.reset());

function setup() {
  const io = fakeIo();
  const manager = new RoomManager(io);
  const r = manager.create();
  const enter = (token, name = token, socketId = `s-${token}`) => {
    const socket = fakeSocket(socketId);
    const res = r.join(socket, { token, name });
    return { res, socket, id: r.members.find((m) => m.token === token)?.id };
  };
  return { io, manager, r, enter };
}

const said = (r, text) => r.chat.some((m) => m.system && m.text === text);

// ---------- entrar ----------

test('entrar: o primeiro vira anfitrião, recebe o código e o estado', () => {
  const { io, r, enter } = setup();
  const ana = enter('ana', 'Ana');
  assert.deepEqual(ana.res, { ok: true, code: r.code, spectator: false });
  assert.equal(r.hostId, ana.id);
  assert.equal(ana.socket.data.code, r.code);
  assert.equal(ana.socket.data.memberId, ana.id);
  assert.ok(said(r, 'Ana entrou na sala'));
  const state = io.sent.findLast((e) => e.event === 'state' && e.target === 's-ana');
  assert.equal(state.data.me, ana.id);
  assert.equal(state.data.hostId, ana.id);
  r.dispose();
});

test('entrar: sem token não entra, sem apelido vira "Jogador"', () => {
  const { r } = setup();
  assert.deepEqual(r.join(fakeSocket('x'), { name: 'Ana' }), { ok: false, error: 'Sessão inválida' });
  r.join(fakeSocket('y'), { token: 't', name: '   ' });
  assert.equal(r.members[0].name, 'Jogador');
  r.dispose();
});

test('entrar: quem entra recebe o histórico do chat', () => {
  const { r, enter } = setup();
  const ana = enter('ana', 'Ana');
  r.say(ana.id, 'oi gente');
  const sock = fakeSocket('s-bia');
  const got = [];
  sock.emit = (event, data) => got.push({ event, data });
  r.join(sock, { token: 'bia', name: 'Bia' });
  const history = got.find((e) => e.event === 'chat:history');
  assert.ok(history.data.some((m) => m.text === 'oi gente'));
  r.dispose();
});

// ---------- sair ----------

test('sair no lobby: some da sala e o chat avisa', () => {
  const { r, enter } = setup();
  enter('ana', 'Ana');
  const bia = enter('bia', 'Bia');
  r.leave(bia.id);
  assert.equal(r.member(bia.id), undefined);
  assert.ok(said(r, 'Bia saiu da sala'));
  r.dispose();
});

test('sair no meio da partida: sai da mesa e a vez passa', () => {
  const { r, enter } = setup();
  const ids = ['ana', 'bia', 'caio'].map((t) => enter(t).id);
  r.start(ids[0]);
  const turn = r.game.players[r.game.turn].id;
  r.leave(turn);
  const p = r.game.players.find((x) => x.id === turn);
  assert.equal(p.eliminated, true);
  assert.equal(p.hand.length, 0);
  assert.notEqual(r.game.players[r.game.turn].id, turn);
  r.dispose();
});

test('sair: o último humano a sair fecha a sala, mesmo com bots', () => {
  const { manager, r, enter } = setup();
  const ana = enter('ana');
  r.addBot(ana.id);
  r.leave(ana.id);
  assert.equal(manager.get(r.code), undefined);
});

test('sair: quem cai no lobby e não volta em 30s sai; sem ninguém, a sala fecha', () => {
  const { manager, r, enter } = setup();
  const ana = enter('ana');
  r.disconnect(ana.id, 's-ana');
  mock.timers.tick(30_000); // no lobby, o lugar fica guardado 30s e depois a pessoa sai
  assert.equal(manager.get(r.code), undefined, 'sem ninguém, a sala fecha junto');
});

// ---------- remover ----------

test('remover: só o anfitrião, e não a si mesmo', () => {
  const { io, r, enter } = setup();
  const ana = enter('ana');
  const bia = enter('bia');
  assert.equal(r.kick(bia.id, ana.id).ok, false);
  assert.deepEqual(r.kick(ana.id, ana.id), { ok: false, error: 'Use o botão de sair' });
  assert.deepEqual(r.kick(ana.id, 'nada'), { ok: false, error: 'Jogador não encontrado' });
  assert.deepEqual(r.kick(ana.id, bia.id), { ok: true });
  assert.ok(io.sent.some((e) => e.target === 's-bia' && e.event === 'room:kicked'));
  assert.equal(r.member(bia.id), undefined);
  r.dispose();
});

// ---------- reconectar ----------

test('reconectar: mesmo token volta para o mesmo lugar, com as mesmas cartas', () => {
  const { r, enter } = setup();
  const ana = enter('ana');
  const bia = enter('bia');
  r.start(ana.id);
  const hand = r.game.players.find((p) => p.id === bia.id).hand.map((c) => c.id);
  r.disconnect(bia.id, 's-bia');
  assert.equal(r.member(bia.id).connected, false);
  const back = enter('bia', 'bia', 's-bia-2');
  assert.equal(back.id, bia.id);
  assert.equal(r.member(bia.id).connected, true);
  assert.equal(r.members.length, 2);
  assert.deepEqual(r.viewFor(bia.id, []).game.hand.map((c) => c.id), hand);
  r.dispose();
});

test('reconectar no lobby: o lugar fica guardado por 30s', () => {
  const { r, enter } = setup();
  enter('ana');
  const bia = enter('bia');
  r.disconnect(bia.id, 's-bia');
  mock.timers.tick(29_000);
  enter('bia', 'bia', 's-bia-2');
  mock.timers.tick(10_000);
  assert.ok(r.member(bia.id), 'voltou a tempo e continua');

  r.disconnect(bia.id, 's-bia-2');
  mock.timers.tick(30_000);
  assert.equal(r.member(bia.id), undefined, 'não voltou: perde o lugar');
  r.dispose();
});

test('reconectar: a queda de uma conexão velha não derruba a nova', () => {
  const { r, enter } = setup();
  const ana = enter('ana');
  enter('ana', 'ana', 's-ana-2');
  r.disconnect(ana.id, 's-ana');
  assert.equal(r.member(ana.id).connected, true);
  r.dispose();
});

// ---------- bots ----------

test('adicionar bot: só o anfitrião, fora da partida e com lugar na mesa', () => {
  const { r, enter } = setup();
  const ana = enter('ana');
  const bia = enter('bia');
  assert.equal(r.addBot(bia.id).ok, false);
  assert.deepEqual(r.addBot(ana.id), { ok: true });
  const bot = r.members.at(-1);
  assert.equal(bot.isBot, true);
  assert.equal(bot.name, BOT_NAMES[0]);
  assert.ok(bot.avatar);
  r.start(ana.id);
  assert.deepEqual(r.addBot(ana.id), { ok: false, error: 'Espere a partida acabar' });
  r.dispose();
});

test('adicionar bot: nomes diferentes e para quando a mesa enche', () => {
  const { r, enter } = setup();
  const ana = enter('ana');
  for (let i = 1; i < MAX_PLAYERS; i++) assert.equal(r.addBot(ana.id).ok, true);
  assert.deepEqual(r.addBot(ana.id), { ok: false, error: 'A sala está cheia' });
  const names = r.members.filter((m) => m.isBot).map((m) => m.name);
  assert.equal(new Set(names).size, names.length);
  r.dispose();
});

test('bot joga sozinho depois de 3 a 5 segundos', () => {
  const { r, enter } = setup();
  const ana = enter('ana');
  r.addBot(ana.id);
  r.start(ana.id);
  const bot = r.members[1].id;
  // joga pela Ana até a vez ser do bot (o Ás, o 9 e o 7 numa mesa de dois devolvem a vez)
  let roundJustStarted = true;
  for (let i = 0; i < 50 && r.game.players[r.game.turn]?.id !== bot; i++) {
    if (r.game.phase === 'roundOver') {
      r.setReady(ana.id);
      roundJustStarted = true;
    } else {
      r.autoplay(ana.id, false);
      roundJustStarted = false;
    }
  }
  assert.equal(r.game.players[r.game.turn].id, bot);
  const seq = r.turnSeq;
  const left = r.deadline - Date.now();
  // se o bot abre a rodada, ainda espera a distribuição das cartas (3,5s)
  const deal = roundJustStarted ? 3500 : 0;
  assert.ok(left >= 3000 + deal && left <= 5000 + deal, `prazo do bot: ${left}ms`);
  mock.timers.tick(left - 1);
  assert.equal(r.turnSeq, seq);
  mock.timers.tick(2);
  assert.ok(r.turnSeq > seq || r.game.phase !== 'playing', 'o bot jogou');
  r.dispose();
});

// ---------- tempo esgotado ----------

test('tempo esgotado: o jogo joga pela pessoa e avisa no chat', () => {
  const { r, enter } = setup();
  const ana = enter('ana', 'Ana');
  const bia = enter('bia', 'Bia');
  r.updateSettings(ana.id, { turnSeconds: 15 });
  r.start(ana.id);
  const turn = r.game.players[r.game.turn].id;
  const name = r.member(turn).name;
  const seq = r.turnSeq;
  const left = r.deadline - Date.now();
  assert.equal(left, 15_000 + 3500, '15s mais a distribuição das cartas na primeira vez');
  mock.timers.tick(left - 1);
  assert.equal(r.turnSeq, seq, 'ainda dentro do prazo');
  mock.timers.tick(2);
  assert.ok(said(r, `O tempo de ${name} acabou, jogada automática`));
  assert.ok(r.turnSeq > seq, 'a vez andou');
  void bia;
  r.dispose();
});

test('configurações: só o anfitrião e só valores conhecidos', () => {
  const { r, enter } = setup();
  const ana = enter('ana');
  const bia = enter('bia');
  assert.equal(r.updateSettings(bia.id, { turnSeconds: 15 }).ok, false);
  r.updateSettings(ana.id, { turnSeconds: 7, isPublic: 'sim' });
  assert.deepEqual(r.settings, { isPublic: true, turnSeconds: 30 });
  r.updateSettings(ana.id, { turnSeconds: 60, isPublic: false });
  assert.deepEqual(r.settings, { isPublic: false, turnSeconds: 60 });
  r.dispose();
});
