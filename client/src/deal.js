// Distribuição das cartas no começo da rodada e cartas compradas.
import { sounds } from './audio.js';
import { $, $$, state } from './core.js';
import { pileScale } from './hand.js';
import { reducedMotion } from './suit-picker.js';
import { DRAW_GAP_MS, EASE_IN_OUT, FLIGHT_MS, centerOf, fly, renderSeats, showGain } from './table.js';

// ---------- distribuição das cartas no começo da rodada ----------
// As cartas saem do baralho uma a uma, em roda, começando por quem está depois do carteador
// (como no engine). Enquanto isso a mão e os contadores dos assentos vão enchendo; no fim
// aparece quem abre o monte. O servidor segura a primeira vez da rodada por esse tempo (DEAL_MS).
const DEAL_FLIGHT_MS = 520;
const DEAL_SPREAD_MS = 2400; // tempo entre a primeira e a última carta sair do baralho
export let deal = null; // { round, pending: ids da sua mão ainda no ar, counts: cartas já entregues por jogador, draw, timers }

// Monta o estado da distribuição antes de desenhar a mesa (para a mão e os assentos já nascerem vazios).
export function prepareDeal(g, s) {
  cancelDeal();
  if (reducedMotion()) return;
  const players = g.players.filter((p) => !p.eliminated);
  const total = players.reduce((n, p) => n + (p.id === s.me ? g.hand.length : p.cardCount), 0);
  if (!total) return;
  deal = {
    round: g.round,
    pending: new Set(g.hand.map((c) => c.id)),
    counts: new Map(players.map((p) => [p.id, 0])),
    draw: g.drawCount + total,
    timers: [],
  };
}

export function cancelDeal() {
  if (!deal) return;
  deal.timers.forEach(clearTimeout);
  deal = null;
  $('#hand').classList.remove('dealing');
  $$('#hand .card.incoming').forEach((c) => c.classList.remove('incoming'));
}

export function runDeal(g, s, onDone) {
  const pileCard = $('#drawPile .card');
  if (!deal || !pileCard) {
    cancelDeal();
    return onDone();
  }
  const current = deal;
  const alive = () => deal === current;
  const pile = centerOf(pileCard);
  $('#hand').classList.add('dealing');
  $('#drawCount').textContent = current.draw;

  // Ordem da roda: a partir de quem está depois do carteador.
  const n = g.players.length;
  const dealerIdx = Math.max(
    0,
    g.players.findIndex((p) => p.id === g.dealerId),
  );
  const order = [];
  for (let k = 1; k <= n; k++) {
    const p = g.players[(dealerIdx + k) % n];
    if (!p.eliminated) order.push(p);
  }
  const myCards = $$('#hand .card').map((node) => node.dataset.id);
  const countOf = (p) => (p.id === s.me ? myCards.length : p.cardCount);
  const rounds = Math.max(0, ...order.map(countOf));
  const total = order.reduce((t, p) => t + countOf(p), 0);
  const gap = Math.min(110, DEAL_SPREAD_MS / Math.max(1, total));

  let delay = 0;
  for (let c = 0; c < rounds; c++) {
    for (const p of order) {
      if (c >= countOf(p)) continue;
      current.timers.push(
        setTimeout(() => {
          if (!alive()) return;
          current.draw -= 1;
          $('#drawCount').textContent = current.draw;
          sounds.deal();
        }, delay),
      );
      if (p.id === s.me) {
        const id = myCards[c];
        const node = $(`#hand [data-id="${id}"]`);
        if (node)
          fly({
            from: pile,
            to: centerOf(node, { scale: pileScale(node) }),
            delay,
            duration: DEAL_FLIGHT_MS,
            onLand: () => {
              if (!alive()) return;
              current.pending.delete(id);
              $(`#hand [data-id="${id}"]`)?.classList.remove('incoming');
            },
          });
      } else {
        const avatar = $(`#seats .seat[data-id="${p.id}"] .avatar`);
        if (avatar)
          fly({
            from: pile,
            to: centerOf(avatar, { scale: 0.45, fade: true }),
            delay,
            duration: DEAL_FLIGHT_MS,
            easing: EASE_IN_OUT,
            onLand: () => {
              if (!alive()) return;
              const count = (current.counts.get(p.id) ?? 0) + 1;
              current.counts.set(p.id, count);
              const label = $(`#seats .seat[data-id="${p.id}"] .seat-count`);
              if (label?.lastChild) label.lastChild.textContent = count;
            },
          });
      }
      delay += gap;
    }
  }
  current.timers.push(
    setTimeout(
      () => {
        if (!alive()) return;
        cancelDeal();
        // Acerta tudo com o estado real (contadores e baralho).
        if (state?.game) {
          renderSeats(state.game, state, new Set());
          $('#drawCount').textContent = state.game.drawCount;
        }
        onDone();
      },
      Math.max(0, delay - gap) + DEAL_FLIGHT_MS + 150,
    ),
  );
}

// Cartas compradas saem do baralho: de costas até o avatar dos outros, virando de frente até a sua mão.
export function animateDraws(events, g, s) {
  const pileCard = $('#drawPile .card');
  if (!pileCard) return;
  const pile = centerOf(pileCard);
  const fresh = $$('#hand .card.fresh');
  let delay = 0;
  const swish = () => setTimeout(sounds.draw, delay);
  const toHand = (node) => {
    swish();
    const card = g.hand.find((c) => c.id === node.dataset.id);
    if (
      card &&
      fly({
        card,
        from: pile,
        to: centerOf(node, { scale: pileScale(node) }),
        flip: true,
        hide: node,
        delay,
      })
    )
      node.classList.remove('fresh');
    delay += DRAW_GAP_MS;
  };
  for (const e of events) {
    // Compra por causa de uma carta jogada (7, 9, Joker): espera ela chegar no monte.
    if (e.type === 'play') delay = Math.max(delay, FLIGHT_MS * 0.8);
    if (e.type !== 'draw' && e.type !== 'penalty') continue;
    if (e.playerId === s.me) {
      fresh.splice(0, e.count).forEach(toHand);
      continue;
    }
    const avatar = $(`#seats .seat[data-id="${e.playerId}"] .avatar`);
    if (!avatar) continue;
    // De costas, num movimento contínuo do baralho até o avatar, para dar para ver quem comprou.
    const to = centerOf(avatar, { scale: 0.5, fade: true });
    for (let k = 0; k < e.count; k++) {
      const last = k === e.count - 1;
      swish();
      fly({
        from: pile,
        to,
        delay,
        easing: EASE_IN_OUT,
        onLand: last ? () => showGain(e.playerId, e.count) : null,
      });
      delay += DRAW_GAP_MS;
    }
  }
  fresh.forEach(toHand);
}
