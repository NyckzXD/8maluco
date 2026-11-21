// Jogador automático: usado pelos bots e quando um jogador humano estoura o tempo ou cai.
//
// Como ele decide (Monte Carlo com mundos sorteados, o "PIMC" dos jogos de cartas):
//   1. Monta o que um jogador atento sabe: a própria mão, as cartas que já foram para o monte,
//      quantas cartas cada um tem e o histórico público da rodada (`state.log`). Quem comprou
//      sem jogar não tinha nada da pinta nem do número do monte, nem 8, nem Joker; isso vale
//      até ele comprar de novo. O bot NUNCA olha a mão dos outros nem a ordem do baralho.
//   2. Sorteia centenas de "mundos" possíveis: distribui as cartas que ele não vê entre as mãos
//      dos adversários (respeitando o que deduziu) e o baralho.
//   3. Em cada mundo, testa cada jogada possível e simula a rodada até o fim com uma heurística
//      rápida para todos. Os mesmos mundos e a mesma sorte valem para todas as jogadas, então a
//      comparação entre elas é justa.
//   4. Fica com a jogada de melhor resultado médio: pontos que ele leva (0 se bate), pontos que
//      os adversários levam e o risco de alguém passar de 100 e sair da partida.
import { SUITS, RANKS, JOKER, canPlay, cardPoints, nextActive } from './engine.js';

// ---------- cartas como números (a simulação precisa ser rápida) ----------
// 0..51 = naipe * 13 + índice do valor em RANKS; 52 = Joker.
const JK = 52;
const R_A = 0;
const R_7 = 6;
const R_8 = 7;
const R_9 = 8;
const PTS = Array.from({ length: 53 }, (_, c) => (c === JK ? 11 : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10][c % 13]));

const codeOf = (card) => (card.rank === JOKER ? JK : SUITS.indexOf(card.suit) * 13 + RANKS.indexOf(card.rank));
const suitIdx = (suit) => (suit ? SUITS.indexOf(suit) : -1);
const rankIdx = (rank) => (rank && rank !== JOKER ? RANKS.indexOf(rank) : -1);

/** @typedef {{ maxRollouts?: number, maxMs?: number, seed?: number, maxPlies?: number }} BotOptions */

// Quanto ele pensa por jogada. Bot no servidor espera 3–5s antes de jogar, então 150ms não aparecem.
export const BOT_DEFAULTS = Object.freeze({ maxRollouts: 20000, maxMs: 300, maxPlies: 400 });

// Pesos do resultado de uma rodada (em pontos).
const ELIM_COST = 80; // sair da partida
const ELIM_GAIN = 80; // tirar alguém (dividido entre os adversários)

function makeRng(seed) {
  let a = seed | 0;
  return () => {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleArr(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function freshDeck(jokers) {
  const d = [];
  for (let c = 0; c < 52; c++) d.push(c);
  for (let j = 0; j < jokers; j++) d.push(JK);
  return d;
}

// ---------- simulação de uma rodada (mesmas regras de engine.js) ----------
// Os assentos da simulação são só os jogadores ativos, na ordem da mesa.

/**
 * @typedef {{ n: number, hands: number[][], pile: number[], discard: number[], suit: number, rank: number,
 *   turn: number, jokers: number, rng: () => number, winner: number }} Sim
 */

function canPlayCode(sim, c) {
  if (sim.suit < 0) return true;
  if (c === JK) return true;
  const r = c % 13;
  return r === R_8 || ((c / 13) | 0) === sim.suit || r === sim.rank;
}

function take(sim, p, n) {
  const hand = sim.hands[p];
  for (let k = 0; k < n; k++) {
    if (sim.pile.length === 0) {
      if (sim.discard.length > 1) {
        const top = sim.discard.pop();
        sim.pile = shuffleArr(sim.discard, sim.rng);
        sim.discard = [top];
      } else {
        sim.pile = shuffleArr(freshDeck(sim.jokers), sim.rng);
      }
    }
    hand.push(sim.pile.pop());
  }
}

// Naipe preferido para o 8: o que mais sobra na mão (8 e Joker não contam), com desempate na sorte.
function bestSuitCodes(hand, rng) {
  const w = [0, 0, 0, 0];
  for (const c of hand) if (c !== JK && c % 13 !== R_8) w[(c / 13) | 0] += 100 + PTS[c];
  let best = Math.floor(rng() * 4);
  for (let s = 0; s < 4; s++) if (w[s] > w[best]) best = s;
  return best;
}

// Joga a carta da posição `idx`. Devolve true se a rodada acabou (bateu).
function playIdx(sim, p, idx, suit) {
  const hand = sim.hands[p];
  const c = hand[idx];
  hand[idx] = hand[hand.length - 1];
  hand.pop();
  sim.discard.push(c);
  if (hand.length === 0) {
    sim.winner = p;
    return true;
  }
  const n = sim.n;
  let next = (p + 1) % n;
  if (c === JK) {
    for (let k = 1; k < n; k++) take(sim, (p + k) % n, 1);
  } else {
    const r = c % 13;
    if (r === R_8) {
      sim.suit = suit >= 0 ? suit : bestSuitCodes(hand, sim.rng);
      sim.rank = R_8;
    } else {
      sim.suit = (c / 13) | 0;
      sim.rank = r;
      if (r === R_A) next = (next + 1) % n;
      else if (r === R_9) {
        take(sim, next, 2);
        next = (next + 1) % n;
      } else if (r === R_7) {
        const left = (p - 1 + n) % n;
        take(sim, left, 1);
        if (n === 2) next = p;
      }
    }
  }
  sim.turn = next;
  return false;
}

// Heurística rápida das simulações: devolve a posição da carta a jogar, ou -1 se não há jogada.
function policy(sim, p) {
  const hand = sim.hands[p];
  const len = hand.length;
  const n = sim.n;
  const rng = sim.rng;
  const nextLen = sim.hands[(p + 1) % n].length;
  const leftLen = sim.hands[(p - 1 + n) % n].length;
  let minOpp = 99;
  for (let k = 1; k < n; k++) minOpp = Math.min(minOpp, sim.hands[(p + k) % n].length);
  const sc0 = [0, 0, 0, 0];
  for (const c of hand) if (c !== JK && c % 13 !== R_8) sc0[(c / 13) | 0]++;

  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < len; i++) {
    const c = hand[i];
    if (!canPlayCode(sim, c)) continue;
    if (len === 1) return i;
    let s = PTS[c] + rng() * 3;
    if (c === JK) s += 3 + (minOpp <= 2 ? 8 : 0);
    else {
      const r = c % 13;
      if (r === R_8)
        s -= 30; // o 8 entra em qualquer coisa: fica para o fim
      else {
        s += sc0[(c / 13) | 0] - 1; // deixa o monte num naipe que ele ainda tem
        if (r === R_A) s += nextLen <= 2 ? 10 : 2;
        else if (r === R_9) s += nextLen <= 2 ? 12 : 4;
        else if (r === R_7) s += n === 2 ? (nextLen <= 2 ? 10 : 4) : leftLen <= 2 ? 6 : 1;
      }
    }
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

// Joga a vez de `p` com a heurística. Devolve true se a rodada acabou.
function policyTurn(sim, p) {
  let i = policy(sim, p);
  if (i < 0) {
    take(sim, p, 1);
    i = policy(sim, p);
    if (i < 0) {
      sim.turn = (p + 1) % sim.n;
      return false;
    }
  }
  return playIdx(sim, p, i, -1);
}

function rollout(sim, maxPlies) {
  for (let ply = 0; ply < maxPlies; ply++) if (policyTurn(sim, sim.turn)) return;
}

// Quanto vale o fim da rodada para `me` (maior é melhor).
function utility(sim, me, scores, limit) {
  const n = sim.n;
  const pts = (p) => {
    if (sim.winner === p) return 0;
    let t = 0;
    for (const c of sim.hands[p]) t += PTS[c];
    return t;
  };
  const mine = pts(me);
  let u = -mine;
  if (scores[me] + mine >= limit) u -= ELIM_COST;
  const nOpp = n - 1;
  for (let p = 0; p < n; p++) {
    if (p === me) continue;
    const theirs = pts(p);
    u += theirs / nOpp;
    if (scores[p] + theirs >= limit) u += ELIM_GAIN / nOpp;
  }
  if (sim.winner === me) u += 2; // bater também tira o risco das próximas compras
  return u;
}

// ---------- o que dá para deduzir das mãos dos outros ----------
// Cada carta escondida de um adversário vira uma "vaga" com o que ela com certeza não é:
// naipes proibidos (bits 0–3), valores proibidos (bits 0–12) e Joker proibido.

/** @typedef {{ sm: number, rm: number, jk: boolean }} Slot */

const freeSlot = () => ({ sm: 0, rm: 0, jk: false });
const slotForbids = (slot, c) =>
  c === JK ? slot.jk : ((slot.sm >> ((c / 13) | 0)) & 1) === 1 || ((slot.rm >> (c % 13)) & 1) === 1;
const slotWeight = (slot) => (slot.jk ? 1 : 0) + bitCount(slot.sm) * 13 + bitCount(slot.rm) * 4;
function bitCount(x) {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
}

/** @returns {Slot[][]} vagas por índice de jogador (do estado), a de `meIdx` fica vazia */
export function inferHands(state, meIdx) {
  const slots = state.players.map(() => Array.from({ length: state.rules.handSize }, freeSlot));
  for (const e of state.log ?? []) {
    if (e.p === meIdx || !slots[e.p]) continue;
    const mine = slots[e.p];
    if (e.t === 'take') {
      for (let k = 0; k < e.n; k++) mine.push(freeSlot());
    } else if (e.t === 'draw') {
      const s = suitIdx(e.suit);
      if (s < 0) {
        mine.push(freeSlot());
        continue;
      }
      // Comprou: não tinha nada que servisse (nem 8, nem Joker).
      const r = rankIdx(e.rank);
      const rm = (1 << R_8) | (r >= 0 ? 1 << r : 0);
      const constrain = (slot) => {
        slot.sm |= 1 << s;
        slot.rm |= rm;
        slot.jk = true;
      };
      mine.forEach(constrain);
      const drawn = freeSlot();
      // A vez passou sozinha: a carta comprada também não servia.
      if (e.auto) constrain(drawn);
      mine.push(drawn);
    } else if (e.t === 'play') {
      const c = e.rank === JOKER ? JK : SUITS.indexOf(e.suit) * 13 + RANKS.indexOf(e.rank);
      // Tira a vaga que podia ser essa carta; entre as possíveis, a mais restrita (a dedução
      // que sobra fica a mais fraca possível, para não errar).
      let pick = -1;
      for (let i = 0; i < mine.length; i++) {
        if (slotForbids(mine[i], c)) continue;
        if (pick < 0 || slotWeight(mine[i]) > slotWeight(mine[pick])) pick = i;
      }
      if (pick < 0) {
        // Jogou algo que a dedução dizia que ele não tinha (comprou sem precisar): esquece tudo.
        for (const slot of mine) Object.assign(slot, freeSlot());
        pick = 0;
      }
      if (mine.length) mine.splice(pick, 1);
    }
  }
  // Acerta a contagem com o que está na mesa (salas antigas sem histórico, jogador que saiu…).
  state.players.forEach((p, i) => {
    if (i === meIdx) {
      slots[i] = [];
      return;
    }
    const need = p.eliminated ? 0 : p.hand.length;
    while (slots[i].length > need) {
      // sobrou vaga: tira a menos restrita
      let drop = 0;
      for (let k = 1; k < slots[i].length; k++) if (slotWeight(slots[i][k]) < slotWeight(slots[i][drop])) drop = k;
      slots[i].splice(drop, 1);
    }
    while (slots[i].length < need) slots[i].push(freeSlot());
  });
  return slots;
}

// ---------- sorteio de um mundo possível ----------

// Cartas que `me` não vê: tudo o que está no jogo, menos a mão dele e o monte.
function unseenCodes(state, meIdx) {
  const count = new Array(53).fill(0);
  const decks = Math.max(1, state.decks || 1);
  for (let c = 0; c < 52; c++) count[c] = decks;
  count[JK] = decks * state.rules.jokersPerDeck;
  for (const card of state.players[meIdx].hand) count[codeOf(card)]--;
  for (const card of state.discard) count[codeOf(card)]--;
  const pool = [];
  for (let c = 0; c < 53; c++) for (let k = 0; k < count[c]; k++) pool.push(c);
  return pool;
}

/**
 * Tudo o que não muda de um mundo para outro.
 * @returns {{ seats: number[], me: number, slots: Slot[][], order: [number, number][], pool: number[],
 *   pileLen: number, myHand: number[], discard: number[], suit: number, rank: number, jokers: number }}
 */
function buildInfoSet(state, meIdx) {
  const seats = state.players.map((p, i) => i).filter((i) => !state.players[i].eliminated);
  const inferred = inferHands(state, meIdx);
  const slots = seats.map((i) => inferred[i]);
  // vagas mais restritas são preenchidas primeiro
  const order = [];
  slots.forEach((list, s) => list.forEach((slot, k) => slotWeight(slot) > 0 && order.push([s, k])));
  order.sort((a, b) => slotWeight(slots[b[0]][b[1]]) - slotWeight(slots[a[0]][a[1]]));
  return {
    seats,
    me: seats.indexOf(meIdx),
    slots,
    order,
    pool: unseenCodes(state, meIdx),
    pileLen: state.drawPile.length,
    myHand: state.players[meIdx].hand.map(codeOf),
    discard: state.discard.map(codeOf),
    suit: suitIdx(state.activeSuit),
    rank: rankIdx(state.activeRank),
    jokers: state.rules.jokersPerDeck,
  };
}

function sampleWorld(info, rng) {
  const pool = shuffleArr(info.pool.slice(), rng);
  const hands = info.slots.map((list) => new Array(list.length).fill(-1));
  hands[info.me] = info.myHand.slice();
  const grab = (accept) => {
    for (let i = pool.length - 1; i >= 0; i--) {
      if (accept(pool[i])) {
        const c = pool[i];
        pool[i] = pool[pool.length - 1];
        pool.pop();
        return c;
      }
    }
    return pool.length ? pool.pop() : Math.floor(rng() * 52); // nada serve: relaxa a dedução
  };
  for (const [s, k] of info.order) {
    const slot = info.slots[s][k];
    hands[s][k] = grab((c) => !slotForbids(slot, c));
  }
  for (let s = 0; s < hands.length; s++) {
    if (s === info.me) continue;
    for (let k = 0; k < hands[s].length; k++) if (hands[s][k] < 0) hands[s][k] = grab(() => true);
  }
  return { hands, pile: pool };
}

function makeSim(info, world, seed) {
  return {
    n: info.seats.length,
    hands: world.hands.map((h) => h.slice()),
    pile: world.pile.slice(),
    discard: info.discard.slice(),
    suit: info.suit,
    rank: info.rank,
    turn: info.me,
    jokers: info.jokers,
    rng: makeRng(seed),
    winner: -1,
  };
}

// Aplica a jogada candidata na simulação. Devolve true se a rodada acabou.
function applyAction(sim, me, action) {
  if (action.type === 'pass') {
    sim.turn = (me + 1) % sim.n;
    return false;
  }
  if (action.type === 'draw') {
    take(sim, me, 1);
    // depois de comprar, a simulação segue com a heurística
    const i = policy(sim, me);
    if (i < 0) {
      sim.turn = (me + 1) % sim.n;
      return false;
    }
    return playIdx(sim, me, i, -1);
  }
  return playIdx(sim, me, sim.hands[me].indexOf(action.code), action.suitIdx);
}

// ---------- jogada ----------

/**
 * Nota de cada jogada possível de `playerId` (média do resultado da rodada nas simulações).
 * @param {any} state
 * @param {string} playerId
 * @param {BotOptions} [options]
 * @returns {{ moves: { move: any, value: number, samples: number, best: boolean }[], samples: number }}
 */
export function evaluateMoves(state, playerId, options = {}) {
  const opts = { ...BOT_DEFAULTS, ...options };
  const meIdx = state.players.findIndex((p) => p.id === playerId);
  const me = state.players[meIdx];
  const playable = me.hand.filter((c) => canPlay(state, c));
  const fallback = state.hasDrawn ? { type: 'pass' } : { type: 'draw' };

  // Jogadas candidatas: cada carta diferente (de baralhos diferentes contam como a mesma),
  // o 8 com cada naipe, e comprar (ou passar, se já comprou).
  const actions = [];
  const seen = new Set();
  for (const card of playable) {
    const code = codeOf(card);
    if (seen.has(code)) continue;
    seen.add(code);
    if (card.rank === '8' && me.hand.length > 1)
      for (let s = 0; s < 4; s++) actions.push({ type: 'play', code, card, suitIdx: s });
    else actions.push({ type: 'play', code, card, suitIdx: -1 });
  }
  actions.push({ ...fallback });

  const rng = makeRng(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
  const info = buildInfoSet(state, meIdx);
  const scores = info.seats.map((i) => state.players[i].score);
  const limit = state.rules.eliminationScore;
  // Resultado de cada jogada em cada mundo sorteado. Todas as jogadas ainda na disputa passam
  // pelos mesmos mundos, então dá para comparar duas a duas (a sorte é a mesma para as duas).
  const results = actions.map(() => []);
  let alive = actions.map((_, i) => i);
  const start = Date.now();
  let rollouts = 0;
  let samples = 0;
  const mean = (a) => results[a].reduce((t, u) => t + u, 0) / results[a].length;
  while (
    alive.length > 1 &&
    rollouts + alive.length <= opts.maxRollouts &&
    (samples === 0 || Date.now() - start < opts.maxMs)
  ) {
    const world = sampleWorld(info, rng);
    const seed = Math.floor(rng() * 2 ** 31);
    for (const a of alive) {
      const sim = makeSim(info, world, seed);
      if (!applyAction(sim, info.me, actions[a])) rollout(sim, opts.maxPlies);
      results[a].push(utility(sim, info.me, scores, limit));
    }
    rollouts += alive.length;
    samples++;
    // De tempos em tempos, larga as jogadas que já estão claramente atrás da melhor
    // (diferença média abaixo de PRUNE_Z desvios), para pensar mais nas que estão perto.
    if (samples >= PRUNE_FROM && samples % PRUNE_EVERY === 0) alive = prune(alive, results);
  }

  const moves = actions.map((a, i) => {
    let move;
    if (a.type !== 'play') move = { type: a.type };
    else {
      move = { type: 'play', cardId: a.card.id };
      if (a.card.rank === '8' && a.suitIdx >= 0) move.suit = SUITS[a.suitIdx];
    }
    return { move, value: results[i].length ? mean(i) : -Infinity, samples: results[i].length, best: false };
  });
  let best = alive[0];
  for (const a of alive) if (moves[a].value > moves[best].value) best = a;
  moves[best].best = true;
  return { moves, samples };
}

const PRUNE_FROM = 96;
const PRUNE_EVERY = 32;
const PRUNE_Z = 3;

// As jogadas que continuam na disputa: as que a melhor ainda não deixou para trás com folga.
function prune(alive, results) {
  const n = results[alive[0]].length;
  const avg = (a) => results[a].reduce((t, u) => t + u, 0) / n;
  let leader = alive[0];
  for (const a of alive) if (avg(a) > avg(leader)) leader = a;
  const lead = results[leader];
  return alive.filter((a) => {
    if (a === leader) return true;
    const r = results[a];
    let sum = 0;
    let sq = 0;
    for (let k = 0; k < n; k++) {
      const d = lead[k] - r[k];
      sum += d;
      sq += d * d;
    }
    const m = sum / n;
    const sd = Math.sqrt(Math.max(0, sq / n - m * m));
    // sd 0 com diferença: em todo mundo sorteado deu igual ou pior
    return m <= 0 || m < (PRUNE_Z * sd) / Math.sqrt(n);
  });
}

/**
 * Escolhe a jogada de `playerId` na vez dele.
 * @param {any} state
 * @param {string} playerId
 * @param {BotOptions} [options]
 * @returns {{ type: 'play', cardId: string, suit?: string } | { type: 'draw' } | { type: 'pass' }}
 */
export function chooseMove(state, playerId, options = {}) {
  const me = state.players.find((p) => p.id === playerId);
  const playable = me.hand.filter((c) => canPlay(state, c));
  if (playable.length === 0) return state.hasDrawn ? { type: 'pass' } : { type: 'draw' };
  // Última carta e ela serve: bate.
  if (me.hand.length === 1) return { type: 'play', cardId: playable[0].id };
  return evaluateMoves(state, playerId, options).moves.find((m) => m.best).move;
}

// ---------- versão simples (antiga) ----------
// Só heurística, sem simular nada: serve de adversário para medir o bot e de reserva barata.

export function chooseMoveBasic(state, playerId) {
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
