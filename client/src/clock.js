// Relógio da vez: anel no avatar, segundos restantes e título da aba.
import { sounds } from './audio.js';
import { $, clockOffset, el, speak, state } from './core.js';
import { isMyTurn } from './hand.js';

// Relógio da vez: barra, segundos que faltam, aviso nos últimos segundos e título da aba.
const BASE_TITLE = document.title;
const TICK_FROM_S = 5;
let lastTick = null;

function setTitle(myTurn) {
  // Com a aba em segundo plano, o título avisa que é a sua vez.
  const title = myTurn && document.hidden ? `Sua vez! · ${BASE_TITLE}` : BASE_TITLE;
  if (document.title !== title) document.title = title;
}

// Quanto ainda resta da vez atual, de 1 (cheio) a 0 (acabou).
function turnProgress() {
  if (!state?.deadline || !state.settings) return 1;
  const left = Math.max(0, state.deadline - (Date.now() + clockOffset));
  // turnMs é o prazo desta vez: o tempo por vez para humanos, alguns segundos para bots
  const total = state.turnMs || state.settings.turnSeconds * 1000;
  return Math.min(1, left / total);
}

// Anel de tempo em volta do avatar de quem joga. Já nasce com o tempo certo,
// para não "encher" de novo cada vez que a mesa é redesenhada.
export function turnRing() {
  const ring = el('span', 'ring');
  ring.style.setProperty('--p', turnProgress());
  return ring;
}

function updateClock() {
  const g = state?.game;
  const myTurn = !!g && g.phase === 'playing' && g.turnId === state.me;
  setTitle(myTurn);
  if (!g) return;
  const now = Date.now() + clockOffset;
  const bar = $('#meTimer');
  const secs = $('#meTimerSecs');
  const left = state.deadline ? Math.max(0, state.deadline - now) : null;
  const p = turnProgress();
  const on = myTurn && left != null;
  const s = on ? Math.ceil(left / 1000) : null;
  bar.classList.toggle('on', on);
  bar.classList.toggle('low', p < 0.2);
  $('i', bar).style.transform = `scaleX(${p})`;
  const total = state.settings.turnSeconds;
  // Tique dos últimos segundos: nos tempos curtos (5s, 10s), só na metade final, senão a vez
  // inteira seria tique e o aviso falado tomaria a vez toda.
  const tickFrom = Math.min(TICK_FROM_S, Math.ceil(total / 2));
  const secsLeft = left == null ? total : Math.ceil(left / 1000);
  if (bar.getAttribute('aria-valuenow') !== String(secsLeft)) {
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(secsLeft));
    bar.setAttribute('aria-valuetext', `${secsLeft} segundos restantes`);
  }
  secs.classList.toggle('on', on);
  secs.classList.toggle('low', on && s <= tickFrom);
  secs.textContent = on ? `${s}s` : '';
  $('#seats .seat.turn .ring')?.style.setProperty('--p', p);
  const myRing = $('#meInfo .ring');
  myRing?.style.setProperty('--p', p);
  myRing?.classList.toggle('low', on && s <= tickFrom);

  // Últimos segundos: um tique (e uma vibração) por segundo.
  if (on && s > 0 && s <= tickFrom) {
    if (s !== lastTick) {
      lastTick = s;
      sounds.tick();
      navigator.vibrate?.(30);
      if (s === tickFrom) speak(`Faltam ${tickFrom} segundos`);
    }
  } else lastTick = null;
}

setInterval(updateClock, 200);
document.addEventListener('visibilitychange', () => setTitle(isMyTurn(state)));
