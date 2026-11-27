// Sala de espera: convite, bots, configurações, plateia e sair da sala.
import { icon, nameWithBot } from './cards.js';
import { canShare, copyText, publicUrl, shareLink } from './platform.js';
import {
  $,
  $$,
  avatar,
  el,
  emit,
  flash,
  nameOf,
  roomCode,
  setRoomCode,
  setState,
  setUrl,
  socket,
  state,
} from './core.js';
import { refreshRooms } from './home.js';
import { closeModal, hideModal, openModal } from './modals.js';
import { placeSeat, seatPosition, show } from './table.js';
import { leaveVoice } from './voice.js';

export function leaveRoom() {
  socket.emit('room:leave');
  leaveVoice({ tellServer: false }); // sair da sala já tira do voz no servidor
  setRoomCode(null);
  setState(null);
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
// Convite: no celular e no app abre o compartilhamento do sistema; no computador (ou sem ele)
// copia o link.
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
  const link = `${publicUrl()}?sala=${roomCode}`;
  if (canShare()) {
    const shared = await shareLink({ title: '8 Maluco', text: `Bora jogar 8 Maluco! Sala ${roomCode}`, url: link });
    if (shared !== 'failed') return; // compartilhou, ou fechou sem escolher
  }
  const copied = (await copyText(link)) || copyFallback(link);
  if (copied) flash('Link copiado! Mande para a galera', { info: true });
  else
    flash(`Não deu para copiar. O código da sala é ${roomCode}`, {
      info: true,
    });
}
$('#copyLink').addEventListener('click', inviteFriends);

// Remover uma pessoa (não bot) da sala pede confirmação.
let pendingKick = null;
function askKick(member) {
  pendingKick = member.id;
  $('#kickTitle').textContent = `Remover ${member.name}?`;
  $('#kickDesc').textContent = `${member.name} sai da sala e não consegue voltar enquanto ela estiver aberta.`;
  $('#kickAvatar').replaceChildren(avatar(member));
  openModal('kickModal');
}
$('#kickConfirm').addEventListener('click', () => {
  if (pendingKick) emit('room:kick', { id: pendingKick });
  pendingKick = null;
  hideModal('kickModal');
  // O "×" que abriu o modal some com o jogador: o foco vai para os controles do anfitrião.
  $('#addBotBtn').focus({ preventScroll: true });
});

export function renderLobby(s) {
  const isHost = s.hostId === s.me;
  $('#lobbyCode').textContent = s.code;
  // na mesa só cabem maxPlayers; quem chegou depois espera na plateia (s.spectators)
  const bench = new Set(s.spectators ?? []);
  const seated = s.members.filter((m) => !bench.has(m.id));
  $('#lobbyCount').textContent = `${seated.length} de ${s.maxPlayers} jogadores`;
  renderBench(
    s,
    s.members.filter((m) => bench.has(m.id)),
    isHost,
  );

  // Cada jogador sentado no lugar dele em volta da mesa, você embaixo, como na partida.
  // As cadeiras que sobram viram convite.
  const list = $('#memberList');
  list.replaceChildren();
  const total = s.maxPlayers;
  const myIdx = Math.max(
    0,
    seated.findIndex((m) => m.id === s.me),
  );
  for (let i = 0; i < total; i++) {
    const { x, y } = seatPosition(i, total);
    const li = el('li', 'seat lobby-seat');
    placeSeat(li, { x, y });
    if (i >= seated.length) {
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
    const realM = seated[(myIdx + i) % seated.length];
    li.dataset.id = realM.id; // o balão das reações acha a cadeira por aqui
    const av = avatar(realM);
    if (realM.id === s.hostId) av.append(icon('crown', 'crown'));
    const sub = realM.isBot
      ? 'bot'
      : !realM.connected
        ? 'desconectado'
        : realM.away
          ? 'ausente'
          : realM.id === s.me
            ? 'você'
            : realM.id === s.hostId
              ? 'anfitrião'
              : '';
    li.append(av, nameWithBot('seat-name', realM.name, realM.isBot, { top1: realM.top1 }), el('span', 'seat-sub', sub));
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
  $('#waitHostText').textContent = `Esperando ${nameOf(s.hostId)} começar a partida`;
  $('#setPublic').checked = s.settings.isPublic;
  $('#setTurn').value = String(s.settings.turnSeconds);
  $('#setPublic').disabled = !isHost;
  $('#setTurn').disabled = !isHost;
  $('#settingsNote').classList.toggle('hidden', isHost);
  $('#addBotBtn').disabled = s.members.length >= s.maxPlayers;
  $('#startBtn').disabled = s.members.length < 2;
}

// Plateia do lobby: quem entrou com a mesa cheia. Senta quando abrir lugar, pela ordem de chegada.
function renderBench(s, people, isHost) {
  const box = $('#lobbyBench');
  box.classList.toggle('hidden', !people.length);
  const list = $('#benchList');
  list.replaceChildren();
  $('#benchTitle').textContent = `Plateia · ${people.length} de ${s.maxSpectators}`;
  for (const m of people) {
    const li = el('li', 'bench-chip');
    li.dataset.id = m.id; // o balão das reações acha a pessoa por aqui
    li.append(avatar(m), el('span', null, m.id === s.me ? `${m.name} (você)` : m.name));
    if (isHost && m.id !== s.me) {
      const kick = el('button', 'kick');
      kick.append(icon('x'));
      kick.type = 'button';
      kick.title = `Remover ${m.name}`;
      kick.setAttribute('aria-label', `Remover ${m.name}`);
      kick.addEventListener('click', () => askKick(m));
      li.append(kick);
    }
    list.append(li);
  }
}
