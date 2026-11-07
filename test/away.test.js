// Queda na própria vez (29) e jogador parado que vira "ausente" (30).
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';

const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });

beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }));
afterEach(() => mock.timers.reset());

// Partida com dois humanos (30s por vez), já passada a distribuição das cartas.
function game() {
  const r = new RoomManager(fakeIo()).create();
  for (let i = 0; i < 2; i++) r.join(fakeSocket(`s${i}`), { token: `tok-${i}`, name: `Jogador ${i}` });
  assert.equal(r.start(r.hostId).ok, true);
  const turnId = () => r.game.players[r.game.turn].id;
  const member = (id) => r.member(id);
  const socketOf = (id) => `s${r.members.findIndex((m) => m.id === id)}`;
  const tokenOf = (id) => `tok-${r.members.findIndex((m) => m.id === id)}`;
  return { r, turnId, member, socketOf, tokenOf, left: () => r.deadline - Date.now() };
}

// Faz os outros jogarem até chegar a vez de `id` de novo (passando por fim de rodada, se houver).
function untilTurnOf({ r, turnId }, id) {
  for (let i = 0; i < 50; i++) {
    const g = r.game;
    if (g.phase === 'roundOver') for (const p of g.players) r.setReady(p.id);
    else if (turnId() === id && r.turnSeq) return;
    else r.autoplay(turnId(), false);
  }
  assert.fail('a vez não voltou');
}

const said = (r, text) => r.chat.some((m) => m.system && m.text.includes(text));

test('29: quem cai na própria vez mantém o prazo que tinha', () => {
  const t = game();
  const id = t.turnId();
  mock.timers.tick(10_000);
  const deadline = t.r.deadline;
  const seq = t.r.turnSeq;
  t.r.disconnect(id, t.socketOf(id));
  assert.equal(t.r.deadline, deadline, 'nada de jogada automática em 1,5s');
  mock.timers.tick(deadline - Date.now() - 100);
  assert.equal(t.r.turnSeq, seq, 'ainda é a vez dele');
  mock.timers.tick(200);
  assert.notEqual(t.r.turnSeq, seq, 'no fim do prazo o jogo joga por ele');
  assert.ok(!said(t.r, 'acabou'), 'cair não conta como tempo esgotado');
  t.r.dispose();
});

test('29: com pouco tempo sobrando, ganha pelo menos 10s, uma vez só', () => {
  const t = game();
  const id = t.turnId();
  mock.timers.tick(t.left() - 3000);
  t.r.disconnect(id, t.socketOf(id));
  assert.equal(t.left(), 10_000);
  // voltar e cair de novo não estica mais
  mock.timers.tick(4000);
  t.r.join(fakeSocket('volta'), { token: t.tokenOf(id), name: 'x' });
  t.r.disconnect(id, 'volta');
  assert.equal(t.left(), 6000);
  t.r.dispose();
});

test('29: quem volta dentro do prazo joga normalmente', () => {
  const t = game();
  const id = t.turnId();
  mock.timers.tick(5000);
  const deadline = t.r.deadline;
  t.r.disconnect(id, t.socketOf(id));
  mock.timers.tick(3000);
  t.r.join(fakeSocket('volta'), { token: t.tokenOf(id), name: 'x' });
  assert.equal(t.r.deadline, deadline);
  assert.equal(t.turnId(), id);
  t.r.dispose();
});

test('29: da vez seguinte em diante, desconectado joga no automático rápido', () => {
  const t = game();
  const id = t.turnId();
  t.r.disconnect(id, t.socketOf(id));
  mock.timers.tick(t.left() + 1);
  untilTurnOf(t, id);
  assert.equal(t.left(), 1500);
  t.r.dispose();
});

test('30: duas vezes seguidas sem jogar deixa o jogador ausente', () => {
  const t = game();
  const id = t.turnId();
  mock.timers.tick(t.left() + 1);
  assert.equal(t.member(id).away, undefined, 'uma vez só ainda não');
  untilTurnOf(t, id);
  mock.timers.tick(t.left() + 1);
  assert.equal(t.member(id).away, true);
  assert.ok(said(t.r, 'Jogador 0 está ausente') || said(t.r, 'Jogador 1 está ausente'));
  assert.equal(t.r.viewFor(id, []).members.find((m) => m.id === id).away, true);
  untilTurnOf(t, id);
  assert.equal(t.left(), 1500, 'ausente joga no automático rápido');
  t.r.dispose();
});

test('30: uma ação entre os tempos esgotados zera a contagem', () => {
  const t = game();
  const id = t.turnId();
  mock.timers.tick(t.left() + 1);
  t.r.touch(id); // mandou uma mensagem, uma reação, tocou na tela...
  untilTurnOf(t, id);
  mock.timers.tick(t.left() + 1);
  assert.ok(!t.member(id).away);
  t.r.dispose();
});

test('30: qualquer ação tira o ausente e, se for a vez dele, devolve o prazo cheio', () => {
  const t = game();
  const id = t.turnId();
  t.member(id).away = true;
  t.r.schedule(false);
  assert.equal(t.left(), 1500);
  t.r.touch(id);
  assert.equal(t.member(id).away, false);
  assert.equal(t.left(), 30_000);
  assert.ok(said(t.r, 'voltou'));
  t.r.dispose();
});

test('30: ausente não segura o "pronto" da rodada nem a revanche', () => {
  const t = game();
  const [a, b] = t.r.members.map((m) => m.id);
  t.member(b).away = true;
  t.r.game.phase = 'roundOver';
  assert.deepEqual(t.r.waitingOn(), [a]);
  t.r.game.phase = 'gameOver';
  assert.deepEqual(t.r.rematchWaitingOn(), [a]);
  t.r.dispose();
});
