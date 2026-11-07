// Apelidos na sala (33) e quem some de vez da mesa (31).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { isBotName } from '../shared/names.js';

const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });
const newRoom = () => new RoomManager(fakeIo()).create();
const enter = (r, token, name) => r.join(fakeSocket(`s-${token}`), { token, name });
const names = (r) => r.members.map((m) => m.name);

test('33: apelidos repetidos ganham um número', () => {
  const r = newRoom();
  enter(r, 'a', 'Ana');
  enter(r, 'b', 'ana');
  enter(r, 'c', 'Ana');
  enter(r, 'd', 'Jogador');
  enter(r, 'e', 'Jogador');
  assert.deepEqual(names(r), ['Ana', 'ana 2', 'Ana 3', 'Jogador', 'Jogador 2']);
  assert.ok(r.chat.some((m) => m.text === 'Ana 3 entrou na sala'));
  r.dispose();
});

test('33: o número cabe nos 16 caracteres', () => {
  const r = newRoom();
  enter(r, 'a', 'Abcdefghijklmnop');
  enter(r, 'b', 'Abcdefghijklmnop');
  assert.equal(r.members[1].name, 'Abcdefghijklmn 2');
  assert.equal(r.members[1].name.length, 16);
  r.dispose();
});

test('33: quem volta com o mesmo apelido mantém o nome da sala', () => {
  const r = newRoom();
  enter(r, 'a', 'Ana');
  enter(r, 'b', 'Ana');
  r.disconnect(r.members[0].id, 's-a');
  enter(r, 'b', 'Ana'); // reconectou
  assert.equal(r.members[1].name, 'Ana 2');
  enter(r, 'b', 'Bia'); // trocou de apelido
  assert.equal(r.members[1].name, 'Bia');
  r.dispose();
});

test('33: apelidos de bot não são aceitos', () => {
  for (const n of ['Robô Zeca', 'robo', 'ROBÔ 3', '  Robo Juca']) assert.ok(isBotName(n), n);
  for (const n of ['Roberto', 'Robson', 'Robôzinho', 'Ana']) assert.ok(!isBotName(n), n);
  const r = newRoom();
  const res = enter(r, 'a', 'Robô Zeca');
  assert.equal(res.ok, false);
  assert.match(res.error, /Robô/);
  assert.equal(r.members.length, 0);
  r.dispose();
});

test('33: mensagem do chat leva o id de quem mandou', () => {
  const r = newRoom();
  enter(r, 'a', 'Ana');
  const id = r.members[0].id;
  r.say(id, 'oi');
  const msg = r.chat.at(-1);
  assert.equal(msg.fromId, id);
  assert.equal(msg.from, 'Ana');
  r.dispose();
});

test('31: desconectado por 3 minutos sai da mesa; quem volta antes fica', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const r = newRoom();
    enter(r, 'a', 'Ana');
    enter(r, 'b', 'Bia');
    enter(r, 'c', 'Caio');
    const [a, b, c] = r.members.map((m) => m.id);
    r.start(a);
    r.clearTimer(); // ninguém joga sozinho durante o teste
    const seat = (id) => r.game.players.find((p) => p.id === id);

    r.disconnect(b, 's-b');
    r.disconnect(c, 's-c');
    r.clearTimer();
    mock.timers.tick(2 * 60_000);
    enter(r, 'c', 'Caio'); // Caio volta a tempo
    r.clearTimer();
    mock.timers.tick(60_000);

    assert.equal(seat(b).eliminated, true, 'Bia sai da mesa');
    assert.equal(seat(b).hand.length, 0);
    assert.equal(seat(c).eliminated, false, 'Caio continua');
    assert.ok(r.member(b), 'Bia continua na sala até a partida acabar');
    assert.ok(r.chat.some((m) => m.text === 'Bia ficou 3 minutos desconectado'));
    assert.ok(r.chat.some((m) => m.text === 'Bia saiu da mesa'));
    r.dispose();
  } finally {
    mock.timers.reset();
  }
});
