// Conta: entrar, criar conta, sair e apagar. A sessão fica no localStorage (om_session) e vai
// no handshake do socket (core.js) e no cabeçalho dos pedidos /api. Sem conta, tudo funciona
// como antes: o apelido é o do campo da tela inicial.
import { nicknameError, passwordError, tidyNickname } from '../../shared/names.js';
import { $, flash, roomCode, socket, speak, store } from './core.js';
import { closeModal, openModal } from './modals.js';
import { SERVER_URL } from './platform.js';

/** @typedef {{ id: number, nickname: string, hasPassword: boolean, hasGoogle: boolean }} User */

function readUser() {
  try {
    return JSON.parse(store.get('om_user') ?? 'null');
  } catch {
    return null;
  }
}

// Quem está logado (guardado também no localStorage, para a tela já abrir com o apelido certo
// antes da resposta do /api/me). Os outros módulos leem direto.
/** @type {User | null} */
export let user = store.get('om_session') ? readUser() : null;

// Pedido para /api com a sessão. Nunca joga erro: sem rede, devolve { ok: false, error }.
export async function api(method, path, body) {
  const session = store.get('om_session');
  try {
    const res = await fetch(`${SERVER_URL}/api${path}`, {
      method,
      headers: {
        ...(body && { 'Content-Type': 'application/json' }),
        ...(session && { Authorization: `Bearer ${session}` }),
      },
      body: body && JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ...data, status: res.status, ok: res.ok && data.ok !== false };
  } catch {
    return { ok: false, status: 0, error: 'Sem conexão com o servidor. Tente de novo.' };
  }
}

// `session`: o token novo (entrou), null (saiu) ou undefined (só atualizou os dados da conta).
function setUser(next, session) {
  user = next;
  if (session === null) store.remove('om_session');
  else if (session) store.set('om_session', session);
  if (next) store.set('om_user', JSON.stringify(next));
  else store.remove('om_user');
  renderAccount();
  // O socket só manda a sessão ao conectar: reconecta para o servidor saber quem é. Entrar e
  // sair só acontecem na tela inicial, onde reconectar não tira ninguém de sala nenhuma.
  if (session !== undefined && !roomCode) {
    socket.disconnect();
    socket.connect();
  }
}

// O servidor encerrou a sessão desta conexão (saiu da conta noutra aba ou aparelho, ou a conta
// foi apagada): volta a ser convidado aqui também. O servidor derruba a conexão logo depois; ela
// volta como convidado e, se estava numa sala, entra de novo pelo token, como numa queda.
let endingHere = false; // esta aba está saindo ou apagando a conta: o setUser dela cuida de tudo
socket.on('session:ended', ({ reason } = {}) => {
  if (endingHere || !store.get('om_session')) return;
  user = null;
  store.remove('om_session');
  store.remove('om_user');
  renderAccount();
  flash(reason === 'deleted' ? 'A conta foi apagada.' : 'Você saiu da conta.', { info: true });
});

// A tela inicial com e sem conta: logado, o apelido é o da conta (o campo fica só de leitura).
export function renderAccount() {
  const input = /** @type {HTMLInputElement} */ ($('#nameInput'));
  const label = $('label[for="nameInput"]');
  input.readOnly = !!user;
  if (user) {
    input.value = user.nickname;
    input.removeAttribute('aria-invalid');
    $('#nameError').classList.add('hidden');
  } else if (input.dataset.account) input.value = store.get('om_name') ?? ''; // saiu: volta o apelido de convidado
  input.dataset.account = user ? '1' : '';
  label.textContent = user ? 'Sua conta' : 'Seu apelido';
  $('#accountBtnText').textContent = user ? 'Minha conta' : 'Entrar ou criar conta';
  $('#accountBtn').setAttribute('aria-label', user ? `Minha conta (${user.nickname})` : 'Entrar ou criar conta');
}

// A sessão guardada ainda vale? Vencida ou apagada: volta a ser convidado.
export async function refreshUser() {
  if (!store.get('om_session')) return null;
  const res = await api('GET', '/me');
  if (res.ok) setUser(res.user);
  else if (res.status === 401) setUser(null, null);
  return user;
}

export function openAccount() {
  if (user) {
    $('#accountNick').textContent = user.nickname;
    resetDelete();
    openModal('accountModal');
  } else {
    showAuthMain();
    setMode('login');
    openModal('authModal');
    showGoogleButton($('#googleBox'), $('#googleBtn'), 'continue_with', googleSignIn);
  }
}

$('#accountBtn').addEventListener('click', openAccount);
// logado, tocar no apelido (só de leitura) também abre a conta
$('#nameInput').addEventListener('click', () => user && openAccount());

// ---------- entrar / criar conta ----------

const form = /** @type {HTMLFormElement} */ ($('#authForm'));
const nickInput = /** @type {HTMLInputElement} */ ($('#authNick'));
const passInput = /** @type {HTMLInputElement} */ ($('#authPass'));
const submitBtn = /** @type {HTMLButtonElement} */ ($('#authSubmit'));
let mode = 'login';

function setMode(next) {
  mode = next;
  for (const tab of [$('#authTabLogin'), $('#authTabRegister')]) {
    const on = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  const register = mode === 'register';
  submitBtn.textContent = register ? 'Criar conta' : 'Entrar';
  passInput.autocomplete = register ? 'new-password' : 'current-password';
  $('#authHint').classList.toggle('hidden', !register);
  // criando conta, já sugere o apelido que a pessoa usa como convidada
  if (register && !nickInput.value) nickInput.value = store.get('om_name') ?? '';
  setAuthError(null);
}

function setAuthError(text, field) {
  const err = $('#authError');
  err.textContent = text ?? '';
  err.classList.toggle('hidden', !text);
  for (const input of [nickInput, passInput]) {
    if (text && input === field) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  if (text) {
    speak(text, { urgent: true });
    field?.focus();
  }
}

for (const tab of [$('#authTabLogin'), $('#authTabRegister')]) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
  // setas trocam de aba (padrão de tablist)
  tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setMode(mode === 'login' ? 'register' : 'login');
    $(`#${mode === 'login' ? 'authTabLogin' : 'authTabRegister'}`).focus();
  });
}
for (const input of [nickInput, passInput]) input.addEventListener('input', () => setAuthError(null));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickname = tidyNickname(nickInput.value);
  const password = passInput.value;
  if (mode === 'register') {
    const nickErr = nicknameError(nickname);
    if (nickErr) return setAuthError(nickErr, nickInput);
    const passErr = passwordError(password);
    if (passErr) return setAuthError(passErr, passInput);
  } else {
    if (!nickname) return setAuthError('Digite seu apelido', nickInput);
    if (!password) return setAuthError('Digite sua senha', passInput);
  }
  submitBtn.disabled = true;
  const res = await api('POST', mode === 'register' ? '/auth/register' : '/auth/login', { nickname, password });
  submitBtn.disabled = false;
  if (!res.ok)
    return setAuthError(res.error ?? 'Não deu certo. Tente de novo.', res.status === 409 ? nickInput : passInput);
  passInput.value = '';
  finishSignIn(res, mode === 'register');
});

function finishSignIn(res, created) {
  closeModal('authModal');
  setUser(res.user, res.session);
  const nick = res.user.nickname;
  flash(created ? `Conta criada! Bem-vindo, ${nick}.` : `Oi de novo, ${nick}!`, { info: true });
}

// ---------- Google ----------
// O botão é o oficial do Google (script deles, carregado só quando o modal abre). Ele devolve
// um ID token, que o servidor confere. Sem GOOGLE_CLIENT_ID no servidor, nada disso aparece.

let googleClientId = null; // null: ainda não perguntou ao servidor; '': desligado
let gisLoading = null;
let onGoogle = null; // quem recebe o próximo token: entrar ou confirmar "apagar conta"
const gis = () => /** @type {any} */ (window).google?.accounts?.id;

async function googleConfig() {
  if (googleClientId === null) {
    const res = await api('GET', '/config');
    if (res.ok) googleClientId = res.googleClientId ?? ''; // sem rede: pergunta de novo na próxima
  }
  return googleClientId;
}

function loadGoogle() {
  gisLoading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      gis()?.initialize({ client_id: googleClientId, callback: (r) => onGoogle?.(r.credential) });
      resolve(gis() ?? null);
    };
    script.onerror = () => {
      script.remove();
      gisLoading = null; // bloqueado ou sem rede: tenta de novo na próxima vez que abrir
      resolve(null);
    };
    document.head.append(script);
  });
  return gisLoading;
}

// Desenha o botão do Google em `target` e mostra `box`. Desligado ou sem carregar, `box` fica escondido.
async function showGoogleButton(box, target, text, handler) {
  box.classList.add('hidden');
  if (!(await googleConfig())) return;
  const id = await loadGoogle();
  if (!id) return;
  onGoogle = handler;
  box.classList.remove('hidden');
  target.replaceChildren();
  id.renderButton(target, {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text,
    locale: 'pt-BR',
    width: Math.min(400, Math.max(220, target.clientWidth || 300)),
  });
}

async function googleSignIn(credential) {
  setAuthError(null);
  const res = await api('POST', '/auth/google', { credential });
  if (!res.ok) return setAuthError(res.error ?? 'Não deu para entrar com o Google. Tente de novo.');
  if (res.needsNickname) return showNickStep(res.ticket);
  finishSignIn(res, false);
}

// Primeira vez com o Google: o modal troca o formulário pelo campo do apelido.
const nickForm = /** @type {HTMLFormElement} */ ($('#googleNickForm'));
const googleNick = /** @type {HTMLInputElement} */ ($('#googleNick'));
let googleTicket = null;

function showAuthMain() {
  googleTicket = null;
  $('#authMain').classList.remove('hidden');
  nickForm.classList.add('hidden');
}

function showNickStep(ticket) {
  googleTicket = ticket;
  $('#authMain').classList.add('hidden');
  nickForm.classList.remove('hidden');
  googleNick.value = store.get('om_name') ?? '';
  setNickError(null);
  googleNick.focus();
  speak('Escolha seu apelido para terminar de criar a conta');
}

function setNickError(text) {
  const err = $('#googleNickError');
  err.textContent = text ?? '';
  err.classList.toggle('hidden', !text);
  if (text) {
    googleNick.setAttribute('aria-invalid', 'true');
    speak(text, { urgent: true });
    googleNick.focus();
  } else googleNick.removeAttribute('aria-invalid');
}
googleNick.addEventListener('input', () => setNickError(null));

nickForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickname = tidyNickname(googleNick.value);
  const error = nicknameError(nickname);
  if (error) return setNickError(error);
  const btn = /** @type {HTMLButtonElement} */ ($('#googleNickSubmit'));
  btn.disabled = true;
  const res = await api('POST', '/auth/google/complete', { ticket: googleTicket, nickname });
  btn.disabled = false;
  if (res.ok) return finishSignIn(res, true);
  if (res.status === 400 && /expirou/.test(res.error ?? '')) {
    // demorou demais (ou o servidor reiniciou): volta para o botão do Google
    showAuthMain();
    return setAuthError(res.error);
  }
  setNickError(res.error ?? 'Não deu certo. Tente de novo.');
});

// ---------- minha conta ----------

$('#logoutBtn').addEventListener('click', async () => {
  endingHere = true;
  await api('POST', '/auth/logout');
  endingHere = false;
  gis()?.disableAutoSelect(); // o Google não entra sozinho de novo nesta conta
  closeModal('accountModal');
  setUser(null, null);
  flash('Você saiu da conta.', { info: true });
});

const deleteForm = /** @type {HTMLFormElement} */ ($('#deleteForm'));
const deletePass = /** @type {HTMLInputElement} */ ($('#deletePass'));

// Conta só do Google não tem senha: confirma entrando com o Google de novo.
const googleOnly = () => !!user && !user.hasPassword && user.hasGoogle;

function resetDelete() {
  /** @type {HTMLDetailsElement} */ ($('#deleteDetails')).open = false;
  deletePass.value = '';
  $('#deletePassField').classList.toggle('hidden', !user?.hasPassword);
  $('#deleteSubmit').classList.toggle('hidden', googleOnly());
  $('#deleteGoogleField').classList.add('hidden');
  setDeleteError(null);
}

$('#deleteDetails').addEventListener('toggle', (e) => {
  if (!(/** @type {HTMLDetailsElement} */ (e.target).open) || !googleOnly()) return;
  showGoogleButton($('#deleteGoogleField'), $('#googleDeleteBtn'), 'continue_with', (credential) =>
    deleteAccount({ credential }),
  );
});

function setDeleteError(text) {
  const err = $('#deleteError');
  err.textContent = text ?? '';
  err.classList.toggle('hidden', !text);
  if (text) {
    deletePass.setAttribute('aria-invalid', 'true');
    speak(text, { urgent: true });
  } else deletePass.removeAttribute('aria-invalid');
}
deletePass.addEventListener('input', () => setDeleteError(null));

deleteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (user?.hasPassword && !deletePass.value) {
    setDeleteError('Digite sua senha para confirmar');
    return deletePass.focus();
  }
  deleteAccount({ password: deletePass.value });
});

async function deleteAccount(body) {
  const btn = /** @type {HTMLButtonElement} */ ($('#deleteSubmit'));
  btn.disabled = true;
  endingHere = true;
  const res = await api('DELETE', '/account', body);
  endingHere = false;
  btn.disabled = false;
  if (!res.ok) {
    if (res.code === 'session') {
      // a sessão venceu no meio do caminho
      closeModal('accountModal');
      setUser(null, null);
      return flash('Sua sessão venceu. Entre de novo para apagar a conta.');
    }
    setDeleteError(res.error ?? 'Não deu certo. Tente de novo.');
    if (!googleOnly()) deletePass.focus();
    return;
  }
  closeModal('accountModal');
  setUser(null, null);
  flash('Sua conta foi apagada.', { info: true });
}

renderAccount();
refreshUser();
