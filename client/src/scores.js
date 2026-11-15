// Placar lateral e a sua barra (nome, pontos e aviso da vez).
import { top1Badge } from './cards.js';
import { turnRing } from './clock.js';
import { $, $$, avatar, el, memberOf, state } from './core.js';
import { selectedId } from './hand.js';
import { dealerBadge } from './table.js';

export function renderScores(g) {
  $('#limitLabel').textContent = g.rules.eliminationScore;
  for (const n of $$('.js-limit')) n.textContent = g.rules.eliminationScore;
  const list = $('#scoreList');
  list.replaceChildren();
  const limit = g.rules.eliminationScore;
  for (const p of [...g.players].sort((a, b) => a.eliminated - b.eliminated || a.score - b.score)) {
    const li = el('li', p.eliminated ? 'out' : '');
    // Destaca você e quem está jogando agora.
    const isMe = p.id === state?.me;
    const playing = g.phase === 'playing' && p.id === g.turnId && !p.eliminated;
    if (isMe) li.classList.add('me');
    if (playing) li.classList.add('turn');
    const bar = el('div', 'bar');
    const fill = el('i');
    const pct = Math.min(100, (p.score / limit) * 100);
    fill.style.width = `${pct}%`;
    fill.style.setProperty('--full', `${(100 / Math.max(pct, 1)) * 100}%`);
    bar.append(fill);
    const nm = el('span', 'nm', p.name);
    if (isMe) nm.append(el('small', 'you', ' (você)'));
    // Quanto falta para chegar ao limite (e ser eliminado).
    const left = Math.max(0, limit - p.score);
    const rest = el('span', 'left', p.eliminated ? 'fora' : `faltam ${left}`);
    li.append(avatar(memberOf(p.id), p.name), nm, el('b', null, p.score), bar, rest);
    if (playing) li.title = 'Jogando agora';
    list.append(li);
  }
}

export function renderMe(g, s, myTurn) {
  const me = g.players.find((p) => p.id === s.me);
  const info = $('#meInfo');
  info.replaceChildren();
  info.classList.toggle('turn', myTurn);
  if (me) {
    const av = avatar(memberOf(me.id), me.name);
    if (myTurn) av.prepend(turnRing());
    // os pontos aqui só aparecem no celular; no desktop eles ficam no #meScore, à direita
    const label = el('span', null, 'Você');
    if (memberOf(me.id)?.top1) label.prepend(top1Badge(), ' ');
    label.append(el('span', 'me-pts', ` · ${me.score} pts`));
    info.append(av, label);
    if (me.id === g.dealerId) info.append(dealerBadge());
    // ausente: fica à vista enquanto durar (o aviso que aparece some sozinho)
    if (memberOf(me.id)?.away && !me.eliminated)
      info.append(el('span', 'away-note', 'Ausente · toque na tela para voltar'));
  }
  renderMeScore(g, me);
  // quem só assiste não tem barra própria: a placa "Plateia" fica no lugar da mão

  renderBanner(g, myTurn);
  $('#passBtn').classList.toggle('hidden', !(myTurn && g.hasDrawn));
}

// Seus pontos até o limite, no canto direito da sua barra: "12 / 100" e a barra enchendo.
function renderMeScore(g, me) {
  const box = $('#meScore');
  if (!me || me.eliminated) {
    box.replaceChildren();
    return;
  }
  const limit = g.rules.eliminationScore;
  const pct = Math.min(100, (me.score / limit) * 100);
  const label = el('span', 'me-score-label');
  label.append(el('span', 'me-score-cap', 'Seus pontos'), el('b', null, me.score), ` / ${limit}`);
  const bar = el('span', 'me-score-bar');
  const fill = el('i');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  bar.classList.toggle('danger', limit - me.score <= 20);
  box.title = `Faltam ${Math.max(0, limit - me.score)} pontos para o limite`;
  box.replaceChildren(label, bar);
}

export function renderBanner(g, myTurn) {
  const banner = $('#turnBanner');
  const text = !myTurn
    ? ''
    : selectedId
      ? 'Toque de novo para jogar'
      : g.hasDrawn
        ? 'Jogue a carta comprada ou passe a vez'
        : g.playable.length
          ? g.top
            ? 'Sua vez! Escolha uma carta'
            : 'Você abre o monte! Jogue qualquer carta'
          : 'Sua vez! Sem jogada, compre do baralho';
  // O banner é anunciado (aria-live): só troca o texto quando ele muda, para não repetir a cada atualização.
  if (banner.textContent !== text) banner.textContent = text;
}

// Números que sobem contando (pontos da rodada e total). Com movimento reduzido, ou se a
// página estiver em segundo plano, o valor final é garantido pelo setTimeout do fim.
