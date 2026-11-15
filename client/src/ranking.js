// Ranking de vitórias: os primeiros colocados e, com conta, a sua posição.
import { RANKED_RULE } from '../../shared/ranking.js';
import { api, openAccount, user } from './account.js';
import { $, avatar, el } from './core.js';
import { closeModal, openModal } from './modals.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Uma linha: posição, avatar, apelido (com partidas e rodadas) e vitórias.
function row(r, tag = 'li') {
  const li = el(tag, 'rank-row');
  const pos = el('span', 'rank-pos', `${r.rank}º`);
  const name = el('span', 'rank-name');
  name.append(
    el('b', null, r.nickname),
    el(
      'small',
      null,
      `${plural(r.games, 'partida', 'partidas')} · ${plural(r.rounds, 'rodada batida', 'rodadas batidas')}`,
    ),
  );
  const wins = el('span', 'rank-wins');
  wins.append(el('b', null, String(r.wins)), el('small', null, r.wins === 1 ? 'vitória' : 'vitórias'));
  li.append(pos, avatar({ name: r.nickname, avatar: r.avatar }), name, wins);
  li.setAttribute(
    'aria-label',
    `${r.rank}º lugar: ${r.nickname}, ${plural(r.wins, 'vitória', 'vitórias')} em ${plural(r.games, 'partida', 'partidas')}`,
  );
  return li;
}

async function loadRanking() {
  const list = $('#rankingList');
  const me = $('#rankingMe');
  const res = await api('GET', '/leaderboard?limit=50');
  if ($('#rankingModal').classList.contains('hidden')) return;
  list.replaceChildren();
  me.replaceChildren();
  if (!res.ok) {
    list.append(el('li', 'empty', res.error ?? 'Não deu para carregar o ranking.'));
    me.classList.add('hidden');
    return;
  }
  if (!res.top.length) {
    const empty = el('li', 'empty');
    empty.append(el('b', null, 'Ninguém no ranking ainda'), el('span', null, 'Junte a galera e seja o primeiro!'));
    list.append(empty);
  }
  for (const r of res.top) {
    const li = row(r);
    if (user && r.id === user.id) li.classList.add('mine');
    list.append(li);
  }

  // Embaixo do título: você (se ficou fora dos primeiros) ou o convite para ter conta.
  const inTop = res.me && res.top.some((r) => r.id === res.me.id);
  if (!user) {
    const join = el('button', 'btn btn-small btn-primary', 'Entrar ou criar conta');
    join.type = 'button';
    join.addEventListener('click', () => {
      closeModal('rankingModal');
      openAccount();
    });
    me.append(el('p', null, 'Entre numa conta para suas vitórias aparecerem aqui.'), join);
  } else if (!res.me) me.append(el('p', null, 'Você ainda não jogou nenhuma partida que vale. Bora jogar!'));
  else if (!inTop) me.append(el('p', null, 'Sua posição'), row(res.me, 'div'));
  me.classList.toggle('hidden', !me.children.length);
}

$('#rankingDesc').textContent = RANKED_RULE;
$('#rankingBtn').addEventListener('click', () => {
  $('#rankingList').replaceChildren();
  $('#rankingMe').classList.add('hidden');
  openModal('rankingModal');
  loadRanking();
});
$('#refreshRanking').addEventListener('click', loadRanking);
