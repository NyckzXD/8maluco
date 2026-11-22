// Tela inicial: apelido, entrar por código ou link, lista de salas abertas.
import { BOT_NAME_ERROR, RESERVED_NAME_ERROR, isBotName } from '../../shared/names.js';
import { openAccount, refreshUser, user } from './account.js';
import { myAvatar } from './avatar-editor.js';
import { icon } from './cards.js';
import { $, avatar, el, emit, flash, roomCode, setRoomCode, setUrl, speak, store, token } from './core.js';
import { closeModal, hideModal, openModal } from './modals.js';

// ---------- tela inicial ----------

export const nameInput = $('#nameInput');
export const codeInput = $('#codeInput');
// com conta, o account.js já pôs o apelido dela no campo
if (!user) nameInput.value = store.get('om_name') ?? '';

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
  if (user) return user.nickname; // com conta, o servidor usa o apelido dela
  const name = nameInput.value.trim();
  if (!name) {
    closeModal('roomsModal');
    setNameError('Escolha um apelido primeiro');
    nameInput.focus();
    return null;
  }
  if (isBotName(name)) {
    closeModal('roomsModal');
    setNameError(BOT_NAME_ERROR);
    nameInput.focus();
    return null;
  }
  setNameError(null);
  store.set('om_name', name);
  return name;
}

// Aceita o código puro ou o link inteiro da sala (".../?sala=AB12C").
const NOT_CODE_CHAR = /[^A-HJ-NP-Z2-9]/g; // mesmo alfabeto do servidor (sem I, O, 0 e 1)
export function extractCode(text = '') {
  const fromLink = /[?&]sala=([a-z0-9]+)/i.exec(text);
  return (fromLink ? fromLink[1] : text).toUpperCase().replace(NOT_CODE_CHAR, '').slice(0, 5);
}

// O servidor recusou o apelido por ser de uma conta. Se a pessoa achava que estava logada, a
// sessão venceu: volta a ser convidada e abre o "Entrar".
async function nameTaken() {
  closeModal('roomsModal');
  if (user && !(await refreshUser())) {
    flash('Sua sessão venceu. Entre de novo na sua conta.');
    return openAccount();
  }
  setNameError(RESERVED_NAME_ERROR);
  nameInput.focus();
}

function onJoined(res) {
  if (!res.ok) return false;
  closeModal('roomsModal');
  setRoomCode(res.code);
  setUrl(res.code);
  if (res.spectator)
    flash('Você entrou na plateia: assiste agora e senta na próxima partida, se tiver lugar.', {
      info: true,
    });
  return true;
}

// Não deu para entrar: em vez de um aviso que some, um modal que diz o que houve e oferece o caminho.
const JOIN_ERRORS = {
  'Sala não encontrada': [
    'Sala não encontrada',
    (c) => `Não existe nenhuma sala ${c} aberta agora. Ela pode ter acabado, ou o código está diferente.`,
  ],
  'A sala está cheia': ['A sala está cheia', (c) => `A sala ${c} já tem todos os lugares ocupados.`],
  'Você foi removido desta sala': [
    'Você foi removido',
    (c) => `O anfitrião da sala ${c} tirou você da mesa. Dá para entrar em outra sala ou criar a sua.`,
  ],
  'A sala fechou': [
    'A sala fechou',
    (c) =>
      `A conexão caiu e, quando voltou, a sala ${c} não existia mais. Isso acontece quando o servidor reinicia ou quando a sala fica vazia por muito tempo.`,
  ],
};
export function showJoinError(error, code) {
  const known = JOIN_ERRORS[error];
  if (!known) return flash(error);
  $('#joinErrorTitle').textContent = known[0];
  $('#joinErrorDesc').textContent = known[1](code);
  openModal('joinErrorModal');
}
$('#joinErrorRooms').addEventListener('click', () => {
  hideModal('joinErrorModal');
  $('#roomList').replaceChildren();
  openModal('roomsModal');
  refreshRooms();
});
$('#joinErrorCreate').addEventListener('click', () => {
  hideModal('joinErrorModal');
  $('#createBtn').click();
});

export async function joinRoom(code) {
  const name = askName();
  if (!name) return;
  code = extractCode(code);
  if (!code) return flash('Digite o código da sala');
  const res = await emit('room:join', { code, token, name, avatar: myAvatar }, { quiet: true });
  if (!res.ok) {
    setUrl(null);
    if (res.error === RESERVED_NAME_ERROR) return nameTaken();
    return showJoinError(res.error, code);
  }
  onJoined(res);
}

// Convite aberto pelo link (no navegador, o ?sala= da página; no app, o link que abriu o app).
// Sem apelido, deixa o código no campo e pede o apelido; já numa sala, não troca sozinho.
export function openInvite(link) {
  const code = extractCode(link);
  if (!code || code === roomCode) return;
  if (roomCode) {
    flash(`Você já está na sala ${roomCode}. Saia dela para entrar na sala ${code}.`, { info: true });
    return;
  }
  codeInput.value = code;
  if (nameInput.value.trim()) joinRoom(code);
  else {
    nameInput.focus();
    flash('Escolha um apelido e clique em Entrar', { info: true });
  }
}

$('#createBtn').addEventListener('click', async () => {
  const name = askName();
  if (!name) return;
  const res = await emit('room:create', { token, name, avatar: myAvatar }, { quiet: true });
  if (res.error === RESERVED_NAME_ERROR) return nameTaken();
  if (!res.ok && res.error) flash(res.error);
  onJoined(res);
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

export async function refreshRooms() {
  if ($('#roomsModal').classList.contains('hidden')) return;
  const res = await emit('room:list');
  const list = $('#roomList');
  // As linhas entram com animação só ao abrir; a atualização a cada 5s troca sem mexer.
  list.classList.toggle('enter', !list.children.length);
  list.replaceChildren();
  if (!res.rooms?.length) {
    const empty = el('li', 'empty');
    // três versos de carta em leque, esperando alguém dar as cartas
    const art = el('div', 'rooms-empty-art');
    art.setAttribute('aria-hidden', 'true');
    for (let n = 0; n < 3; n++) art.append(el('span', 'card back'));
    // o mesmo botão principal da tela inicial (grande, com o ícone de +)
    const create = el('button', 'btn btn-primary btn-big');
    create.append(icon('plus'), 'Criar uma sala');
    create.type = 'button';
    create.addEventListener('click', () => {
      hideModal('roomsModal');
      $('#createBtn').click();
    });
    empty.append(
      art,
      el('b', null, 'Nenhuma sala aberta agora'),
      el('span', null, 'Crie a sua e chame a galera pelo link.'),
      create,
    );
    list.append(empty);
    return;
  }
  for (const r of res.rooms) {
    // em jogo ou com a mesa cheia, quem entra vai para a plateia; "cheia" só sem vaga nem para assistir
    const full = r.full ?? r.players >= r.max;
    const watch = !full && (r.playing || r.players >= r.max);
    const li = el('li', full ? 'full' : '');
    // quem criou a mesa, com o avatar dele
    const host = avatar({
      name: r.host,
      avatar: r.hostAvatar,
      color: r.hostColor,
    });
    const info = el('div', 'room-info');
    const head = el('div', 'room-head');
    head.append(
      el('b', 'room-code-sm', r.code),
      el('span', `tag ${r.playing ? 'playing' : ''}`, r.playing ? 'em jogo' : 'no lobby'),
    );
    // os lugares da mesa: cheios para quem já sentou, vazios para as vagas
    const seats = el('span', 'room-seats');
    seats.setAttribute('aria-hidden', 'true');
    for (let n = 0; n < r.max; n++) seats.append(el('i', n < r.players ? 'on' : ''));
    const watching = r.watching ? ` · ${r.watching} na plateia` : '';
    const sub = el(
      'small',
      null,
      watch
        ? `${r.playing ? 'Em jogo' : 'Mesa cheia'} · entrar como plateia${watching}`
        : `Mesa de ${r.host} · ${r.players} de ${r.max} lugares${watching}`,
    );
    info.append(head, seats, sub);
    const btn = el(
      'button',
      `btn btn-small ${watch ? 'btn-felt' : 'btn-primary'}`,
      full ? 'Cheia' : watch ? 'Assistir' : 'Entrar',
    );
    btn.disabled = full;
    btn.setAttribute(
      'aria-label',
      full ? `Sala ${r.code} cheia` : watch ? `Entrar como plateia na sala ${r.code}` : `Entrar na sala ${r.code}`,
    );
    btn.addEventListener('click', () => joinRoom(r.code));
    li.append(host, info, btn);
    list.append(li);
  }
}

$('#refreshRooms').addEventListener('click', refreshRooms);
setInterval(refreshRooms, 5000);

$('#roomsBtn').addEventListener('click', () => {
  $('#roomList').replaceChildren();
  openModal('roomsModal');
  refreshRooms();
});
