// Multiplayer de ponta a ponta (40): servidor de verdade numa porta qualquer e 2 ou 3 clientes
// socket.io reais, como navegadores. As regras de sala estão em rooms.test.js; aqui é a rede.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/index.js';

let srv;
let url;
const sockets = [];

before(async () => {
  // o anfitrião passa o cargo em 200ms em vez de 5s, para o teste não esperar à toa
  srv = createGameServer({ timing: { hostGraceMs: 200 } });
  await new Promise((resolve) => srv.server.listen(0, resolve));
  url = `http://localhost:${srv.server.address().port}`;
});

after(async () => {
  for (const s of sockets) s.close();
  for (const code of [...srv.rooms.rooms.keys()]) srv.rooms.delete(code);
  srv.io.close();
  await new Promise((resolve) => srv.server.close(resolve));
});

async function socket() {
  const s = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  await new Promise((resolve) => s.once('connect', resolve));
  return s;
}

// Um jogador: a conexão, tudo o que chegou dele em 'state' e helpers para esperar.
async function player(name, token = `tok-${name}-${Math.random()}`) {
  const s = await socket();
  const p = { s, name, token, states: [], chat: [] };
  s.on('state', (st) => p.states.push(st));
  s.on('chat', (m) => p.chat.push(m));
  p.state = () => p.states.at(-1);
  p.call = (event, data) => s.timeout(2000).emitWithAck(event, data);
  p.create = () => p.call('room:create', { token, name });
  p.join = (code) => p.call('room:join', { code, token, name });
  // espera até o estado mais recente satisfazer `pred`
  p.until = (pred, ms = 3000) =>
    new Promise((resolve, reject) => {
      if (p.state() && pred(p.state())) return resolve(p.state());
      const timer = setTimeout(() => reject(new Error(`${name}: estado esperado não chegou`)), ms);
      const check = (st) => {
        if (!pred(st)) return;
        clearTimeout(timer);
        s.off('state', check);
        resolve(st);
      };
      s.on('state', check);
    });
  return p;
}

const call = (s, event, ...args) => s.timeout(2000).emitWithAck(event, ...args);
const next = (s, event) => new Promise((resolve) => s.once(event, resolve));
const handIds = (st) => st.game.hand.map((c) => c.id);
const seatId = (p) => p.state().me;

test('criar e entrar pelo código: todos recebem o estado da sala', async () => {
  const ana = await player('Ana');
  const created = await ana.create();
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z2-9]{5}$/);

  const bia = await player('Bia');
  // código digitado em minúsculas também vale
  assert.equal((await bia.join(created.code.toLowerCase())).ok, true);

  for (const p of [ana, bia]) {
    const st = await p.until((s) => s.members.length === 2);
    assert.equal(st.code, created.code);
    assert.deepEqual(
      st.members.map((m) => m.name),
      ['Ana', 'Bia'],
    );
    assert.equal(st.hostId, ana.state().me);
  }
  assert.notEqual(seatId(ana), seatId(bia));
  // o chat de um chega para o outro
  await ana.call('chat', { text: 'bora jogar' });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(bia.chat.some((m) => m.text === 'bora jogar' && m.from === 'Ana'));
  assert.deepEqual((await (await player('Caio')).join('ZZZZZ')).error, 'Sala não encontrada');
});

test('partida: cada um recebe só a própria mão', async () => {
  const ana = await player('Ana');
  const { code } = await ana.create();
  const bia = await player('Bia');
  const caio = await player('Caio');
  await bia.join(code);
  await caio.join(code);
  assert.equal((await ana.call('room:start')).ok, true);
  const all = [ana, bia, caio];
  for (const p of all) await p.until((s) => s.game?.hand.length === 9);

  // as três mãos são diferentes e ninguém vê carta de outro em nada que chegou pela rede
  for (const p of all) {
    const mine = handIds(p.state());
    // controle: a busca acha as cartas nos dados do próprio dono (senão o teste abaixo passaria à toa)
    assert.ok(JSON.stringify(p.states).includes(`"id":"${mine[0]}"`));
    for (const other of all.filter((o) => o !== p)) {
      const theirs = new Set(handIds(other.state()));
      assert.ok(
        mine.every((id) => !theirs.has(id)),
        'mãos sem cartas em comum',
      );
      const everything = JSON.stringify(other.states);
      for (const id of mine)
        assert.ok(!everything.includes(`"id":"${id}"`), `${other.name} recebeu a carta ${id} de ${p.name}`);
    }
    // dos outros, só a contagem
    for (const seat of p.state().game.players) {
      assert.equal(seat.hand, undefined);
      assert.equal(seat.cardCount, 9);
    }
  }
  // e só quem tem a vez recebe a lista de jogáveis
  const turnId = ana.state().game.turnId;
  for (const p of all) if (seatId(p) !== turnId) assert.deepEqual(p.state().game.playable, []);
});

test('reconectar com o mesmo token mantém o lugar e as cartas', async () => {
  const ana = await player('Ana');
  const { code } = await ana.create();
  const bia = await player('Bia', 'tok-bia-volta');
  await bia.join(code);
  await ana.call('room:start');
  const before = await bia.until((s) => s.game?.hand.length === 9);
  const id = before.me;
  const hand = handIds(before);

  bia.s.close(); // caiu (fechou o app, perdeu o sinal...)
  await ana.until((s) => s.members.find((m) => m.id === id)?.connected === false);

  const back = await player('Bia', 'tok-bia-volta');
  assert.equal((await back.join(code)).ok, true);
  const st = await back.until((s) => s.game?.hand.length > 0);
  assert.equal(st.me, id, 'mesmo lugar');
  assert.deepEqual(handIds(st), hand, 'mesmas cartas');
  await ana.until((s) => s.members.find((m) => m.id === id)?.connected === true);
  assert.equal(ana.state().members.length, 2, 'não virou outro jogador');
});

test('segunda aba com o mesmo token assume o lugar e a primeira perde o acesso (27)', async () => {
  const first = await player('Bia', 'tok-abas');
  const created = await first.create();
  const room = srv.rooms.get(created.code);

  const second = await player('Bia', 'tok-abas');
  const replaced = next(first.s, 'room:replaced');
  assert.equal((await second.join(created.code)).ok, true);
  assert.deepEqual(await replaced, { code: created.code });
  assert.equal(room.members.length, 1, 'continua sendo um jogador só');

  // a aba antiga não fala nem mexe mais na sala
  assert.equal((await first.call('chat', { text: 'oi' })).ok, false);
  assert.equal((await first.call('room:addBot')).ok, false);
  assert.equal(room.members.length, 1);
  // e a nova continua no comando
  assert.equal((await second.call('room:addBot')).ok, true);
  assert.equal(room.members.length, 2);

  // a queda da aba antiga não desconecta o jogador
  first.s.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(room.members.find((m) => !m.isBot).connected, true);
});

test('anfitrião cai e o cargo passa para o próximo humano (28)', async () => {
  const ana = await player('Ana');
  const { code } = await ana.create();
  const bia = await player('Bia');
  const caio = await player('Caio');
  await bia.join(code);
  await caio.join(code);
  const biaId = (await bia.until((s) => s.members.length === 3)).me;

  ana.s.close();
  for (const p of [bia, caio]) await p.until((s) => s.hostId === biaId);
  assert.ok(caio.chat.some((m) => m.system && m.text === 'Bia agora é o anfitrião'));
  // a Bia já consegue fazer o que só o anfitrião faz
  assert.equal((await bia.call('room:addBot')).ok, true);
  assert.equal((await caio.call('room:addBot')).ok, false);
});

test('quem entra no meio da partida vira plateia (34)', async () => {
  const ana = await player('Ana');
  const { code } = await ana.create();
  const bia = await player('Bia');
  await bia.join(code);
  await ana.call('room:start');

  const caio = await player('Caio');
  const res = await caio.join(code);
  assert.deepEqual(res, { ok: true, code, spectator: true });
  const st = await caio.until((s) => s.game);
  assert.deepEqual(st.spectators, [st.me]);
  assert.deepEqual(st.game.hand, []);
  assert.ok(!st.game.players.some((p) => p.id === st.me));
  // e não consegue jogar
  assert.equal((await caio.call('game:draw')).ok, false);
  // a lista de salas mostra que dá para assistir
  const { rooms } = await caio.call('room:list');
  const listed = rooms.find((r) => r.code === code);
  assert.equal(listed.playing, true);
  assert.equal(listed.watching, 1);
});

test('mensagens malformadas respondem erro e não derrubam o servidor (26)', async () => {
  const s = await socket();
  const events = [
    'room:list',
    'room:create',
    'room:join',
    'room:leave',
    'room:addBot',
    'room:kick',
    'room:settings',
    'room:start',
    'room:lobby',
    'game:rematch',
    'chat',
    'reaction',
    'game:play',
    'game:draw',
    'game:pass',
    'game:ready',
    'presence',
  ];
  const payloads = [null, 42, 'texto', [1, 2], { code: { a: 1 }, token: ['x'], name: 7 }, { text: null }];
  for (const event of events) {
    for (const payload of payloads) {
      const res = await call(s, event, payload);
      assert.equal(typeof res.ok, 'boolean', `${event} com ${JSON.stringify(payload)}`);
    }
    s.emit(event, null); // sem ack também não pode derrubar
  }
  // ainda de pé: dois jogadores novos criam e entram numa sala normalmente
  const ana = await player('Ana');
  const { code, ok } = await ana.create();
  assert.equal(ok, true);
  assert.equal((await (await player('Bia')).join(code)).ok, true);
});
