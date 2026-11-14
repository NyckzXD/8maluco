// Chat da sala e histórico de jogadas.
import { $, $$, el, socket, store } from './core.js';

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
export function setSideUnread(on) {
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

export function addChat(msg) {
  for (const log of $$('.chat-log')) {
    const li = el('li', msg.system ? 'system' : msg.log ? (msg.who ? 'log play' : 'log') : '');
    // jogadas e compras: só o nome de quem agiu fica em vermelho
    if (msg.who) li.append(el('b', 'log-who', msg.who), ' ');
    if (msg.from) {
      // o id de quem mandou: com nomes iguais fora da sala (ou trocados), a linha ainda acha a pessoa
      if (msg.fromId) li.dataset.from = msg.fromId;
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

export function logLine(text) {
  addChat({ log: true, text });
}

// Linha do histórico de jogadas: "<nome> jogou 9 de Paus".
export function logPlay(who, text) {
  addChat({ log: true, who, text });
}

export const cardsLabel = (n) => `${n} carta${n > 1 ? 's' : ''}`;
