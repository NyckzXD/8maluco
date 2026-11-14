// Conta: entrar, criar conta, sair e apagar. A sessão fica no localStorage (om_session) e vai
// no handshake do socket (core.js) e no cabeçalho dos pedidos /api. Sem conta, tudo funciona
// como antes: o apelido é o do campo da tela inicial.
import { nicknameError, passwordError, tidyNickname } from '../../shared/names.js';
import { $, flash, roomCode, socket, speak, store } from './core.js';
import { closeModal, openModal } from './modals.js';

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
async function api(method, path, body) {
  const session = store.get('om_session');
  try {
    const res = await fetch(`/api${path}`, {
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
    setMode('login');
    openModal('authModal');
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
  closeModal('authModal');
  setUser(res.user, res.session);
  flash(mode === 'register' ? `Conta criada! Bem-vindo, ${res.user.nickname}.` : `Oi de novo, ${res.user.nickname}!`, {
    info: true,
  });
});

// ---------- minha conta ----------

$('#logoutBtn').addEventListener('click', async () => {
  await api('POST', '/auth/logout');
  closeModal('accountModal');
  setUser(null, null);
  flash('Você saiu da conta.', { info: true });
});

const deleteForm = /** @type {HTMLFormElement} */ ($('#deleteForm'));
const deletePass = /** @type {HTMLInputElement} */ ($('#deletePass'));

function resetDelete() {
  /** @type {HTMLDetailsElement} */ ($('#deleteDetails')).open = false;
  deletePass.value = '';
  $('#deletePassField').classList.toggle('hidden', !user?.hasPassword);
  setDeleteError(null);
}

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
  const btn = /** @type {HTMLButtonElement} */ ($('#deleteSubmit'));
  btn.disabled = true;
  const res = await api('DELETE', '/account', { password: deletePass.value });
  btn.disabled = false;
  if (!res.ok) {
    if (res.status === 401 && !/senha/i.test(res.error ?? '')) {
      // a sessão venceu no meio do caminho
      closeModal('accountModal');
      setUser(null, null);
      return flash('Sua sessão venceu. Entre de novo para apagar a conta.');
    }
    setDeleteError(res.error ?? 'Não deu certo. Tente de novo.');
    return deletePass.focus();
  }
  closeModal('accountModal');
  setUser(null, null);
  flash('Sua conta foi apagada.', { info: true });
});

renderAccount();
refreshUser();
