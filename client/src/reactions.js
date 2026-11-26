// Reações rápidas: menu do botão "Reagir" e balões em cima do avatar de quem reagiu.
import { REACTIONS, REACTION_MS, reactionLabel } from '../../shared/reactions.js';
import { svg } from './cards.js';
import { $, $$, el, emit, nameOf, speak, state } from './core.js';
import { seatAnchor } from './table.js';

// ---------- reações rápidas ----------
// O botão "Reagir" (no topo da mesa e da sala de espera) abre um menu com as reações de
// shared/reactions.js. A escolhida vai para o servidor, que limita a frequência e repassa para
// a sala toda; cada um vê um balão por REACTION_MS em cima do avatar de quem reagiu.

const reactMenu = $('#reactMenu');
let reactOpener = null;

// Os botões são montados na primeira abertura (o svg() depende de constantes declaradas
// mais abaixo neste arquivo).
function buildReactMenu() {
  if (reactMenu.children.length) return;
  for (const r of REACTIONS) {
    const b = el('button', 'react-opt');
    b.type = 'button';
    b.dataset.id = r.id;
    b.append(reactionFace(r.id), el('span', null, r.label));
    // nome comprido ("Conheceu o Silas") ocupa a linha inteira, com a carinha do lado
    if (r.label.length > 10) b.classList.add('react-opt-wide');
    b.addEventListener('click', () => {
      closeReactMenu({ focus: true });
      emit('reaction', { id: r.id });
    });
    reactMenu.append(b);
  }
}

function reactionFace(id, className = 'react-face') {
  const node = svg('svg', {
    class: className,
    viewBox: '0 0 40 40',
    'aria-hidden': 'true',
  });
  node.append(svg('use', { href: `#r-${id}` }));
  return node;
}

function openReactMenu(opener) {
  buildReactMenu();
  reactOpener = opener;
  reactMenu.classList.remove('hidden');
  // embaixo do botão, alinhado pela direita dele, sem sair da tela
  const r = opener.getBoundingClientRect();
  const w = reactMenu.offsetWidth;
  const left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8);
  reactMenu.style.left = `${left}px`;
  reactMenu.style.top = `${r.bottom + 8}px`;
  for (const b of $$('.react-btn')) b.setAttribute('aria-expanded', String(b === opener));
  reactMenu.querySelector('.react-opt')?.focus({ preventScroll: true });
}

export function closeReactMenu({ focus = false } = {}) {
  if (reactMenu.classList.contains('hidden')) return;
  reactMenu.classList.add('hidden');
  for (const b of $$('.react-btn')) b.setAttribute('aria-expanded', 'false');
  if (focus) reactOpener?.focus({ preventScroll: true });
  reactOpener = null;
}

for (const b of $$('.react-btn')) {
  b.addEventListener('click', () => {
    if (reactOpener === b) closeReactMenu();
    else openReactMenu(b);
  });
}

// Clicar fora ou redimensionar a tela fecha o menu.
document.addEventListener('pointerdown', (e) => {
  if (reactOpener && !reactMenu.contains(e.target) && !(e.target instanceof Element && e.target.closest('.react-btn')))
    closeReactMenu();
});
addEventListener('resize', () => closeReactMenu());

// Setas andam entre as reações do menu (o Tab também funciona).
reactMenu.addEventListener('keydown', (e) => {
  const opts = $$('.react-opt', reactMenu);
  const i = opts.indexOf(document.activeElement);
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (step == null || i < 0) return;
  e.preventDefault();
  opts[(i + step + opts.length) % opts.length].focus();
});

// Onde está o avatar de alguém agora: o assento na mesa (o seu fica na sua barra) ou a
// cadeira na sala de espera.
function reactionAnchor(memberId) {
  if (state?.game) return seatAnchor(memberId);
  return $(`#memberList .seat[data-id="${memberId}"]`);
}

// O balão nasce centrado no avatar; perto da borda (o seu avatar, no canto da sua barra no
// celular, ou um assento na beirada da mesa) ele escorrega para dentro da tela, e a ponta
// continua apontando para o avatar.
const EDGE = 8;
function keepOnScreen(bubble, anchor) {
  const a = anchor.getBoundingClientRect();
  const w = bubble.offsetWidth; // largura sem o scale da animação
  const center = a.left + a.width / 2;
  const left = Math.min(Math.max(EDGE, center - w / 2), innerWidth - EDGE - w);
  const shift = Math.round(left - (center - w / 2));
  if (shift) bubble.style.setProperty('--shift', `${shift}px`);
}

// Balões no ar, um por pessoa. A mesa e a sala de espera redesenham os assentos a cada
// mudança (vez de outro jogador, carta jogada, alguém entrou), o que apagaria o balão junto
// com o assento antigo. Por isso cada balão fica guardado aqui e, quando o assento é
// redesenhado, volta para o avatar novo e continua a animação de onde parou.
const bubbles = new Map(); // memberId -> { node, start, timer }

function placeBubble(from, entry) {
  const anchor = reactionAnchor(from);
  if (!anchor) {
    entry.node.remove();
    return;
  }
  if (entry.node.parentNode === anchor) return;
  // voltar para o DOM reinicia a animação CSS; o atraso negativo pula o tempo que já passou
  entry.node.style.animationDelay = `-${Math.round(performance.now() - entry.start)}ms`;
  anchor.append(entry.node);
  keepOnScreen(entry.node, anchor);
}

function addBubble(from, bubble) {
  const old = bubbles.get(from);
  if (old) {
    clearTimeout(old.timer);
    old.node.remove();
  }
  bubble.setAttribute('aria-hidden', 'true');
  bubble.style.setProperty('--life', `${REACTION_MS}ms`);
  const entry = {
    node: bubble,
    start: performance.now(),
    timer: setTimeout(() => {
      bubble.remove();
      if (bubbles.get(from) === entry) bubbles.delete(from);
    }, REACTION_MS),
  };
  bubbles.set(from, entry);
  placeBubble(from, entry);
}

// Qualquer redesenho (assentos da mesa, sua barra, cadeiras da sala de espera) passa por aqui:
// balão que ficou fora da tela, ou num avatar que não é mais o da pessoa, volta para o lugar.
new MutationObserver(() => {
  for (const [from, entry] of bubbles) placeBubble(from, entry);
}).observe(document.body, { childList: true, subtree: true });

export function showReaction(from, id) {
  const label = reactionLabel(id);
  if (!label) return;
  speak(`${from === state?.me ? 'Você' : nameOf(from)}: ${label}`);
  const bubble = el('div', 'reaction');
  bubble.append(reactionFace(id), el('span', null, label));
  addBubble(from, bubble);
}

// Mensagens do chat também viram balão em cima do avatar de quem escreveu, para a mesa toda
// ler sem abrir o chat.
export function showChatBubble(from, text) {
  if (!text) return;
  // o texto já é anunciado pelo log do chat; o balão é só visual
  const bubble = el('div', 'reaction chat-bubble');
  bubble.append(el('span', 'chat-bubble-text', text));
  addBubble(from, bubble);
}
