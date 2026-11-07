// Jogador automático: usado pelos bots e quando um jogador humano estoura o tempo ou cai.
import { SUITS, JOKER, canPlay, cardPoints, nextActive } from './engine.js';

export function chooseMove(state, playerId) {
  const me = state.players.find((p) => p.id === playerId);
  const playable = me.hand.filter((c) => canPlay(state, c));
  if (playable.length === 0) return state.hasDrawn ? { type: 'pass' } : { type: 'draw' };

  const nextPlayer = state.players[nextActive(state, state.turn)];
  const threat = nextPlayer.hand.length <= 2; // o próximo está quase batendo

  let best = null;
  let bestScore = -Infinity;
  for (const card of playable) {
    // Livrar-se de cartas que valem muito ponto é sempre bom.
    let score = cardPoints(card);
    if (card.rank === '9') score += threat ? 12 : 5;
    if (card.rank === 'A') score += threat ? 10 : 3;
    // mesa de dois: o 7 também pula o outro (vale quase como um 9)
    if (card.rank === '7') score += state.players.filter((p) => !p.eliminated).length === 2 ? (threat ? 10 : 4) : 3;
    if (card.rank === JOKER) score += 6;
    // O 8 é coringa: guarda para quando não houver outra saída.
    if (card.rank === '8') score -= me.hand.length > 2 ? 25 : 0;
    score += Math.random() * 2;
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }

  const move = { type: 'play', cardId: best.id };
  if (best.rank === '8') move.suit = favoriteSuit(me.hand.filter((c) => c.id !== best.id));
  return move;
}

// A pinta que o jogador mais tem na mão (desempate pelos pontos dessas cartas).
export function favoriteSuit(hand) {
  const weight = Object.fromEntries(SUITS.map((s) => [s, 0]));
  for (const c of hand) if (c.suit && c.rank !== '8') weight[c.suit] += 100 + cardPoints(c);
  return SUITS.reduce((a, b) => (weight[b] > weight[a] ? b : a), SUITS[Math.floor(Math.random() * 4)]);
}
