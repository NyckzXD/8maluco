// Escolha da pinta ao jogar um 8.
import { renderCard, sortHand } from './cards.js';
import { $, $$, emit, pendingEight, setPendingEight } from './core.js';
import { hideModal, openModal } from './modals.js';
import { EASE_IN_OUT, EASE_OUT } from './table.js';

// ---------- escolha da pinta com o 8 ----------
// As outras cartas da mão saem da posição de jogo e vão, recolhidas, para baixo da janela de pintas,
// para dar para ver o que você tem antes de escolher. Ao fechar, voltam para a mão.
const SUIT_FLY_MS = 420;
const SUIT_GAP_MS = 28;
export let liftedIds = new Set();
let suitAnims = [];

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function layoutSuitHand() {
  const row = $('#suitHand');
  const n = row.children.length;
  if (n < 2) return;
  const cardW = row.firstElementChild.offsetWidth;
  const avail = Math.min(row.clientWidth, 560) - 8;
  const overlap = Math.min(-cardW * 0.55, (avail - n * cardW) / (n - 1));
  row.style.setProperty('--overlap', `${Math.max(overlap, -cardW * 0.8)}px`);
}

// Deslocamento (centro a centro) de um nó da mão até a carta na fileira da janela.
function offsetTo(from, to) {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  return {
    x: a.left + a.width / 2 - (b.left + b.width / 2),
    y: a.top + a.height / 2 - (b.top + b.height / 2),
    s: a.width / b.width,
  };
}

function stopSuitAnims() {
  for (const a of suitAnims) a.cancel();
  suitAnims = [];
}

export function openSuitModal(g, eight) {
  const modal = $('#suitModal');
  const row = $('#suitHand');
  const rest = sortHand(g.hand).filter((c) => c.id !== eight.id);
  stopSuitAnims();
  modal.classList.remove('closing');
  row.replaceChildren(...rest.map((c) => renderCard(c)));
  openModal('suitModal');
  layoutSuitHand();

  liftedIds = new Set(rest.map((c) => c.id));
  const sources = rest.map((c) => $(`#hand [data-id="${c.id}"]`));
  if (!reducedMotion()) {
    [...row.children].forEach((node, i) => {
      const src = sources[i];
      if (!src) return;
      const d = offsetTo(src, node);
      suitAnims.push(
        node.animate(
          [
            { transform: `translate(${d.x}px, ${d.y}px) scale(${d.s})` },
            { transform: 'translate(0, -10px) scale(1.04)', offset: 0.75 },
            { transform: 'none' },
          ],
          {
            duration: SUIT_FLY_MS,
            delay: i * SUIT_GAP_MS,
            easing: EASE_OUT,
            fill: 'backwards',
          },
        ),
      );
    });
  }
  for (const node of sources) node?.classList.add('lifted');
}

// Fecha a janela devolvendo as cartas para a mão (ou só some, se não houver animação).
export function closeSuitModal({ animate = true } = {}) {
  const modal = $('#suitModal');
  setPendingEight(null);
  if (modal.classList.contains('hidden')) return;
  // Já está fechando (Esc duas vezes, por exemplo): deixa a animação terminar.
  if (animate && modal.classList.contains('closing')) return;
  stopSuitAnims();
  const finish = () => {
    // As cartas voltam a aparecer antes de fechar, para o foco poder voltar para a carta de origem.
    liftedIds = new Set();
    for (const n of $$('#hand .card.lifted')) n.classList.remove('lifted');
    modal.classList.remove('closing');
    $('#suitHand').replaceChildren();
    hideModal(modal);
  };
  const cards = [...$('#suitHand').children];
  if (!animate || reducedMotion() || !cards.length) return finish();

  modal.classList.add('closing');
  suitAnims = cards.map((node) => {
    const dst = $(`#hand [data-id="${node.dataset.id}"]`);
    if (!dst)
      return node.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 200,
        fill: 'forwards',
      });
    const d = offsetTo(dst, node);
    return node.animate([{ transform: 'none' }, { transform: `translate(${d.x}px, ${d.y}px) scale(${d.s})` }], {
      duration: SUIT_FLY_MS * 0.7,
      easing: EASE_IN_OUT,
      fill: 'forwards',
    });
  });
  Promise.all(suitAnims.map((a) => a.finished)).then(finish, () => {});
}

for (const btn of $$('.suit-btn')) {
  btn.addEventListener('click', () => {
    const cardId = pendingEight;
    closeSuitModal();
    if (cardId) emit('game:play', { cardId, suit: btn.dataset.suit });
  });
}
