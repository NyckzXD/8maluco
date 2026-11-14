// Desenha a tela a cada atualização do servidor e anuncia o que aconteceu.
import { SUIT_INFO } from '../../shared/engine.js';
import { sounds } from './audio.js';
import { suitIcon } from './cards.js';
import { cardsLabel, logLine, logPlay } from './chat.js';
import { $, avatarArt, cardName, el, memberOf, nameOf, speak, state } from './core.js';
import { animateDraws, cancelDeal, deal, prepareDeal, runDeal } from './deal.js';
import { renderHand, waveHand } from './hand.js';
import { renderLobby } from './lobby.js';
import { hideModal } from './modals.js';
import { renderCenter } from './pile.js';
import { closeReactMenu } from './reactions.js';
import { renderRoundModal } from './results.js';
import { renderMe, renderScores } from './scores.js';
import { closeSuitModal } from './suit-picker.js';
import { playOrigin, renderSeats, seatCallout, show, showEffectTargets, showGain, tableCallout } from './table.js';

function roundCallout(e, s) {
  tableCallout(`Rodada ${e.round}`, e.starterId === s.me ? 'Você abre o monte' : `${nameOf(e.starterId)} abre o monte`);
}

// Cada coisa que aconteceu aparece onde aconteceu: no assento de quem foi afetado
// ou, se for grande, num letreiro no centro da mesa. Tudo também vai para o log.
function announce(events, g, s) {
  const jokerPlayed = events.some((e) => e.type === 'play' && e.card.rank === 'JOKER');
  for (const e of events) {
    const who = e.playerId === s.me ? 'Você' : nameOf(e.playerId);
    switch (e.type) {
      case 'roundStart':
        // Com a distribuição animada, o letreiro de quem abre o monte só vem no fim dela (renderGame).
        if (!deal) roundCallout(e, s);
        logLine(`— Rodada ${e.round}: ${nameOf(e.dealerId)} deu as cartas —`);
        break;
      case 'play':
        if (e.card.rank === 'JOKER') tableCallout('Joker!', 'Todo mundo compra 1');
        logPlay(who, `jogou ${e.card.rank === 'JOKER' ? 'o Joker' : cardName(e.card)}`);
        break;
      case 'draw':
        logPlay(who, `comprou ${cardsLabel(e.count)}`);
        break;
      case 'skip':
        seatCallout(e.playerId, ['Pulou!'], 'skip');
        speak(who === 'Você' ? 'Você foi pulado' : `${who} foi pulado`);
        logLine(`${who} foi pulado`);
        break;
      case 'penalty': {
        const qty = cardsLabel(e.count);
        // o "+N" no assento mostra a compra (o seu sai aqui; o dos outros, quando as cartas chegam)
        if (e.playerId === s.me && e.count) showGain(s.me, e.count);
        if (!(jokerPlayed && e.reason === 'JOKER')) speak(`${who} compra ${qty}`);
        if (e.count) logPlay(who, `comprou ${qty}`);
        if (e.playerId === s.me) sounds.bad();
        break;
      }
      case 'suit': {
        const suit = SUIT_INFO[e.suit];
        seatCallout(e.playerId, [suitIcon(e.suit, `callout-suit ${suit.color}`), suit.name], 'suit');
        speak(`${who} pediu ${suit.name}`);
        logLine(`${who} pediu ${suit.name}`);
        break;
      }
      case 'pass':
        logLine(`${who} passou a vez`);
        break;
      case 'gameOver':
        sounds.win();
        break;
      case 'roundEnd':
        if (e.winnerId === s.me) sounds.win();
        break;
    }
  }
}

// ---------- última jogada ----------
// Uma linha perto do monte com o que acabou de acontecer ("Robô Cida jogou 9♠ · Você compra 2").
// Fica até a próxima jogada; atualizações sem jogada (chat, tempo) não mexem nela.

// Carta em miniatura: valor e naipe, na cor do naipe.
function cardChip(card) {
  if (card.rank === 'JOKER') return el('b', 'lm-card joker', 'Joker');
  // Na tela "9♠"; para o leitor de tela, o nome inteiro ("9 de Espadas").
  const chip = el('b', `lm-card ${SUIT_INFO[card.suit].color}`);
  chip.append(el('span', null, card.rank), suitIcon(card.suit, 'lm-suit'), el('span', 'sr-only', cardName(card)));
  chip.firstChild.setAttribute('aria-hidden', 'true');
  return chip;
}

// O que cada jogador sofreu na jogada: compras e vez perdida.
function moveEffects(events, s) {
  const hits = new Map();
  for (const e of events) {
    if (e.type !== 'penalty' && e.type !== 'skip') continue;
    const h = hits.get(e.playerId) ?? { count: 0, skipped: false, joker: false };
    if (e.type === 'penalty') {
      h.count += e.count;
      if (e.reason === 'JOKER') h.joker = true;
    } else h.skipped = true;
    hits.set(e.playerId, h);
  }
  const all = [...hits.values()];
  // Joker: todos os outros compram 1.
  if (all.length > 1 && all.every((h) => h.joker && !h.skipped)) return [`todos compram ${all[0].count}`];
  return [...hits].map(([id, h]) => {
    const who = id === s.me ? 'Você' : nameOf(id);
    if (h.count && h.skipped) return `${who} compra ${h.count} e perde a vez`;
    if (h.count) return `${who} compra ${h.count}`;
    return `${who} foi pulado`;
  });
}

// Monta a linha a partir dos eventos desta atualização; null quando não houve jogada.
function describeMove(events, s) {
  const play = events.findLast((e) => e.type === 'play');
  const act = play ?? events.findLast((e) => (e.type === 'draw' || e.type === 'pass') && e.playerId);
  if (!act) return null;
  const line = el('span', 'lm-line');
  const who = el('span', 'lm-who');
  const m = memberOf(act.playerId);
  if (m?.avatar) who.append(avatarArt(m.avatar, { title: m.name }));
  who.append(document.createTextNode(act.playerId === s.me ? 'Você' : nameOf(act.playerId)));
  line.append(who, ' ');
  if (act.type === 'play') {
    line.append('jogou ', cardChip(act.card));
    const after = events.slice(events.indexOf(act) + 1);
    for (const fx of moveEffects(after, s)) line.append(el('span', 'lm-sep', ' · '), el('span', 'lm-fx', fx));
  } else if (act.type === 'draw') line.append(`comprou ${cardsLabel(act.count)}`);
  else line.append('passou a vez');
  return line;
}

function renderLastMove(events, s) {
  const box = $('#lastMove');
  if (events.some((e) => e.type === 'roundStart')) {
    box.replaceChildren();
    return;
  }
  const line = describeMove(events, s);
  if (line) box.replaceChildren(line);
}

function renderGame(prev, s) {
  const g = s.game;
  const myTurn = g.phase === 'playing' && g.turnId === s.me;
  const hit = new Set(s.events.filter((e) => e.type === 'penalty').map((e) => e.playerId));
  const roundStart = s.events.find((e) => e.type === 'roundStart');
  if (roundStart) prepareDeal(g, s);
  else if (deal && (deal.round !== g.round || g.phase !== 'playing')) cancelDeal();
  $('#roundLabel').textContent = `Rodada ${g.round}`;
  renderSeats(g, s, hit);
  const play = prev?.game && s.events.find((e) => e.type === 'play' && e.card.id === g.top?.id);
  renderCenter(prev, g, myTurn, play ? playOrigin(play, s) : null);
  renderHand(prev, g, s, myTurn);
  if (prev?.game) {
    animateDraws(s.events, g, s);
    showEffectTargets(s.events, s);
  }
  renderMe(g, s, myTurn);
  renderScores(g);
  renderRoundModal(g, s);
  if (s.events.length) announce(s.events, g, s);
  if (!prev?.game) $('#lastMove').replaceChildren();
  renderLastMove(s.events, s);
  const wasMyTurn = prev?.game?.phase === 'playing' && prev.game.turnId === s.me;
  const turnAlert = () => {
    sounds.turn();
    navigator.vibrate?.(60);
    waveHand();
  };
  if (roundStart && deal) {
    // Primeiro as cartas chegam a todo mundo; depois o letreiro de quem abre o monte.
    runDeal(g, s, () => {
      roundCallout(roundStart, s);
      if (state?.game?.phase === 'playing' && state.game.turnId === s.me) turnAlert();
    });
  } else if (myTurn && !wasMyTurn) turnAlert();
  if (!myTurn) closeSuitModal({ animate: false });
}

export function render(prev, s) {
  if (!s.game !== !prev?.game) closeReactMenu();
  if (!s.game) {
    cancelDeal();
    hideModal($('#roundModal'));
    show('lobby');
    renderLobby(s);
  } else {
    const entering = $('#game').classList.contains('hidden');
    hideModal('kickModal');
    show('game');
    if (entering) $('#discardPile').dataset.top = '';
    renderGame(prev, s);
  }
}
