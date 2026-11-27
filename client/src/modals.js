// Modais, gaveta de placar e chat no celular, botão de som e atalhos de teclado globais.
import { icon } from './cards.js';
import { setSideUnread } from './chat.js';
import { $, $$, muted, setMuted, store } from './core.js';
import { cancelDrag, drag } from './drag.js';
import { selectedId, setSelected } from './hand.js';
import { closeReactMenu } from './reactions.js';
import { closeSuitModal } from './suit-picker.js';
import { closeVoiceMenu } from './voice-ui.js';

// ---------- modais ----------
// Todo modal: leva o foco para dentro ao abrir, deixa o resto da página inerte (o Tab não sai dele),
// fecha com Esc e clicando fora (menos os marcados com data-static) e devolve o foco a quem abriu.

export const modalStack = [];
const modalOpener = new WeakMap();

function modalEl(modal) {
  return typeof modal === 'string' ? $(`#${modal}`) : modal;
}

// Só o modal do topo fica interativo; as telas e os outros modais ficam inertes.
function syncInert() {
  const top = modalStack.at(-1);
  for (const node of $$('body > .screen, body > .modal')) node.inert = !!top && node !== top;
}

export function openModal(modal) {
  modal = modalEl(modal);
  if (!modal.classList.contains('hidden')) return;
  const active = document.activeElement;
  if (active && active !== document.body) modalOpener.set(modal, active);
  modal.classList.remove('hidden');
  modalStack.push(modal);
  syncInert();
  const target = $$('[data-autofocus]', modal).find((n) => n.offsetParent && !n.disabled) ?? $('.modal-box', modal);
  target.focus({ preventScroll: true });
}

// Esconde na hora (o modal de pinta usa isso no fim da animação de fechar).
export function hideModal(modal) {
  modal = modalEl(modal);
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modalStack.splice(modalStack.indexOf(modal), 1);
  syncInert();
  const opener = modalOpener.get(modal);
  modalOpener.delete(modal);
  const usable = (node) => node?.isConnected && node.offsetParent && !node.closest('[inert]');
  // Quem abriu pode ter sumido (a carta jogada com o 8 sai da mão): aí o foco vai para a mão.
  const back = usable(opener) ? opener : opener?.matches?.('.card') ? $('#hand .card') : null;
  if (usable(back)) back.focus({ preventScroll: true });
  else if (modalStack.length && !modalStack.at(-1).contains(document.activeElement))
    $('.modal-box', modalStack.at(-1)).focus();
}

export function closeModal(modal) {
  modal = modalEl(modal);
  if (modal.id === 'suitModal') return closeSuitModal();
  hideModal(modal);
}

for (const modal of $$('.modal')) {
  modal.addEventListener('click', (e) => {
    if (e.target === modal && !modal.hasAttribute('data-static')) closeModal(modal);
  });
}
for (const b of $$('[data-close]')) b.addEventListener('click', () => closeModal(b.closest('.modal')));

// ---------- gaveta de placar e chat (celular) ----------

const sideQuery = matchMedia('(max-width: 860px)');

function setSideOpen(open) {
  const side = $('.side');
  const wasOpen = side.classList.contains('open');
  open = open && sideQuery.matches;
  side.classList.toggle('open', open);
  $('#sideToggle').setAttribute('aria-expanded', String(open));
  // Com a gaveta aberta, a mesa atrás fica inerte (o fundo escurecido cobre ela).
  $('.game-main').inert = open;
  if (open && !wasOpen) {
    setSideUnread(false);
    $('.side-close').focus({ preventScroll: true });
  } else if (!open && wasOpen && (side.contains(document.activeElement) || document.activeElement === document.body)) {
    $('#sideToggle').focus({ preventScroll: true });
  }
}

// Fecha o que estiver por cima: o arrasto, o menu de reações, o modal (os marcados com
// data-static ficam, mas o pedido conta como atendido), a gaveta, a carta selecionada.
// Devolve false quando não havia nada aberto. É o Esc do teclado e o voltar do Android (native.js).
export function closeTopLayer() {
  const top = modalStack.at(-1);
  if (drag?.active) cancelDrag();
  else if (!$('#reactMenu').classList.contains('hidden')) closeReactMenu({ focus: true });
  else if (!$('#voiceMenu').classList.contains('hidden')) closeVoiceMenu({ focus: true });
  else if (top) {
    if (!top.hasAttribute('data-static')) closeModal(top);
  } else if ($('.side').classList.contains('open')) setSideOpen(false);
  else if (selectedId) setSelected(null);
  else return false;
  return true;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && closeTopLayer()) e.preventDefault();
});

// ---------- painéis e modais ----------

// Botão de alternar: o nome fica fixo ("Silenciar") e o aria-pressed diz se está ligado.
function syncMuteBtn() {
  const btn = $('#muteBtn');
  btn.replaceChildren(icon(muted ? 'mute' : 'volume'));
  btn.setAttribute('aria-pressed', String(muted));
  btn.title = muted ? 'Ativar som' : 'Silenciar';
}
syncMuteBtn();
$('#muteBtn').addEventListener('click', () => {
  setMuted(!muted);
  store.set('om_muted', muted ? '1' : '0');
  syncMuteBtn();
});

$('#sideToggle').addEventListener('click', (e) => {
  e.stopPropagation();
  setSideOpen(!$('.side').classList.contains('open'));
});
$('.side-close').addEventListener('click', () => setSideOpen(false));
// Tocar fora (no fundo escurecido) fecha a gaveta.
document.addEventListener('click', (e) => {
  const side = $('.side');
  if (side.classList.contains('open') && !side.contains(e.target)) setSideOpen(false);
});
// Voltou para a tela larga: o painel fica fixo do lado, então a gaveta não existe mais.
sideQuery.addEventListener('change', () => setSideOpen(false));

for (const b of [$('#rulesBtn'), ...$$('.rules-link')]) {
  b.addEventListener('click', () => openModal('rulesModal'));
}
