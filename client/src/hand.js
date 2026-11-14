// Sua mão: disposição em fileiras, seleção e jogada das cartas.
import { sounds } from './audio.js';
import { bindCardTip, hideCardTip, refreshCardTip, setTipLongPressed, tipLongPressed, tipText } from './card-tip.js';
import { renderCard, sortHand } from './cards.js';
import { $, $$, cardName, el, emit, flash, setPendingEight, state } from './core.js';
import { deal } from './deal.js';
import { onCardPointerDown, syncDragWithHand } from './drag.js';
import { renderBanner } from './scores.js';
import { layoutSuitHand, liftedIds, openSuitModal } from './suit-picker.js';
import { renderSeats } from './table.js';

// Chegou a sua vez: as cartas da mão sobem uma depois da outra, numa onda.
export function waveHand() {
  const hand = $('#hand');
  $$('.card', hand).forEach((c, i) => c.style.setProperty('--wave', i));
  hand.classList.remove('wave');
  void hand.offsetWidth;
  hand.classList.add('wave');
  setTimeout(() => hand.classList.remove('wave'), 1400);
}

// Quanto de cada carta precisa aparecer para dar para tocar nela (área mínima de toque).
const HAND_MIN_VISIBLE = 44;
const HAND_MAX_ROWS = 3;

// Distribui a mão em fileiras: uma só enquanto cada carta mostrar pelo menos HAND_MIN_VISIBLE px;
// senão, mais fileiras. As de trás ficam meio cobertas, mostrando o canto com número e pinta.
function layoutHand() {
  const hand = $('#hand');
  const cards = $$('.card', hand);
  if (!cards.length) return;
  // Mover as cartas entre fileiras tira o foco delas; guarda para devolver no fim.
  const focused = focusedHandCard();
  const n = cards.length;
  const cardW = cards[0].offsetWidth;
  const avail = hand.clientWidth - 16;
  const overlapFor = (count) => (count < 2 ? 0 : Math.min(6, (avail - count * cardW) / (count - 1)));
  let rows = 1;
  while (rows < HAND_MAX_ROWS && cardW + overlapFor(Math.ceil(n / rows)) < HAND_MIN_VISIBLE) rows++;

  // As fileiras da frente (de baixo) levam as cartas que sobram, já que aparecem inteiras.
  const base = Math.floor(n / rows);
  const extra = n % rows;
  const rowEls = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const size = base + (r >= rows - extra ? 1 : 0);
    const row = el('div', 'hand-row');
    row.append(...cards.slice(i, i + size));
    rowEls.push(row);
    i += size;
  }
  hand.replaceChildren(...rowEls);
  hand.style.setProperty('--overlap', `${Math.max(overlapFor(base + (extra ? 1 : 0)), -cardW * 0.72)}px`);
  focused?.focus({ preventScroll: true });
}

// Carta da mão que está com o foco (teclado), se houver.
/** @returns {HTMLElement | null} */
function focusedHandCard() {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.closest('#hand .card') ? active : null;
}

// Setas esquerda/direita andam entre as cartas da mão.
function moveHandFocus(from, step) {
  const cards = $$('#hand .card');
  const i = cards.indexOf(from);
  cards[Math.max(0, Math.min(cards.length - 1, i + step))]?.focus();
}

// Escala de uma carta em relação ao monte (o voo usa o tamanho do monte; a mão pode ter cartas maiores).
export function pileScale(node) {
  return node.offsetWidth / $('#discardPile').offsetWidth;
}
// Um redesenho por quadro, no máximo: o resize dispara dezenas de vezes enquanto a janela muda.
let resizeFrame = 0;
addEventListener('resize', () => {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    layoutHand();
    layoutSuitHand();
    if (state?.game) renderSeats(state.game, state, new Set());
  });
});

// Placa no lugar da mão para quem não está jogando: um selo e uma linha.
function sideline(title, sub, kind) {
  const box = el('div', `spectator ${kind}`);
  box.append(
    el('span', 'spectator-stamp', kind === 'out' ? 'Fora!' : 'Plateia'),
    el('b', null, title),
    el('span', null, sub),
  );
  return box;
}

export function renderHand(prev, g, s, myTurn) {
  const hand = $('#hand');
  hand.classList.toggle('my-turn', myTurn);
  const me = g.players.find((p) => p.id === s.me);
  if (!me) {
    hideCardTip();
    hand.replaceChildren(sideline('Você está assistindo', 'Entra na próxima partida!', 'watch'));
    return;
  }
  if (me.eliminated) {
    hideCardTip();
    hand.replaceChildren(sideline('Você está fora', 'Assista até o fim e torça!', 'out'));
    return;
  }
  const sameRound = prev?.game?.round === g.round;
  const before = new Set(sameRound ? prev.game.hand.map((c) => c.id) : []);
  const playable = new Set(g.playable);
  // A mão é redesenhada a cada jogada: o foco volta para a mesma carta ou, se ela saiu, para a vizinha.
  const focused = focusedHandCard();
  const focusedId = focused?.dataset.id;
  const focusedIndex = focused ? $$('#hand .card').indexOf(focused) : -1;
  // A seleção só vale enquanto for a sua vez e a carta ainda puder ser jogada.
  if (!myTurn || !playable.has(selectedId)) selectedId = null;
  syncDiscardTarget();
  hand.replaceChildren(
    ...sortHand(g.hand).map((card) => {
      const node = renderCard(card);
      if (playable.has(card.id)) node.classList.add('playable');
      if (card.id === selectedId) node.classList.add('selected');
      // No toque, a primeira batida seleciona: o estado vai junto para o leitor de tela.
      if (confirmByTap()) node.setAttribute('aria-pressed', String(card.id === selectedId));
      if (sameRound && !before.has(card.id)) node.classList.add('fresh');
      if (liftedIds.has(card.id)) node.classList.add('lifted');
      if (deal?.pending.has(card.id)) node.classList.add('incoming');
      // Dá para jogar pelo teclado: Tab/setas escolhem, Enter ou Espaço joga.
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      const tip = tipText(card);
      node.setAttribute(
        'aria-label',
        `${cardName(card)}${myTurn && playable.has(card.id) ? ', jogável' : ''}${tip ? `. Efeito: ${tip.tip}` : ''}`,
      );
      node.addEventListener('click', () => {
        // O toque longo só mostrou a dica: não seleciona nem joga.
        if (tipLongPressed === card.id) {
          setTipLongPressed(null);
          return;
        }
        onCardClick(card);
      });
      node.addEventListener('pointerdown', (e) => onCardPointerDown(e, node, card));
      bindCardTip(node, card);
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCardClick(card, { direct: true });
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          moveHandFocus(node, e.key === 'ArrowRight' ? 1 : -1);
        }
      });
      return node;
    }),
  );
  layoutHand();
  syncDragWithHand(myTurn);
  refreshCardTip(g.hand);
  if (focused) {
    const cards = $$('#hand .card');
    const target = cards.find((c) => c.dataset.id === focusedId) ?? cards[Math.min(focusedIndex, cards.length - 1)];
    target?.focus({ preventScroll: true });
  }
}

// No toque (celular/tablet), a 1ª batida numa carta só seleciona; a 2ª, ou tocar no monte, joga.
// Com mouse, um clique já joga.
export let selectedId = null;
const confirmByTap = () => matchMedia('(pointer: coarse)').matches;

export function isMyTurn(s) {
  return s?.game?.phase === 'playing' && s.game.turnId === s.me;
}

export function setSelected(id) {
  selectedId = id;
  for (const node of $$('#hand .card')) {
    node.classList.toggle('selected', node.dataset.id === id);
    if (confirmByTap() || node.hasAttribute('aria-pressed'))
      node.setAttribute('aria-pressed', String(node.dataset.id === id));
  }
  syncDiscardTarget();
  if (state?.game) renderBanner(state.game, isMyTurn(state));
}

// `direct` (teclado) joga sem o passo de selecionar, como o clique do mouse.
function onCardClick(card, { direct = false } = {}) {
  const g = state?.game;
  if (!g || !isMyTurn(state)) return flash('Calma, ainda não é a sua vez');
  if (!g.playable.includes(card.id)) {
    sounds.bad();
    $(`#hand [data-id="${card.id}"]`)?.classList.add('hit');
    return flash('Essa carta não combina com a pinta nem com o número');
  }
  if (!direct && confirmByTap() && selectedId !== card.id) {
    setSelected(card.id);
    sounds.select();
    navigator.vibrate?.(15);
    return;
  }
  playCard(card);
}

export function playCard(card) {
  const g = state.game;
  setSelected(null);
  if (card.rank === '8' && g.hand.length > 1) {
    setPendingEight(card.id);
    openSuitModal(g, card);
    return null;
  }
  return emit('game:play', { cardId: card.id });
}

// O monte só vira botão quando há carta selecionada; fora disso fica fora da ordem do Tab.
export function syncDiscardTarget() {
  const pile = $('#discardPile');
  const g = state?.game;
  const card = selectedId && g?.hand.find((c) => c.id === selectedId);
  pile.classList.toggle('drop-target', !!card);
  pile.tabIndex = card ? 0 : -1;
  pile.setAttribute('aria-disabled', String(!card));
  const top = g?.top ? `Monte: ${cardName(g.top)}` : 'Monte vazio';
  pile.setAttribute('aria-label', card ? `${top}. Jogar ${cardName(card)} aqui` : top);
}

function playSelected() {
  const card = selectedId && state?.game?.hand.find((c) => c.id === selectedId);
  if (card) playCard(card);
}

// Tocar no monte joga a carta selecionada.
$('#discardPile').addEventListener('click', playSelected);
$('#discardPile').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  playSelected();
});
