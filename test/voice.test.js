// Chat de voz: o servidor só apresenta os pares (entrar, sair, mutar) e repassa a negociação
// do WebRTC. Regras da sala com io de mentira; no fim, o caminho de ponta a ponta pela rede.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { RoomManager } from '../server/rooms.js';
import { createGameServer, configFromEnv } from '../server/index.js';
import { SDP_MAX, cleanSignal, iceServers } from '../server/voice.js';

function fakeIo() {
  const sent = [];
  return {
    sent,
    to: (target) => ({ emit: (event, payload) => sent.push({ target, event, payload }) }),
    emit() {},
    sockets: { sockets: new Map() },
  };
}

const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });

const OFFER = { description: { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' } };
const CANDIDATE = {
  candidate: {
    candidate: 'candidate:1 1 udp 2122260223 10.0.0.2 54321 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: 'abcd',
  },
};

// Sala com Ana, Bia e Caio (sockets s-ana, s-bia, s-caio) e um bot.
function setup(options = {}) {
  const io = fakeIo();
  const manager = new RoomManager(io, options);
  const room = manager.create();
  const ids = {};
  for (const name of ['Ana', 'Bia', 'Caio']) {
    assert.ok(room.join(fakeSocket(`s-${name}`), { token: `tok-${name}`, name }).ok);
    ids[name] = room.members.at(-1).id;
  }
  room.addBot(ids.Ana);
  const bot = room.members.find((m) => m.isBot).id;
  const to = (socketId, event) => io.sent.filter((s) => s.target === socketId && s.event === event);
  const lastState = (name) => to(`s-${name}`, 'state').at(-1).payload;
  return { io, room, ids, bot, to, lastState, done: () => room.dispose() };
}

test('entrar no voz: devolve quem já está e aparece no estado da sala', () => {
  const { room, ids, bot, lastState, done } = setup();
  const ana = room.voiceJoin(ids.Ana);
  assert.equal(ana.ok, true);
  assert.deepEqual(ana.peers, []);
  assert.deepEqual(room.voiceJoin(ids.Bia, { muted: true }).peers, [ids.Ana]);
  // entrar de novo (depois de reconectar, por exemplo) não muda nada e dá a lista de novo
  assert.deepEqual(room.voiceJoin(ids.Ana).peers, [ids.Bia]);

  const members = lastState('Caio').members;
  const byId = (id) => members.find((m) => m.id === id);
  assert.deepEqual([byId(ids.Ana).voice, byId(ids.Ana).voiceMuted], [true, false]);
  assert.deepEqual([byId(ids.Bia).voice, byId(ids.Bia).voiceMuted], [true, true]);
  assert.equal(byId(ids.Caio).voice, false);

  // bot e quem não está na sala não entram
  assert.equal(room.voiceJoin(bot).ok, false);
  assert.equal(room.voiceJoin('ninguem').ok, false);
  done();
});

test('mutar só vale para quem está no voz', () => {
  const { room, ids, lastState, done } = setup();
  assert.equal(room.voiceMute(ids.Ana, true).ok, false);
  room.voiceJoin(ids.Ana);
  assert.equal(room.voiceMute(ids.Ana, true).ok, true);
  assert.equal(lastState('Bia').members.find((m) => m.id === ids.Ana).voiceMuted, true);
  assert.equal(room.voiceMute(ids.Ana, false).ok, true);
  assert.equal(lastState('Bia').members.find((m) => m.id === ids.Ana).voiceMuted, false);
  done();
});

test('sinal vai só para o destino, com o id de quem mandou e sem campo extra', () => {
  const { room, ids, to, done } = setup();
  room.voiceJoin(ids.Ana);
  room.voiceJoin(ids.Bia);
  const data = { ...OFFER, evil: '<script>', description: { ...OFFER.description, extra: 1 } };
  assert.deepEqual(room.voiceSignal(ids.Ana, { to: ids.Bia, data }), { ok: true });
  assert.deepEqual(to('s-Bia', 'voice:signal'), [
    { target: 's-Bia', event: 'voice:signal', payload: { from: ids.Ana, ...OFFER } },
  ]);
  assert.deepEqual(room.voiceSignal(ids.Bia, { to: ids.Ana, data: CANDIDATE }), { ok: true });
  assert.deepEqual(to('s-Ana', 'voice:signal').at(-1).payload, { from: ids.Bia, ...CANDIDATE });
  assert.equal(to('s-Caio', 'voice:signal').length, 0);
  done();
});

test('sinal recusado: fora do voz, para si, para quem não está no voz ou conteúdo inválido', () => {
  const { room, ids, bot, to, done } = setup();
  // Caio não entrou no voz: não manda nem recebe
  assert.equal(room.voiceSignal(ids.Caio, { to: ids.Ana, data: OFFER }).ok, false);
  room.voiceJoin(ids.Ana);
  assert.equal(room.voiceSignal(ids.Ana, { to: ids.Caio, data: OFFER }).ok, false);
  assert.equal(room.voiceSignal(ids.Ana, { to: ids.Ana, data: OFFER }).ok, false);
  assert.equal(room.voiceSignal(ids.Ana, { to: bot, data: OFFER }).ok, false);
  assert.equal(room.voiceSignal(ids.Ana, { to: 42, data: OFFER }).ok, false);
  room.voiceJoin(ids.Bia);
  for (const data of [null, 'oi', {}, { description: { type: 'rollback', sdp: 'x' } }, { candidate: 'x' }]) {
    const r = room.voiceSignal(ids.Ana, { to: ids.Bia, data });
    assert.equal(r.ok, false, JSON.stringify(data));
    assert.match(r.error, /inválida/);
  }
  assert.equal(to('s-Bia', 'voice:signal').length, 0);
  assert.equal(to('s-Caio', 'voice:signal').length, 0);
  done();
});

test('sair do voz, cair, sair da sala ou ser removido avisa quem ficou no voz', () => {
  const { room, ids, to, done } = setup();
  for (const name of ['Ana', 'Bia', 'Caio']) room.voiceJoin(ids[name]);
  const leftFor = (name) => to(`s-${name}`, 'voice:peer-left').map((s) => s.payload.id);

  room.voiceLeave(ids.Caio);
  assert.deepEqual(leftFor('Ana'), [ids.Caio]);
  assert.deepEqual(leftFor('Bia'), [ids.Caio]);
  assert.deepEqual(leftFor('Caio'), [], 'quem saiu não recebe o próprio aviso');
  // sair de novo não avisa de novo
  room.voiceLeave(ids.Caio);
  assert.deepEqual(leftFor('Ana'), [ids.Caio]);

  // queda: a conexão de voz era daquela conexão
  room.disconnect(ids.Bia, 's-Bia');
  assert.deepEqual(leftFor('Ana'), [ids.Caio, ids.Bia]);
  assert.equal(room.member(ids.Bia).voice, null);
  // voltou por outra conexão: está na sala, mas fora do voz até pedir de novo
  room.join(fakeSocket('s-Bia-2'), { token: 'tok-Bia', name: 'Bia' });
  assert.equal(room.member(ids.Bia).voice, null);
  assert.deepEqual(room.voiceJoin(ids.Bia).peers, [ids.Ana]);

  // a mesma pessoa abrindo outra aba: a conexão nova assume e o voz da antiga acaba
  room.join(fakeSocket('s-Bia-3'), { token: 'tok-Bia', name: 'Bia' });
  assert.equal(room.member(ids.Bia).voice, null);
  assert.deepEqual(leftFor('Ana'), [ids.Caio, ids.Bia, ids.Bia]);

  room.voiceJoin(ids.Caio);
  room.leave(ids.Caio);
  assert.deepEqual(leftFor('Ana').at(-1), ids.Caio);

  room.voiceJoin(ids.Bia);
  room.kick(ids.Ana, ids.Bia);
  assert.deepEqual(leftFor('Ana').at(-1), ids.Bia);
  assert.deepEqual(room.voicePeers(ids.Ana), []);
  done();
});

test('negociar não tira o "ausente"; entrar de novo depois da queda também não', async () => {
  // pelo servidor de verdade, porque é o index.js que decide quais eventos contam como presença
  const { ana, bia, srv } = await pair();
  const room = srv.rooms.get(ana.code);
  const anaMember = room.member(ana.id);
  anaMember.away = true;
  await ana.call('voice:join', {});
  await bia.call('voice:join', {});
  await ana.call('voice:signal', { to: bia.id, data: OFFER });
  assert.equal(anaMember.away, true);
  await ana.call('voice:mute', { muted: true });
  assert.equal(anaMember.away, false, 'mutar é a pessoa mexendo na tela');
});

test('credenciais do TURN: temporárias, no padrão do coturn, só com o segredo configurado', () => {
  const now = Date.UTC(2026, 10, 25);
  assert.deepEqual(iceServers({ stunUrls: ['stun:a:3478'] }, now), [{ urls: ['stun:a:3478'] }]);
  assert.deepEqual(iceServers({ turnUrls: ['turn:t:3478'] }, now), [], 'sem segredo não há TURN');

  const [stun, turn] = iceServers(
    { stunUrls: ['stun:a'], turnUrls: ['turn:t:3478', 'turns:t:5349'], turnSecret: 's3gr3d0', turnTtlSeconds: 60 },
    now,
  );
  assert.deepEqual(stun.urls, ['stun:a']);
  assert.deepEqual(turn.urls, ['turn:t:3478', 'turns:t:5349']);
  const [expires] = turn.username.split(':');
  assert.equal(Number(expires), now / 1000 + 60);
  assert.equal(turn.credential, createHmac('sha1', 's3gr3d0').update(turn.username).digest('base64'));
  // cada pedido ganha um usuário diferente
  assert.notEqual(
    iceServers({ turnUrls: ['turn:t'], turnSecret: 'x' }, now)[0].username,
    iceServers({ turnUrls: ['turn:t'], turnSecret: 'x' }, now)[0].username,
  );
});

test('configuração do voz vem do ambiente', () => {
  const def = configFromEnv({});
  assert.deepEqual(def.stunUrls, ['stun:stun.l.google.com:19302']);
  assert.deepEqual(def.turnUrls, []);
  assert.equal(def.turnSecret, null);
  const c = configFromEnv({
    STUN_URLS: '',
    TURN_URLS: 'turn:t.example:3478, turns:t.example:5349',
    TURN_SECRET: ' abc ',
    TURN_TTL_SECONDS: '120',
  });
  assert.deepEqual(c.stunUrls, []);
  assert.deepEqual(c.turnUrls, ['turn:t.example:3478', 'turns:t.example:5349']);
  assert.equal(c.turnSecret, 'abc');
  assert.equal(c.turnTtlSeconds, 120);
});

test('limpeza da negociação', () => {
  assert.deepEqual(cleanSignal({ candidate: null }), { candidate: null });
  assert.deepEqual(cleanSignal({ candidate: { candidate: '' } }), {
    candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null, usernameFragment: null },
  });
  assert.equal(cleanSignal({ description: { type: 'offer', sdp: '' } }), null);
  assert.equal(cleanSignal({ description: { type: 'offer', sdp: 'x'.repeat(SDP_MAX + 1) } }), null);
  assert.ok(cleanSignal({ description: { type: 'answer', sdp: 'x'.repeat(SDP_MAX) } }));
  assert.equal(cleanSignal({ candidate: { candidate: 'c', sdpMLineIndex: -1 } }), null);
  assert.equal(cleanSignal({ candidate: { candidate: 'c', sdpMLineIndex: 1.5 } }), null);
  assert.equal(cleanSignal({ candidate: { candidate: 'c', sdpMid: 7 } }), null);
  assert.equal(cleanSignal({ candidate: { candidate: 'c'.repeat(1001) } }), null);
});

test('plateia e eliminados também entram no voz, falam e ouvem (cada um decide, sem regra do anfitrião)', () => {
  const { io, room, ids, to, lastState, done } = setup();
  assert.equal(room.start(ids.Ana).ok, true);
  // Davi chega com a partida rolando: vai para a plateia
  const joined = room.join(fakeSocket('s-Davi'), { token: 'tok-Davi', name: 'Davi' });
  assert.equal(joined.spectator, true);
  ids.Davi = room.members.at(-1).id;
  // Caio foi eliminado (estourou o limite de pontos): continua na sala, fora da partida
  room.game.players.find((p) => p.id === ids.Caio).eliminated = true;

  // ninguém precisa de permissão: quem não é anfitrião entra sozinho, inclusive a plateia
  for (const name of ['Davi', 'Caio', 'Bia']) assert.equal(room.voiceJoin(ids[name]).ok, true, name);
  assert.deepEqual(room.voiceJoin(ids.Ana).peers.sort(), [ids.Davi, ids.Caio, ids.Bia].sort());

  // a plateia fala com quem joga e com o eliminado, e recebe de volta
  io.sent.length = 0;
  for (const target of ['Ana', 'Caio'])
    assert.equal(room.voiceSignal(ids.Davi, { to: ids[target], data: OFFER }).ok, true);
  assert.equal(room.voiceSignal(ids.Caio, { to: ids.Davi, data: CANDIDATE }).ok, true);
  assert.deepEqual(to('s-Ana', 'voice:signal')[0].payload, { from: ids.Davi, ...OFFER });
  assert.deepEqual(to('s-Caio', 'voice:signal')[0].payload, { from: ids.Davi, ...OFFER });
  assert.deepEqual(to('s-Davi', 'voice:signal')[0].payload, { from: ids.Caio, ...CANDIDATE });

  // e mutar vale para eles também
  assert.equal(room.voiceMute(ids.Davi, true).ok, true);
  const st = lastState('Ana');
  assert.deepEqual(st.spectators, [ids.Davi]);
  assert.deepEqual(
    st.members.filter((m) => m.voice).map((m) => [m.name, m.voiceMuted]),
    [
      ['Ana', false],
      ['Bia', false],
      ['Caio', false],
      ['Davi', true],
    ],
  );
  done();
});

// ---------- pela rede ----------

let srv;
let url;
const sockets = [];

before(async () => {
  srv = createGameServer({
    timing: { hostGraceMs: 200 },
    turnUrls: ['turn:turn.test:3478'],
    turnSecret: 'segredo-de-teste',
    stunUrls: [],
  });
  await new Promise((resolve) => srv.server.listen(0, resolve));
  url = `http://localhost:${srv.server.address().port}`;
});

after(async () => {
  for (const s of sockets) s.close();
  for (const code of [...srv.rooms.rooms.keys()]) srv.rooms.delete(code);
  srv.io.close();
  await new Promise((resolve) => srv.server.close(resolve));
});

async function client(name) {
  const s = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  await new Promise((resolve) => s.once('connect', resolve));
  const c = { s, name, call: (event, data) => s.timeout(2000).emitWithAck(event, data) };
  return c;
}

// Ana cria a sala e Bia entra; cada um sabe o próprio id.
async function pair() {
  const ana = await client('Ana');
  const created = await ana.call('room:create', { token: `tok-a-${Math.random()}`, name: 'Ana' });
  ana.code = created.code;
  const bia = await client('Bia');
  await bia.call('room:join', { code: created.code, token: `tok-b-${Math.random()}`, name: 'Bia' });
  const room = srv.rooms.get(created.code);
  ana.id = room.members[0].id;
  bia.id = room.members[1].id;
  return { ana, bia, srv };
}

const next = (s, event) => new Promise((resolve) => s.once(event, resolve));

test('de ponta a ponta: entra, recebe o TURN, negocia e sabe quando o outro cai', async () => {
  const { ana, bia } = await pair();
  // fora de sala não dá
  const stranger = await client('Zé');
  assert.equal((await stranger.call('voice:join', {})).ok, false);

  const joined = await ana.call('voice:join', {});
  assert.equal(joined.ok, true);
  assert.deepEqual(joined.peers, []);
  const [turn] = joined.iceServers;
  assert.deepEqual(turn.urls, ['turn:turn.test:3478']);
  assert.ok(turn.username && turn.credential);

  const bJoined = await bia.call('voice:join', { muted: true });
  assert.deepEqual(bJoined.peers, [ana.id]);

  // a Bia oferece para a Ana (quem chega oferece), a Ana responde
  const offer = next(ana.s, 'voice:signal');
  assert.deepEqual(await bia.call('voice:signal', { to: ana.id, data: OFFER }), { ok: true });
  assert.deepEqual(await offer, { from: bia.id, ...OFFER });
  const answer = next(bia.s, 'voice:signal');
  const ANSWER = { description: { type: 'answer', sdp: OFFER.description.sdp } };
  await ana.call('voice:signal', { to: bia.id, data: ANSWER });
  assert.deepEqual(await answer, { from: ana.id, ...ANSWER });

  // a Bia cai: a Ana fica sabendo para fechar a conexão
  const left = next(ana.s, 'voice:peer-left');
  bia.s.close();
  assert.deepEqual(await left, { id: bia.id });
});

test('negociação tem limite próprio, folgado para a mesa cheia', async () => {
  const { ana, bia } = await pair();
  await ana.call('voice:join', {});
  await bia.call('voice:join', {});
  // bem mais que o limite padrão (20 em 10s): uma mesa de 12 renegociando inteira
  const results = await Promise.all(
    Array.from({ length: 150 }, () => ana.call('voice:signal', { to: bia.id, data: CANDIDATE })),
  );
  assert.ok(results.every((r) => r.ok));
});
