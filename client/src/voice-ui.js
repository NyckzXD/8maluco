// Tela do chat de voz: os botões do topo (mesa e sala de espera), o menu com quem está no voz
// e os sinais em cima dos avatares. A conexão em si fica em voice.js.
//
// - Fora do voz, o botão do fone entra (o próprio toque libera o microfone e o áudio).
// - Dentro, aparece o botão do microfone (liga e desliga) e o do fone mostra quantos estão no
//   voz e abre o menu: cada pessoa com o estado dela, silenciar alguém só para você e sair.
// - Nos avatares (assentos da mesa, cadeiras da sala de espera, plateia e a sua barra): um
//   selo de fone (no voz), de microfone cortado (desligou o microfone) ou de alto-falante
//   cortado (você silenciou), e um anel verde em quem está falando.
import { icon } from './cards.js';
import { $, $$, avatar, el, speak, state } from './core.js';
import { enableMic, joinVoice, leaveVoice, onVoiceChange, setSilenced, setVoiceMuted, voiceStatus } from './voice.js';

const menu = $('#voiceMenu');
/** @type {HTMLElement | null} */
let menuOpener = null;

// ---------- botões do topo ----------

function syncButtons(v = voiceStatus()) {
  const people = voiceMembers().length;
  for (const b of $$('.voice-btn')) {
    b.classList.toggle('is-on', v.active);
    b.disabled = v.joining;
    b.setAttribute('aria-busy', String(v.joining));
    const label = v.joining
      ? 'Entrando no chat de voz'
      : v.active
        ? `Chat de voz, ${people === 1 ? 'só você' : `${people} pessoas`}`
        : 'Entrar no chat de voz';
    b.title = label;
    b.setAttribute('aria-label', label);
    if (v.active) {
      b.setAttribute('aria-haspopup', 'dialog');
      b.setAttribute('aria-expanded', String(menuOpener === b));
      b.setAttribute('aria-controls', 'voiceMenu');
    } else {
      b.removeAttribute('aria-haspopup');
      b.removeAttribute('aria-expanded');
      b.removeAttribute('aria-controls');
    }
    const count = $('.voice-count', b);
    count.textContent = String(people);
    count.classList.toggle('hidden', !v.active);
  }
  for (const b of $$('.voice-mic')) {
    // só ouvindo, o botão aparece desligado: tocar pede o microfone (enableMic)
    b.classList.toggle('hidden', !v.active);
    b.disabled = v.joining;
    b.classList.toggle('is-off', v.muted);
    b.replaceChildren(icon(v.muted ? 'mic-off' : 'mic'));
    // nome fixo e aria-pressed dizendo se está ligado, como o "Silenciar" dos sons
    b.setAttribute('aria-label', 'Desligar microfone');
    b.setAttribute('aria-pressed', String(v.muted));
    b.title = v.muted ? 'Ligar microfone' : 'Desligar microfone';
  }
}

for (const b of $$('.voice-btn')) {
  b.addEventListener('click', async () => {
    const v = voiceStatus();
    if (v.joining) return;
    if (!v.active) {
      if (await joinVoice()) speak('Você entrou no chat de voz');
      return;
    }
    if (menuOpener === b) closeVoiceMenu();
    else openVoiceMenu(b);
  });
}

for (const b of $$('.voice-mic')) {
  b.addEventListener('click', async () => {
    if (voiceStatus().listenOnly) {
      if (await enableMic()) speak('Microfone ligado');
      return;
    }
    const muted = !voiceStatus().muted;
    setVoiceMuted(muted);
    speak(muted ? 'Microfone desligado' : 'Microfone ligado');
  });
}

// ---------- menu ----------

const voiceMembers = () => state?.members.filter((m) => m.voice) ?? [];

function openVoiceMenu(opener) {
  menuOpener = opener;
  renderMenu({ force: true });
  menu.classList.remove('hidden');
  placeMenu();
  syncButtons();
  menu.querySelector('button')?.focus({ preventScroll: true });
}

// embaixo do botão, alinhado pela direita dele, sem sair da tela (como o menu de reações)
function placeMenu() {
  if (!menuOpener) return;
  const r = menuOpener.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.left = `${Math.min(Math.max(8, r.right - w), innerWidth - w - 8)}px`;
  menu.style.top = `${r.bottom + 8}px`;
}

export function closeVoiceMenu({ focus = false } = {}) {
  if (!menuOpener) return false;
  menu.classList.add('hidden');
  const opener = menuOpener;
  menuOpener = null;
  syncButtons();
  if (focus && opener.isConnected) opener.focus({ preventScroll: true });
  return true;
}

const CONNECTION_NOTE = {
  new: 'conectando…',
  connecting: 'conectando…',
  disconnected: 'reconectando…',
  failed: 'sem conexão',
};

// O que muda a lista do menu (quem está, microfone, silenciado, conexão). Quem está falando
// muda várias vezes por segundo e só troca uma classe: recriar os botões no meio de um toque
// perderia o clique.
let menuKey = '';
const keyOf = (v) =>
  voiceMembers()
    .map((m) => [m.id, m.name, m.voiceMuted, v.silenced.has(m.id), v.peers.get(m.id) ?? ''].join(':'))
    .join('|') + (v.listenOnly ? '|só ouvindo' : '');

function renderMenu({ force = false } = {}) {
  if (!menuOpener) return;
  const v = voiceStatus();
  const key = keyOf(v);
  if (!force && key === menuKey) {
    for (const li of $$('.voice-row', menu)) li.classList.toggle('speaking', v.speaking.has(li.dataset.id));
    return;
  }
  menuKey = key;
  // o foco volta para o mesmo botão depois de redesenhar (alguém falou, entrou, saiu)
  const focused = menu.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused instanceof HTMLElement ? focused.dataset.key : null;

  const head = el('div', 'voice-menu-head');
  head.append(icon('headset'), el('h2', null, 'Chat de voz'));
  const list = el('ul', 'voice-list');
  for (const m of voiceMembers()) {
    const mine = m.id === state.me;
    const li = el('li', 'voice-row');
    li.dataset.id = m.id;
    if (v.speaking.has(m.id)) li.classList.add('speaking');
    const note = mine
      ? v.listenOnly
        ? 'você · só ouvindo'
        : m.voiceMuted
          ? 'você · microfone desligado'
          : 'você'
      : (CONNECTION_NOTE[v.peers.get(m.id)] ??
        (v.silenced.has(m.id) ? 'silenciado por você' : m.voiceMuted ? 'microfone desligado' : ''));
    const text = el('div', 'voice-who');
    text.append(el('b', null, m.name));
    if (note) text.append(el('span', null, note));
    li.append(avatar(m), text);
    if (!mine) {
      const silenced = v.silenced.has(m.id);
      const b = el('button', 'btn btn-small voice-silence');
      b.type = 'button';
      b.dataset.key = `silence-${m.id}`;
      b.append(icon(silenced ? 'mute' : 'volume'));
      b.setAttribute('aria-label', `Silenciar ${m.name}`);
      b.setAttribute('aria-pressed', String(silenced));
      b.title = silenced ? `Ouvir ${m.name} de novo` : `Silenciar ${m.name} só para você`;
      b.addEventListener('click', () => {
        setSilenced(m.id, !silenced);
        speak(silenced ? `Ouvindo ${m.name} de novo` : `${m.name} silenciado para você`);
      });
      li.append(b);
    }
    list.append(li);
  }
  const leave = el('button', 'btn btn-small voice-leave');
  leave.type = 'button';
  leave.dataset.key = 'leave';
  leave.append(icon('x'), 'Sair do voz');
  leave.addEventListener('click', () => {
    closeVoiceMenu({ focus: true });
    leaveVoice();
    speak('Você saiu do chat de voz');
  });
  menu.replaceChildren(head, list, leave);
  if (focusKey) menu.querySelector(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
}

// Clicar fora ou redimensionar a tela fecha o menu.
document.addEventListener('pointerdown', (e) => {
  if (!menuOpener || !(e.target instanceof Element)) return;
  if (!menu.contains(e.target) && !e.target.closest('.voice-btn')) closeVoiceMenu();
});
addEventListener('resize', () => closeVoiceMenu());

// ---------- avatares ----------

const BADGES = {
  on: { icon: 'headset', label: 'No chat de voz' },
  muted: { icon: 'mic-off', label: 'No chat de voz, microfone desligado' },
  silenced: { icon: 'mute', label: 'No chat de voz, silenciado por você' },
};

// Cada avatar de quem está na sala: o assento, a cadeira, a plateia e a sua barra.
function avatarsOf(id) {
  const s = state;
  const spots = [
    $(`#seats .seat[data-id="${id}"] .avatar`),
    $(`#memberList .seat[data-id="${id}"] .avatar`),
    $(`#benchList [data-id="${id}"] .avatar`),
  ];
  spots.push($(`#voiceBench [data-id="${id}"] .avatar`));
  if (s && id === s.me) spots.push($('#meInfo .avatar'));
  return spots.filter(Boolean);
}

/** Põe (ou tira) os sinais do voz nos avatares. Chamado depois de cada redesenho e a cada mudança do voz. */
export function paintVoice() {
  const s = state;
  if (!s) return;
  const v = voiceStatus();
  for (const m of s.members) {
    if (m.isBot) continue;
    const kind = !m.voice ? null : v.silenced.has(m.id) ? 'silenced' : m.voiceMuted ? 'muted' : 'on';
    const talking = !!kind && kind !== 'silenced' && v.speaking.has(m.id);
    for (const av of avatarsOf(m.id)) {
      av.classList.toggle('speaking', talking);
      let badge = /** @type {HTMLElement | null} */ (av.querySelector(':scope > .badge.voice'));
      if (badge && badge.dataset.kind !== kind) {
        badge.remove();
        badge = null;
      }
      if (!kind || badge) continue;
      badge = el('span', `badge voice ${kind}`);
      badge.dataset.kind = kind;
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', BADGES[kind].label);
      badge.title = BADGES[kind].label;
      badge.append(icon(BADGES[kind].icon));
      av.append(badge);
    }
  }
}

// ---------- quem entrou e saiu (leitor de tela) ----------

let lastVoice = new Set();
function announceChanges() {
  const s = state;
  const now = new Set(voiceMembers().map((m) => m.id));
  if (s && voiceStatus().active) {
    for (const id of now)
      if (!lastVoice.has(id) && id !== s.me) speak(`${s.members.find((m) => m.id === id)?.name} entrou no chat de voz`);
    for (const id of lastVoice)
      if (!now.has(id) && id !== s.me) {
        const m = s.members.find((x) => x.id === id);
        if (m) speak(`${m.name} saiu do chat de voz`);
      }
  }
  lastVoice = now;
}

// ---------- plateia na partida ----------
// Na partida, só quem joga (ou já foi eliminado) tem assento. Quem está na plateia e entrou no
// voz aparece numa fileira no canto da mesa, para a mesa saber quem está falando.

let benchKey = '';
function renderBench() {
  const box = $('#voiceBench');
  const g = state?.game;
  const seated = new Set(g?.players.map((p) => p.id) ?? []);
  const people = g ? voiceMembers().filter((m) => !seated.has(m.id)) : [];
  const key = people.map((m) => `${m.id}:${m.name}`).join('|');
  if (key === benchKey) return;
  benchKey = key;
  box.classList.toggle('hidden', !people.length);
  box.replaceChildren(
    ...people.map((m) => {
      const li = el('li', 'voice-bench-chip');
      li.dataset.id = m.id;
      li.title = m.id === state.me ? `${m.name} (você), na plateia` : `${m.name}, na plateia`;
      li.append(avatar(m), el('span', 'sr-only', li.title));
      return li;
    }),
  );
}

// Depois de cada 'state' (render.js chama): botões, menu, selos e avisos.
export function renderVoice() {
  if (!state) closeVoiceMenu();
  syncButtons();
  renderMenu();
  renderBench();
  paintVoice();
  announceChanges();
}

onVoiceChange((v) => {
  if (!v.active) closeVoiceMenu();
  syncButtons(v);
  renderMenu();
  paintVoice();
});
syncButtons();
