// Base do cliente: atalhos do DOM, armazenamento local, conexão com o servidor, estado da sala
// e utilidades usadas por todas as telas.
import { io } from 'socket.io-client';
import { SUIT_INFO } from '../../shared/engine.js';
import { avatarSVG } from '../../shared/avatar.js';
import { SERVER_URL } from './platform.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const store = {
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
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

// Token secreto que identifica este navegador: permite voltar para a sala depois de cair.
export const token =
  store.get('om_token') ?? crypto.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
store.set('om_token', token);

// A sessão da conta (account.js) vai no handshake; função para cada reconexão ler a atual.
// No navegador conecta na própria origem; no app, no SERVER_URL (platform.js).
const socketOptions = { auth: (cb) => cb({ session: store.get('om_session') ?? '' }) };
export const socket = SERVER_URL ? io(SERVER_URL, socketOptions) : io(socketOptions);

export let state = null;
export let roomCode = null;
export let clockOffset = 0;
export let pendingEight = null;
export let muted = store.get('om_muted') === '1';

// Os outros módulos leem essas variáveis direto (o import acompanha o valor), mas só este
// módulo pode trocá-las: quem precisa mudar usa estas funções.
export const setState = (v) => (state = v);
export const setRoomCode = (v) => (roomCode = v);
export const setClockOffset = (v) => (clockOffset = v);
export const setPendingEight = (v) => (pendingEight = v);
export const setMuted = (v) => (muted = v);

export const RANK_NAMES = {
  A: 'Ás',
  J: 'Valete',
  Q: 'Dama',
  K: 'Rei',
  JOKER: 'Joker',
};
export const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
export const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'JOKER'];
// Efeito de cada carta especial (as que têm estrela), mostrado na dica da mão.
export const SPECIAL_TIPS = {
  A: 'pula o próximo jogador',
  7: 'o jogador da esquerda compra 1 carta',
  8: 'entra em qualquer pinta e você escolhe a pinta do próximo',
  9: 'o jogador da direita compra 2 cartas e perde a vez',
  JOKER: 'entra em qualquer carta e todos os outros compram 1',
};

// ---------- utilidades ----------

// Escreve num aviso fixo para leitores de tela. Limpa antes, para repetir a mesma frase também ser lida.
export function speak(text, { urgent = false } = {}) {
  const region = $(urgent ? '#srAlert' : '#srStatus');
  region.textContent = '';
  setTimeout(() => (region.textContent = text), 50);
}

// Aviso rápido no rodapé. Por padrão é um erro (lido na hora); `info` é lido sem interromper.
export function flash(text, { info = false } = {}) {
  const el = document.createElement('div');
  // na partida o aviso vai para o topo, longe da mão
  el.className = `flash ${info ? 'info' : 'error'}${$('#game').classList.contains('hidden') ? '' : ' in-game'}`;
  el.setAttribute('aria-hidden', 'true');
  const mark = document.createElement('span');
  mark.className = 'flash-mark';
  mark.textContent = info ? 'i' : '!';
  el.append(mark, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 3100);
  speak(text, { urgent: !info });
}

export function emit(event, data = {}, { quiet = false } = {}) {
  return new Promise((resolve) => {
    socket.emit(event, data, (res) => {
      if (res && !res.ok && res.error && !quiet) flash(res.error);
      resolve(res ?? { ok: true });
    });
  });
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Desenho do avatar (SVG montado a partir de índices, então pode ir direto no innerHTML).
export function avatarArt(config, opts) {
  const art = el('span', 'avatar-art');
  art.innerHTML = avatarSVG(config, opts);
  return art;
}

// Avatar de um membro da sala; quem não tem avatar (ou já saiu) aparece com a inicial do nome.
export function avatar(member, name) {
  if (member?.avatar) {
    const a = el('div', 'avatar has-art');
    a.append(avatarArt(member.avatar, { title: name ?? member.name }));
    return a;
  }
  const a = el('div', 'avatar', (name ?? member?.name ?? '?').trim().charAt(0).toUpperCase());
  a.style.background = member?.color ?? '#999';
  return a;
}

export function memberOf(id) {
  return state?.members.find((m) => m.id === id);
}

export function nameOf(id) {
  return memberOf(id)?.name ?? state?.game?.players.find((p) => p.id === id)?.name ?? '?';
}

export function cardName(card) {
  if (card.rank === 'JOKER') return 'Joker';
  return `${RANK_NAMES[card.rank] ?? card.rank} de ${SUIT_INFO[card.suit].name}`;
}

export function setUrl(code) {
  history.replaceState(null, '', code ? `?sala=${code}` : location.pathname);
}
