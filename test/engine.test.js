import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  startRound,
  playCard,
  drawCard,
  passTurn,
  removePlayer,
  buildDeck,
  cardPoints,
  viewFor,
  canPlay,
} from '../shared/engine.js';
import { chooseMove } from '../shared/bot.js';

const c = (rank, suit, n = 0) => ({ id: `${rank}${suit}t${n}`, rank, suit });
const joker = (n = 0) => ({ id: `JKt${n}`, rank: 'JOKER', suit: null });

// Mesa com 4 jogadores, vez do p0, monte com 5 de copas.
function table(hands, { top = c('5', 'H', 99), turn = 0 } = {}) {
  const ids = hands.map((_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const s = createGame(ids, { seed: 42, dealer: hands.length - 1 });
  s.players.forEach((p, i) => (p.hand = hands[i]));
  s.drawPile = buildDeck(1, 2);
  s.decks = 1;
  s.discard = [top];
  s.activeSuit = top.suit;
  s.activeRank = top.rank;
  s.turn = turn;
  s.phase = 'playing';
  return s;
}

const filler = () => [c('2', 'S', 50), c('3', 'S', 51)];

test('distribui 9 cartas e o da direita do carteador abre o monte', () => {
  const s = createGame(
    [1, 2, 3, 4].map((n) => ({ id: `p${n}`, name: `P${n}` })),
    { seed: 7, dealer: 2 }
  );
  const r = startRound(s);
  assert.ok(r.ok);
  for (const p of s.players) assert.equal(p.hand.length, 9);
  assert.equal(s.turn, 3);
  assert.equal(s.discard.length, 0);
  assert.ok(s.players[3].hand.every((card) => canPlay(s, card)), 'quem abre joga qualquer carta');
  assert.equal(108 - 36, s.drawPile.length); // 4 jogadores = 2 baralhos
});

test('o carteador é sorteado e depois passa para a direita a cada rodada', () => {
  const s = createGame(
    [1, 2, 3].map((n) => ({ id: `p${n}`, name: `P${n}` })),
    { seed: 11 }
  );
  const first = s.dealer;
  startRound(s);
  assert.equal(s.dealer, first);
  s.phase = 'roundOver';
  startRound(s);
  assert.equal(s.dealer, (first + 1) % 3);
  assert.equal(s.turn, (first + 2) % 3);

});

test('usa mais de um baralho com muitos jogadores', () => {
  const s = createGame(
    Array.from({ length: 6 }, (_, n) => ({ id: `p${n}`, name: `P${n}` })),
    { seed: 3 }
  );
  startRound(s);
  assert.equal(s.drawPile.length + s.discard.length + 6 * 9, 108);
});

test('com todas as cartas nas mãos, entra um baralho novo', () => {
  const s = table([[c('K', 'S')], filler(), filler(), filler()]);
  s.drawPile = [];
  const r = drawCard(s, 'p0');
  assert.equal(r.drawn !== null, true);
  assert.equal(s.drawPile.length, 53);
  assert.equal(s.decks, 2);
});

test('pontuação das cartas', () => {
  assert.equal(cardPoints(c('A', 'S')), 1);
  assert.equal(cardPoints(c('7', 'S')), 7);
  assert.equal(cardPoints(c('10', 'S')), 10);
  assert.equal(cardPoints(c('K', 'S')), 10);
  assert.equal(cardPoints(c('Q', 'S')), 10);
  assert.equal(cardPoints(c('J', 'S')), 10);
  assert.equal(cardPoints(joker()), 11);
});

test('só joga carta da mesma pinta ou do mesmo número', () => {
  const s = table([[c('K', 'S'), c('5', 'C'), c('2', 'H'), c('3', 'D')], filler(), filler(), filler()]);
  assert.equal(playCard(s, 'p0', c('K', 'S').id).ok, false);
  assert.equal(playCard(s, 'p0', c('5', 'C').id).ok, true);
  assert.equal(s.turn, 1);
});

test('não joga fora da vez', () => {
  const s = table([filler(), [c('5', 'C')], filler(), filler()]);
  assert.equal(playCard(s, 'p1', c('5', 'C').id).ok, false);
});

test('Ás pula o próximo jogador', () => {
  const s = table([[c('A', 'H'), c('2', 'S')], filler(), filler(), filler()]);
  const r = playCard(s, 'p0', c('A', 'H').id);
  assert.ok(r.ok);
  assert.equal(s.turn, 2);
  assert.ok(r.events.some((e) => e.type === 'skip' && e.playerId === 'p1'));
});

test('Ás com 2 jogadores devolve a vez para quem jogou', () => {
  const s = table([[c('A', 'H'), c('2', 'S')], filler()]);
  playCard(s, 'p0', c('A', 'H').id);
  assert.equal(s.turn, 0);
});

test('7 faz o jogador da esquerda comprar 1', () => {
  const s = table([[c('7', 'H'), c('2', 'S')], filler(), filler(), filler()]);
  playCard(s, 'p0', c('7', 'H').id);
  assert.equal(s.players[3].hand.length, 3); // esquerda de p0 = p3
  assert.equal(s.players[1].hand.length, 2);
  assert.equal(s.turn, 1);
});

test('mesa de dois: 7 faz o outro comprar 1, perder a vez e a mão volta para quem jogou', () => {
  const s = table([[c('7', 'H'), c('2', 'S')], filler()]);
  const r = playCard(s, 'p0', c('7', 'H').id);
  assert.equal(r.ok, true);
  assert.equal(s.players[1].hand.length, 3);
  assert.equal(s.turn, 0);
  assert.deepEqual(
    r.events.filter((e) => e.type !== 'play').map((e) => [e.type, e.playerId]),
    [['penalty', 'p1'], ['skip', 'p1']],
  );
});

test('mesa de três: 7 continua só fazendo o da esquerda comprar 1', () => {
  const s = table([[c('7', 'H'), c('2', 'S')], filler(), filler()]);
  const r = playCard(s, 'p0', c('7', 'H').id);
  assert.equal(s.players[2].hand.length, 3); // esquerda de p0 = p2
  assert.equal(s.turn, 1);
  assert.ok(!r.events.some((e) => e.type === 'skip'));
});

test('7 conta só quem ainda está na mesa: com dois ativos, também pula', () => {
  const s = table([[c('7', 'H'), c('2', 'S')], filler(), filler(), filler()]);
  s.players[1].eliminated = true;
  s.players[3].eliminated = true;
  playCard(s, 'p0', c('7', 'H').id);
  assert.equal(s.players[2].hand.length, 3);
  assert.equal(s.turn, 0);
});

test('9 faz o jogador da direita comprar 2 e perder a vez', () => {
  const s = table([[c('9', 'H'), c('2', 'S')], filler(), filler(), filler()]);
  const r = playCard(s, 'p0', c('9', 'H').id);
  assert.equal(s.players[1].hand.length, 4);
  assert.equal(s.turn, 2);
  assert.ok(r.events.some((e) => e.type === 'skip' && e.playerId === 'p1'));
});

test('Joker abrindo o monte deixa o próximo jogar qualquer carta', () => {
  const s = table([[joker(), c('2', 'S')], filler(), filler(), filler()]);
  s.discard = [];
  s.activeSuit = null;
  s.activeRank = null;
  playCard(s, 'p0', joker().id);
  assert.equal(canPlay(s, c('K', 'D')), true);
});

test('8 entra em qualquer pinta e escolhe a próxima pinta', () => {
  const s = table([[c('8', 'S'), c('2', 'S')], [c('K', 'D'), c('3', 'C')], filler(), filler()]);
  assert.equal(playCard(s, 'p0', c('8', 'S').id).ok, false, 'precisa escolher a pinta');
  assert.ok(playCard(s, 'p0', c('8', 'S').id, 'D').ok);
  assert.equal(s.activeSuit, 'D');
  assert.equal(canPlay(s, c('K', 'D')), true);
  assert.equal(canPlay(s, c('3', 'C')), false);
});

test('Joker: todos menos quem jogou compram 1 e a pinta de baixo continua', () => {
  const s = table([[joker(), c('2', 'S')], filler(), filler(), filler()]);
  const r = playCard(s, 'p0', joker().id);
  assert.ok(r.ok);
  assert.deepEqual(
    s.players.map((p) => p.hand.length),
    [1, 3, 3, 3]
  );
  assert.equal(s.activeSuit, 'H');
  assert.equal(canPlay(s, c('2', 'H')), true);
  assert.equal(canPlay(s, c('5', 'S')), false);
});

test('comprar sem carta jogável passa a vez sozinho', () => {
  const s = table([[c('K', 'S')], filler(), filler(), filler()]);
  s.drawPile = [c('Q', 'C', 7)];
  const r = drawCard(s, 'p0');
  assert.ok(r.ok);
  assert.equal(s.turn, 1);
  assert.equal(s.players[0].hand.length, 2);
});

test('comprar uma carta jogável deixa jogar, e só se compra uma vez', () => {
  const s = table([[c('K', 'S')], filler(), filler(), filler()]);
  s.drawPile = [c('Q', 'H', 7)];
  drawCard(s, 'p0');
  assert.equal(s.turn, 0);
  assert.equal(drawCard(s, 'p0').ok, false);
  assert.ok(passTurn(s, 'p0').ok);
  assert.equal(s.turn, 1);
});

test('baralho vazio é refeito com o monte', () => {
  const s = table([[c('K', 'S')], filler(), filler(), filler()]);
  s.drawPile = [];
  s.discard = [c('Q', 'C', 1), c('3', 'D', 2), c('5', 'H', 3)];
  drawCard(s, 'p0');
  assert.equal(s.discard.length, 1);
  assert.equal(s.discard[0].id, c('5', 'H', 3).id);
  assert.equal(s.players[0].hand.length + s.drawPile.length, 3);
});

test('fim da rodada soma os pontos de quem ficou com cartas', () => {
  const s = table([
    [c('5', 'S')],
    [c('K', 'D'), joker()],
    [c('A', 'C'), c('3', 'C')],
    [c('9', 'S')],
  ]);
  const r = playCard(s, 'p0', c('5', 'S').id);
  assert.ok(r.ok);
  assert.equal(s.phase, 'roundOver');
  assert.deepEqual(
    s.players.map((p) => p.score),
    [0, 21, 4, 9]
  );
});

test('a carta que bate ainda aplica o efeito (9 no último lance)', () => {
  const s = table([[c('9', 'H')], [c('2', 'C')], filler(), filler()]);
  s.drawPile = [c('K', 'S', 1), c('Q', 'S', 2)];
  playCard(s, 'p0', c('9', 'H').id);
  assert.equal(s.players[1].score, 22);
});

test('quem passa de 100 é eliminado e o último que sobra vence', () => {
  const s = table([[c('5', 'S')], [c('K', 'D')], [c('2', 'D')]]);
  s.players[1].score = 95;
  s.players[2].score = 99;
  playCard(s, 'p0', c('5', 'S').id);
  assert.equal(s.players[1].eliminated, true);
  assert.equal(s.players[2].eliminated, true);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.winnerId, 'p0');
});

test('eliminado sai da roda e a próxima rodada segue sem ele', () => {
  const s = table([[c('5', 'S')], [c('K', 'D')], [c('2', 'D')], [c('3', 'D')]]);
  s.players[1].score = 95;
  playCard(s, 'p0', c('5', 'S').id);
  assert.equal(s.phase, 'roundOver');
  startRound(s);
  assert.equal(s.players[1].hand.length, 0);
  assert.equal(s.players[2].hand.length, 9);
});

test('jogador que sai da mesa entrega a vez', () => {
  const s = table([filler(), filler(), filler()]);
  removePlayer(s, 'p0');
  assert.equal(s.turn, 1);
  removePlayer(s, 'p1');
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.winnerId, 'p2');
});

test('a visão do jogador esconde a mão dos outros', () => {
  const s = table([[c('5', 'C')], filler(), filler(), filler()]);
  const v = viewFor(s, 'p1');
  assert.equal(v.hand.length, 2);
  assert.equal(v.players[0].cardCount, 1);
  assert.equal(JSON.stringify(v).includes(c('5', 'C').id), false);
});

test('bots terminam partidas inteiras sem travar', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const n = 2 + (seed % 7); // 2 a 8 jogadores
    const s = createGame(
      Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}` })),
      { seed }
    );
    let moves = 0;
    while (s.phase !== 'gameOver') {
      if (s.phase !== 'playing') {
        assert.ok(startRound(s).ok);
        continue;
      }
      const id = s.players[s.turn].id;
      const m = chooseMove(s, id);
      const r =
        m.type === 'play' ? playCard(s, id, m.cardId, m.suit) : m.type === 'draw' ? drawCard(s, id) : passTurn(s, id);
      assert.ok(r.ok, r.error);
      assert.ok(++moves < 100000, 'partida não terminou');
    }
    assert.ok(s.winnerId);
    assert.equal(s.players.filter((p) => !p.eliminated).length, 1);
  }
});
