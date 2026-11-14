// Passo a passo do "Como jogar" na tela inicial.
import { icon } from './cards.js';
import { $, $$, el, store } from './core.js';

// Passo a passo do "Como jogar": troca sozinho, pelas bolinhas, pelas setas e deslizando.
// Pausa com o mouse em cima ou com o foco dentro, e não anda sozinho com movimento reduzido.
// A bolinha do passo atual é um relógio (CSS) que se enche no mesmo tempo do passo; pausado,
// o relógio para onde está e, ao continuar, o passo só troca depois do tempo que faltava.
const howtoSlides = $$('#howto .howto-slide');
const howtoSection = $('.howto-section');
const howtoNav = $('.howto-nav');
const HOWTO_MS = 3500;
howtoSection.style.setProperty('--howto-ms', `${HOWTO_MS}ms`);
let howtoIndex = 0;
let howtoTimer;
let howtoHover = false;
let howtoRunning = false; // o relógio do passo atual está andando
let howtoStart = 0; // quando ele voltou a andar
let howtoElapsed = 0; // quanto do passo atual já passou antes da última pausa
// Parado pelo botão de pausa: fica parado até a pessoa mandar continuar (vale entre visitas).
let howtoStopped = store.get('om_howto_paused') === '1';

const howtoPaused = () =>
  howtoStopped ||
  howtoHover ||
  howtoSection.contains(document.activeElement) ||
  matchMedia('(prefers-reduced-motion: reduce)').matches;

function syncHowtoPause() {
  const btn = $('#howtoPause');
  const label = howtoStopped ? 'Continuar passo a passo' : 'Pausar passo a passo';
  btn.replaceChildren(icon(howtoStopped ? 'play' : 'pause'));
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
syncHowtoPause();
$('#howtoPause').addEventListener('click', () => {
  howtoStopped = !howtoStopped;
  store.set('om_howto_paused', howtoStopped ? '1' : '0');
  syncHowtoPause();
  scheduleHowto();
});

function scheduleHowto() {
  if (howtoRunning) {
    howtoElapsed += performance.now() - howtoStart;
    howtoRunning = false;
  }
  clearTimeout(howtoTimer);
  const paused = howtoPaused();
  howtoSection.classList.toggle('paused', paused);
  if (paused) return;
  howtoRunning = true;
  howtoStart = performance.now();
  howtoTimer = setTimeout(() => showHowto(howtoIndex + 1), Math.max(0, HOWTO_MS - howtoElapsed));
}

// Recomeça o relógio do zero (tira e põe a classe que liga a animação).
function restartHowtoClock() {
  howtoNav.classList.remove('run');
  void howtoNav.offsetWidth;
  howtoNav.classList.add('run');
}

function showHowto(i) {
  howtoIndex = (i + howtoSlides.length) % howtoSlides.length;
  howtoSlides.forEach((s, n) => {
    s.classList.toggle('active', n === howtoIndex);
    s.setAttribute('aria-label', `Passo ${n + 1} de ${howtoSlides.length}`);
  });
  $$('#howtoDots button').forEach((d, n) => d.setAttribute('aria-current', n === howtoIndex));
  $('#howtoCount').textContent = `${howtoIndex + 1} / ${howtoSlides.length}`;
  clearTimeout(howtoTimer);
  howtoRunning = false;
  howtoElapsed = 0;
  restartHowtoClock();
  scheduleHowto();
}

howtoSection.addEventListener('mouseenter', () => {
  howtoHover = true;
  scheduleHowto();
});
howtoSection.addEventListener('mouseleave', () => {
  howtoHover = false;
  scheduleHowto();
});
howtoSection.addEventListener('focusin', () => scheduleHowto());
// Espera o foco chegar no próximo elemento antes de ver se ainda está dentro.
howtoSection.addEventListener('focusout', () => setTimeout(scheduleHowto));
$('#howtoPrev').addEventListener('click', () => showHowto(howtoIndex - 1));
$('#howtoNext').addEventListener('click', () => showHowto(howtoIndex + 1));

// Deslizar para os lados no celular troca o passo.
let howtoSwipe = null;
$('#howto').addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') howtoSwipe = { x: e.clientX, y: e.clientY };
});
$('#howto').addEventListener('pointerup', (e) => {
  if (!howtoSwipe) return;
  const dx = e.clientX - howtoSwipe.x;
  const dy = e.clientY - howtoSwipe.y;
  howtoSwipe = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) showHowto(howtoIndex + (dx < 0 ? 1 : -1));
});
$('#howto').addEventListener('pointercancel', () => (howtoSwipe = null));

howtoSlides.forEach((_, n) => {
  const dot = el('button');
  dot.type = 'button';
  dot.title = `Passo ${n + 1}`;
  dot.setAttribute('aria-label', `Passo ${n + 1}`);
  dot.addEventListener('click', () => showHowto(n));
  $('#howtoDots').append(dot);
});
showHowto(0);
