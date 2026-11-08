// Reiniciar o servidor sem perder as partidas (38).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect } from 'socket.io-client';
import { RoomManager } from '../server/rooms.js';
import { saveSnapshot, loadSnapshot } from '../server/snapshot.js';
import { createGameServer } from '../server/index.js';

const dir = mkdtempSync(join(tmpdir(), '8maluco-'));
const cleanup = [];
after(() => {
  for (const fn of cleanup) fn();
  rmSync(dir, { recursive: true, force: true });
});

const fakeIo = () => ({ to: () => ({ emit() {} }), emit() {}, sockets: { sockets: new Map() } });
const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });

// Sala com Ana, Bia e um bot, partida rolando, 45s por vez.
function playing() {
  const manager = new RoomManager(fakeIo());
  const r = manager.create();
  r.join(fakeSocket('a'), { token: 'tok-a', name: 'Ana' });
  r.join(fakeSocket('b'), { token: 'tok-b', name: 'Bia' });
  r.addBot(r.hostId);
  r.updateSettings(r.hostId, { turnSeconds: 45 });
  r.say(r.hostId, 'boa sorte');
  r.start(r.hostId);
  return { manager, r };
}

// Snapshot passando por JSON, como no arquivo.
const roundTrip = (manager) => JSON.parse(JSON.stringify(manager.snapshot()));

test('a sala volta igual: membros com token, configurações, partida e chat', () => {
  const { manager, r } = playing();
  const data = roundTrip(manager);
  const fresh = new RoomManager(fakeIo());
  assert.equal(fresh.restore(data), 1);
  const back = fresh.get(r.code);

  assert.deepEqual(back.game, JSON.parse(JSON.stringify(r.game)), 'estado do motor idêntico, com a seed');
  assert.deepEqual(back.settings, r.settings);
  assert.equal(back.hostId, r.hostId);
  assert.deepEqual(
    back.members.map((m) => [m.id, m.token, m.name, m.isBot]),
    r.members.map((m) => [m.id, m.token, m.name, m.isBot]),
  );
  assert.ok(back.chat.some((m) => m.text === 'boa sorte'));
  assert.ok(back.chat.some((m) => m.system && m.text.includes('O servidor reiniciou')));
  // humanos desconectados, bot "conectado"; relógio parado até alguém voltar
  assert.deepEqual(
    back.members.map((m) => m.connected),
    [false, false, true],
  );
  assert.equal(back.resumePending, true);
  assert.equal(back.deadline, null);
  assert.equal(back.timer, null);
  r.dispose();
  back.dispose();
});

test('o primeiro a voltar solta a vez, com o prazo cheio', () => {
  const { manager, r } = playing();
  const fresh = new RoomManager(fakeIo());
  fresh.restore(roundTrip(manager));
  const back = fresh.get(r.code);
  const turn = back.game.players[back.game.turn].id;
  const handBefore = back.game.players.map((p) => p.hand.map((c) => c.id));

  const before = Date.now();
  back.join(fakeSocket('a2'), { token: 'tok-a', name: 'Ana' });
  assert.equal(back.resumePending, false);
  assert.equal(back.game.players[back.game.turn].id, turn, 'continua a mesma vez');
  assert.deepEqual(
    back.game.players.map((p) => p.hand.map((c) => c.id)),
    handBefore,
    'ninguém jogou enquanto estava parado',
  );
  if (!back.member(turn).isBot) {
    const left = back.deadline - before;
    assert.ok(left >= 45_000 && left <= 45_100, `prazo cheio, mesmo para quem ainda não voltou: ${left}`);
  }
  r.dispose();
  back.dispose();
});

test('snapshot velho, de outra versão ou sem gente não volta', () => {
  const { manager, r } = playing();
  const data = roundTrip(manager);
  assert.equal(new RoomManager(fakeIo()).restore(data, data.savedAt + 11 * 60_000), 0);
  assert.equal(new RoomManager(fakeIo()).restore({ ...data, version: 99 }), 0);
  assert.equal(new RoomManager(fakeIo()).restore(null), 0);
  // sala só com bots não é gravada
  const empty = new RoomManager(fakeIo());
  const solo = empty.create();
  solo.join(fakeSocket('x'), { token: 'x', name: 'X' });
  solo.addBot(solo.hostId);
  solo.members = solo.members.filter((m) => m.isBot);
  assert.equal(empty.snapshot().rooms.length, 0);
  r.dispose();
  solo.dispose();
});

test('arquivo: grava, lê uma vez só e apaga', () => {
  const file = join(dir, 'sub', 'rooms.json');
  const { manager, r } = playing();
  assert.equal(saveSnapshot(manager, file), 1);
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, 'utf8'), /"tok-a"/);

  const fresh = new RoomManager(fakeIo());
  assert.equal(loadSnapshot(fresh, file), 1);
  assert.equal(existsSync(file), false, 'lido e apagado');
  assert.equal(loadSnapshot(new RoomManager(fakeIo()), file), 0, 'sem arquivo, nada volta');

  // sem nenhuma sala, apaga o arquivo velho
  saveSnapshot(manager, file);
  manager.delete(r.code);
  assert.equal(saveSnapshot(manager, file), 0);
  assert.equal(existsSync(file), false);
  fresh.get(r.code).dispose();
});

test('reinício de verdade: os jogadores voltam pelo token para a mesma vez, com as mesmas cartas', async () => {
  const file = join(dir, 'e2e.json');
  const start = async () => {
    const s = createGameServer();
    await new Promise((resolve) => s.server.listen(0, resolve));
    s.url = `http://localhost:${s.server.address().port}`;
    cleanup.push(() => {
      for (const code of [...s.rooms.rooms.keys()]) s.rooms.delete(code);
      s.io.close();
    });
    return s;
  };
  const client = async (url, token, name) => {
    const c = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    cleanup.push(() => c.close());
    await new Promise((resolve) => c.once('connect', resolve));
    const states = [];
    c.on('state', (st) => states.push(st));
    const call = (event, data) => c.timeout(2000).emitWithAck(event, data);
    const last = async (pred) => {
      for (let i = 0; i < 40 && !(states.at(-1) && pred(states.at(-1))); i++)
        await new Promise((r) => setTimeout(r, 25));
      return states.at(-1);
    };
    return { c, call, last, token, name, join: (code) => call('room:join', { code, token, name }) };
  };

  // antes: Ana e Bia jogando
  const a = await start();
  const ana = await client(a.url, 'tok-ana', 'Ana');
  const { code } = await ana.call('room:create', { token: 'tok-ana', name: 'Ana' });
  const bia = await client(a.url, 'tok-bia', 'Bia');
  await bia.join(code);
  await ana.call('room:start');
  const anaBefore = await ana.last((s) => s.game?.hand.length === 9);
  const biaBefore = await bia.last((s) => s.game?.hand.length === 9);

  const warned = new Promise((resolve) => ana.c.once('server:restart', resolve));
  await a.shutdown({ snapshotFile: file });
  assert.match((await warned).message, /continua quando ele voltar/);
  assert.ok(existsSync(file));

  // depois: servidor novo lê o arquivo, os dois voltam pelo token
  const b = await start();
  assert.equal(loadSnapshot(b.rooms, file), 1);
  const ana2 = await client(b.url, 'tok-ana', 'Ana');
  const bia2 = await client(b.url, 'tok-bia', 'Bia');
  assert.equal((await ana2.join(code)).ok, true);
  assert.equal((await bia2.join(code)).ok, true);
  const anaAfter = await ana2.last((s) => s.members.every((m) => m.connected));
  const biaAfter = await bia2.last((s) => s.members.every((m) => m.connected));

  assert.equal(anaAfter.me, anaBefore.me);
  assert.equal(biaAfter.me, biaBefore.me);
  assert.deepEqual(anaAfter.game.hand, anaBefore.game.hand);
  assert.deepEqual(biaAfter.game.hand, biaBefore.game.hand);
  assert.equal(anaAfter.game.turnId, anaBefore.game.turnId, 'mesma vez');
  assert.equal(anaAfter.hostId, anaBefore.hostId);
  const left = anaAfter.deadline - anaAfter.serverNow;
  assert.ok(left > 29_000 && left <= 30_000, `prazo cheio depois de voltar: ${left}`);
});
