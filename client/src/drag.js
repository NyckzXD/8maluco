// Arrastar a carta da mão para o monte.
import { sounds } from './audio.js';
import { hideCardTip, setTipPress, tipTimer } from './card-tip.js';
import { $, emit, flash, state } from './core.js';
import { isMyTurn, playCard, selectedId, setSelected } from './hand.js';
import { reducedMotion } from './suit-picker.js';
import { EASE_OUT } from './table.js';

// ---------- arrastar a carta para o monte ----------
// Mouse, toque e caneta pelos mesmos pointer events. Mexer menos que DRAG_START_PX continua sendo
// clique/toque normal. Soltar perto do monte joga; soltar em outro lugar devolve a carta para a mão.
const DRAG_START_PX = 8;
export let drag = null; // arraste em andamento: { id, card, node, x0, y0, rect, ghost, active, over, tilt }
let dropGhost = null; // carta solta no monte esperando a jogada voltar do servidor
let suppressClickUntil = 0;

export function onCardPointerDown(e, node, card) {
  if (!e.isPrimary || e.button !== 0 || drag || dropGhost || !isMyTurn(state)) return;
  drag = {
    id: card.id,
    card,
    node,
    x0: e.clientX,
    y0: e.clientY,
    active: false,
    over: false,
    tilt: 0,
  };
}

// A carta que segue o dedo é uma cópia solta no body; a original fica apagada no lugar dela.
function startDrag() {
  const { node } = drag;
  const rect = node.getBoundingClientRect();
  const ghost = node.cloneNode(true);
  ghost.classList.remove('playable', 'selected', 'fresh', 'lifted', 'hit');
  ghost.classList.add('drag-ghost');
  for (const a of ['tabindex', 'role', 'aria-label', 'aria-pressed', 'style']) ghost.removeAttribute(a);
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  ghost.style.setProperty('--card-w', `${rect.width}px`);
  ghost.style.setProperty('--card-h', `${rect.height}px`);
  document.body.append(ghost);
  node.classList.add('dragging');
  Object.assign(drag, { rect, ghost, active: true });
  // O arraste toma o lugar da seleção por toque e da dica do toque longo.
  setSelected(null);
  setTipPress(null);
  clearTimeout(tipTimer);
  hideCardTip();
  $('#discardPile').classList.add('drag-ready');
  document.body.classList.add('is-dragging');
}

// Área de soltar: o monte com uma folga em volta, para não exigir mira.
function overPile(x, y) {
  const r = $('#discardPile').getBoundingClientRect();
  const pad = Math.max(28, r.width * 0.5);
  return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
}

function clearDragUi() {
  $('#discardPile').classList.remove('drag-ready', 'drag-over');
  document.body.classList.remove('is-dragging');
}

// Devolve a cópia para a carta da mão (ou só some, com movimento reduzido).
function snapBack({ ghost, node, rect }, { hit = false } = {}) {
  const finish = () => {
    ghost.remove();
    node.classList.remove('dragging');
    if (hit) node.classList.add('hit');
  };
  if (reducedMotion() || !node.isConnected) return finish();
  const r = node.getBoundingClientRect();
  ghost.animate(
    [
      { transform: ghost.style.transform || 'none' },
      {
        transform: `translate(${r.left - rect.left}px, ${r.top - rect.top}px)`,
      },
    ],
    {
      duration: 220,
      easing: EASE_OUT,
      fill: 'forwards',
    },
  ).onfinish = finish;
}

export function cancelDrag() {
  const d = drag;
  drag = null;
  if (!d?.active) return;
  clearDragUi();
  snapBack(d);
}

function endDrag(x, y) {
  const d = drag;
  drag = null;
  if (!d.active) return; // foi só um clique/toque: o evento click cuida
  suppressClickUntil = performance.now() + 400;
  clearDragUi();
  const g = state?.game;
  if (!overPile(x, y) || !g || !isMyTurn(state)) return snapBack(d);
  if (!g.playable.includes(d.id)) {
    sounds.bad();
    flash('Essa carta não combina com a pinta nem com o número');
    return snapBack(d, { hit: true });
  }
  // O 8 pede a pinta antes de sair: a carta volta para a mão e a janela de pintas abre.
  if (d.card.rank === '8' && g.hand.length > 1) {
    snapBack(d);
    playCard(d.card);
    return;
  }
  // A cópia fica parada no monte até a jogada voltar; o voo final sai dali (playOrigin).
  dropGhost = { ...d, timer: setTimeout(releaseDropGhost, 3000) };
  playCard(d.card)?.then((res) => {
    if (res && !res.ok) releaseDropGhost();
  });
}

// A jogada não aconteceu (erro ou demora demais): a carta volta para a mão.
function releaseDropGhost() {
  if (!dropGhost) return;
  const d = dropGhost;
  dropGhost = null;
  clearTimeout(d.timer);
  snapBack(d);
}

// Usado por playOrigin: de onde a carta solta deve voar até o monte.
export function takeDropGhost(cardId) {
  if (dropGhost?.id !== cardId) return null;
  const d = dropGhost;
  dropGhost = null;
  clearTimeout(d.timer);
  const r = d.ghost.getBoundingClientRect();
  const from = {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    scale: (d.rect.width * 0.92) / $('#discardPile').offsetWidth,
    rot: d.tilt,
  };
  d.ghost.remove();
  return from;
}

// A mão foi redesenhada no meio do arraste: segue com a carta nova ou desiste se ela não vale mais.
export function syncDragWithHand(myTurn) {
  if (drag) {
    const node = $(`#hand [data-id="${drag.id}"]`);
    if (node && myTurn) {
      drag.node = node;
      if (drag.active) node.classList.add('dragging');
    } else if (drag.active) cancelDrag();
    else drag = null;
  }
  if (dropGhost) {
    const node = $(`#hand [data-id="${dropGhost.id}"]`);
    if (node) {
      node.classList.add('dragging');
      dropGhost.node = node;
    }
  }
}

addEventListener('pointermove', (e) => {
  if (!drag || !e.isPrimary) return;
  const dx = e.clientX - drag.x0;
  const dy = e.clientY - drag.y0;
  if (!drag.active) {
    if (Math.hypot(dx, dy) < DRAG_START_PX) return;
    startDrag();
  }
  const over = overPile(e.clientX, e.clientY);
  if (over !== drag.over) {
    drag.over = over;
    $('#discardPile').classList.toggle('drag-over', over);
  }
  drag.tilt = Math.max(-12, Math.min(12, dx / 20));
  drag.ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(${drag.tilt}deg) scale(${over ? 0.92 : 1.06})`;
});
addEventListener('pointerup', (e) => {
  if (drag && e.isPrimary) endDrag(e.clientX, e.clientY);
});
addEventListener('pointercancel', (e) => {
  if (drag && e.isPrimary) cancelDrag();
});
// Soltar a carta de volta na mão não pode virar um clique (no mouse, o clique joga).
addEventListener(
  'click',
  (e) => {
    if (performance.now() >= suppressClickUntil) return;
    suppressClickUntil = 0;
    e.stopPropagation();
    e.preventDefault();
  },
  true,
);

// Tocar fora da mão (e do monte) desfaz a seleção.
document.addEventListener('click', (e) => {
  if (selectedId && !(e.target instanceof Element && e.target.closest('#hand .card, #discardPile'))) setSelected(null);
});

$('#drawPile').addEventListener('click', () => {
  setSelected(null);
  emit('game:draw');
});
$('#passBtn').addEventListener('click', () => emit('game:pass'));
