import { SUIT_INFO } from '/shared/engine.js';

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

// ---------- utilidades ----------

function show(id) {
  for (const s of ['home', 'lobby', 'game']) $(`#${s}`).classList.toggle('hidden', s !== id);
}

function flash(text) {
  const el = document.createElement('div');
  el.className = 'flash';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 3100);
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

function avatar(member, name) {
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

// ---------- cartas ----------

// Naipes desenhados num quadrado 100×100, usados por <use> nas cartas (não dependem da fonte nem viram emoji).
document.body.insertAdjacentHTML(
  'afterbegin',
  `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <symbol id="suit-H" viewBox="0 0 100 100"><path fill="currentColor" d="M50 94C22 68 3 52 3 30 3 14 15 4 29 4c10 0 17 6 21 15 4-9 11-15 21-15 14 0 26 10 26 26 0 22-19 38-47 64z"/></symbol>
    <symbol id="suit-D" viewBox="0 0 100 100"><path fill="currentColor" d="M50 1 86 50 50 99 14 50z"/></symbol>
    <symbol id="suit-S" viewBox="0 0 100 100"><path fill="currentColor" d="M50 2C40 24 5 40 5 63c0 13 10 22 22 22 9 0 16-4 20-11-1 11-5 18-14 24h34c-9-6-13-13-14-24 4 7 11 11 20 11 12 0 22-9 22-22C95 40 60 24 50 2z"/></symbol>
    <symbol id="suit-C" viewBox="0 0 100 100"><g fill="currentColor"><circle cx="50" cy="27" r="21"/><circle cx="26" cy="60" r="21"/><circle cx="74" cy="60" r="21"/><path d="M42 40h16v20H42z"/><path d="M47 62c-1 15-5 26-15 36h36c-10-10-14-21-15-36z"/></g></symbol>
    <symbol id="jester" viewBox="0 0 100 100"><g stroke="#1d1d28" stroke-width="2.5" stroke-linejoin="round">
      <path fill="#d0102a" d="M24 72C18 54 10 42 6 30c14 2 26 14 30 30z"/><path fill="#d0102a" d="M76 72c6-18 14-30 18-42-14 2-26 14-30 30z"/>
      <path fill="#2aa7d8" d="M28 72C30 44 40 22 50 8c10 14 20 36 22 64z"/>
      <rect fill="#f5c43a" x="20" y="70" width="60" height="14" rx="4"/>
      <path fill="#d0102a" d="M34 77l4-4 4 4-4 4zM46 77l4-4 4 4-4 4zM58 77l4-4 4 4-4 4z"/>
      <circle fill="#f5c43a" cx="6" cy="30" r="5"/><circle fill="#f5c43a" cx="50" cy="8" r="5"/><circle fill="#f5c43a" cx="94" cy="30" r="5"/>
    </g></symbol>
  </defs></svg>`,
);

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function suitIcon(suit, className) {
  const icon = svg('svg', { class: className, viewBox: '0 0 100 100' });
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

function renderCard(card) {
  const node = el('div', 'card');
  node.dataset.id = card.id;
  if (card.rank === 'JOKER') {
    node.classList.add('joker', 'special');
    const hat = svg('svg', { class: 'pips', viewBox: '0 0 100 100' });
    hat.append(svg('use', { href: '#jester' }));
    node.append(el('span', 'label', 'JOKER'), hat, el('span', 'label bottom', 'JOKER'));
    return node;
  }
  const suit = SUIT_INFO[card.suit];
  if (suit.color === 'red') node.classList.add('red');
  if (['A', '7', '8', '9'].includes(card.rank)) node.classList.add('special');
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
  turn: () => beep([660, 880], 0.12),
  bad: () => beep([220, 160], 0.12, 'sawtooth', 0.03),
  win: () => beep([523, 659, 784, 1046], 0.14),
};

// ---------- chat ----------

const chatTemplate = $('#chatTemplate');
for (const panel of $$('[data-chat]')) {
  panel.append(chatTemplate.content.cloneNode(true));
  const form = $('form', panel);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input', form);
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat', { text });
    input.value = '';
  });
}

// Chat da mesa recolhível, para dar mais espaço e foco ao jogo.
const gameChat = $('.side .chat-panel');
const chatToggle = $('.chat-toggle', gameChat);
function setChatCollapsed(collapsed) {
  gameChat.classList.toggle('collapsed', collapsed);
  chatToggle.setAttribute('aria-expanded', String(!collapsed));
  chatToggle.title = collapsed ? 'Abrir chat' : 'Recolher chat';
  store.set('om_chat_collapsed', collapsed ? '1' : '0');
  if (!collapsed) {
    $('.chat-unread', gameChat).classList.add('hidden');
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
    const li = el('li', msg.system ? 'system' : msg.log ? 'log' : '');
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
    $('#unread').classList.remove('hidden');
  }
  if (!msg.log && gameChat.classList.contains('collapsed')) {
    $('.chat-unread', gameChat).classList.remove('hidden');
  }
}

function logLine(text) {
  addChat({ log: true, text });
}

// ---------- tela inicial ----------

const nameInput = $('#nameInput');
const codeInput = $('#codeInput');
nameInput.value = store.get('om_name') ?? '';

// Por enquanto o avatar da tela inicial mostra só a inicial do apelido.
function updateHomeAvatar() {
  $('#homeAvatar').textContent = nameInput.value.trim().charAt(0).toUpperCase() || '?';
}
nameInput.addEventListener('input', updateHomeAvatar);
updateHomeAvatar();

function askName() {
  const name = nameInput.value.trim();
  if (!name) {
    flash('Escolha um apelido primeiro 🙂');
    nameInput.focus();
    return null;
  }
  store.set('om_name', name);
  return name;
}

function onJoined(res) {
  if (!res.ok) return false;
  roomCode = res.code;
  setUrl(res.code);
  return true;
}

async function joinRoom(code) {
  const name = askName();
  if (!name) return;
  code = code.trim().toUpperCase();
  if (!code) return flash('Digite o código da sala');
  onJoined(await emit('room:join', { code, token, name }));
}

$('#createBtn').addEventListener('click', async () => {
  const name = askName();
  if (!name) return;
  onJoined(await emit('room:create', { token, name, isPublic: $('#createPublic').checked }));
});

$('#joinBtn').addEventListener('click', () => joinRoom(codeInput.value));
codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && joinRoom(codeInput.value));

async function refreshRooms() {
  if ($('#home').classList.contains('hidden')) return;
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

function leaveRoom() {
  socket.emit('room:leave');
  roomCode = null;
  state = null;
  setUrl(null);
  $('#roundModal').classList.add('hidden');
  show('home');
  refreshRooms();
}

for (const b of $$('.leave-btn')) {
  b.addEventListener('click', () => {
    if (state?.game && state.game.phase !== 'gameOver' && !confirm('Sair da partida? Você será eliminado.')) return;
    leaveRoom();
  });
}

// ---------- lobby ----------

$('#addBotBtn').addEventListener('click', () => emit('room:addBot'));
$('#startBtn').addEventListener('click', () => emit('room:start'));
$('#setPublic').addEventListener('change', (e) => emit('room:settings', { isPublic: e.target.checked }));
$('#setTurn').addEventListener('change', (e) => emit('room:settings', { turnSeconds: Number(e.target.value) }));
$('#copyLink').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?sala=${roomCode}`;
  try {
    await navigator.clipboard.writeText(link);
    flash('Link copiado! Mande para a galera 🎉');
  } catch {
    prompt('Copie o link da sala:', link);
  }
});

function renderLobby(s) {
  const isHost = s.hostId === s.me;
  $('#lobbyCode').textContent = s.code;
  $('#lobbyCount').textContent = `Jogadores (${s.members.length}/${s.maxPlayers})`;

  const list = $('#memberList');
  list.replaceChildren();
  for (const m of s.members) {
    const li = el('li');
    const av = avatar(m);
    if (m.id === s.hostId) av.append(el('span', 'crown', '👑'));
    const text = el('div');
    text.style.minWidth = '0';
    const sub = m.isBot ? 'bot' : !m.connected ? 'desconectado' : m.id === s.me ? 'você' : m.id === s.hostId ? 'anfitrião' : '';
    text.append(el('div', 'name', `${m.isBot ? '🤖 ' : ''}${m.name}`), el('div', 'sub', sub));
    li.append(av, text);
    if (isHost && m.id !== s.me) {
      const kick = el('button', 'kick', '×');
      kick.title = 'Remover';
      kick.addEventListener('click', () => emit('room:kick', { id: m.id }));
      li.append(kick);
    }
    list.append(li);
  }
  for (let i = s.members.length; i < s.maxPlayers; i++) list.append(el('li', 'empty', 'lugar vazio'));

  $('#hostControls').classList.toggle('hidden', !isHost);
  $('#waitHost').classList.toggle('hidden', isHost);
  $('#setPublic').checked = s.settings.isPublic;
  $('#setTurn').value = String(s.settings.turnSeconds);
  $('#addBotBtn').disabled = s.members.length >= s.maxPlayers;
  $('#startBtn').disabled = s.members.length < 2;
  $('#startBtn').textContent = s.members.length < 2 ? 'Precisa de 2 jogadores' : 'Começar partida';
}

// ---------- mesa ----------

function seatPosition(offset, total) {
  // offset 0 = embaixo (você). Para a direita = anti-horário na tela.
  const angle = ((90 - (offset * 360) / total) * Math.PI) / 180;
  const narrow = innerWidth < 860;
  return { x: 50 + (narrow ? 40 : 44) * Math.cos(angle), y: 50 + (narrow ? 42 : 42) * Math.sin(angle) };
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
    if (p.eliminated) seat.classList.add('out');
    if (hit.has(p.id)) seat.classList.add('hit');

    const av = avatar(m, p.name);
    if (p.id === g.turnId) av.prepend(el('span', 'ring'));
    if (p.id === g.dealerId) av.append(el('span', 'badge dealer', 'D'));
    if (m && !m.isBot && !m.connected) av.append(el('span', 'badge', '📴'));
    const name = el('div', 'seat-name', `${m?.isBot ? '🤖 ' : ''}${p.name}`);
    const info = el('div', 'seat-info');
    if (p.eliminated) info.textContent = 'fora 💀';
    else {
      const cards = el('span');
      cards.append(el('i', 'mini-card'), document.createTextNode(p.cardCount));
      info.append(cards, el('span', null, `${p.score} pts`));
    }
    seat.append(av, name, info);
    seats.append(seat);
  });
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
    const card = $(`#hand [data-id="${play.card.id}"]`);
    const node = card ?? $('#meInfo .avatar');
    return node && { ...centerOf(node, { scale: card ? 1 : 0.5 }), flip: false };
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

// "+N" subindo do assento de quem comprou.
function showGain(playerId, count) {
  const seat = $(`#seats .seat[data-id="${playerId}"]`);
  if (!seat) return;
  const chip = el('div', 'gain', `+${count}`);
  seat.append(chip);
  chip.addEventListener('animationend', () => chip.remove());
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
    if (card && fly({ card, from: pile, to: centerOf(node), flip: true, hide: node, delay })) node.classList.remove('fresh');
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
  const canDraw = myTurn && !g.hasDrawn;
  drawPile.disabled = !canDraw;
  drawPile.classList.toggle('can-draw', canDraw);

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
    badge.append(document.createTextNode(g.top ? 'Joker: qualquer carta vale' : 'Abra o monte com qualquer carta'));
  } else {
    const sym = el('b', suit.color === 'red' ? 'red' : '', suit.symbol);
    const label = g.activeRank === '8' ? 'Pediu' : g.activeRank === 'JOKER' ? 'Continua' : 'Pinta';
    badge.append(document.createTextNode(`${label}: `), sym, document.createTextNode(` ${suit.name}`));
  }
  badge.classList.toggle('changed', g.activeRank === '8' || g.activeRank === 'JOKER');
}

function layoutHand() {
  const hand = $('#hand');
  const cards = hand.children.length;
  if (cards < 2 || !hand.firstElementChild?.classList.contains('card')) return;
  const cardW = hand.firstElementChild.offsetWidth;
  const avail = hand.clientWidth - 16;
  const overlap = Math.min(6, (avail - cards * cardW) / (cards - 1));
  hand.style.setProperty('--overlap', `${Math.max(overlap, -cardW * 0.72)}px`);
}
addEventListener('resize', () => {
  layoutHand();
  if (state?.game) renderSeats(state.game, state, new Set());
});

function renderHand(prev, g, s, myTurn) {
  const hand = $('#hand');
  hand.classList.toggle('my-turn', myTurn);
  const me = g.players.find((p) => p.id === s.me);
  if (!me) {
    hand.replaceChildren(el('p', 'spectator', '👀 Você está assistindo. Entra na próxima partida!'));
    return;
  }
  if (me.eliminated) {
    hand.replaceChildren(el('p', 'spectator', '💀 Você está fora. Assista até o fim!'));
    return;
  }
  const sameRound = prev?.game?.round === g.round;
  const before = new Set(sameRound ? prev.game.hand.map((c) => c.id) : []);
  const playable = new Set(g.playable);
  hand.replaceChildren(
    ...sortHand(g.hand).map((card) => {
      const node = renderCard(card);
      if (playable.has(card.id)) node.classList.add('playable');
      if (sameRound && !before.has(card.id)) node.classList.add('fresh');
      node.addEventListener('click', () => onCardClick(card));
      return node;
    })
  );
  layoutHand();
}

function onCardClick(card) {
  const g = state?.game;
  if (!g || g.turnId !== state.me || g.phase !== 'playing') return flash('Calma, ainda não é a sua vez');
  if (!g.playable.includes(card.id)) {
    sounds.bad();
    $(`#hand [data-id="${card.id}"]`)?.classList.add('hit');
    return flash('Essa carta não combina com a pinta nem com o número');
  }
  if (card.rank === '8' && g.hand.length > 1) {
    pendingEight = card.id;
    $('#suitModal').classList.remove('hidden');
    return;
  }
  emit('game:play', { cardId: card.id });
}

$('#drawPile').addEventListener('click', () => emit('game:draw'));
$('#passBtn').addEventListener('click', () => emit('game:pass'));

for (const btn of $$('.suit-btn')) {
  btn.addEventListener('click', () => {
    $('#suitModal').classList.add('hidden');
    if (pendingEight) emit('game:play', { cardId: pendingEight, suit: btn.dataset.suit });
    pendingEight = null;
  });
}

function renderScores(g) {
  $('#limitLabel').textContent = g.rules.eliminationScore;
  const list = $('#scoreList');
  list.replaceChildren();
  const limit = g.rules.eliminationScore;
  for (const p of [...g.players].sort((a, b) => a.eliminated - b.eliminated || a.score - b.score)) {
    const li = el('li', p.eliminated ? 'out' : '');
    const bar = el('div', 'bar');
    const fill = el('i');
    const pct = Math.min(100, (p.score / limit) * 100);
    fill.style.width = `${pct}%`;
    fill.style.setProperty('--full', `${(100 / Math.max(pct, 1)) * 100}%`);
    bar.append(fill);
    li.append(avatar(memberOf(p.id), p.name), el('span', 'nm', p.name), el('b', null, p.score), bar);
    list.append(li);
  }
}

function renderMe(g, s, myTurn) {
  const me = g.players.find((p) => p.id === s.me);
  const info = $('#meInfo');
  info.replaceChildren();
  info.classList.toggle('turn', myTurn);
  if (me) info.append(avatar(memberOf(me.id), me.name), el('span', null, `Você · ${me.score} pts`));
  else info.append(el('span', null, 'Assistindo'));

  $('#turnBanner').textContent = myTurn
    ? g.hasDrawn
      ? 'Jogue a carta comprada ou passe a vez'
      : g.playable.length
        ? g.top
          ? 'Sua vez! Escolha uma carta'
          : 'Você abre o monte! Jogue qualquer carta'
        : 'Sua vez! Sem jogada, compre do baralho'
    : '';
  $('#passBtn').classList.toggle('hidden', !(myTurn && g.hasDrawn));
}

function renderRoundModal(g, s) {
  const modal = $('#roundModal');
  const lr = g.lastRound;
  if (!lr || (g.phase !== 'roundOver' && g.phase !== 'gameOver')) {
    modal.classList.add('hidden');
    return;
  }
  modal.classList.remove('hidden');
  const over = g.phase === 'gameOver';
  $('#roundTitle').textContent = over
    ? `🏆 ${nameOf(g.winnerId)} venceu o jogo!`
    : `🎉 ${nameOf(lr.winnerId)} bateu a rodada ${lr.round}!`;

  const rows = $('#roundRows');
  rows.replaceChildren();
  for (const r of [...lr.results].sort((a, b) => a.points - b.points)) {
    const out = lr.eliminated.includes(r.playerId);
    const tr = el('tr', r.playerId === lr.winnerId ? 'winner' : out ? 'eliminated' : '');
    const who = el('td');
    const whoBox = el('div', 'who');
    whoBox.append(avatar(memberOf(r.playerId), nameOf(r.playerId)), el('span', null, nameOf(r.playerId) + (out ? ' 💀' : '')));
    who.append(whoBox);
    const handTd = el('td');
    const mini = el('div', 'mini-hand');
    if (r.hand.length) mini.append(...sortHand(r.hand).map(renderCard));
    else mini.append(el('span', 'muted', 'bateu! 🎉'));
    handTd.append(mini);
    if (s.ready.includes(r.playerId)) whoBox.append(el('span', 'ready-tag', '✓ pronto'));
    tr.append(who, handTd, el('td', 'pts', `+${r.points}`), el('td', 'pts', r.total));
    rows.append(tr);
  }

  $('#gameOverActions').classList.toggle('hidden', !over);
  $('#againBtn').classList.toggle('hidden', s.hostId !== s.me);
  $('#againWait').classList.toggle('hidden', s.hostId === s.me);
  if (over) $('#roundFooter').textContent = 'Fim de jogo! Todos os outros chegaram a 100 pontos.';

  // Entre rodadas: a próxima só começa quando todo mundo que ainda está na mesa clicar em "pronto".
  const playing = g.players.some((p) => p.id === s.me && !p.eliminated);
  const imReady = s.ready.includes(s.me);
  $('#readyActions').classList.toggle('hidden', over || !playing);
  $('#readyBtn').disabled = imReady;
  $('#readyBtn').textContent = imReady ? '✓ Pronto!' : 'Estou pronto!';
  if (!over) {
    const waiting = s.waitingOn.filter((id) => id !== s.me).map(nameOf);
    $('#roundFooter').textContent = !waiting.length
      ? imReady || !playing ? 'Começando a próxima rodada…' : 'Só falta você!'
      : `Esperando ${waiting.join(', ')} ficar${waiting.length > 1 ? 'em' : ''} pronto${waiting.length > 1 ? 's' : ''}…`;
  }
}

$('#againBtn').addEventListener('click', () => emit('room:lobby'));
$('#readyBtn').addEventListener('click', () => emit('game:ready'));

// Mensagens curtas na mesa e no log para cada coisa que aconteceu.
function announce(events, g, s) {
  const toasts = $('#toasts');
  const toast = (text) => {
    const t = el('div', 'toast', text);
    toasts.append(t);
    setTimeout(() => t.remove(), 3100);
    while (toasts.children.length > 3) toasts.firstChild.remove();
  };
  const jokerPlayed = events.some((e) => e.type === 'play' && e.card.rank === 'JOKER');
  for (const e of events) {
    const who = e.playerId === s.me ? 'Você' : nameOf(e.playerId);
    switch (e.type) {
      case 'roundStart':
        toast(`Rodada ${e.round}! ${e.starterId === s.me ? 'Você abre o monte' : `${nameOf(e.starterId)} abre o monte`}`);
        logLine(`— Rodada ${e.round}: ${nameOf(e.dealerId)} deu as cartas —`);
        break;
      case 'play':
        sounds.card();
        if (e.card.rank === 'JOKER') toast('🃏 Joker! Todo mundo compra 1');
        break;
      case 'skip':
        toast(`⏭ ${who === 'Você' ? 'Você foi pulado' : `${who} foi pulado`}!`);
        logLine(`${who} foi pulado`);
        break;
      case 'penalty': {
        const qty = `${e.count} carta${e.count > 1 ? 's' : ''}`;
        if (!(jokerPlayed && e.reason === 'JOKER')) toast(`${e.reason === '7' ? '7️⃣' : '9️⃣'} ${who} compra ${qty}`);
        if (e.playerId === s.me) sounds.bad();
        break;
      }
      case 'suit': {
        const suit = SUIT_INFO[e.suit];
        toast(`🎨 ${who} pediu ${suit.symbol} ${suit.name}`);
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
  if (prev?.game) animateDraws(s.events, g, s);
  renderMe(g, s, myTurn);
  renderScores(g);
  renderRoundModal(g, s);
  if (s.events.length) announce(s.events, g, s);
  const wasMyTurn = prev?.game?.phase === 'playing' && prev.game.turnId === s.me;
  if (myTurn && !wasMyTurn) {
    sounds.turn();
    navigator.vibrate?.(60);
  }
  if (!myTurn) {
    $('#suitModal').classList.add('hidden');
    pendingEight = null;
  }
}

function render(prev, s) {
  if (!s.game) {
    $('#roundModal').classList.add('hidden');
    show('lobby');
    renderLobby(s);
  } else {
    const entering = $('#game').classList.contains('hidden');
    show('game');
    if (entering) $('#discardPile').dataset.top = '';
    renderGame(prev, s);
  }
}

// Relógio da vez.
setInterval(() => {
  const g = state?.game;
  if (!g) return;
  const now = Date.now() + clockOffset;
  const bar = $('#meTimer');
  const myTurn = g.phase === 'playing' && g.turnId === state.me;
  let p = 1;
  if (state.deadline) p = Math.max(0, Math.min(1, (state.deadline - now) / (state.settings.turnSeconds * 1000)));
  bar.classList.toggle('on', myTurn && !!state.deadline);
  bar.classList.toggle('low', p < 0.2);
  $('i', bar).style.transform = `scaleX(${p})`;
  $('#seats .seat.turn .ring')?.style.setProperty('--p', p);
}, 200);

// ---------- painéis e modais ----------

$('#muteBtn').textContent = muted ? '🔇' : '🔊';
$('#muteBtn').addEventListener('click', () => {
  muted = !muted;
  store.set('om_muted', muted ? '1' : '0');
  $('#muteBtn').textContent = muted ? '🔇' : '🔊';
});

$('#sideToggle').addEventListener('click', (e) => {
  e.stopPropagation();
  $('.side').classList.toggle('open');
  $('#unread').classList.add('hidden');
});
document.addEventListener('click', (e) => {
  const side = $('.side');
  if (side.classList.contains('open') && !side.contains(e.target)) side.classList.remove('open');
});

for (const b of [$('#rulesBtn'), ...$$('.rules-link')]) {
  b.addEventListener('click', () => $('#rulesModal').classList.remove('hidden'));
}
for (const b of $$('[data-close]')) {
  b.addEventListener('click', () => {
    b.closest('.modal').classList.add('hidden');
    pendingEight = null;
  });
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
    const res = await emit('room:join', { code: roomCode, token, name: store.get('om_name') ?? 'Jogador' });
    if (!res.ok) leaveRoom();
  } else {
    refreshRooms();
  }
});

socket.on('disconnect', () => $('#netStatus').classList.remove('hidden'));

// Entrou por um link de convite (?sala=CODIGO).
const invite = new URLSearchParams(location.search).get('sala');
if (invite) {
  codeInput.value = invite.toUpperCase();
  if (nameInput.value.trim()) joinRoom(invite);
  else {
    nameInput.focus();
    flash('Escolha um apelido e clique em Entrar');
  }
}
