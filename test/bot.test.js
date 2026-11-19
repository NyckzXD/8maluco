import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startRound, playCard, drawCard, passTurn, buildDeck, canPlay } from '../shared/engine.js';
import { chooseMove, chooseMoveBasic, inferHands } from '../shared/bot.js';

const c = (rank, suit, n = 0) => ({ id: `${rank}${suit}t${n}`, rank, suit });

// Mesa com o monte num 5 de copas, vez do p0. O baralho é o que sobra de um baralho completo.
function table(hands, { top = c('5', 'H', 99), turn = 0 } = {}) {
  const s = createGame(
    hands.map((_, i) => ({ id: `p${i}`, name: `P${i}` })),
    { seed: 42, dealer: hands.length - 1 },
  );
  s.players.forEach((p, i) => (p.hand = hands[i]));
  const used = new Set([...hands.flat(), top].map((x) => x.rank + x.suit));
  s.drawPile = buildDeck(1, 2).filter((x) => !used.has(x.rank + x.suit));
  s.decks = 1;
  s.discard = [top];
  s.activeSuit = top.suit;
  s.activeRank = top.rank;
  s.turn = turn;
  s.phase = 'playing';
  return s;
}

function apply(s, id, m) {
  return m.type === 'play' ? playCard(s, id, m.cardId, m.suit) : m.type === 'draw' ? drawCard(s, id) : passTurn(s, id);
}

test('bate quando a última carta serve', () => {
  const s = table([[c('9', 'H')], [c('2', 'S'), c('3', 'S')]]);
  assert.deepEqual(chooseMove(s, 'p0', { seed: 1 }), { type: 'play', cardId: c('9', 'H').id });
});

test('sem jogada compra; depois de comprar sem jogada passa', () => {
  const s = table([
    [c('2', 'S'), c('3', 'S')],
    [c('2', 'C'), c('3', 'C')],
  ]);
  assert.equal(chooseMove(s, 'p0', { seed: 1 }).type, 'draw');
  s.hasDrawn = true;
  assert.equal(chooseMove(s, 'p0', { seed: 1 }).type, 'pass');
});

test('guarda o 8 para bater: com 8 e outra carta que serve, joga a outra', () => {
  const s = table([
    [c('8', 'S'), c('K', 'H')],
    [c('2', 'C'), c('3', 'C'), c('4', 'C')],
  ]);
  assert.equal(chooseMove(s, 'p0', { seed: 3 }).cardId, c('K', 'H').id);
});

test('no 8, escolhe o naipe que tem na mão', () => {
  const hand = [c('8', 'S'), c('2', 'D'), c('6', 'D'), c('J', 'D'), c('K', 'C')];
  const s = table([hand, [c('2', 'C'), c('3', 'C'), c('4', 'C')]]);
  const m = chooseMove(s, 'p0', { seed: 5 });
  assert.equal(m.cardId, c('8', 'S').id, 'só o 8 serve');
  assert.equal(m.suit, 'D');
});

test('com o próximo a uma carta de bater, faz ele comprar', () => {
  // p1 tem 1 carta: o 9 faz ele comprar 2 e perder a vez
  const s = table([[c('9', 'H'), c('4', 'H'), c('2', 'S'), c('3', 'S')], [c('6', 'H')]]);
  assert.equal(chooseMove(s, 'p0', { seed: 7 }).cardId, c('9', 'H').id);
});

test('não olha as cartas escondidas: mesma informação pública, mesma jogada', () => {
  const mine = [c('4', 'H'), c('K', 'H'), c('5', 'S'), c('Q', 'C'), c('7', 'H')];
  const a = table([mine, [c('2', 'S'), c('3', 'C'), c('J', 'D')], [c('6', 'D'), c('10', 'C')]]);
  // mesmas contagens, mas os adversários têm outras cartas e o baralho está em outra ordem
  const b = table([mine, [c('9', 'D'), c('A', 'S'), c('2', 'C')], [c('K', 'S'), c('3', 'D')]]);
  b.drawPile.reverse();
  assert.equal(a.drawPile.length, b.drawPile.length);
  for (const seed of [1, 2, 3]) assert.deepEqual(chooseMove(a, 'p0', { seed }), chooseMove(b, 'p0', { seed }));
});

test('deduz o que o adversário não tem: comprou e a vez passou sozinha', () => {
  const s = table(
    [
      [c('2', 'S'), c('3', 'S')],
      [c('2', 'C'), c('3', 'C')],
    ],
    { turn: 1 },
  );
  s.drawPile.push(c('J', 'D', 7)); // a carta que ele vai comprar não serve
  drawCard(s, 'p1');
  assert.equal(s.turn, 0);
  const slots = inferHands(s, 0);
  assert.equal(slots[1].length, 3);
  for (const slot of slots[1]) {
    assert.equal(slot.jk, true, 'sem Joker');
    assert.ok(slot.sm & (1 << 1), 'sem copas');
    assert.ok(slot.rm & (1 << 4), 'sem 5');
    assert.ok(slot.rm & (1 << 7), 'sem 8');
  }
  assert.deepEqual(slots[0], [], 'a própria mão não entra');
});

test('a dedução não vale para cartas novas e é esquecida quando falha', () => {
  const s = table([
    [c('2', 'S'), c('3', 'S')],
    [c('2', 'C'), c('3', 'C'), c('9', 'D'), c('10', 'D'), c('J', 'D')],
  ]);
  s.rules = { ...s.rules, handSize: 2 };
  s.log = [
    { t: 'draw', p: 1, suit: 'H', rank: '5', auto: true },
    { t: 'take', p: 1, n: 2 },
  ];
  let slots = inferHands(s, 0);
  assert.equal(slots[1].filter((x) => x.jk).length, 3);
  assert.equal(slots[1].filter((x) => !x.jk).length, 2);
  // jogou uma copas: só pode ter vindo de uma das cartas novas
  s.log.push({ t: 'play', p: 1, rank: '4', suit: 'H' });
  s.players[1].hand.pop();
  slots = inferHands(s, 0);
  assert.equal(slots[1].length, 4);
  assert.equal(slots[1].filter((x) => x.jk).length, 3);
  // jogou outra copas, mas não sobrou vaga livre: a dedução estava errada e é esquecida
  s.log.push({ t: 'play', p: 1, rank: '6', suit: 'H' }, { t: 'play', p: 1, rank: '7', suit: 'H' });
  s.players[1].hand.pop();
  s.players[1].hand.pop();
  slots = inferHands(s, 0);
  assert.equal(slots[1].length, 2);
  assert.equal(slots[1].filter((x) => x.jk).length, 0);
});

test('só faz jogadas válidas em partidas inteiras', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const n = 2 + (seed % 4);
    const s = createGame(
      Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}` })),
      { seed },
    );
    let moves = 0;
    while (s.phase !== 'gameOver') {
      if (s.phase !== 'playing') {
        startRound(s);
        continue;
      }
      const id = s.players[s.turn].id;
      const m = id === 'b0' ? chooseMove(s, id, { maxRollouts: 200, seed: moves }) : chooseMoveBasic(s, id);
      if (m.type === 'play') {
        const card = s.players[s.turn].hand.find((x) => x.id === m.cardId);
        assert.ok(card && canPlay(s, card));
      }
      assert.ok(apply(s, id, m).ok);
      assert.ok(++moves < 100000);
    }
  }
});

test('respeita o tempo máximo para pensar', () => {
  const s = createGame(
    Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, name: `B${i}` })),
    { seed: 9 },
  );
  startRound(s);
  const t = Date.now();
  chooseMove(s, s.players[s.turn].id, { maxRollouts: 1e9, maxMs: 80 });
  assert.ok(Date.now() - t < 400);
});
