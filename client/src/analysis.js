// Análise do bot forte, ao vivo: na sua vez, mostra o que ele jogaria e quanto cada opção
// perde para a melhor. Só aparece para as contas liberadas no servidor (ANALYSIS_USERS);
// para as outras o painel nem é desenhado e o servidor recusa o pedido.
import { SUIT_INFO } from '../../shared/engine.js';
import { $, $$, cardName, el, emit, store } from './core.js';

const AUTO_KEY = 'om_analysis_auto';
const OPEN_KEY = 'om_analysis_open';
const DETAILS_KEY = 'om_analysis_details';

let auto = store.get(AUTO_KEY) === '1';
let open = store.get(OPEN_KEY) !== '0';
// A lista de opções aberta. No celular começa fechada: o painel fica numa linha só (a jogada
// sugerida) e não cobre a mesa.
let details = (store.get(DETAILS_KEY) ?? (matchMedia('(max-width: 860px)').matches ? '0' : '1')) === '1';
let situation = null; // a situação analisada (ou sendo analisada) agora
let result = null; // resposta do servidor para `situation`
let pending = false;
const TOP_MOVES = 3; // a lista mostra só as melhores
let lastFeedback = null; // como foi a sua última jogada perto da do bot
let lastAnalysis = null; // a análise da sua última vez (para comparar com o que você fez)

// Mesma vez, mesma mão, mesmo monte: mesma análise.
const situationOf = (g) =>
  `${g.round}|${g.top?.id ?? '-'}|${g.activeSuit}|${g.hasDrawn}|${g.hand.map((c) => c.id).join()}`;

function moveLabel(move, hand) {
  if (move.type === 'draw') return 'Comprar uma carta';
  if (move.type === 'pass') return 'Passar a vez';
  const card = hand.find((c) => c.id === move.cardId);
  const name = card ? cardName(card) : '?';
  return move.suit ? `${name}, pedindo ${SUIT_INFO[move.suit].name}` : name;
}

const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function sameMove(a, b, hand) {
  if (a.type !== b.type) return false;
  if (a.type !== 'play') return true;
  // cartas iguais de baralhos diferentes contam como a mesma jogada
  const ca = hand.find((c) => c.id === a.cardId);
  const cb = hand.find((c) => c.id === b.cardId);
  const same = a.cardId === b.cardId || (ca && cb && ca.rank === cb.rank && ca.suit === cb.suit);
  return !!same && (a.suit ?? null) === (b.suit ?? null);
}

async function request(s) {
  const key = situation;
  pending = true;
  paint(s);
  const res = await emit('game:analyze', {}, { quiet: true });
  if (situation !== key) return; // a vez já mudou
  pending = false;
  result = res.ok ? res : { error: res.error ?? 'Não deu para analisar' };
  if (res.ok) lastAnalysis = { moves: res.moves, hand: [...s.game.hand] };
  paint(s);
}

// Quando a sua jogada chega, compara com a análise que havia.
function noteMyMove(s) {
  if (!lastAnalysis) return;
  const mine = s.events.find(
    (e) => e.playerId === s.me && (e.type === 'play' || e.type === 'draw' || e.type === 'pass'),
  );
  if (!mine) return;
  const suitEvent = s.events.find((e) => e.type === 'suit' && e.playerId === s.me);
  const played =
    mine.type === 'play'
      ? { type: 'play', cardId: mine.card.id, suit: mine.card.rank === '8' ? (suitEvent?.suit ?? null) : null }
      : { type: mine.type };
  const { moves, hand } = lastAnalysis;
  const match = moves.find((m) => sameMove(m, played, hand));
  const best = moves.find((m) => m.best) ?? moves[0];
  lastAnalysis = null;
  if (!best) return;
  if (match?.best) lastFeedback = { good: true, text: 'Você jogou o mesmo que o bot.' };
  else if (match)
    lastFeedback = {
      good: match.loss < 0.5,
      text: `Você: ${moveLabel(match, hand)} (−${fmt(match.loss)}). O bot: ${moveLabel(best, hand)}.`,
    };
  // a última carta (bater) não é analisada: o bot sempre bate
}

function paint(s) {
  const box = $('#analysis');
  const g = s.game;
  const myTurn = g.phase === 'playing' && g.turnId === s.me;
  box.classList.toggle('open', open);
  box.classList.toggle('details', details);
  $('#analysisShow').setAttribute('aria-expanded', String(open));
  $('#analysisDetails').setAttribute('aria-expanded', String(details));
  const auto$ = /** @type {HTMLInputElement} */ ($('#analysisAuto'));
  auto$.checked = auto;
  const body = $('#analysisBody');
  const parts = [];

  // destaque na mão: a carta que o bot jogaria
  for (const node of $$('#hand .card.bot-pick')) node.classList.remove('bot-pick');
  const best = result?.moves?.find((m) => m.best);
  // escondida, nada da análise aparece (nem a marca na mão)
  if (open && myTurn && best?.type === 'play') $(`#hand [data-id="${best.cardId}"]`)?.classList.add('bot-pick');

  // o título é a jogada sugerida: é o que fica à vista com o painel compacto
  $('#analysisTitle').textContent =
    myTurn && pending ? 'Pensando…' : myTurn && best ? moveLabel(best, g.hand) : 'Análise do bot';
  $('#analysisTitle').classList.toggle('analysis-best', !!(myTurn && best));

  if (lastFeedback) parts.push(el('p', `analysis-feedback ${lastFeedback.good ? 'good' : 'bad'}`, lastFeedback.text));

  if (!myTurn) {
    if (details) parts.push(el('p', 'analysis-note', 'Na sua vez, veja o que o bot forte jogaria.'));
  } else if (pending) {
    // o título já diz "Pensando…"
  } else if (result?.error) {
    parts.push(el('p', 'analysis-note', result.error));
  } else if (result?.moves) {
    if (details) appendDetails(parts, result, g);
  } else {
    const ask = el('button', 'btn btn-small', 'O que o bot jogaria?');
    ask.type = 'button';
    ask.addEventListener('click', () => request(state()));
    parts.push(ask);
  }
  body.replaceChildren(...parts);
}

// A lista de opções com quanto cada uma perde para a melhor.
function appendDetails(parts, result, g) {
  const list = el('ol', 'analysis-list');
  for (const m of result.moves.slice(0, TOP_MOVES)) {
    const item = el('li', m.best ? 'best' : '');
    const loss = el('span', 'analysis-loss', m.best ? 'melhor' : `−${fmt(m.loss)}`);
    // a explicação do número fica na dica, para a lista continuar curta
    if (!m.best) loss.title = `Em média, termina a rodada ${fmt(m.loss)} pontos pior que a melhor`;
    item.append(el('span', 'analysis-move', moveLabel(m, g.hand)), loss);
    list.append(item);
  }
  parts.push(list);
}

let current = null;
const state = () => current;

/** Chamado a cada atualização da partida, depois de desenhar a mão. */
export function renderAnalysis(s) {
  const box = $('#analysis');
  current = s;
  if (!s.analyst || !s.game || !s.game.players.some((p) => p.id === s.me)) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const g = s.game;
  const myTurn = g.phase === 'playing' && g.turnId === s.me;
  const now = myTurn ? situationOf(g) : null;
  if (now !== situation) {
    situation = now;
    result = null;
    pending = false;
    if (myTurn) lastFeedback = null; // vez nova: o comentário da anterior já foi visto
  }
  // depois de trocar a situação: comprar e continuar na vez também ganha comentário
  if (s.events.length) noteMyMove(s);
  // última carta e ela serve: não há o que analisar
  const trivial = myTurn && g.hand.length === 1 && g.playable.length === 1;
  // escondida, não pede nada ao servidor (nem com "sempre" marcado)
  if (open && myTurn && !trivial && auto && !result && !pending) request(s);
  else paint(s);
}

// botões do painel (o módulo carrega com a página pronta, como os outros)
{
  const setOpen = (value) => {
    open = value;
    store.set(OPEN_KEY, open ? '1' : '0');
    // ao mostrar, o "sempre" já pede a análise desta vez
    if (current) renderAnalysis({ ...current, events: [] });
    // o foco vai para o botão que desfaz (o que foi clicado sumiu)
    $(open ? '#analysisHide' : '#analysisShow').focus();
  };
  $('#analysisShow').addEventListener('click', () => setOpen(true));
  $('#analysisHide').addEventListener('click', () => setOpen(false));
  $('#analysisDetails').addEventListener('click', () => {
    details = !details;
    store.set(DETAILS_KEY, details ? '1' : '0');
    if (current) paint(current);
  });
  $('#analysisAuto').addEventListener('change', (e) => {
    auto = /** @type {HTMLInputElement} */ (e.target).checked;
    store.set(AUTO_KEY, auto ? '1' : '0');
    if (current) renderAnalysis({ ...current, events: [] });
  });
}
