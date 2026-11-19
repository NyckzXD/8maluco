// Motor do 8 Maluco: lógica pura do jogo, sem rede nem interface.
// Roda no servidor e pode ser reaproveitado no app mobile (ex.: modo offline contra bots).
//
// Convenção dos assentos: a ordem do array `players` é o sentido do jogo,
// ou seja, "para a direita" (anti-horário). next = direita, prev = esquerda.

export const SUITS = ['S', 'H', 'D', 'C']; // espadas, copas, ouros, paus
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const JOKER = 'JOKER';

export const SUIT_INFO = {
  S: { name: 'Espadas', symbol: '♠', color: 'black' },
  H: { name: 'Copas', symbol: '♥', color: 'red' },
  D: { name: 'Ouros', symbol: '♦', color: 'red' },
  C: { name: 'Paus', symbol: '♣', color: 'black' },
};

export const DEFAULT_RULES = Object.freeze({
  handSize: 9,
  eliminationScore: 100,
  jokersPerDeck: 2,
  // A cada N jogadores entra mais um baralho, para não faltar carta.
  playersPerDeck: 3,
});

// ---------- utilidades ----------

// PRNG com semente guardada no próprio estado (mulberry32): o estado continua
// serializável e as partidas ficam reproduzíveis nos testes.
function random(state) {
  let t = (state.seed = (state.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(state, cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function buildDeck(decks = 1, jokersPerDeck = 2, firstDeck = 0) {
  const cards = [];
  for (let d = firstDeck; d < firstDeck + decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ id: `${rank}${suit}${d}`, rank, suit });
    }
    for (let j = 0; j < jokersPerDeck; j++) cards.push({ id: `JK${d}${j}`, rank: JOKER, suit: null });
  }
  return cards;
}

export function cardPoints(card) {
  if (card.rank === 'A') return 1;
  if (card.rank === JOKER) return 11;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return Number(card.rank);
}

export function handPoints(hand) {
  return hand.reduce((sum, c) => sum + cardPoints(c), 0);
}

export function nextActive(state, i) {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const j = (i + k) % n;
    if (!state.players[j].eliminated) return j;
  }
  return i;
}

export function prevActive(state, i) {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const j = (i - k + n) % n;
    if (!state.players[j].eliminated) return j;
  }
  return i;
}

export function activePlayers(state) {
  return state.players.filter((p) => !p.eliminated);
}

function indexOf(state, playerId) {
  return state.players.findIndex((p) => p.id === playerId);
}

function fail(error) {
  return { ok: false, error, events: [] };
}

// ---------- ciclo de vida ----------

/**
 * O que aconteceu numa ação, na ordem: o servidor repassa para as telas.
 * @typedef {{ type: string, playerId?: string, [key: string]: any }} GameEvent
 */

/**
 * @param {any[]} players
 * @param {{ rules?: object, seed?: number, dealer?: number }} [options]
 */
export function createGame(players, { rules = {}, seed, dealer } = {}) {
  if (players.length < 2) throw new Error('São necessários pelo menos 2 jogadores');
  const state = {
    rules: { ...DEFAULT_RULES, ...rules },
    seed: seed ?? Math.floor(Math.random() * 2 ** 31),
    players: players.map((p) => ({ id: p.id, name: p.name, score: 0, eliminated: false, hand: [] })),
    dealer: 0,
    round: 0,
    phase: 'idle', // idle | playing | roundOver | gameOver
    decks: 0,
    drawPile: [],
    discard: [],
    activeSuit: null,
    activeRank: null,
    turn: -1,
    hasDrawn: false,
    lastRound: null,
    winnerId: null,
    // Histórico público da rodada (o que qualquer um na mesa viu): jogadas, compras e castigos.
    // Nada de carta escondida aqui; o bot usa para deduzir o que cada um não tem na mão.
    log: [],
  };
  state.dealer = dealer ?? Math.floor(random(state) * players.length);
  return state;
}

export function startRound(state) {
  if (state.phase === 'playing' || state.phase === 'gameOver') return fail('A rodada não pode começar agora');
  const { rules } = state;
  const active = activePlayers(state);
  const decks = Math.max(1, Math.ceil(active.length / rules.playersPerDeck));

  state.round += 1;
  // Na primeira rodada o carteador já foi sorteado; depois ele passa para a direita.
  if (state.round > 1 || state.players[state.dealer].eliminated) state.dealer = nextActive(state, state.dealer);
  state.decks = decks;
  state.drawPile = shuffle(state, buildDeck(decks, rules.jokersPerDeck));
  state.discard = [];
  state.log = [];
  for (const p of state.players) p.hand = [];

  // Distribui uma carta por vez, começando pela direita de quem dá as cartas.
  for (let c = 0; c < rules.handSize; c++) {
    let i = state.dealer;
    for (let k = 0; k < active.length; k++) {
      i = nextActive(state, i);
      state.players[i].hand.push(state.drawPile.pop());
    }
  }

  // Nenhuma carta é virada: quem está à direita do carteador abre o monte com a carta que quiser.
  state.activeSuit = null;
  state.activeRank = null;
  state.turn = nextActive(state, state.dealer);
  state.hasDrawn = false;
  state.lastRound = null;
  state.phase = 'playing';

  return {
    ok: true,
    events: [
      {
        type: 'roundStart',
        round: state.round,
        dealerId: state.players[state.dealer].id,
        starterId: state.players[state.turn].id,
      },
    ],
  };
}

// ---------- regras ----------

export function topCard(state) {
  return state.discard[state.discard.length - 1] ?? null;
}

export function canPlay(state, card) {
  // Monte aberto (primeira carta da rodada, ou só um Joker nele): vale qualquer carta.
  if (!state.activeSuit) return true;
  if (card.rank === JOKER || card.rank === '8') return true;
  return card.suit === state.activeSuit || card.rank === state.activeRank;
}

export function playableCards(state, playerId) {
  const p = state.players[indexOf(state, playerId)];
  if (!p) return [];
  return p.hand.filter((c) => canPlay(state, c));
}

// Compra cartas do baralho; se ele acabar, embaralha o monte (menos a carta de cima).
// Se até o monte acabou (todas as cartas nas mãos), entra um baralho novo na mesa.
function takeCards(state, i, n) {
  const taken = [];
  for (let k = 0; k < n; k++) {
    if (state.drawPile.length === 0) {
      if (state.discard.length > 1) {
        const top = state.discard.pop();
        state.drawPile = shuffle(state, state.discard);
        state.discard = [top];
      } else {
        state.drawPile = shuffle(state, buildDeck(1, state.rules.jokersPerDeck, state.decks));
        state.decks += 1;
      }
    }
    const card = state.drawPile.pop();
    state.players[i].hand.push(card);
    taken.push(card);
  }
  return taken;
}

// Anota no histórico público. Salas gravadas antes de existir o histórico chegam sem ele.
function logPublic(state, entry) {
  (state.log ??= []).push(entry);
}

function penalty(state, i, n, events, reason) {
  const taken = takeCards(state, i, n);
  logPublic(state, { t: 'take', p: i, n: taken.length });
  events.push({ type: 'penalty', playerId: state.players[i].id, count: taken.length, reason });
}

function checkTurn(state, playerId) {
  if (state.phase !== 'playing') return 'A rodada não está em andamento';
  const i = indexOf(state, playerId);
  if (i < 0) return 'Jogador não está na mesa';
  if (i !== state.turn) return 'Não é a sua vez';
  return null;
}

export function playCard(state, playerId, cardId, chosenSuit) {
  const err = checkTurn(state, playerId);
  if (err) return fail(err);
  const i = state.turn;
  const player = state.players[i];
  const ci = player.hand.findIndex((c) => c.id === cardId);
  if (ci < 0) return fail('Você não tem essa carta');
  const card = player.hand[ci];
  if (!canPlay(state, card)) return fail('Essa carta não combina com a pinta nem com o número do monte');
  if (card.rank === '8' && player.hand.length > 1 && !SUITS.includes(chosenSuit)) {
    return fail('Escolha a pinta que o próximo deve jogar');
  }

  player.hand.splice(ci, 1);
  state.discard.push(card);
  logPublic(state, { t: 'play', p: i, rank: card.rank, suit: card.suit });
  /** @type {GameEvent[]} */
  const events = [{ type: 'play', playerId, card }];

  // Bateu: a rodada acaba aqui. A carta final não tem efeito (9, 7 e Joker não fazem
  // ninguém comprar, Ás não pula), e a contagem usa as mãos como estavam.
  if (player.hand.length === 0) {
    if (card.rank !== JOKER) {
      state.activeSuit = card.rank === '8' && SUITS.includes(chosenSuit) ? chosenSuit : card.suit;
      state.activeRank = card.rank;
    }
    endRound(state, i, events);
    return { ok: true, events };
  }

  let next = nextActive(state, i);

  switch (card.rank) {
    case 'A': // pula o próximo
      events.push({ type: 'skip', playerId: state.players[next].id });
      next = nextActive(state, next);
      state.activeSuit = card.suit;
      state.activeRank = card.rank;
      break;
    case '7': {
      // o da esquerda (sentido horário) compra 1
      const left = prevActive(state, i);
      penalty(state, left, 1, events, '7');
      // Mesa de dois: o da esquerda é o único adversário, que também perde a vez,
      // e a mão volta para quem jogou o 7.
      if (activePlayers(state).length === 2) {
        events.push({ type: 'skip', playerId: state.players[left].id });
        next = nextActive(state, left);
      }
      state.activeSuit = card.suit;
      state.activeRank = card.rank;
      break;
    }
    case '9': // o da direita compra 2 e não joga
      penalty(state, next, 2, events, '9');
      events.push({ type: 'skip', playerId: state.players[next].id });
      next = nextActive(state, next);
      state.activeSuit = card.suit;
      state.activeRank = card.rank;
      break;
    case '8': // coringa: escolhe a pinta
      state.activeSuit = SUITS.includes(chosenSuit) ? chosenSuit : card.suit;
      state.activeRank = card.rank;
      events.push({ type: 'suit', playerId, suit: state.activeSuit });
      break;
    case JOKER: // todos os outros compram 1; a pinta e o número da carta de baixo continuam valendo
      for (let k = nextActive(state, i); k !== i; k = nextActive(state, k)) penalty(state, k, 1, events, JOKER);
      break;
    default:
      state.activeSuit = card.suit;
      state.activeRank = card.rank;
  }

  state.turn = next;
  state.hasDrawn = false;
  return { ok: true, events };
}

export function drawCard(state, playerId) {
  const err = checkTurn(state, playerId);
  if (err) return fail(err);
  if (state.hasDrawn) return fail('Você já comprou nesta vez');
  const i = state.turn;
  const { activeSuit: suit, activeRank: rank } = state;
  const taken = takeCards(state, i, 1);
  state.hasDrawn = true;
  /** @type {GameEvent[]} */
  const events = [{ type: 'draw', playerId, count: taken.length }];
  // Se mesmo depois de comprar não há o que jogar, a vez passa sozinha.
  const stuck = !state.players[i].hand.some((c) => canPlay(state, c));
  // `auto`: a vez passou sozinha, então todo mundo viu que nada na mão dele servia.
  logPublic(state, { t: 'draw', p: i, suit, rank, auto: stuck });
  if (stuck) {
    events.push(...advance(state, playerId));
  }
  return { ok: true, events, drawn: taken[0] ?? null };
}

export function passTurn(state, playerId) {
  const err = checkTurn(state, playerId);
  if (err) return fail(err);
  if (!state.hasDrawn) return fail('Compre uma carta antes de passar a vez');
  return { ok: true, events: advance(state, playerId) };
}

function advance(state, playerId) {
  state.turn = nextActive(state, state.turn);
  state.hasDrawn = false;
  return [{ type: 'pass', playerId }];
}

function endRound(state, winnerIdx, events) {
  const results = [];
  for (const [i, p] of state.players.entries()) {
    if (p.eliminated) continue;
    const points = i === winnerIdx ? 0 : handPoints(p.hand);
    p.score += points;
    results.push({ playerId: p.id, points, total: p.score, hand: [...p.hand] });
  }
  const eliminated = [];
  for (const p of state.players) {
    if (!p.eliminated && p.score >= state.rules.eliminationScore) {
      p.eliminated = true;
      eliminated.push(p.id);
    }
  }
  const remaining = activePlayers(state);
  state.lastRound = {
    round: state.round,
    winnerId: state.players[winnerIdx].id,
    results,
    eliminated,
  };
  state.turn = -1;
  state.hasDrawn = false;
  events.push({ type: 'roundEnd', ...state.lastRound });
  if (remaining.length <= 1) {
    state.phase = 'gameOver';
    state.winnerId = remaining[0]?.id ?? state.players[winnerIdx].id;
    events.push({ type: 'gameOver', winnerId: state.winnerId });
  } else {
    state.phase = 'roundOver';
  }
}

// Remove um jogador da partida (ex.: saiu da sala). Conta como eliminado.
export function removePlayer(state, playerId) {
  const i = indexOf(state, playerId);
  if (i < 0 || state.players[i].eliminated) return { ok: true, events: [] };
  const wasTurn = state.phase === 'playing' && state.turn === i;
  const p = state.players[i];
  state.drawPile.unshift(...p.hand);
  p.hand = [];
  p.eliminated = true;
  /** @type {GameEvent[]} */
  const events = [{ type: 'left', playerId }];
  const remaining = activePlayers(state);
  if (remaining.length <= 1 && state.phase !== 'gameOver') {
    state.phase = 'gameOver';
    state.turn = -1;
    state.winnerId = remaining[0]?.id ?? null;
    events.push({ type: 'gameOver', winnerId: state.winnerId });
  } else if (wasTurn) {
    state.turn = nextActive(state, i);
    state.hasDrawn = false;
  }
  return { ok: true, events };
}

// O que cada jogador pode ver: a própria mão e só a quantidade de cartas dos outros.
export function viewFor(state, viewerId) {
  const me = state.players.find((p) => p.id === viewerId);
  const myTurn = state.phase === 'playing' && state.players[state.turn]?.id === viewerId;
  return {
    round: state.round,
    phase: state.phase,
    rules: state.rules,
    dealerId: state.players[state.dealer]?.id ?? null,
    turnId: state.players[state.turn]?.id ?? null,
    hasDrawn: myTurn ? state.hasDrawn : false,
    activeSuit: state.activeSuit,
    activeRank: state.activeRank,
    top: topCard(state),
    discardCount: state.discard.length,
    drawCount: state.drawPile.length,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      eliminated: p.eliminated,
      cardCount: p.hand.length,
    })),
    hand: me ? me.hand : [],
    playable: myTurn ? me.hand.filter((c) => canPlay(state, c)).map((c) => c.id) : [],
    lastRound: state.lastRound,
    winnerId: state.winnerId,
  };
}
