import { SUIT_INFO } from '/shared/engine.js';
import {
  avatarSVG,
  randomAvatar,
  sanitizeAvatar,
  BACKGROUNDS,
  SKINS,
  OUTFITS,
  OUTFIT_COLORS,
  HAIRS,
  HAIR_COLORS,
  FACES,
} from '/shared/avatar.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

// Token secreto que identifica este navegador: permite voltar para a sala depois de cair.
const token =
  store.get('om_token') ?? (crypto.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
store.set('om_token', token);

const socket = io();
let state = null;
let roomCode = null;
let clockOffset = 0;
let pendingEight = null;
let muted = store.get('om_muted') === '1';

const RANK_NAMES = { A: 'Ás', J: 'Valete', Q: 'Dama', K: 'Rei', JOKER: 'Joker' };
const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'JOKER'];
// Efeito de cada carta especial (as que têm estrela), mostrado na dica da mão.
const SPECIAL_TIPS = {
  A: 'pula o próximo jogador',
  7: 'o jogador da esquerda compra 1 carta',
  8: 'entra em qualquer pinta e você escolhe a pinta do próximo',
  9: 'o jogador da direita compra 2 cartas e perde a vez',
  JOKER: 'entra em qualquer carta e todos os outros compram 1',
};

// ---------- utilidades ----------

function show(id) {
  for (const s of ['home', 'lobby', 'game']) $(`#${s}`).classList.toggle('hidden', s !== id);
}

// Escreve num aviso fixo para leitores de tela. Limpa antes, para repetir a mesma frase também ser lida.
function speak(text, { urgent = false } = {}) {
  const region = $(urgent ? '#srAlert' : '#srStatus');
  region.textContent = '';
  setTimeout(() => (region.textContent = text), 50);
}

// Aviso rápido no rodapé. Por padrão é um erro (lido na hora); `info` é lido sem interromper.
function flash(text, { info = false } = {}) {
  const el = document.createElement('div');
  // na partida o aviso vai para o topo, longe da mão
  el.className = $('#game').classList.contains('hidden') ? 'flash' : 'flash in-game';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 3100);
  speak(text, { urgent: !info });
}

function emit(event, data = {}) {
  return new Promise((resolve) => {
    socket.emit(event, data, (res) => {
      if (res && !res.ok && res.error) flash(res.error);
      resolve(res ?? { ok: true });
    });
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Desenho do avatar (SVG montado a partir de índices, então pode ir direto no innerHTML).
function avatarArt(config, opts) {
  const art = el('span', 'avatar-art');
  art.innerHTML = avatarSVG(config, opts);
  return art;
}

// Avatar de um membro da sala; quem não tem avatar (ou já saiu) aparece com a inicial do nome.
function avatar(member, name) {
  if (member?.avatar) {
    const a = el('div', 'avatar has-art');
    a.append(avatarArt(member.avatar, { title: name ?? member.name }));
    return a;
  }
  const a = el('div', 'avatar', (name ?? member?.name ?? '?').trim().charAt(0).toUpperCase());
  a.style.background = member?.color ?? '#999';
  return a;
}

function memberOf(id) {
  return state?.members.find((m) => m.id === id);
}

function nameOf(id) {
  return memberOf(id)?.name ?? state?.game?.players.find((p) => p.id === id)?.name ?? '?';
}

function cardName(card) {
  if (card.rank === 'JOKER') return 'Joker';
  return `${RANK_NAMES[card.rank] ?? card.rank} de ${SUIT_INFO[card.suit].name}`;
}

function setUrl(code) {
  history.replaceState(null, '', code ? `?sala=${code}` : location.pathname);
}

// ---------- modais ----------
// Todo modal: leva o foco para dentro ao abrir, deixa o resto da página inerte (o Tab não sai dele),
// fecha com Esc e clicando fora (menos os marcados com data-static) e devolve o foco a quem abriu.

const modalStack = [];
const modalOpener = new WeakMap();

function modalEl(modal) {
  return typeof modal === 'string' ? $(`#${modal}`) : modal;
}

// Só o modal do topo fica interativo; as telas e os outros modais ficam inertes.
function syncInert() {
  const top = modalStack.at(-1);
  for (const node of $$('body > .screen, body > .modal')) node.inert = !!top && node !== top;
}

function openModal(modal) {
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
function hideModal(modal) {
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
  else if (modalStack.length && !modalStack.at(-1).contains(document.activeElement)) $('.modal-box', modalStack.at(-1)).focus();
}

function closeModal(modal) {
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

// Esc fecha o que estiver por cima: modal, depois a gaveta, depois a carta selecionada.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (drag?.active) {
    cancelDrag();
    e.preventDefault();
    return;
  }
  const top = modalStack.at(-1);
  if (top) {
    if (!top.hasAttribute('data-static')) closeModal(top);
  } else if ($('.side').classList.contains('open')) setSideOpen(false);
  else if (selectedId) setSelected(null);
  else return;
  e.preventDefault();
});

// ---------- cartas ----------

// Naipes desenhados num quadrado 100×100, usados por <use> nas cartas (não dependem da fonte nem viram emoji).
document.body.insertAdjacentHTML(
  'afterbegin',
  `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <symbol id="suit-H" viewBox="0 0 100 100"><path fill="currentColor" d="M50 94C22 68 3 52 3 30 3 14 15 4 29 4c10 0 17 6 21 15 4-9 11-15 21-15 14 0 26 10 26 26 0 22-19 38-47 64z"/></symbol>
    <symbol id="suit-D" viewBox="0 0 100 100"><path fill="currentColor" d="M50 1 86 50 50 99 14 50z"/></symbol>
    <symbol id="suit-S" viewBox="0 0 100 100"><path fill="currentColor" d="M50 2C40 24 5 40 5 63c0 13 10 22 22 22 9 0 16-4 20-11-1 11-5 18-14 24h34c-9-6-13-13-14-24 4 7 11 11 20 11 12 0 22-9 22-22C95 40 60 24 50 2z"/></symbol>
    <symbol id="suit-C" viewBox="0 0 100 100"><g fill="currentColor"><circle cx="50" cy="27" r="21"/><circle cx="26" cy="60" r="21"/><circle cx="74" cy="60" r="21"/><path d="M42 40h16v20H42z"/><path d="M47 62c-1 15-5 26-15 36h36c-10-10-14-21-15-36z"/></g></symbol>
    <symbol id="star" viewBox="0 0 24 24"><path fill="currentColor" d="m12 1.8 3 6.9 7.5.7-5.7 5 1.7 7.3L12 17.9l-6.5 3.8 1.7-7.3-5.7-5 7.5-.7z"/></symbol>
    <symbol id="jester" viewBox="0 0 100 100"><g stroke="#1d1d28" stroke-width="2.5" stroke-linejoin="round">
      <path fill="#d0102a" d="M24 72C18 54 10 42 6 30c14 2 26 14 30 30z"/><path fill="#d0102a" d="M76 72c6-18 14-30 18-42-14 2-26 14-30 30z"/>
      <path fill="#2aa7d8" d="M28 72C30 44 40 22 50 8c10 14 20 36 22 64z"/>
      <rect fill="#f5c43a" x="20" y="70" width="60" height="14" rx="4"/>
      <path fill="#d0102a" d="M34 77l4-4 4 4-4 4zM46 77l4-4 4 4-4 4zM58 77l4-4 4 4-4 4z"/>
      <circle fill="#f5c43a" cx="6" cy="30" r="5"/><circle fill="#f5c43a" cx="50" cy="8" r="5"/><circle fill="#f5c43a" cx="94" cy="30" r="5"/>
    </g></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><rect x="10" y="3" width="4" height="18" rx="2"/><rect x="3" y="10" width="18" height="4" rx="2"/></symbol>
    <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="7.5" r="4"/><path d="M1.5 20.5c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5V21h-15z"/><circle cx="17.5" cy="8.5" r="3"/><path d="M17.6 13c2.8.3 4.9 3 4.9 6V21h-4.3v-.5c0-2.9-1.1-5.5-2.9-7.3.7-.2 1.5-.3 2.3-.2z"/></symbol>
    <symbol id="i-book" viewBox="0 0 24 24"><path d="M2 5c0-1.1.9-2 2-2h4c1.9 0 3 1 3 2.8V21c-.7-1-1.8-1.5-3-1.5H4c-1.1 0-2-.9-2-2zM22 5c0-1.1-.9-2-2-2h-4c-1.9 0-3 1-3 2.8V21c.7-1 1.8-1.5 3-1.5h4c1.1 0 2-.9 2-2z"/></symbol>
    <symbol id="i-back" viewBox="0 0 24 24"><path d="M10.3 3.8a1.7 1.7 0 0 1 0 2.4L6.8 9.8H20a2.2 2.2 0 0 1 0 4.4H6.8l3.5 3.6a1.7 1.7 0 0 1-2.4 2.4l-6-6.2a2.7 2.7 0 0 1 0-4l6-6.2a1.7 1.7 0 0 1 2.4 0z"/></symbol>
    <symbol id="i-bot" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 1.5a1.5 1.5 0 0 1 1.5 1.5v2H16a4 4 0 0 1 4 4v.5h.5A1.5 1.5 0 0 1 22 11v4a1.5 1.5 0 0 1-1.5 1.5H20v.5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-.5h-.5A1.5 1.5 0 0 1 2 15v-4a1.5 1.5 0 0 1 1.5-1.5H4V9a4 4 0 0 1 4-4h2.5V3A1.5 1.5 0 0 1 12 1.5zM9 10.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></symbol>
    <symbol id="i-volume" viewBox="0 0 24 24"><path d="M3 9.5c0-.8.7-1.5 1.5-1.5H7l4.4-3.7c.7-.6 1.6-.1 1.6.8v13.8c0 .9-.9 1.4-1.6.8L7 16H4.5c-.8 0-1.5-.7-1.5-1.5z"/><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M16.3 8.8a4.5 4.5 0 0 1 0 6.4M19.2 5.9a8.6 8.6 0 0 1 0 12.2"/></symbol>
    <symbol id="i-mute" viewBox="0 0 24 24"><path d="M3 9.5c0-.8.7-1.5 1.5-1.5H7l4.4-3.7c.7-.6 1.6-.1 1.6.8v13.8c0 .9-.9 1.4-1.6.8L7 16H4.5c-.8 0-1.5-.7-1.5-1.5z"/><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="m16.5 9.5 5 5M21.5 9.5l-5 5"/></symbol>
    <symbol id="i-pause" viewBox="0 0 24 24"><rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/></symbol>
    <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 5.2c0-1.2 1.3-1.9 2.3-1.3l10.4 6.8c.9.6.9 2 0 2.6L9.3 20.1c-1 .6-2.3-.1-2.3-1.3z"/></symbol>
    <symbol id="i-chat" viewBox="0 0 24 24"><path d="M12 2.5c5.5 0 10 3.8 10 8.5s-4.5 8.5-10 8.5c-1.1 0-2.2-.2-3.2-.4l-4.6 2.6c-.8.4-1.6-.3-1.4-1.1l1.1-3.9C2.8 15.1 2 13.1 2 11c0-4.7 4.5-8.5 10-8.5z"/></symbol>
    <symbol id="i-refresh" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M19.5 9.5A8 8 0 0 0 5 7.5M4.5 14.5A8 8 0 0 0 19 16.5"/><path d="M21 3.5v6.2c0 .6-.5 1-1 1h-6.2c-.9 0-1.3-1.1-.7-1.7l6.2-6.2c.6-.6 1.7-.2 1.7.7zM3 20.5v-6.2c0-.6.5-1 1-1h6.2c.9 0 1.3 1.1.7 1.7l-6.2 6.2c-.6.6-1.7.2-1.7-.7z"/></symbol>
    <symbol id="i-chevron" viewBox="0 0 24 24"><path d="M4.2 9.3a1.8 1.8 0 0 1 2.5-2.5l5.3 5.3 5.3-5.3a1.8 1.8 0 0 1 2.5 2.5l-6.5 6.5a1.8 1.8 0 0 1-2.6 0z"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="M3.8 12.3a1.8 1.8 0 0 1 2.6 0l3.1 3.1 8.1-8.9a1.8 1.8 0 0 1 2.7 2.4l-9.4 10.3a1.8 1.8 0 0 1-2.6.1l-4.5-4.5a1.8 1.8 0 0 1 0-2.5z"/></symbol>
    <symbol id="i-x" viewBox="0 0 24 24"><path d="M5.2 5.2a1.8 1.8 0 0 1 2.5 0l4.3 4.3 4.3-4.3a1.8 1.8 0 0 1 2.5 2.5L14.5 12l4.3 4.3a1.8 1.8 0 0 1-2.5 2.5L12 14.5l-4.3 4.3a1.8 1.8 0 0 1-2.5-2.5L9.5 12 5.2 7.7a1.8 1.8 0 0 1 0-2.5z"/></symbol>
    <symbol id="i-wifi-off" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M8.5 15.8a5 5 0 0 1 7 0M5 12.3a10 10 0 0 1 5-2.6M19 12.3a10 10 0 0 0-2-1.4M2 8.6a15 15 0 0 1 4-2.5M22 8.6A15 15 0 0 0 11 5M3 3l18 18"/><circle cx="12" cy="19.5" r="1.8"/></symbol>
    <symbol id="i-trophy" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M7 2h10a1 1 0 0 1 1 1v.5h2.5A1.5 1.5 0 0 1 22 5v1.5a5 5 0 0 1-4.6 5 6 6 0 0 1-3.9 3.3V18H16a1.5 1.5 0 0 1 1.5 1.5V22h-11v-2.5A1.5 1.5 0 0 1 8 18h2.5v-3.2a6 6 0 0 1-3.9-3.3A5 5 0 0 1 2 6.5V5a1.5 1.5 0 0 1 1.5-1.5H6V3a1 1 0 0 1 1-1zM4.5 6v.5a2.5 2.5 0 0 0 1.6 2.3A6 6 0 0 1 6 8V6zm15 0H18v2c0 .3 0 .5-.1.8a2.5 2.5 0 0 0 1.6-2.3z"/></symbol>
    <symbol id="i-pencil" viewBox="0 0 24 24"><path d="M16.6 2.6a2.2 2.2 0 0 1 3.1 0l1.7 1.7a2.2 2.2 0 0 1 0 3.1L9.2 19.6l-5.6 1.7c-.6.2-1.1-.4-.9-.9l1.7-5.6z"/></symbol>
    <symbol id="i-dice" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm2 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-4 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-4 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></symbol>
    <symbol id="i-image" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm4 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5.5 18.5h13l-4.5-6-3.2 4-2-2.2z"/></symbol>
    <symbol id="i-droplet" viewBox="0 0 24 24"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></symbol>
    <symbol id="i-shirt" viewBox="0 0 24 24"><path d="M20.4 3.5 16 2a4 4 0 0 1-8 0L3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.2a1 1 0 0 0 1-.8l.6-3.5a2 2 0 0 0-1.4-2.2z"/></symbol>
    <symbol id="i-scissors" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M6 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM6 14.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M20 4 8.5 15.5M14.5 14.5 20 20M8.5 8.5 12 12"/></symbol>
    <symbol id="i-smile" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM8.8 7.8a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm6.4 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM7.3 13.5c.8 2.1 2.6 3.5 4.7 3.5s3.9-1.4 4.7-3.5z"/></symbol>
    <symbol id="i-crown" viewBox="0 0 24 24"><path fill="currentColor" stroke="#1d1d28" stroke-width="1.5" stroke-linejoin="round" d="M2.5 18 4 7l5 4.5L12 4l3 7.5L20 7l1.5 11z"/></symbol>
  </defs></svg>`,
);

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Ícones de interface (sprite acima): icon('bot') -> <svg class="icon"><use href="#i-bot"/></svg>.
function icon(name, className = '') {
  const node = svg('svg', { class: `icon ${className}`.trim(), 'aria-hidden': 'true' });
  node.append(svg('use', { href: `#i-${name}` }));
  return node;
}

// Nome com um ícone de robô na frente quando é bot.
function nameWithBot(className, name, isBot) {
  const node = el('div', className);
  if (isBot) node.append(icon('bot'), ' ');
  node.append(name);
  return node;
}

function suitIcon(suit, className) {
  const icon = svg('svg', { class: className, viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  icon.append(svg('use', { href: `#suit-${suit}` }));
  return icon;
}

// Disposição clássica dos pips: [coluna, altura de 0 (topo) a 1 (base)]. Os da metade de baixo ficam de ponta-cabeça.
const L = 23.5, C = 36, R = 48.5;
const PIPS = {
  2: [[C, 0], [C, 1]],
  3: [[C, 0], [C, 0.5], [C, 1]],
  4: [[L, 0], [R, 0], [L, 1], [R, 1]],
  5: [[L, 0], [R, 0], [C, 0.5], [L, 1], [R, 1]],
  6: [[L, 0], [R, 0], [L, 0.5], [R, 0.5], [L, 1], [R, 1]],
  7: [[L, 0], [R, 0], [C, 0.25], [L, 0.5], [R, 0.5], [L, 1], [R, 1]],
  8: [[L, 0], [R, 0], [C, 0.25], [L, 0.5], [R, 0.5], [C, 0.75], [L, 1], [R, 1]],
  9: [[L, 0], [R, 0], [L, 1 / 3], [R, 1 / 3], [C, 0.5], [L, 2 / 3], [R, 2 / 3], [L, 1], [R, 1]],
  10: [[L, 0], [R, 0], [C, 1 / 6], [L, 1 / 3], [R, 1 / 3], [L, 2 / 3], [R, 2 / 3], [C, 5 / 6], [L, 1], [R, 1]],
};

// Pips no mesmo sistema de coordenadas da carta (72×104), então escalam junto com --card-w.
function renderPips(card) {
  const box = svg('svg', { class: 'pips', viewBox: '0 0 72 104' });
  const pip = (x, y, size, flip) => {
    const use = svg('use', { href: `#suit-${card.suit}`, x: x - size / 2, y: y - size / 2, width: size, height: size });
    if (flip) use.setAttribute('transform', `rotate(180 ${x} ${y})`);
    box.append(use);
  };
  if (card.rank === 'A') pip(C, 52, 26, false);
  else for (const [x, t] of PIPS[card.rank]) pip(x, 21 + t * 62, 14, t > 0.5);
  return box;
}

// Estrela dourada no canto das cartas especiais (SVG, para não virar emoji).
function starMark() {
  const star = svg('svg', { class: 'star', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  star.append(svg('use', { href: '#star' }));
  return star;
}

function renderCard(card) {
  const node = el('div', 'card');
  node.dataset.id = card.id;
  if (card.rank === 'JOKER') {
    node.classList.add('joker', 'special');
    const hat = svg('svg', { class: 'pips', viewBox: '0 0 100 100' });
    hat.append(svg('use', { href: '#jester' }));
    node.append(el('span', 'label', 'JOKER'), hat, el('span', 'label bottom', 'JOKER'), starMark());
    return node;
  }
  const suit = SUIT_INFO[card.suit];
  if (suit.color === 'red') node.classList.add('red');
  if (SPECIAL_TIPS[card.rank]) {
    node.classList.add('special');
    node.append(starMark());
  }
  for (const pos of ['tl', 'br']) {
    const corner = el('span', `corner ${pos}`);
    corner.append(el('b', null, card.rank), suitIcon(card.suit));
    node.append(corner);
  }
  if (['J', 'Q', 'K'].includes(card.rank)) {
    const art = el('img', 'face');
    art.src = `/cards/${card.rank}${card.suit}.webp`;
    art.alt = '';
    art.draggable = false;
    node.append(art);
  } else node.append(renderPips(card));
  return node;
}

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const sa = a.suit ? SUIT_ORDER[a.suit] : 9;
    const sb = b.suit ? SUIT_ORDER[b.suit] : 9;
    return sa - sb || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
  });
}

// ---------- som ----------

let audio;
function beep(freqs, dur = 0.08, type = 'triangle', gain = 0.06) {
  if (muted) return;
  try {
    audio ??= new AudioContext();
    let t = audio.currentTime;
    for (const f of freqs) {
      const osc = audio.createOscillator();
      const g = audio.createGain();
      osc.type = type;
      osc.frequency.value = f;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur * 0.9;
    }
  } catch {}
}

const sounds = {
  card: () => beep([520], 0.05, 'square', 0.03),
  select: () => beep([740], 0.04, 'triangle', 0.03),
  turn: () => beep([660, 880], 0.12),
  bad: () => beep([220, 160], 0.12, 'sawtooth', 0.03),
  tick: () => beep([990], 0.05, 'square', 0.025),
  win: () => beep([523, 659, 784, 1046], 0.14),
};

// ---------- chat ----------

const chatTemplate = $('#chatTemplate');
$$('[data-chat]').forEach((panel, i) => {
  panel.append(chatTemplate.content.cloneNode(true));
  // Cada cópia do chat ganha ids próprios para o botão de recolher apontar para o que ele controla.
  const log = $('.chat-log', panel);
  log.id = `chatLog${i}`;
  $('.chat-form', panel).id = `chatForm${i}`;
  $('.chat-toggle', panel).setAttribute('aria-controls', `${log.id} chatForm${i}`);
  const form = $('form', panel);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input', form);
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat', { text });
    input.value = '';
  });
});

// Chat da mesa recolhível, para dar mais espaço e foco ao jogo.
const gameChat = $('.side .chat-panel');
const chatToggle = $('.chat-toggle', gameChat);

// Os pontinhos de "mensagem nova" são só visuais: o nome do botão diz a mesma coisa para o leitor de tela.
function setSideUnread(on) {
  $('#unread').classList.toggle('hidden', !on);
  $('#sideToggle').setAttribute('aria-label', on ? 'Placar e chat, mensagens novas' : 'Placar e chat');
}
function setChatUnread(on) {
  $('.chat-unread', gameChat).classList.toggle('hidden', !on);
  chatToggle.setAttribute('aria-label', on ? 'Chat, mensagens novas' : 'Chat');
}
function setChatCollapsed(collapsed) {
  gameChat.classList.toggle('collapsed', collapsed);
  chatToggle.setAttribute('aria-expanded', String(!collapsed));
  chatToggle.title = collapsed ? 'Abrir chat' : 'Recolher chat';
  store.set('om_chat_collapsed', collapsed ? '1' : '0');
  if (!collapsed) {
    setChatUnread(false);
    const log = $('.chat-log', gameChat);
    log.scrollTop = log.scrollHeight;
  }
}
setChatCollapsed(store.get('om_chat_collapsed') === '1');
$('.panel-head', gameChat).addEventListener('click', () => {
  setChatCollapsed(!gameChat.classList.contains('collapsed'));
});

function addChat(msg) {
  for (const log of $$('.chat-log')) {
    const li = el('li', msg.system ? 'system' : msg.log ? (msg.who ? 'log play' : 'log') : '');
    // jogadas e compras: só o nome de quem agiu fica em vermelho
    if (msg.who) li.append(el('b', 'log-who', msg.who), ' ');
    if (msg.from) {
      const who = el('b', null, `${msg.from}: `);
      who.style.color = msg.color;
      li.append(who);
    }
    li.append(document.createTextNode(msg.text));
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.append(li);
    while (log.children.length > 150) log.firstChild.remove();
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }
  if (!msg.log && !$('.side').classList.contains('open') && !$('#game').classList.contains('hidden')) {
    setSideUnread(true);
  }
  if (!msg.log && gameChat.classList.contains('collapsed')) setChatUnread(true);
}

function logLine(text) {
  addChat({ log: true, text });
}

// Linha do histórico de jogadas: "<nome> jogou 9 de Paus".
function logPlay(who, text) {
  addChat({ log: true, who, text });
}

const cardsLabel = (n) => `${n} carta${n > 1 ? 's' : ''}`;

// ---------- tela inicial ----------

const nameInput = $('#nameInput');
const codeInput = $('#codeInput');
nameInput.value = store.get('om_name') ?? '';

// ---------- avatar ----------
// Fica salvo neste navegador e vai junto ao entrar numa sala. Na primeira visita, sorteia um.

function loadAvatar() {
  try {
    return sanitizeAvatar(JSON.parse(store.get('om_avatar')));
  } catch {
    return null;
  }
}

let myAvatar = loadAvatar();
if (!myAvatar) {
  myAvatar = randomAvatar();
  store.set('om_avatar', JSON.stringify(myAvatar));
}

function updateHomeAvatar() {
  const home = $('#homeAvatar');
  $('.avatar-art', home)?.remove();
  home.prepend(avatarArt(myAvatar, { title: 'Seu avatar' }));
}
updateHomeAvatar();

// Abas do editor: cada uma mexe em um estilo (miniaturas) e/ou em uma cor (bolinhas).
// `view` recorta a miniatura para dar destaque à parte que está sendo escolhida.
const AVATAR_TABS = [
  { label: 'Fundo', icon: 'image', colors: { key: 'bg', list: BACKGROUNDS } },
  { label: 'Pele', icon: 'droplet', colors: { key: 'skin', list: SKINS } },
  { label: 'Roupa', icon: 'shirt', styles: { key: 'outfit', list: OUTFITS, view: '4 36 92 64' }, colors: { key: 'outfitColor', list: OUTFIT_COLORS } },
  { label: 'Cabelo', icon: 'scissors', styles: { key: 'hair', list: HAIRS, view: '12 2 76 76' }, colors: { key: 'hairColor', list: HAIR_COLORS } },
  { label: 'Rosto', icon: 'smile', styles: { key: 'face', list: FACES, view: '27 28 46 46' } },
];

let avatarDraft = null;
let avatarTab = 0;

// As abas são criadas uma vez só; escolher uma opção atualiza o estado no lugar, sem recriar os
// botões, para o foco do teclado continuar onde está.
const avatarTabs = AVATAR_TABS.map((t, i) => {
  const b = el('button', 'avatar-tab');
  b.type = 'button';
  b.id = `avatarTab${i}`;
  b.setAttribute('role', 'tab');
  b.setAttribute('aria-controls', 'avatarOptions');
  b.append(icon(t.icon), el('span', null, t.label));
  b.addEventListener('click', () => selectAvatarTab(i));
  return b;
});
$('#avatarTabs').replaceChildren(...avatarTabs);

// Setas trocam de aba (tabindex móvel): Tab sai da lista e vai direto para as opções.
$('#avatarTabs').addEventListener('keydown', (e) => {
  const n = AVATAR_TABS.length;
  const next = {
    ArrowRight: avatarTab + 1,
    ArrowLeft: avatarTab - 1,
    Home: 0,
    End: n - 1,
  }[e.key];
  if (next == null) return;
  e.preventDefault();
  selectAvatarTab((next + n) % n);
  avatarTabs[avatarTab].focus();
});

function selectAvatarTab(i) {
  avatarTab = i;
  renderAvatarOptions();
  $('#avatarOptions').scrollTop = 0;
}

function syncAvatarTabs() {
  avatarTabs.forEach((b, i) => {
    b.setAttribute('aria-selected', String(i === avatarTab));
    b.tabIndex = i === avatarTab ? 0 : -1;
  });
  $('#avatarOptions').setAttribute('aria-labelledby', avatarTabs[avatarTab].id);
}

function renderAvatarPreview() {
  $('#avatarPreview').replaceChildren(avatarArt(avatarDraft, { title: 'Prévia do avatar' }));
}

// Atualiza seleção e miniaturas sem tirar os botões do lugar.
function syncAvatarOptions() {
  const box = $('#avatarOptions');
  for (const b of $$('[data-key]', box)) {
    b.setAttribute('aria-pressed', String(avatarDraft[b.dataset.key] === Number(b.dataset.value)));
  }
  const view = AVATAR_TABS[avatarTab].styles?.view;
  for (const b of $$('.style-opt', box)) {
    b.replaceChildren(avatarArt({ ...avatarDraft, [b.dataset.key]: Number(b.dataset.value) }, { view, title: b.title }));
  }
}

function setAvatarPart(key, value) {
  avatarDraft = { ...avatarDraft, [key]: value };
  renderAvatarPreview();
  syncAvatarOptions();
}

function optionButton(className, key, value, name) {
  const b = el('button', className);
  b.type = 'button';
  b.title = name;
  b.dataset.key = key;
  b.dataset.value = String(value);
  b.setAttribute('aria-label', name);
  b.addEventListener('click', () => setAvatarPart(key, value));
  return b;
}

function renderAvatarOptions() {
  syncAvatarTabs();
  const tab = AVATAR_TABS[avatarTab];
  const box = $('#avatarOptions');
  box.replaceChildren();

  // A cor vem primeiro (é uma fileira curta), assim ela aparece sem precisar rolar.
  if (tab.colors) {
    const { key, list } = tab.colors;
    if (tab.styles) box.append(el('h3', 'opt-label', 'Cor'));
    const row = el('div', `swatches${tab.styles ? '' : ' big'}`);
    list.forEach(({ name, hex }, i) => {
      const b = optionButton('swatch', key, i, name);
      b.style.setProperty('--c', hex);
      row.append(b);
    });
    box.append(row);
  }

  if (tab.styles) {
    const { key, list } = tab.styles;
    if (tab.colors) box.append(el('h3', 'opt-label', 'Estilo'));
    const grid = el('div', 'style-grid');
    list.forEach((name, i) => grid.append(optionButton('style-opt', key, i, name)));
    box.append(grid);
  }
  syncAvatarOptions();
}

function openAvatarEditor() {
  avatarDraft = { ...myAvatar };
  renderAvatarPreview();
  renderAvatarOptions();
  openModal('avatarModal');
  $('#avatarOptions').scrollTop = 0;
}

$('#homeAvatar').addEventListener('click', openAvatarEditor);
$('#avatarRandom').addEventListener('click', () => {
  avatarDraft = randomAvatar();
  renderAvatarPreview();
  syncAvatarOptions();
});
$('#avatarSave').addEventListener('click', () => {
  myAvatar = sanitizeAvatar(avatarDraft) ?? myAvatar;
  store.set('om_avatar', JSON.stringify(myAvatar));
  updateHomeAvatar();
  closeModal('avatarModal');
  flash('Avatar salvo!', { info: true });
});

// Erro do apelido logo abaixo do campo (lido na hora pelo leitor de tela), com o foco nele.
function setNameError(text) {
  const err = $('#nameError');
  err.textContent = text ?? '';
  err.classList.toggle('hidden', !text);
  if (text) nameInput.setAttribute('aria-invalid', 'true');
  else nameInput.removeAttribute('aria-invalid');
  if (text) speak(text, { urgent: true });
}
nameInput.addEventListener('input', () => setNameError(null));

function askName() {
  const name = nameInput.value.trim();
  if (!name) {
    closeModal('roomsModal');
    setNameError('Escolha um apelido primeiro');
    nameInput.focus();
    return null;
  }
  setNameError(null);
  store.set('om_name', name);
  return name;
}

// Aceita o código puro ou o link inteiro da sala (".../?sala=AB12C").
const NOT_CODE_CHAR = /[^A-HJ-NP-Z2-9]/g; // mesmo alfabeto do servidor (sem I, O, 0 e 1)
function extractCode(text = '') {
  const fromLink = /[?&]sala=([a-z0-9]+)/i.exec(text);
  return (fromLink ? fromLink[1] : text).toUpperCase().replace(NOT_CODE_CHAR, '').slice(0, 5);
}

function onJoined(res) {
  if (!res.ok) return false;
  closeModal('roomsModal');
  roomCode = res.code;
  setUrl(res.code);
  return true;
}

async function joinRoom(code) {
  const name = askName();
  if (!name) return;
  code = extractCode(code);
  if (!code) return flash('Digite o código da sala');
  onJoined(await emit('room:join', { code, token, name, avatar: myAvatar }));
}

$('#createBtn').addEventListener('click', async () => {
  const name = askName();
  if (!name) return;
  onJoined(await emit('room:create', { token, name, avatar: myAvatar }));
});

$('#joinBtn').addEventListener('click', () => joinRoom(codeInput.value));
codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && joinRoom(codeInput.value));
// Colar o link inteiro: o maxlength cortaria antes, então o código é extraído aqui.
codeInput.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text');
  if (!text) return;
  e.preventDefault();
  codeInput.value = extractCode(text);
});

async function refreshRooms() {
  if ($('#roomsModal').classList.contains('hidden')) return;
  const res = await emit('room:list');
  const list = $('#roomList');
  list.replaceChildren();
  if (!res.rooms?.length) {
    list.append(el('li', 'empty', 'Nenhuma sala aberta. Crie a sua!'));
    return;
  }
  for (const r of res.rooms) {
    const li = el('li');
    const info = el('div', 'room-info');
    info.append(el('b', null, r.code), el('small', null, `de ${r.host} · ${r.players}/${r.max} jogadores`));
    const tag = el('span', `tag ${r.playing ? 'playing' : ''}`, r.playing ? 'jogando' : 'no lobby');
    const btn = el('button', 'btn btn-small btn-primary', 'Entrar');
    btn.disabled = r.players >= r.max;
    btn.addEventListener('click', () => joinRoom(r.code));
    li.append(info, tag, btn);
    list.append(li);
  }
}

$('#refreshRooms').addEventListener('click', refreshRooms);
setInterval(refreshRooms, 5000);

$('#roomsBtn').addEventListener('click', () => {
  openModal('roomsModal');
  refreshRooms();
});

// Passo a passo do "Como jogar": troca sozinho, pelas bolinhas, pelas setas e deslizando.
// Pausa com o mouse em cima ou com o foco dentro, e não anda sozinho com movimento reduzido.
// A bolinha do passo atual é um relógio (CSS) que se enche no mesmo tempo do passo; pausado,
// o relógio para onde está e, ao continuar, o passo só troca depois do tempo que faltava.
const howtoSlides = $$('#howto .howto-slide');
const howtoSection = $('.howto-section');
const howtoNav = $('.howto-nav');
const HOWTO_MS = 3500;
howtoSection.style.setProperty('--howto-ms', `${HOWTO_MS}ms`);
let howtoIndex = 0;
let howtoTimer;
let howtoHover = false;
let howtoRunning = false; // o relógio do passo atual está andando
let howtoStart = 0; // quando ele voltou a andar
let howtoElapsed = 0; // quanto do passo atual já passou antes da última pausa
// Parado pelo botão de pausa: fica parado até a pessoa mandar continuar (vale entre visitas).
let howtoStopped = store.get('om_howto_paused') === '1';

const howtoPaused = () =>
  howtoStopped ||
  howtoHover ||
  howtoSection.contains(document.activeElement) ||
  matchMedia('(prefers-reduced-motion: reduce)').matches;

function syncHowtoPause() {
  const btn = $('#howtoPause');
  const label = howtoStopped ? 'Continuar passo a passo' : 'Pausar passo a passo';
  btn.replaceChildren(icon(howtoStopped ? 'play' : 'pause'));
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
syncHowtoPause();
$('#howtoPause').addEventListener('click', () => {
  howtoStopped = !howtoStopped;
  store.set('om_howto_paused', howtoStopped ? '1' : '0');
  syncHowtoPause();
  scheduleHowto();
});

function scheduleHowto() {
  if (howtoRunning) {
    howtoElapsed += performance.now() - howtoStart;
    howtoRunning = false;
  }
  clearTimeout(howtoTimer);
  const paused = howtoPaused();
  howtoSection.classList.toggle('paused', paused);
  if (paused) return;
  howtoRunning = true;
  howtoStart = performance.now();
  howtoTimer = setTimeout(() => showHowto(howtoIndex + 1), Math.max(0, HOWTO_MS - howtoElapsed));
}

// Recomeça o relógio do zero (tira e põe a classe que liga a animação).
function restartHowtoClock() {
  howtoNav.classList.remove('run');
  void howtoNav.offsetWidth;
  howtoNav.classList.add('run');
}

function showHowto(i) {
  howtoIndex = (i + howtoSlides.length) % howtoSlides.length;
  howtoSlides.forEach((s, n) => {
    s.classList.toggle('active', n === howtoIndex);
    s.setAttribute('aria-label', `Passo ${n + 1} de ${howtoSlides.length}`);
  });
  $$('#howtoDots button').forEach((d, n) => d.setAttribute('aria-current', n === howtoIndex));
  $('#howtoCount').textContent = `${howtoIndex + 1} / ${howtoSlides.length}`;
  clearTimeout(howtoTimer);
  howtoRunning = false;
  howtoElapsed = 0;
  restartHowtoClock();
  scheduleHowto();
}

howtoSection.addEventListener('mouseenter', () => {
  howtoHover = true;
  scheduleHowto();
});
howtoSection.addEventListener('mouseleave', () => {
  howtoHover = false;
  scheduleHowto();
});
howtoSection.addEventListener('focusin', () => scheduleHowto());
// Espera o foco chegar no próximo elemento antes de ver se ainda está dentro.
howtoSection.addEventListener('focusout', () => setTimeout(scheduleHowto));
$('#howtoPrev').addEventListener('click', () => showHowto(howtoIndex - 1));
$('#howtoNext').addEventListener('click', () => showHowto(howtoIndex + 1));

// Deslizar para os lados no celular troca o passo.
let howtoSwipe = null;
$('#howto').addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') howtoSwipe = { x: e.clientX, y: e.clientY };
});
$('#howto').addEventListener('pointerup', (e) => {
  if (!howtoSwipe) return;
  const dx = e.clientX - howtoSwipe.x;
  const dy = e.clientY - howtoSwipe.y;
  howtoSwipe = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) showHowto(howtoIndex + (dx < 0 ? 1 : -1));
});
$('#howto').addEventListener('pointercancel', () => (howtoSwipe = null));

howtoSlides.forEach((_, n) => {
  const dot = el('button');
  dot.type = 'button';
  dot.title = `Passo ${n + 1}`;
  dot.setAttribute('aria-label', `Passo ${n + 1}`);
  dot.addEventListener('click', () => showHowto(n));
  $('#howtoDots').append(dot);
});
showHowto(0);

function leaveRoom() {
  socket.emit('room:leave');
  roomCode = null;
  state = null;
  setUrl(null);
  closeModal('roundModal');
  show('home');
  refreshRooms();
}

// Sair no meio da partida elimina o jogador: confirma antes, num modal do próprio jogo.
for (const b of $$('.leave-btn')) {
  b.addEventListener('click', () => {
    if (state?.game && state.game.phase !== 'gameOver') openModal('leaveModal');
    else leaveRoom();
  });
}
$('#leaveConfirm').addEventListener('click', () => {
  hideModal('leaveModal');
  leaveRoom();
});

// ---------- lobby ----------

$('#addBotBtn').addEventListener('click', () => emit('room:addBot'));
$('#startBtn').addEventListener('click', () => emit('room:start'));
$('#setPublic').addEventListener('change', (e) => emit('room:settings', { isPublic: e.target.checked }));
$('#setTurn').addEventListener('change', (e) => emit('room:settings', { turnSeconds: Number(e.target.value) }));
// Convite: no celular abre o compartilhamento do sistema; no computador (ou sem ele) copia o link.
const canShare = () => !!navigator.share && matchMedia('(pointer: coarse)').matches;
$('#copyLink').textContent = canShare() ? 'Convidar' : 'Copiar link';

// Cópia de reserva para navegadores sem a API de área de transferência (ou sem permissão).
function copyFallback(text) {
  const area = el('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  area.remove();
  return ok;
}

async function inviteFriends() {
  const link = `${location.origin}${location.pathname}?sala=${roomCode}`;
  if (canShare()) {
    try {
      await navigator.share({ title: '8 Maluco', text: `Bora jogar 8 Maluco! Sala ${roomCode}`, url: link });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // fechou o compartilhamento sem escolher
    }
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(link);
    copied = true;
  } catch {
    copied = copyFallback(link);
  }
  if (copied) flash('Link copiado! Mande para a galera', { info: true });
  else flash(`Não deu para copiar. O código da sala é ${roomCode}`, { info: true });
}
$('#copyLink').addEventListener('click', inviteFriends);

// Remover uma pessoa (não bot) da sala pede confirmação.
let pendingKick = null;
function askKick(member) {
  pendingKick = member.id;
  $('#kickTitle').textContent = `Remover ${member.name}?`;
  $('#kickDesc').textContent = `${member.name} sai da sala e pode voltar pelo link.`;
  openModal('kickModal');
}
$('#kickConfirm').addEventListener('click', () => {
  if (pendingKick) emit('room:kick', { id: pendingKick });
  pendingKick = null;
  hideModal('kickModal');
  // O "×" que abriu o modal some com o jogador: o foco vai para os controles do anfitrião.
  $('#addBotBtn').focus({ preventScroll: true });
});

function renderLobby(s) {
  const isHost = s.hostId === s.me;
  $('#lobbyCode').textContent = s.code;
  $('#lobbyCount').textContent = `${s.members.length} de ${s.maxPlayers} jogadores`;

  // Cada jogador sentado no lugar dele em volta da mesa, você embaixo, como na partida.
  // As cadeiras que sobram viram convite.
  const list = $('#memberList');
  list.replaceChildren();
  const total = s.maxPlayers;
  const myIdx = Math.max(0, s.members.findIndex((m) => m.id === s.me));
  for (let i = 0; i < total; i++) {
    const { x, y } = seatPosition(i, total);
    const li = el('li', 'seat lobby-seat');
    li.style.left = `${x}%`;
    li.style.top = `${y}%`;
    if (i >= s.members.length) {
      // lugar livre
      const btn = el('button', 'seat-invite');
      btn.type = 'button';
      btn.append(icon('plus'));
      btn.title = canShare() ? 'Convidar amigos' : 'Copiar link do convite';
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('click', inviteFriends);
      li.classList.add('empty');
      li.append(btn, el('span', 'seat-name', 'Livre'));
      list.append(li);
      continue;
    }
    // a partir de você, na ordem da sala
    const realM = s.members[(myIdx + i) % s.members.length];
    const av = avatar(realM);
    if (realM.id === s.hostId) av.append(icon('crown', 'crown'));
    const sub = realM.isBot ? 'bot' : !realM.connected ? 'desconectado' : realM.id === s.me ? 'você' : realM.id === s.hostId ? 'anfitrião' : '';
    li.append(av, nameWithBot('seat-name', realM.name, realM.isBot), el('span', 'seat-sub', sub));
    if (isHost && realM.id !== s.me) {
      const kick = el('button', 'kick');
      kick.append(icon('x'));
      kick.type = 'button';
      kick.title = `Remover ${realM.name}`;
      kick.setAttribute('aria-label', `Remover ${realM.name}`);
      // Bot sai na hora; pessoa pede confirmação antes.
      kick.addEventListener('click', () => (realM.isBot ? emit('room:kick', { id: realM.id }) : askKick(realM)));
      li.append(kick);
    }
    list.append(li);
  }
  // Quem ia ser removido já saiu: a confirmação perde o sentido.
  if (pendingKick && !s.members.some((m) => m.id === pendingKick)) {
    pendingKick = null;
    hideModal('kickModal');
  }

  // Configurações: todos veem, só o anfitrião muda.
  $('#hostControls').classList.toggle('hidden', !isHost);
  $('#waitHost').classList.toggle('hidden', isHost);
  $('#setPublic').checked = s.settings.isPublic;
  $('#setTurn').value = String(s.settings.turnSeconds);
  $('#setPublic').disabled = !isHost;
  $('#setTurn').disabled = !isHost;
  $('#settingsNote').classList.toggle('hidden', isHost);
  $('#addBotBtn').disabled = s.members.length >= s.maxPlayers;
  $('#startBtn').disabled = s.members.length < 2;
  $('#startHint').classList.toggle('hidden', s.members.length >= 2);
}

// ---------- mesa ----------

function seatPosition(offset, total) {
  // offset 0 = embaixo (você). Para a direita = anti-horário na tela.
  const angle = ((90 - (offset * 360) / total) * Math.PI) / 180;
  const narrow = innerWidth < 860;
  return { x: 50 + (narrow ? 40 : 44) * Math.cos(angle), y: 50 + (narrow ? 42 : 42) * Math.sin(angle) };
}

// Botão de carteador, como no pôquer: um disco com "D" e o nome por extenso no title.
function dealerBadge() {
  const dealer = el('span', 'badge dealer', 'D');
  dealer.title = 'Deu as cartas';
  dealer.setAttribute('role', 'img');
  dealer.setAttribute('aria-label', 'Deu as cartas');
  return dealer;
}

function renderSeats(g, s, hit) {
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
    seat.style.left = `${x}%`;
    seat.style.top = `${y}%`;
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
    }
    const name = nameWithBot('seat-name', p.name, m?.isBot);
    const info = el('div', 'seat-info');
    if (p.eliminated) info.textContent = 'fora';
    else {
      const cards = el('span');
      cards.append(el('i', 'mini-card'), document.createTextNode(p.cardCount));
      info.append(cards, el('span', null, `${p.score} pts`));
    }
    seat.append(av, name, info);
    seats.append(seat);
  });
}

// Ao jogar 7 ou 9, uma seta sai do monte até quem vai comprar.
const TARGET_ARROW_MS = 1800;
function showEffectTargets(events, s) {
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

  const layer = svg('svg', { class: 'target-arrow', width: innerWidth, height: innerHeight, 'aria-hidden': 'true' });
  layer.append(
    svg('path', { class: 'target-line', d: `M${x1} ${y1} Q${qx} ${qy} ${bx} ${by}`, pathLength: 1 }),
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

function cardRotation(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h % 17) - 8;
}

// Duração do voo de uma carta e intervalo entre cartas compradas em sequência.
const FLIGHT_MS = 950;
const DRAW_GAP_MS = 200;

function centerOf(node, extra = {}) {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, scale: 1, ...extra };
}

// De onde saiu a carta jogada: a carta na sua mão ou o avatar de quem jogou.
function playOrigin(play, s) {
  if (play.playerId === s.me) {
    const dropped = takeDropGhost(play.card.id);
    if (dropped) return { ...dropped, flip: false };
    const card = $(`#hand [data-id="${play.card.id}"]`);
    const node = card ?? $('#meInfo .avatar');
    return node && { ...centerOf(node, { scale: card ? pileScale(card) : 0.5 }), flip: false };
  }
  const seat = $(`#seats .seat[data-id="${play.playerId}"]`);
  if (!seat) return null;
  seat.classList.add('played');
  return { ...centerOf($('.avatar', seat), { scale: 0.45, fade: true }), flip: true };
}

// Uma carta voando de um ponto da tela a outro (centros, com escala e giro). Sem `card`, voa de costas.
// `flip` vira de costas para frente no caminho; `hide` fica escondida até a carta chegar; `onLand` roda na chegada.
const EASE_OUT = 'cubic-bezier(0.25, 0.8, 0.25, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.45, 0, 0.2, 1)';

function fly({ card, from, to, flip = false, hide, delay = 0, easing = EASE_OUT, onLand }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onLand?.();
    return false;
  }
  hide?.classList.add('incoming');
  setTimeout(() => launch({ card, from, to, flip, hide, easing, onLand }), delay);
  return true;
}

function launch({ card, from, to, flip, hide, easing, onLand }) {
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

  const timing = { duration: FLIGHT_MS, fill: 'both' };
  const move = flyer.animate(
    [
      { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.scale}) rotate(${from.rot ?? 0}deg)` },
      { transform: `translate(0, 0) scale(${to.scale}) rotate(${to.rot ?? 0}deg)` },
    ],
    { ...timing, easing }
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
      timing
    );
  }
  // Sobe um pouco no meio do caminho e, se for o caso, vira de costas para frente.
  inner.animate(
    [
      { transform: `rotateY(${flip ? 180 : 0}deg) scale(1)`, easing: 'ease-in-out' },
      { transform: 'rotateY(0deg) scale(1.12)', offset: 0.5, easing: 'ease-in-out' },
      { transform: 'rotateY(0deg) scale(1)' },
    ],
    timing
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
function seatAnchor(playerId) {
  return playerId === state?.me ? $('#meInfo .avatar') : $(`#seats .seat[data-id="${playerId}"]`);
}

// "+N" subindo do assento de quem comprou.
function showGain(playerId, count) {
  const seat = seatAnchor(playerId);
  if (!seat) return;
  const chip = el('div', 'gain', `+${count}`);
  seat.append(chip);
  chip.addEventListener('animationend', () => chip.remove());
}

// Aviso curto em cima do avatar de quem foi afetado (pulado, pinta pedida).
// É só visual: o leitor de tela recebe a frase inteira por speak().
function seatCallout(playerId, parts, kind = '') {
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
function tableCallout(title, sub) {
  const box = $('#toasts');
  box.replaceChildren();
  const plate = el('div', 'table-callout');
  plate.append(el('strong', null, title));
  if (sub) plate.append(el('span', null, sub));
  box.append(plate);
  setTimeout(() => plate.remove(), 2600);
}

// Cartas compradas saem do baralho: de costas até o avatar dos outros, virando de frente até a sua mão.
function animateDraws(events, g, s) {
  const pileCard = $('#drawPile .card');
  if (!pileCard) return;
  const pile = centerOf(pileCard);
  const fresh = $$('#hand .card.fresh');
  let delay = 0;
  const toHand = (node) => {
    const card = g.hand.find((c) => c.id === node.dataset.id);
    if (card && fly({ card, from: pile, to: centerOf(node, { scale: pileScale(node) }), flip: true, hide: node, delay }))
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
      fly({ from: pile, to, delay, easing: EASE_IN_OUT, onLand: last ? () => showGain(e.playerId, e.count) : null });
      delay += DRAW_GAP_MS;
    }
  }
  fresh.forEach(toHand);
}

function renderCenter(prev, g, myTurn, origin) {
  const drawPile = $('#drawPile');
  $('#drawCount').textContent = g.drawCount;
  drawPile.setAttribute('aria-label', `Comprar carta (${g.drawCount} no baralho)`);
  const canDraw = myTurn && !g.hasDrawn;
  drawPile.disabled = !canDraw;
  // Comprar sempre é permitido na sua vez, mas o baralho só chama atenção quando não há jogada.
  drawPile.classList.toggle('can-draw', canDraw && !g.playable.length);

  const discard = $('#discardPile');
  const prevTop = prev?.game?.top?.id;
  if (!g.top) {
    discard.replaceChildren(el('div', 'empty-pile', 'monte vazio'));
    discard.dataset.top = '';
  } else if (discard.dataset.top !== g.top.id) {
    const card = renderCard(g.top);
    card.style.setProperty('--rot', `${cardRotation(g.top.id)}deg`);
    card.style.transform = `rotate(${cardRotation(g.top.id)}deg)`;
    // Mantém as duas cartas de baixo aparecendo, para o monte parecer uma pilha.
    if (prevTop && prev.game.round === g.round) {
      discard.querySelector('.empty-pile')?.remove();
      const under = $$('.card', discard);
      under.slice(0, -2).forEach((c) => c.remove());
      for (const c of under) c.classList.remove('new', 'incoming');
      discard.append(card);
    } else discard.replaceChildren(card);
    discard.dataset.top = g.top.id;
    if (origin) fly({ card: g.top, from: origin, to: centerOf(discard, { rot: cardRotation(g.top.id) }), flip: origin.flip, hide: card });
    else if (prevTop && prevTop !== g.top.id) card.classList.add('new');
  }

  const badge = $('#activeSuit');
  const suit = SUIT_INFO[g.activeSuit];
  badge.replaceChildren();
  if (!suit) {
    const text = g.top
      ? 'Joker: qualquer carta vale'
      : myTurn
        ? 'Abra o monte com qualquer carta'
        : `${nameOf(g.turnId)} vai abrir o monte`;
    badge.append(document.createTextNode(text));
  } else {
    const sym = el('b', suit.color === 'red' ? 'red' : '');
    sym.append(suitIcon(g.activeSuit, 'badge-suit'));
    const label = g.activeRank === '8' ? 'Pediu' : g.activeRank === 'JOKER' ? 'Continua' : 'Pinta';
    badge.append(document.createTextNode(`${label}: `), sym, document.createTextNode(` ${suit.name}`));
  }
  badge.classList.toggle('changed', g.activeRank === '8' || g.activeRank === 'JOKER');
  syncDiscardTarget();
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
function focusedHandCard() {
  const active = document.activeElement;
  return active?.closest?.('#hand .card') ? active : null;
}

// Setas esquerda/direita andam entre as cartas da mão.
function moveHandFocus(from, step) {
  const cards = $$('#hand .card');
  const i = cards.indexOf(from);
  cards[Math.max(0, Math.min(cards.length - 1, i + step))]?.focus();
}

// Escala de uma carta em relação ao monte (o voo usa o tamanho do monte; a mão pode ter cartas maiores).
function pileScale(node) {
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

function renderHand(prev, g, s, myTurn) {
  const hand = $('#hand');
  hand.classList.toggle('my-turn', myTurn);
  const me = g.players.find((p) => p.id === s.me);
  if (!me) {
    hideCardTip();
    hand.replaceChildren(el('p', 'spectator', 'Você está assistindo. Entra na próxima partida!'));
    return;
  }
  if (me.eliminated) {
    hideCardTip();
    hand.replaceChildren(el('p', 'spectator', 'Você está fora. Assista até o fim!'));
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
          tipLongPressed = null;
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
    })
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

// ---------- dica das cartas especiais ----------
// Passar o mouse, dar um toque longo ou focar pelo teclado numa carta com estrela mostra o efeito dela.
const TIP_HOVER_MS = 350;
const TIP_PRESS_MS = 450;
const cardTip = el('div', 'card-tip hidden');
cardTip.setAttribute('aria-hidden', 'true'); // o efeito já vai no aria-label da carta
document.body.append(cardTip);
let tipCardId = null;
let tipTimer;
let tipPress = null; // toque longo em andamento: { id, x, y }
let tipLongPressed = null; // id da carta cujo toque longo abriu a dica (o clique seguinte não seleciona)

function tipText(card) {
  const tip = SPECIAL_TIPS[card.rank];
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

function hideCardTip() {
  clearTimeout(tipTimer);
  tipCardId = null;
  cardTip.classList.add('hidden');
}

// Liga os eventos da dica numa carta da mão (só as especiais têm dica).
function bindCardTip(node, card) {
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
      navigator.vibrate?.(10);
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
function refreshCardTip(hand) {
  if (!tipCardId) return;
  const node = $(`#hand [data-id="${tipCardId}"]`);
  const card = hand.find((c) => c.id === tipCardId);
  if (node && card) showCardTip(node, card);
  else hideCardTip();
}

addEventListener('resize', hideCardTip);
addEventListener('scroll', hideCardTip); // só a página: o chat rola sozinho a cada jogada

// No toque (celular/tablet), a 1ª batida numa carta só seleciona; a 2ª, ou tocar no monte, joga.
// Com mouse, um clique já joga.
let selectedId = null;
const confirmByTap = () => matchMedia('(pointer: coarse)').matches;

function isMyTurn(s) {
  return s?.game?.phase === 'playing' && s.game.turnId === s.me;
}

function setSelected(id) {
  selectedId = id;
  for (const node of $$('#hand .card')) {
    node.classList.toggle('selected', node.dataset.id === id);
    if (confirmByTap() || node.hasAttribute('aria-pressed')) node.setAttribute('aria-pressed', String(node.dataset.id === id));
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

function playCard(card) {
  const g = state.game;
  setSelected(null);
  if (card.rank === '8' && g.hand.length > 1) {
    pendingEight = card.id;
    openSuitModal(g, card);
    return null;
  }
  return emit('game:play', { cardId: card.id });
}

// O monte só vira botão quando há carta selecionada; fora disso fica fora da ordem do Tab.
function syncDiscardTarget() {
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

// ---------- arrastar a carta para o monte ----------
// Mouse, toque e caneta pelos mesmos pointer events. Mexer menos que DRAG_START_PX continua sendo
// clique/toque normal. Soltar perto do monte joga; soltar em outro lugar devolve a carta para a mão.
const DRAG_START_PX = 8;
let drag = null; // arraste em andamento: { id, card, node, x0, y0, rect, ghost, active, over, tilt }
let dropGhost = null; // carta solta no monte esperando a jogada voltar do servidor
let suppressClickUntil = 0;

function onCardPointerDown(e, node, card) {
  if (!e.isPrimary || e.button !== 0 || drag || dropGhost || !isMyTurn(state)) return;
  drag = { id: card.id, card, node, x0: e.clientX, y0: e.clientY, active: false, over: false, tilt: 0 };
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
  tipPress = null;
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
  ghost.animate([{ transform: ghost.style.transform || 'none' }, { transform: `translate(${r.left - rect.left}px, ${r.top - rect.top}px)` }], {
    duration: 220,
    easing: EASE_OUT,
    fill: 'forwards',
  }).onfinish = finish;
}

function cancelDrag() {
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
function takeDropGhost(cardId) {
  if (dropGhost?.id !== cardId) return null;
  const d = dropGhost;
  dropGhost = null;
  clearTimeout(d.timer);
  const r = d.ghost.getBoundingClientRect();
  const from = { x: r.left + r.width / 2, y: r.top + r.height / 2, scale: (d.rect.width * 0.92) / $('#discardPile').offsetWidth, rot: d.tilt };
  d.ghost.remove();
  return from;
}

// A mão foi redesenhada no meio do arraste: segue com a carta nova ou desiste se ela não vale mais.
function syncDragWithHand(myTurn) {
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
  if (selectedId && !e.target.closest('#hand .card, #discardPile')) setSelected(null);
});

$('#drawPile').addEventListener('click', () => {
  setSelected(null);
  emit('game:draw');
});
$('#passBtn').addEventListener('click', () => emit('game:pass'));

// ---------- escolha da pinta com o 8 ----------
// As outras cartas da mão saem da posição de jogo e vão, recolhidas, para baixo da janela de pintas,
// para dar para ver o que você tem antes de escolher. Ao fechar, voltam para a mão.
const SUIT_FLY_MS = 420;
const SUIT_GAP_MS = 28;
let liftedIds = new Set();
let suitAnims = [];

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function layoutSuitHand() {
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
  return { x: a.left + a.width / 2 - (b.left + b.width / 2), y: a.top + a.height / 2 - (b.top + b.height / 2), s: a.width / b.width };
}

function stopSuitAnims() {
  for (const a of suitAnims) a.cancel();
  suitAnims = [];
}

function openSuitModal(g, eight) {
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
          { duration: SUIT_FLY_MS, delay: i * SUIT_GAP_MS, easing: EASE_OUT, fill: 'backwards' }
        )
      );
    });
  }
  for (const node of sources) node?.classList.add('lifted');
}

// Fecha a janela devolvendo as cartas para a mão (ou só some, se não houver animação).
function closeSuitModal({ animate = true } = {}) {
  const modal = $('#suitModal');
  pendingEight = null;
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
    if (!dst) return node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
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

function renderScores(g) {
  $('#limitLabel').textContent = g.rules.eliminationScore;
  for (const n of $$('.js-limit')) n.textContent = g.rules.eliminationScore;
  const list = $('#scoreList');
  list.replaceChildren();
  const limit = g.rules.eliminationScore;
  for (const p of [...g.players].sort((a, b) => a.eliminated - b.eliminated || a.score - b.score)) {
    const li = el('li', p.eliminated ? 'out' : '');
    // Destaca você e quem está jogando agora.
    const isMe = p.id === state?.me;
    const playing = g.phase === 'playing' && p.id === g.turnId && !p.eliminated;
    if (isMe) li.classList.add('me');
    if (playing) li.classList.add('turn');
    const bar = el('div', 'bar');
    const fill = el('i');
    const pct = Math.min(100, (p.score / limit) * 100);
    fill.style.width = `${pct}%`;
    fill.style.setProperty('--full', `${(100 / Math.max(pct, 1)) * 100}%`);
    bar.append(fill);
    const nm = el('span', 'nm', p.name);
    if (isMe) nm.append(el('small', 'you', ' (você)'));
    // Quanto falta para chegar ao limite (e ser eliminado).
    const left = Math.max(0, limit - p.score);
    const rest = el('span', 'left', p.eliminated ? 'fora' : `faltam ${left}`);
    li.append(avatar(memberOf(p.id), p.name), nm, el('b', null, p.score), bar, rest);
    if (playing) li.title = 'Jogando agora';
    list.append(li);
  }
}

function renderMe(g, s, myTurn) {
  const me = g.players.find((p) => p.id === s.me);
  const info = $('#meInfo');
  info.replaceChildren();
  info.classList.toggle('turn', myTurn);
  if (me) {
    const av = avatar(memberOf(me.id), me.name);
    if (myTurn) av.prepend(turnRing());
    info.append(av, el('span', null, `Você · ${me.score} pts`));
    if (me.id === g.dealerId) info.append(dealerBadge());
  }
  else info.append(el('span', null, 'Assistindo'));

  renderBanner(g, myTurn);
  $('#passBtn').classList.toggle('hidden', !(myTurn && g.hasDrawn));
}

function renderBanner(g, myTurn) {
  const banner = $('#turnBanner');
  const text = !myTurn
    ? ''
    : selectedId
      ? 'Toque de novo para jogar'
      : g.hasDrawn
        ? 'Jogue a carta comprada ou passe a vez'
        : g.playable.length
          ? g.top
            ? 'Sua vez! Escolha uma carta'
            : 'Você abre o monte! Jogue qualquer carta'
          : 'Sua vez! Sem jogada, compre do baralho';
  // O banner é anunciado (aria-live): só troca o texto quando ele muda, para não repetir a cada atualização.
  if (banner.textContent !== text) banner.textContent = text;
}

// Números que sobem contando (pontos da rodada e total). Com movimento reduzido, ou se a
// página estiver em segundo plano, o valor final é garantido pelo setTimeout do fim.
function countUp(node, from, to, { delay = 0, duration = 600, prefix = '' } = {}) {
  node.textContent = `${prefix}${from}`;
  if (from === to || reducedMotion()) {
    node.textContent = `${prefix}${to}`;
    return;
  }
  const start = performance.now() + delay;
  const step = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    node.textContent = `${prefix}${Math.round(from + (to - from) * (1 - (1 - t) ** 3))}`;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => (node.textContent = `${prefix}${to}`), delay + duration + 50);
}

// Linha do jogador no resultado: avatar e nome, a mão que sobrou, os pontos e a barra até o limite.
// Os tempos de cada pedaço vêm de --i (ordem da linha) e --c (ordem da carta), no CSS.
let shownRound = null; // rodada cujo resultado já foi animado (só anima uma vez)
function resultRow(r, i, lr, g, s, limit) {
  const out = r.earlier || lr.eliminated.includes(r.playerId);
  const winner = r.playerId === lr.winnerId;
  const li = el('li', `res-row${winner ? ' winner' : ''}${out ? ' out' : ''}${r.playerId === s.me ? ' me' : ''}`);
  li.dataset.id = r.playerId;
  li.style.setProperty('--i', i);

  const who = el('div', 'res-who');
  const name = el('div', 'res-name');
  name.append(el('span', null, r.playerId === s.me ? 'Você' : nameOf(r.playerId)), el('span', 'res-tag'));
  who.append(avatar(memberOf(r.playerId), nameOf(r.playerId)), name);

  const hand = el('div', 'res-hand mini-hand');
  const cards = sortHand(r.hand);
  if (cards.length)
    cards.forEach((c, n) => {
      const card = renderCard(c);
      card.style.setProperty('--c', n);
      hand.append(card);
    });
  else if (r.earlier) hand.append(el('span', 'res-gone', 'Saiu numa rodada anterior'));
  else hand.append(el('span', 'res-empty', 'Sem cartas'));

  // os pontos entram depois que as cartas viraram
  const flipMs = 260 + i * 220 + cards.length * 70;
  const pts = el('b', 'res-pts');
  // quem saiu numa rodada anterior não fez pontos nesta: só o traço
  if (r.earlier) pts.textContent = '–';
  else countUp(pts, 0, r.points, { delay: flipMs, duration: 450, prefix: '+' });

  const before = r.total - r.points;
  const pct = (v) => `${Math.min(100, (v / limit) * 100)}%`;
  const bar = el('div', 'res-bar');
  const fill = el('i');
  fill.style.setProperty('--from', pct(before));
  fill.style.setProperty('--to', pct(r.total));
  bar.append(fill);
  const total = el('b', 'res-total');
  countUp(total, before, r.total, { delay: flipMs + 250, duration: 700 });
  const score = el('div', 'res-score');
  score.append(bar, total);
  li.style.setProperty('--flip', `${flipMs}ms`);

  li.append(who, hand, pts, score);
  // carimbo embaixo do nome
  if (out) name.append(el('span', 'res-stamp', 'Fora!'));
  if (winner) name.append(el('span', 'res-stamp gold', 'Bateu!'));
  syncReadyTag(li, s);
  return li;
}

// Selo de cada linha: "pronto" entre rodadas; quem bateu ou caiu fora já tem o carimbo.
function syncReadyTag(li, s) {
  const tag = $('.res-tag', li);
  const ready = s.ready.includes(li.dataset.id) && !li.classList.contains('out');
  tag.replaceChildren(...(ready ? [icon('check'), ' pronto'] : []));
  tag.classList.toggle('ready', ready);
}

function renderRoundModal(g, s) {
  const modal = $('#roundModal');
  const lr = g.lastRound;
  if (!lr || (g.phase !== 'roundOver' && g.phase !== 'gameOver')) {
    hideModal(modal);
    return;
  }
  const over = g.phase === 'gameOver';
  const limit = g.rules.eliminationScore;
  const key = `${lr.round}:${g.phase}`;
  const rows = $('#roundRows');

  if (key !== shownRound) {
    // Primeira vez deste resultado: monta tudo e deixa a animação correr.
    shownRound = key;
    const winnerName = (id) => (id === s.me ? 'Você' : nameOf(id));
    $('#roundTitle').replaceChildren(
      ...(over
        ? [icon('trophy', 'trophy'), ` ${winnerName(g.winnerId)} venceu o jogo!`]
        : [`${winnerName(lr.winnerId)} bateu!`]),
    );
    $('#roundSub').textContent = over
      ? `Fim de jogo na rodada ${lr.round}. Os outros chegaram a ${limit} pontos.`
      : `Fim da rodada ${lr.round}. Quem chegar a ${limit} pontos está fora.`;
    modal.classList.toggle('game-over', over);
    rows.replaceChildren();
    rows.classList.remove('settled');
    const results = [...lr.results].sort(
      (a, b) => (b.playerId === lr.winnerId) - (a.playerId === lr.winnerId) || a.points - b.points,
    );
    // No fim de jogo entram também os que caíram fora antes (não jogaram a última rodada).
    if (over) {
      const inRound = new Set(results.map((r) => r.playerId));
      g.players
        .filter((p) => !inRound.has(p.id))
        .sort((a, b) => a.score - b.score)
        .forEach((p) => results.push({ playerId: p.id, points: 0, total: p.score, hand: [], earlier: true }));
    }
    results.forEach((r, i) => rows.append(resultRow(r, i, lr, g, s, limit)));
  } else {
    // O mesmo resultado de novo (alguém clicou em "pronto"): só atualiza os selos, sem repetir a animação.
    for (const li of $$('.res-row', rows)) syncReadyTag(li, s);
  }

  $('#gameOverActions').classList.toggle('hidden', !over);
  $('#againBtn').classList.toggle('hidden', s.hostId !== s.me);
  $('#againWait').classList.toggle('hidden', s.hostId === s.me);
  if (over) $('#roundFooter').textContent = '';

  // Entre rodadas: a próxima só começa quando todo mundo que ainda está na mesa clicar em "pronto".
  const playing = g.players.some((p) => p.id === s.me && !p.eliminated);
  const imReady = s.ready.includes(s.me);
  $('#readyActions').classList.toggle('hidden', over || !playing);
  $('#readyBtn').disabled = imReady;
  $('#readyBtn').replaceChildren(...(imReady ? [icon('check'), 'Pronto!'] : ['Estou pronto!']));
  if (!over) {
    const waiting = s.waitingOn.filter((id) => id !== s.me).map(nameOf);
    $('#roundFooter').textContent = !waiting.length
      ? imReady || !playing ? 'Começando a próxima rodada…' : 'Só falta você!'
      : `Esperando ${waiting.join(', ')} ficar${waiting.length > 1 ? 'em' : ''} pronto${waiting.length > 1 ? 's' : ''}…`;
  }
  // Abre só depois de montar, para o foco cair no botão certo (pronto / voltar para a sala).
  openModal('roundModal');
}

$('#againBtn').addEventListener('click', () => emit('room:lobby'));
$('#readyBtn').addEventListener('click', () => emit('game:ready'));

// Cada coisa que aconteceu aparece onde aconteceu: no assento de quem foi afetado
// ou, se for grande, num letreiro no centro da mesa. Tudo também vai para o log.
function announce(events, g, s) {
  const jokerPlayed = events.some((e) => e.type === 'play' && e.card.rank === 'JOKER');
  for (const e of events) {
    const who = e.playerId === s.me ? 'Você' : nameOf(e.playerId);
    switch (e.type) {
      case 'roundStart':
        tableCallout(`Rodada ${e.round}`, e.starterId === s.me ? 'Você abre o monte' : `${nameOf(e.starterId)} abre o monte`);
        logLine(`— Rodada ${e.round}: ${nameOf(e.dealerId)} deu as cartas —`);
        break;
      case 'play':
        sounds.card();
        if (e.card.rank === 'JOKER') tableCallout('Joker!', 'Todo mundo compra 1');
        logPlay(who, `jogou ${e.card.rank === 'JOKER' ? 'o Joker' : cardName(e.card)}`);
        break;
      case 'draw':
        logPlay(who, `comprou ${cardsLabel(e.count)}`);
        break;
      case 'skip':
        seatCallout(e.playerId, ['Pulou!'], 'skip');
        speak(who === 'Você' ? 'Você foi pulado' : `${who} foi pulado`);
        logLine(`${who} foi pulado`);
        break;
      case 'penalty': {
        const qty = cardsLabel(e.count);
        // o "+N" no assento mostra a compra (o seu sai aqui; o dos outros, quando as cartas chegam)
        if (e.playerId === s.me && e.count) showGain(s.me, e.count);
        if (!(jokerPlayed && e.reason === 'JOKER')) speak(`${who} compra ${qty}`);
        if (e.count) logPlay(who, `comprou ${qty}`);
        if (e.playerId === s.me) sounds.bad();
        break;
      }
      case 'suit': {
        const suit = SUIT_INFO[e.suit];
        seatCallout(e.playerId, [suitIcon(e.suit, `callout-suit ${suit.color}`), suit.name], 'suit');
        speak(`${who} pediu ${suit.name}`);
        logLine(`${who} pediu ${suit.name}`);
        break;
      }
      case 'pass':
        logLine(`${who} passou a vez`);
        break;
      case 'gameOver':
        sounds.win();
        break;
      case 'roundEnd':
        if (e.winnerId === s.me) sounds.win();
        break;
    }
  }
}

function renderGame(prev, s) {
  const g = s.game;
  const myTurn = g.phase === 'playing' && g.turnId === s.me;
  const hit = new Set(s.events.filter((e) => e.type === 'penalty').map((e) => e.playerId));
  $('#roundLabel').textContent = `Rodada ${g.round}`;
  renderSeats(g, s, hit);
  const play = prev?.game && s.events.find((e) => e.type === 'play' && e.card.id === g.top?.id);
  renderCenter(prev, g, myTurn, play ? playOrigin(play, s) : null);
  renderHand(prev, g, s, myTurn);
  if (prev?.game) {
    animateDraws(s.events, g, s);
    showEffectTargets(s.events, s);
  }
  renderMe(g, s, myTurn);
  renderScores(g);
  renderRoundModal(g, s);
  if (s.events.length) announce(s.events, g, s);
  const wasMyTurn = prev?.game?.phase === 'playing' && prev.game.turnId === s.me;
  if (myTurn && !wasMyTurn) {
    sounds.turn();
    navigator.vibrate?.(60);
  }
  if (!myTurn) closeSuitModal({ animate: false });
}

function render(prev, s) {
  if (!s.game) {
    hideModal($('#roundModal'));
    show('lobby');
    renderLobby(s);
  } else {
    const entering = $('#game').classList.contains('hidden');
    hideModal('kickModal');
    show('game');
    if (entering) $('#discardPile').dataset.top = '';
    renderGame(prev, s);
  }
}

// Relógio da vez: barra, segundos que faltam, aviso nos últimos segundos e título da aba.
const BASE_TITLE = document.title;
const TICK_FROM_S = 5;
let lastTick = null;

function setTitle(myTurn) {
  // Com a aba em segundo plano, o título avisa que é a sua vez.
  const title = myTurn && document.hidden ? `Sua vez! · ${BASE_TITLE}` : BASE_TITLE;
  if (document.title !== title) document.title = title;
}

// Quanto ainda resta da vez atual, de 1 (cheio) a 0 (acabou).
function turnProgress() {
  if (!state?.deadline || !state.settings) return 1;
  const left = Math.max(0, state.deadline - (Date.now() + clockOffset));
  // turnMs é o prazo desta vez: o tempo por vez para humanos, alguns segundos para bots
  const total = state.turnMs || state.settings.turnSeconds * 1000;
  return Math.min(1, left / total);
}

// Anel de tempo em volta do avatar de quem joga. Já nasce com o tempo certo,
// para não "encher" de novo cada vez que a mesa é redesenhada.
function turnRing() {
  const ring = el('span', 'ring');
  ring.style.setProperty('--p', turnProgress());
  return ring;
}

function updateClock() {
  const g = state?.game;
  const myTurn = !!g && g.phase === 'playing' && g.turnId === state.me;
  setTitle(myTurn);
  if (!g) return;
  const now = Date.now() + clockOffset;
  const bar = $('#meTimer');
  const secs = $('#meTimerSecs');
  const left = state.deadline ? Math.max(0, state.deadline - now) : null;
  const p = turnProgress();
  const on = myTurn && left != null;
  const s = on ? Math.ceil(left / 1000) : null;
  bar.classList.toggle('on', on);
  bar.classList.toggle('low', p < 0.2);
  $('i', bar).style.transform = `scaleX(${p})`;
  const total = state.settings.turnSeconds;
  const secsLeft = left == null ? total : Math.ceil(left / 1000);
  if (bar.getAttribute('aria-valuenow') !== String(secsLeft)) {
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(secsLeft));
    bar.setAttribute('aria-valuetext', `${secsLeft} segundos restantes`);
  }
  secs.classList.toggle('on', on);
  secs.classList.toggle('low', on && s <= TICK_FROM_S);
  secs.textContent = on ? `${s}s` : '';
  $('#seats .seat.turn .ring')?.style.setProperty('--p', p);
  const myRing = $('#meInfo .ring');
  myRing?.style.setProperty('--p', p);
  myRing?.classList.toggle('low', on && s <= TICK_FROM_S);

  // Últimos segundos: um tique (e uma vibração) por segundo.
  if (on && s > 0 && s <= TICK_FROM_S) {
    if (s !== lastTick) {
      lastTick = s;
      sounds.tick();
      navigator.vibrate?.(30);
      if (s === TICK_FROM_S) speak(`Faltam ${TICK_FROM_S} segundos`);
    }
  } else lastTick = null;
}

setInterval(updateClock, 200);
document.addEventListener('visibilitychange', () => setTitle(isMyTurn(state)));

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
  muted = !muted;
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

// ---------- conexão ----------

socket.on('state', (s) => {
  clockOffset = s.serverNow - Date.now();
  const prev = state;
  state = s;
  render(prev, s);
});

socket.on('chat', addChat);
socket.on('chat:history', (msgs) => {
  for (const log of $$('.chat-log')) log.replaceChildren();
  msgs.forEach(addChat);
});

socket.on('room:kicked', () => {
  roomCode = null;
  state = null;
  setUrl(null);
  show('home');
  flash('Você foi removido da sala');
});

socket.on('connect', async () => {
  $('#netStatus').classList.add('hidden');
  if (roomCode) {
    const res = await emit('room:join', { code: roomCode, token, name: store.get('om_name') ?? 'Jogador', avatar: myAvatar });
    if (!res.ok) leaveRoom();
  } else {
    refreshRooms();
  }
});

socket.on('disconnect', () => $('#netStatus').classList.remove('hidden'));

// Entrou por um link de convite (?sala=CODIGO).
const invite = new URLSearchParams(location.search).get('sala');
if (invite) {
  codeInput.value = extractCode(invite);
  if (nameInput.value.trim()) joinRoom(invite);
  else {
    nameInput.focus();
    flash('Escolha um apelido e clique em Entrar', { info: true });
  }
}
