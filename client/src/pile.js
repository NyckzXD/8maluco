// Monte de descarte e baralho no centro da mesa, com o efeito das cartas especiais.
import { SUIT_INFO } from '../../shared/engine.js';
import { sounds } from './audio.js';
import { renderCard, suitIcon } from './cards.js';
import { $, $$, RANK_NAMES, el, nameOf } from './core.js';
import { deal } from './deal.js';
import { syncDiscardTarget } from './hand.js';
import { reducedMotion } from './suit-picker.js';
import { cardRotation, centerOf, fly } from './table.js';

// Efeito da carta especial quando ela pousa no monte: o Ás pula, o 8 gira e solta a pinta
// pedida, o 7 e o 9 batem com uma onda vermelha, o Joker balança com uma onda dourada.
const CARD_FX = {
  A: 'fx-hop',
  8: 'fx-spin',
  7: 'fx-thump',
  9: 'fx-thump',
  JOKER: 'fx-wobble',
};
function cardFx(card, top, g) {
  const fx = CARD_FX[top.rank];
  if (!fx || !card.isConnected || reducedMotion()) return;
  const pile = $('#discardPile');
  card.classList.remove('new');
  card.classList.add(fx);
  card.addEventListener('animationend', () => card.classList.remove(fx), {
    once: true,
  });
  const burst = (node) => {
    pile.append(node);
    setTimeout(() => node.remove(), 1200);
  };
  if (top.rank === '7' || top.rank === '9') burst(el('span', 'fx-ring'));
  if (top.rank === 'JOKER') burst(el('span', 'fx-ring gold'));
  if (top.rank === '8' && SUIT_INFO[g.activeSuit]) {
    const glyph = suitIcon(g.activeSuit, `fx-suit ${SUIT_INFO[g.activeSuit].color}`);
    burst(glyph);
  }
}

export function renderCenter(prev, g, myTurn, origin) {
  const drawPile = $('#drawPile');
  $('#drawCount').textContent = deal ? deal.draw : g.drawCount;
  drawPile.setAttribute('aria-label', `Comprar carta (${g.drawCount} no baralho)`);
  const canDraw = myTurn && !g.hasDrawn;
  drawPile.disabled = !canDraw;
  // Comprar sempre é permitido na sua vez, mas o baralho só chama atenção quando não há jogada.
  drawPile.classList.toggle('can-draw', canDraw && !g.playable.length);

  const discard = $('#discardPile');
  const prevTop = prev?.game?.top?.id;
  if (!g.top) {
    // só o contorno: o selo embaixo já diz quem abre o monte
    discard.replaceChildren(el('div', 'empty-pile'));
    discard.dataset.top = '';
  } else if (discard.dataset.top !== g.top.id) {
    const card = renderCard(g.top);
    card.style.setProperty('--rot', `${cardRotation(g.top.id)}deg`);
    card.style.transform = `rotate(${cardRotation(g.top.id)}deg)`;
    // Mantém as duas cartas de baixo aparecendo, para o monte parecer uma pilha.
    if (prevTop && prev.game.round === g.round) {
      discard.querySelector('.empty-pile')?.remove();
      const under = $$('.card', discard);
      under.slice(0, -2).forEach((c) => c.remove());
      for (const c of under) c.classList.remove('new', 'incoming');
      discard.append(card);
    } else discard.replaceChildren(card);
    discard.dataset.top = g.top.id;
    const top = g.top;
    if (origin)
      fly({
        card: top,
        from: origin,
        to: centerOf(discard, { rot: cardRotation(top.id) }),
        flip: origin.flip,
        hide: card,
        onLand: () => {
          sounds.card();
          cardFx(card, top, g);
        },
      });
    else if (prevTop && prevTop !== top.id) {
      card.classList.add('new');
      sounds.card();
      setTimeout(() => cardFx(card, top, g), 350);
    }
  }

  const badge = $('#activeSuit');
  const suit = SUIT_INFO[g.activeSuit];
  badge.replaceChildren();
  if (!suit) {
    const text = g.top
      ? 'Joker: qualquer carta vale'
      : myTurn
        ? 'Abra o monte com qualquer carta'
        : `${nameOf(g.turnId)} vai abrir o monte`;
    badge.append(document.createTextNode(text));
  } else {
    const sym = el('b', suit.color === 'red' ? 'red' : '');
    sym.append(suitIcon(g.activeSuit, 'badge-suit'));
    const onJoker = g.top?.rank === 'JOKER';
    const label = onJoker ? 'Continua' : g.activeRank === '8' ? 'Pediu' : 'Naipe';
    // Sobre o Joker o número de baixo também vale (o 8 entra em tudo, então não precisa dizer).
    const rank =
      onJoker && g.activeRank && g.activeRank !== '8' ? ` ou ${RANK_NAMES[g.activeRank] ?? g.activeRank}` : '';
    badge.append(document.createTextNode(`${label}: `), sym, document.createTextNode(` ${suit.name}${rank}`));
  }
  badge.classList.toggle('changed', g.activeRank === '8' || g.top?.rank === 'JOKER');
  syncDiscardTarget();
}
