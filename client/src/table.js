// Mesa: assentos, cartas voando, setas de efeito e avisos em cima dos jogadores.
import { icon, nameWithBot, renderCard, svg } from './cards.js';
import { turnRing } from './clock.js';
import { $, $$, avatar, el, memberOf, state } from './core.js';
import { cancelDeal, deal } from './deal.js';
import { takeDropGhost } from './drag.js';
import { pileScale } from './hand.js';
import { reducedMotion } from './suit-picker.js';

// ---------- mesa ----------

export function seatPosition(offset, total) {
  // offset 0 = embaixo (você). Para a direita = anti-horário na tela.
  const angle = ((90 - (offset * 360) / total) * Math.PI) / 180;
  const narrow = innerWidth < 860;
  return {
    x: 50 + (narrow ? 40 : 44) * Math.cos(angle),
    y: 50 + (narrow ? 42 : 42) * Math.sin(angle),
  };
}

// Põe o assento no lugar. Na vertical ele fica sempre inteiro dentro da mesa (--seat-half é
// meia altura do assento): em mesas baixas o de cima não sobe por cima da barra do topo.
export function placeSeat(seat, { x, y }) {
  seat.style.left = `${x}%`;
  seat.style.top = `clamp(var(--seat-half), ${y}%, 100% - var(--seat-half))`;
}

// Botão de carteador, como no pôquer: um disco com "D" e o nome por extenso no title.
export function dealerBadge() {
  const dealer = el('span', 'badge dealer', 'D');
  dealer.title = 'Deu as cartas';
  dealer.setAttribute('role', 'img');
  dealer.setAttribute('aria-label', 'Deu as cartas');
  return dealer;
}

export function renderSeats(g, s, hit) {
  const seats = $('#seats');
  seats.replaceChildren();
  const n = g.players.length;
  const myIdx = g.players.findIndex((p) => p.id === s.me);
  const base = myIdx >= 0 ? myIdx : 0;
  g.players.forEach((p, i) => {
    if (i === myIdx) return;
    const m = memberOf(p.id);
    const { x, y } = seatPosition((i - base + n) % n, n);
    const seat = el('div', 'seat');
    seat.dataset.id = p.id;
    placeSeat(seat, { x, y });
    if (p.id === g.turnId) seat.classList.add('turn');
    // Lugares do lado esquerdo põem o selo de carteador do lado de dentro (direita), para não sair da tela.
    if (x < 45) seat.classList.add('left');
    if (p.eliminated) seat.classList.add('out');
    if (hit.has(p.id)) seat.classList.add('hit');

    const av = avatar(m, p.name);
    if (p.id === g.turnId) av.prepend(turnRing());
    if (p.id === g.dealerId) av.append(dealerBadge());
    if (m && !m.isBot && !m.connected) {
      const off = el('span', 'badge offline');
      off.title = 'Desconectado';
      off.append(icon('wifi-off'));
      av.append(off);
    } else if (m?.away && !p.eliminated) {
      const away = el('span', 'badge away', 'Ausente');
      away.title = 'Ausente: o jogo está jogando por ele';
      av.append(away);
    }
    const name = nameWithBot('seat-name', p.name, m?.isBot, { top1: m?.top1 });
    const info = el('div', 'seat-info');
    if (p.eliminated) info.textContent = 'fora';
    else {
      // Quantas cartas tem na mão: a informação mais importante do assento, num selo grande
      // (vermelho quando só resta uma). O número é o último nó: a distribuição o atualiza.
      const count = deal?.counts.get(p.id) ?? p.cardCount;
      const cards = el('span', `seat-count${count === 1 ? ' last' : ''}`);
      cards.title = 'Cartas na mão';
      cards.append(el('i', 'mini-card'), document.createTextNode(count));
      info.append(cards, el('span', 'seat-pts', `${p.score} pts`));
    }
    seat.append(av, name, info);
    seats.append(seat);
  });
}

// Ao jogar 7 ou 9, uma seta sai do monte até quem vai comprar.
const TARGET_ARROW_MS = 1800;
export function showEffectTargets(events, s) {
  const hits = events.filter((e) => e.type === 'penalty' && (e.reason === '7' || e.reason === '9'));
  if (!hits.length) return;
  // Espera a carta jogada chegar no monte.
  const delay = reducedMotion() ? 0 : FLIGHT_MS * 0.8;
  setTimeout(() => hits.forEach((e) => drawTargetArrow(e.playerId, s)), delay);
}

function drawTargetArrow(playerId, s) {
  const target = playerId === s.me ? $('#meInfo .avatar') : $(`#seats .seat[data-id="${playerId}"] .avatar`);
  const pile = $('#discardPile');
  if (!target || !pile) return;
  const from = centerOf(pile);
  const to = centerOf(target);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 80) return;
  const ux = dx / len;
  const uy = dy / len;
  // Começa na borda do monte e para antes do avatar.
  const startGap = pile.getBoundingClientRect().width / 2 + 8;
  const endGap = target.getBoundingClientRect().width / 2 + 10;
  const x1 = from.x + ux * startGap;
  const y1 = from.y + uy * startGap;
  const x2 = to.x - ux * endGap;
  const y2 = to.y - uy * endGap;
  // Curva leve para o lado, para não passar por cima das cartas do centro.
  const bend = Math.min(60, len * 0.18);
  const qx = (x1 + x2) / 2 - uy * bend;
  const qy = (y1 + y2) / 2 + ux * bend;
  // Ponta da seta alinhada com a direção final da curva.
  const ex = x2 - qx;
  const ey = y2 - qy;
  const el2 = Math.hypot(ex, ey) || 1;
  const [tx, ty] = [ex / el2, ey / el2];
  const head = 14;
  const wing = 8;
  const bx = x2 - tx * head;
  const by = y2 - ty * head;

  const layer = svg('svg', {
    class: 'target-arrow',
    width: innerWidth,
    height: innerHeight,
    'aria-hidden': 'true',
  });
  layer.append(
    svg('path', {
      class: 'target-line',
      d: `M${x1} ${y1} Q${qx} ${qy} ${bx} ${by}`,
      pathLength: 1,
    }),
    svg('polygon', {
      class: 'target-head',
      points: `${x2},${y2} ${bx - ty * wing},${by + tx * wing} ${bx + ty * wing},${by - tx * wing}`,
    }),
  );
  document.body.append(layer);
  setTimeout(() => {
    layer.classList.add('out');
    setTimeout(() => layer.remove(), 300);
  }, TARGET_ARROW_MS);
}

export function cardRotation(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h % 17) - 8;
}

// Duração do voo de uma carta e intervalo entre cartas compradas em sequência.
export const FLIGHT_MS = 950;
export const DRAW_GAP_MS = 200;

export function centerOf(node, extra = {}) {
  const r = node.getBoundingClientRect();
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    scale: 1,
    ...extra,
  };
}

// De onde saiu a carta jogada: a carta na sua mão ou o avatar de quem jogou.
export function playOrigin(play, s) {
  if (play.playerId === s.me) {
    const dropped = takeDropGhost(play.card.id);
    if (dropped) return { ...dropped, flip: false };
    const card = $(`#hand [data-id="${play.card.id}"]`);
    const node = card ?? $('#meInfo .avatar');
    return (
      node && {
        ...centerOf(node, { scale: card ? pileScale(card) : 0.5 }),
        flip: false,
      }
    );
  }
  const seat = $(`#seats .seat[data-id="${play.playerId}"]`);
  if (!seat) return null;
  seat.classList.add('played');
  return {
    ...centerOf($('.avatar', seat), { scale: 0.45, fade: true }),
    flip: true,
  };
}

// Uma carta voando de um ponto da tela a outro (centros, com escala e giro). Sem `card`, voa de costas.
// `flip` vira de costas para frente no caminho; `hide` fica escondida até a carta chegar; `onLand` roda na chegada.
// (As curvas abaixo são o `easing` padrão do voo.)
export const EASE_OUT = 'cubic-bezier(0.25, 0.8, 0.25, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.45, 0, 0.2, 1)';

/**
 * @typedef {{ x: number, y: number, scale?: number, rotate?: number }} Point
 * @param {{
 *   card?: object, from: Point, to: Point, flip?: boolean, hide?: HTMLElement | null,
 *   delay?: number, easing?: string, duration?: number, onLand?: (() => void) | null,
 * }} flight
 */
export function fly({
  card,
  from,
  to,
  flip = false,
  hide,
  delay = 0,
  easing = EASE_OUT,
  duration = FLIGHT_MS,
  onLand,
}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onLand?.();
    return false;
  }
  hide?.classList.add('incoming');
  const timer = setTimeout(() => {
    flightTimers.delete(timer);
    launch({ card, from, to, flip, hide, easing, duration, onLand });
  }, delay);
  flightTimers.add(timer);
  return true;
}

// Troca de tela (início, sala de espera, mesa). Saindo da mesa, nenhuma carta continua voando.
export function show(id) {
  for (const s of ['home', 'lobby', 'game']) $(`#${s}`).classList.toggle('hidden', s !== id);
  if (id !== 'game') stopFlights();
}

// Cartas voando que ainda vão sair (a distribuição agenda dezenas). Saindo da mesa (sala fechou,
// foi removido, voltou para o início), nenhuma pode continuar voando por cima da outra tela.
const flightTimers = new Set();
export function stopFlights() {
  flightTimers.forEach(clearTimeout);
  flightTimers.clear();
  cancelDeal();
  $$('.flyer').forEach((node) => node.remove());
}

function launch({ card, from, to, flip, hide, easing, duration, onLand }) {
  const size = $('#discardPile').getBoundingClientRect();
  const flyer = el('div', 'flyer');
  const inner = el('div', 'flyer-inner');
  inner.append(card ? renderCard(card) : el('div', 'card back'), el('div', 'card back reverse'));
  flyer.append(inner);
  Object.assign(flyer.style, {
    left: `${to.x - size.width / 2}px`,
    top: `${to.y - size.height / 2}px`,
    width: `${size.width}px`,
    height: `${size.height}px`,
  });
  document.body.append(flyer);

  const timing = { duration, fill: 'both' };
  const move = flyer.animate(
    [
      {
        transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.scale}) rotate(${from.rot ?? 0}deg)`,
      },
      {
        transform: `translate(0, 0) scale(${to.scale}) rotate(${to.rot ?? 0}deg)`,
      },
    ],
    { ...timing, easing },
  );
  // Surge ao sair de um avatar e some ao chegar em outro.
  if (from.fade || to.fade) {
    flyer.animate(
      [
        { opacity: from.fade ? 0 : 1 },
        { opacity: 1, offset: 0.15 },
        { opacity: 1, offset: 0.85 },
        { opacity: to.fade ? 0 : 1 },
      ],
      timing,
    );
  }
  // Sobe um pouco no meio do caminho e, se for o caso, vira de costas para frente.
  inner.animate(
    [
      {
        transform: `rotateY(${flip ? 180 : 0}deg) scale(1)`,
        easing: 'ease-in-out',
      },
      {
        transform: 'rotateY(0deg) scale(1.12)',
        offset: 0.5,
        easing: 'ease-in-out',
      },
      { transform: 'rotateY(0deg) scale(1)' },
    ],
    timing,
  );
  move.finished
    .catch(() => {})
    .finally(() => {
      flyer.remove();
      hide?.classList.remove('incoming');
      onLand?.();
    });
}

// Onde cada jogador está na tela: o assento dos outros ou o seu avatar, na sua barra.
export function seatAnchor(playerId) {
  return playerId === state?.me ? $('#meInfo .avatar') : $(`#seats .seat[data-id="${playerId}"]`);
}

// "+N" subindo do assento de quem comprou.
export function showGain(playerId, count) {
  const seat = seatAnchor(playerId);
  if (!seat) return;
  const chip = el('div', 'gain', `+${count}`);
  seat.append(chip);
  chip.addEventListener('animationend', () => chip.remove());
}

// Aviso curto em cima do avatar de quem foi afetado (pulado, pinta pedida).
// É só visual: o leitor de tela recebe a frase inteira por speak().
export function seatCallout(playerId, parts, kind = '') {
  const anchor = seatAnchor(playerId);
  if (!anchor) return;
  anchor.querySelector(':scope > .callout')?.remove();
  const chip = el('div', `callout ${kind}`.trim());
  chip.setAttribute('aria-hidden', 'true');
  chip.append(...parts);
  anchor.append(chip);
  // some no fim da animação; com movimento reduzido não há animação, então o tempo garante
  setTimeout(() => chip.remove(), 2400);
}

// Letreiro no centro da mesa, só para os eventos grandes (rodada nova, Joker). Um por vez.
export function tableCallout(title, sub) {
  const box = $('#toasts');
  box.replaceChildren();
  const plate = el('div', 'table-callout');
  plate.append(el('strong', null, title));
  if (sub) plate.append(el('span', null, sub));
  box.append(plate);
  setTimeout(() => plate.remove(), 2600);
}
