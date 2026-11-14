// Resultado da rodada, fim de partida e revanche.
import { icon, renderCard, sortHand } from './cards.js';
import { $, $$, avatar, el, emit, memberOf, nameOf } from './core.js';
import { hideModal, openModal } from './modals.js';
import { reducedMotion } from './suit-picker.js';

function countUp(node, from, to, { delay = 0, duration = 600, prefix = '' } = {}) {
  node.textContent = `${prefix}${from}`;
  if (from === to || reducedMotion()) {
    node.textContent = `${prefix}${to}`;
    return;
  }
  const start = performance.now() + delay;
  const step = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    node.textContent = `${prefix}${Math.round(from + (to - from) * (1 - (1 - t) ** 3))}`;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => (node.textContent = `${prefix}${to}`), delay + duration + 50);
}

// Linha do jogador no resultado: avatar e nome, a mão que sobrou, os pontos e a barra até o limite.
// Os tempos de cada pedaço vêm de --i (ordem da linha) e --c (ordem da carta), no CSS.
let shownRound = null; // rodada cujo resultado já foi animado (só anima uma vez)
function resultRow(r, i, lr, g, s, limit) {
  const out = r.earlier || lr.eliminated.includes(r.playerId);
  const winner = r.playerId === lr.winnerId;
  const li = el('li', `res-row${winner ? ' winner' : ''}${out ? ' out' : ''}${r.playerId === s.me ? ' me' : ''}`);
  li.dataset.id = r.playerId;
  li.style.setProperty('--i', i);

  const who = el('div', 'res-who');
  const name = el('div', 'res-name');
  name.append(el('span', null, r.playerId === s.me ? 'Você' : nameOf(r.playerId)), el('span', 'res-tag'));
  who.append(avatar(memberOf(r.playerId), nameOf(r.playerId)), name);

  const hand = el('div', 'res-hand mini-hand');
  const cards = sortHand(r.hand);
  if (cards.length)
    cards.forEach((c, n) => {
      const card = renderCard(c);
      card.style.setProperty('--c', n);
      hand.append(card);
    });
  else if (r.earlier) hand.append(el('span', 'res-gone', 'Saiu numa rodada anterior'));
  else hand.append(el('span', 'res-empty', 'Sem cartas'));

  // os pontos entram depois que as cartas viraram
  const flipMs = 260 + i * 220 + cards.length * 70;
  const pts = el('b', 'res-pts');
  // quem saiu numa rodada anterior não fez pontos nesta: só o traço
  if (r.earlier) pts.textContent = '–';
  else countUp(pts, 0, r.points, { delay: flipMs, duration: 450, prefix: '+' });

  const before = r.total - r.points;
  const pct = (v) => `${Math.min(100, (v / limit) * 100)}%`;
  const bar = el('div', 'res-bar');
  const fill = el('i');
  fill.style.setProperty('--from', pct(before));
  fill.style.setProperty('--to', pct(r.total));
  bar.append(fill);
  const total = el('b', 'res-total');
  countUp(total, before, r.total, { delay: flipMs + 250, duration: 700 });
  const score = el('div', 'res-score');
  score.append(bar, total);
  li.style.setProperty('--flip', `${flipMs}ms`);

  li.append(who, hand, pts, score);
  // carimbo embaixo do nome
  if (out) name.append(el('span', 'res-stamp', 'Fora!'));
  if (winner) name.append(el('span', 'res-stamp gold', 'Bateu!'));
  syncReadyTag(li, s);
  return li;
}

// Selo de cada linha: "pronto" entre rodadas; quem bateu ou caiu fora já tem o carimbo.
function syncReadyTag(li, s) {
  const tag = $('.res-tag', li);
  const ready = s.ready.includes(li.dataset.id) && !li.classList.contains('out');
  tag.replaceChildren(...(ready ? [icon('check'), ' pronto'] : []));
  tag.classList.toggle('ready', ready);
}

// Três pontinhos que pulam, para os textos de espera.
function waitDots() {
  const dots = el('span', 'dots');
  dots.setAttribute('aria-hidden', 'true');
  dots.append(el('i'), el('i'), el('i'));
  return dots;
}

export function renderRoundModal(g, s) {
  const modal = $('#roundModal');
  const lr = g.lastRound;
  if (!lr || (g.phase !== 'roundOver' && g.phase !== 'gameOver')) {
    // partida nova (revanche) ainda sem resultado: o próximo resultado anima de novo,
    // mesmo que caia na mesma rodada em que a partida anterior terminou
    if (!lr) shownRound = null;
    hideModal(modal);
    return;
  }
  const over = g.phase === 'gameOver';
  const limit = g.rules.eliminationScore;
  const key = `${lr.round}:${g.phase}`;
  const rows = $('#roundRows');

  if (key !== shownRound) {
    // Primeira vez deste resultado: monta tudo e deixa a animação correr.
    shownRound = key;
    const winnerName = (id) => (id === s.me ? 'Você' : nameOf(id));
    $('#roundTitle').replaceChildren(
      ...(over
        ? [icon('trophy', 'trophy'), ` ${winnerName(g.winnerId)} venceu o jogo!`]
        : [`${winnerName(lr.winnerId)} bateu!`]),
    );
    $('#roundSub').textContent = over
      ? `Fim de jogo na rodada ${lr.round}. Os outros chegaram a ${limit} pontos.`
      : `Fim da rodada ${lr.round}. Quem chegar a ${limit} pontos está fora.`;
    modal.classList.toggle('game-over', over);
    rows.replaceChildren();
    rows.classList.remove('settled');
    const results = [...lr.results].sort(
      (a, b) => Number(b.playerId === lr.winnerId) - Number(a.playerId === lr.winnerId) || a.points - b.points,
    );
    // No fim de jogo entram também os que caíram fora antes (não jogaram a última rodada).
    if (over) {
      const inRound = new Set(results.map((r) => r.playerId));
      g.players
        .filter((p) => !inRound.has(p.id))
        .sort((a, b) => a.score - b.score)
        .forEach((p) =>
          results.push({
            playerId: p.id,
            points: 0,
            total: p.score,
            hand: [],
            earlier: true,
          }),
        );
    }
    results.forEach((r, i) => rows.append(resultRow(r, i, lr, g, s, limit)));
  } else {
    // O mesmo resultado de novo (alguém clicou em "pronto"): só atualiza os selos, sem repetir a animação.
    for (const li of $$('.res-row', rows)) syncReadyTag(li, s);
  }

  $('#gameOverActions').classList.toggle('hidden', !over);
  // voltar para a sala continua com o anfitrião, como opção secundária
  $('#againBtn').classList.toggle('hidden', s.hostId !== s.me);
  if (over) {
    $('#roundFooter').replaceChildren();
    $('#roundFooter').dataset.text = '';
    renderRematch(s);
  }

  // Entre rodadas: a próxima só começa quando todo mundo que ainda está na mesa clicar em "pronto".
  const playing = g.players.some((p) => p.id === s.me && !p.eliminated);
  const imReady = s.ready.includes(s.me);
  $('#readyActions').classList.toggle('hidden', over || !playing);
  $('#readyBtn').disabled = imReady;
  $('#readyBtn').replaceChildren(...(imReady ? [icon('check'), 'Pronto!'] : ['Estou pronto!']));
  if (!over) {
    const waiting = s.waitingOn.filter((id) => id !== s.me).map(nameOf);
    const text = !waiting.length
      ? imReady || !playing
        ? 'Começando a próxima rodada'
        : 'Só falta você!'
      : `Esperando ${waiting.join(', ')} ficar${waiting.length > 1 ? 'em' : ''} pronto${waiting.length > 1 ? 's' : ''}`;
    const footer = $('#roundFooter');
    // só troca quando o texto muda, para as reticências não recomeçarem a cada atualização
    if (footer.dataset.text !== text) {
      footer.dataset.text = text;
      footer.replaceChildren(text);
      if (text !== 'Só falta você!') footer.append(waitDots());
    }
  }
  // Abre só depois de montar, para o foco cair no botão certo (pronto / voltar para a sala).
  openModal('roundModal');
}

// Revanche: sozinho com bots, "Jogar de novo" recomeça na hora; com mais humanos na sala o
// botão vira um "pronto" e a partida nova começa quando todos estiverem prontos (o servidor
// decide, em Room.rematch). Quem caiu não segura.
function renderRematch(s) {
  const humans = s.members.filter((m) => !m.isBot && m.connected);
  const solo = humans.length <= 1;
  const imReady = s.rematch?.includes(s.me);
  const btn = $('#rematchBtn');
  btn.disabled = !!imReady;
  btn.replaceChildren(
    ...(solo
      ? [icon('refresh'), 'Jogar de novo']
      : imReady
        ? [icon('check'), 'Pronto!']
        : [icon('refresh'), 'Pronto para a revanche']),
  );
  const waiting = (s.rematchWaitingOn ?? []).filter((id) => id !== s.me).map(nameOf);
  const text = solo
    ? ''
    : !imReady
      ? waiting.length && s.rematch?.length
        ? `${s.rematch.length} de ${humans.length} prontos para a revanche`
        : 'Mesma mesa, partida nova: começa quando todos estiverem prontos'
      : waiting.length
        ? `Esperando ${waiting.join(', ')} ficar${waiting.length > 1 ? 'em' : ''} pronto${waiting.length > 1 ? 's' : ''}`
        : 'Começando a revanche';
  const line = $('#rematchWait');
  // só troca quando o texto muda, para as reticências não recomeçarem a cada atualização
  if (line.dataset.text !== text) {
    line.dataset.text = text;
    line.replaceChildren(text);
    if (imReady && text) line.append(waitDots());
  }
}

$('#rematchBtn').addEventListener('click', () => emit('game:rematch'));
$('#againBtn').addEventListener('click', () => emit('room:lobby'));
$('#readyBtn').addEventListener('click', () => emit('game:ready'));
