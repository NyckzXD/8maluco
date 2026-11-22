// Dica com o efeito das cartas especiais (passar o mouse, toque longo ou foco).
import { $, RANK_NAMES, SPECIAL_TIPS, el, state } from './core.js';
import { vibrate } from './platform.js';

// ---------- dica das cartas especiais ----------
// Passar o mouse, dar um toque longo ou focar pelo teclado numa carta com estrela mostra o efeito dela.
const TIP_HOVER_MS = 350;
const TIP_PRESS_MS = 450;
const cardTip = el('div', 'card-tip hidden');
cardTip.setAttribute('aria-hidden', 'true'); // o efeito já vai no aria-label da carta
document.body.append(cardTip);
let tipCardId = null;
export let tipTimer;
export let tipPress = null; // toque longo em andamento: { id, x, y }
export let tipLongPressed = null; // id da carta cujo toque longo abriu a dica (o clique seguinte não seleciona)
export const setTipPress = (v) => (tipPress = v);
export const setTipLongPressed = (v) => (tipLongPressed = v);

export function tipText(card) {
  let tip = SPECIAL_TIPS[card.rank];
  // mesa de dois: o 7 também faz o outro perder a vez (shared/engine.js)
  const active = state?.game?.players.filter((p) => !p.eliminated).length;
  if (card.rank === '7' && active === 2) tip = 'o outro jogador compra 1 carta e perde a vez: você joga de novo';
  return tip && { rank: RANK_NAMES[card.rank] ?? card.rank, tip };
}

function showCardTip(node, card) {
  const t = tipText(card);
  if (!t) return;
  tipCardId = card.id;
  cardTip.replaceChildren(el('b', null, `${t.rank}:`), ` ${t.tip}`);
  cardTip.classList.remove('hidden');
  placeCardTip(node);
}

// Acima da carta, centralizada nela, sem sair da tela.
function placeCardTip(node) {
  const r = node.getBoundingClientRect();
  const w = cardTip.offsetWidth;
  const x = Math.min(Math.max(r.left + r.width / 2, w / 2 + 8), innerWidth - w / 2 - 8);
  cardTip.style.left = `${x}px`;
  cardTip.style.top = `${r.top - 10}px`;
  cardTip.style.setProperty('--caret-x', `${r.left + r.width / 2 - x}px`);
}

export function hideCardTip() {
  clearTimeout(tipTimer);
  tipCardId = null;
  cardTip.classList.add('hidden');
}

// Liga os eventos da dica numa carta da mão (só as especiais têm dica).
export function bindCardTip(node, card) {
  if (!tipText(card)) return;
  node.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showCardTip(node, card), TIP_HOVER_MS);
  });
  node.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hideCardTip();
  });
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    tipPress = { id: card.id, x: e.clientX, y: e.clientY };
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tipLongPressed = card.id;
      showCardTip(node, card);
      vibrate('tip');
    }, TIP_PRESS_MS);
  });
  node.addEventListener('pointermove', (e) => {
    if (tipPress && Math.hypot(e.clientX - tipPress.x, e.clientY - tipPress.y) > 10) {
      tipPress = null;
      clearTimeout(tipTimer);
    }
  });
  const release = () => {
    if (!tipPress) return;
    tipPress = null;
    clearTimeout(tipTimer);
    // A dica do toque longo fica um pouco na tela depois de soltar.
    if (tipLongPressed === card.id) tipTimer = setTimeout(hideCardTip, 1800);
  };
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  // Sem o menu de "copiar/salvar" do toque longo.
  node.addEventListener('contextmenu', (e) => e.preventDefault());
  node.addEventListener('focus', () => {
    if (node.matches(':focus-visible')) showCardTip(node, card);
  });
  node.addEventListener('blur', hideCardTip);
}

// A mão é redesenhada a cada atualização: a dica volta a apontar para a mesma carta, se ela ainda estiver lá.
export function refreshCardTip(hand) {
  if (!tipCardId) return;
  const node = $(`#hand [data-id="${tipCardId}"]`);
  const card = hand.find((c) => c.id === tipCardId);
  if (node && card) showCardTip(node, card);
  else hideCardTip();
}

addEventListener('resize', hideCardTip);
addEventListener('scroll', hideCardTip); // só a página: o chat rola sozinho a cada jogada
