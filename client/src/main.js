// Entrada do cliente: liga os eventos da conexão e entra pela sala do convite, se houver.
//
// Os módulos entram primeiro, na ordem do antigo app.js: cada um liga os eventos da sua parte
// da tela ao carregar. A ordem importa: um módulo que usa outro já no carregamento (não só
// dentro de funções) precisa vir depois dele.
import './core.js';
import './modals.js';
import './reactions.js';
import './cards.js';
import './audio.js';
import './chat.js';
import './account.js';
import './home.js';
import './avatar-editor.js';
import './howto.js';
import './lobby.js';
import './table.js';
import './deal.js';
import './pile.js';
import './hand.js';
import './card-tip.js';
import './drag.js';
import './suit-picker.js';
import './scores.js';
import './results.js';
import './render.js';
import './clock.js';

import { myAvatar } from './avatar-editor.js';
import { addChat } from './chat.js';
import {
  $,
  $$,
  emit,
  flash,
  roomCode,
  setClockOffset,
  setRoomCode,
  setState,
  setUrl,
  socket,
  state,
  store,
  token,
} from './core.js';
import { codeInput, extractCode, joinRoom, nameInput, refreshRooms, showJoinError } from './home.js';
import { leaveRoom } from './lobby.js';
import { closeModal, hideModal, modalStack, openModal } from './modals.js';
import { showChatBubble, showReaction } from './reactions.js';
import { render } from './render.js';
import { show } from './table.js';

// Service worker (public/sw.js): deixa o app instalável e abre a casca do jogo sem internet.
// Registra depois do carregamento para não disputar banda com a primeira tela.
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ---------- conexão ----------

socket.on('state', (s) => {
  setClockOffset(s.serverNow - Date.now());
  const prev = state;
  setState(s);
  render(prev, s);
  const wasAway = !!prev?.members.find((m) => m.id === prev.me)?.away;
  if (amAway() && !wasAway)
    flash('Você ficou ausente e o jogo está jogando por você. Toque na tela para voltar.', {
      info: true,
    });
});

// Ausente (deixou o tempo acabar duas vezes seguidas): qualquer toque ou tecla avisa o servidor
// que a pessoa voltou. Jogar, falar ou reagir também tiram o estado, lá no servidor.
const amAway = () => !!state?.members.find((m) => m.id === state.me)?.away;
let presenceSent = 0;
for (const type of ['pointerdown', 'keydown']) {
  addEventListener(
    type,
    () => {
      if (!amAway() || Date.now() - presenceSent < 1000) return;
      presenceSent = Date.now();
      socket.emit('presence');
    },
    { capture: true, passive: true },
  );
}

socket.on('chat', (msg) => {
  addChat(msg);
  // mensagem de jogador (não do sistema nem do histórico de jogadas) também vira balão no avatar
  if (msg?.fromId) showChatBubble(msg.fromId, msg.text);
});
socket.on('reaction', ({ from, id } = {}) => showReaction(from, id));
socket.on('chat:history', (msgs) => {
  for (const log of $$('.chat-log')) log.replaceChildren();
  msgs.forEach(addChat);
});

socket.on('room:kicked', () => {
  setRoomCode(null);
  setState(null);
  setUrl(null);
  show('home');
  flash('Você foi removido da sala');
});

// O mesmo navegador entrou nesta sala por outra aba: esta perde o lugar (o servidor já cortou
// o acesso) e não reentra sozinha ao reconectar. "Jogar aqui" puxa o lugar de volta.
let replacedCode = null;
socket.on('room:replaced', ({ code } = {}) => {
  replacedCode = code ?? roomCode;
  setRoomCode(null);
  setState(null);
  setUrl(null);
  while (modalStack.length) hideModal(modalStack.at(-1));
  show('home');
  $('#replacedDesc').textContent =
    `Você entrou na sala ${replacedCode} por outra aba ou janela. Só uma delas pode jogar por vez.`;
  openModal('replacedModal');
});
$('#replacedHome').addEventListener('click', () => {
  replacedCode = null;
  closeModal('replacedModal');
});
$('#replacedHere').addEventListener('click', () => {
  const code = replacedCode;
  replacedCode = null;
  closeModal('replacedModal');
  if (code) joinRoom(code);
});

socket.on('connect', async () => {
  $('#netStatus').classList.add('hidden');
  if (roomCode) {
    const code = roomCode;
    const res = await emit(
      'room:join',
      {
        code,
        token,
        name: store.get('om_name') ?? 'Jogador',
        avatar: myAvatar,
      },
      { quiet: true },
    );
    if (!res.ok) {
      leaveRoom();
      showJoinError(res.error === 'Sala não encontrada' ? 'A sala fechou' : res.error, code);
    }
  } else {
    refreshRooms();
  }
});

// reconexão de propósito (entrou ou saiu da conta) não é queda: não mostra o aviso
socket.on('disconnect', (reason) => reason !== 'io client disconnect' && $('#netStatus').classList.remove('hidden'));

// O servidor vai reiniciar (deploy): avisa antes da conexão cair; a reconexão cuida do resto.
socket.on('server:restart', ({ message } = {}) =>
  flash(message ?? 'O servidor vai reiniciar. Volte em instantes!', { info: true }),
);

// Conexão recusada pelo servidor (muitas conexões do mesmo endereço, origem não liberada):
// mostra a faixa de "Reconectando" e, na primeira vez, o motivo.
let connectErrorShown = false;
socket.on('connect_error', (err) => {
  $('#netStatus').classList.remove('hidden');
  if (!connectErrorShown && err?.message && !/xhr|websocket|timeout/i.test(err.message)) {
    connectErrorShown = true;
    flash(err.message);
  }
});

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
