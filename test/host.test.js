// Anfitrião que cai: o cargo passa para o próximo humano conectado.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';

const fakeIo = () => ({ to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
const fakeSocket = (id) => ({ id, data: {}, join() {}, leave() {}, emit() {} });

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

// Sala com `n` humanos (tok-0 é o anfitrião) e um bot entre eles.
function room(n = 3) {
  const r = new RoomManager(fakeIo()).create();
  const ids = [];
  for (let i = 0; i < n; i++) {
    r.join(fakeSocket(`s${i}`), { token: `tok-${i}`, name: `Jogador ${i}` });
    ids.push(r.members.at(-1).id);
    if (i === 0) r.addBot(r.hostId); // o bot senta logo depois do anfitrião
  }
  return { r, ids };
}

const said = (r, text) => r.chat.some((m) => m.system && m.text === text);

test('anfitrião que cai passa o cargo ao próximo humano conectado depois de 5s', () => {
  const { r, ids } = room(3);
  r.disconnect(ids[0], 's0');
  mock.timers.tick(4000);
  assert.equal(r.hostId, ids[0], 'ainda segura o cargo');
  mock.timers.tick(1000);
  assert.equal(r.hostId, ids[1], 'pula o bot e vai para o próximo humano');
  assert.ok(said(r, 'Jogador 1 agora é o anfitrião'));
  // o novo anfitrião já consegue agir
  assert.equal(r.addBot(ids[1]).ok, true);
  r.dispose();
});

test('pula quem também está desconectado', () => {
  const { r, ids } = room(3);
  r.disconnect(ids[1], 's1');
  r.disconnect(ids[0], 's0');
  mock.timers.tick(5000);
  assert.equal(r.hostId, ids[2]);
  r.dispose();
});

test('anfitrião que volta a tempo continua; depois de perder, não recebe de volta', () => {
  const { r, ids } = room(2);
  r.disconnect(ids[0], 's0');
  mock.timers.tick(3000);
  r.join(fakeSocket('s0b'), { token: 'tok-0', name: 'Jogador 0' });
  mock.timers.tick(5000);
  assert.equal(r.hostId, ids[0]);

  r.disconnect(ids[0], 's0b');
  mock.timers.tick(5000);
  assert.equal(r.hostId, ids[1]);
  r.join(fakeSocket('s0c'), { token: 'tok-0', name: 'Jogador 0' });
  assert.equal(r.hostId, ids[1]);
  r.dispose();
});

test('sem ninguém conectado, o cargo vai para quem voltar primeiro', () => {
  const { r, ids } = room(3);
  r.disconnect(ids[1], 's1');
  r.disconnect(ids[2], 's2');
  r.disconnect(ids[0], 's0');
  mock.timers.tick(5000);
  assert.equal(r.hostId, ids[0], 'não há para quem passar');
  r.join(fakeSocket('s2b'), { token: 'tok-2', name: 'Jogador 2' });
  assert.equal(r.hostId, ids[2]);
  assert.ok(said(r, 'Jogador 2 agora é o anfitrião'));
  r.dispose();
});

test('também vale no meio da partida', () => {
  const { r, ids } = room(2);
  assert.equal(r.start(ids[0]).ok, true);
  r.disconnect(ids[0], 's0');
  mock.timers.tick(5000);
  assert.equal(r.hostId, ids[1]);
  r.dispose();
});

test('anfitrião que sai passa o cargo ao próximo humano conectado, não a um desconectado', () => {
  const { r, ids } = room(3);
  r.disconnect(ids[1], 's1');
  r.leave(ids[0]);
  assert.equal(r.hostId, ids[2]);
  assert.ok(said(r, 'Jogador 2 agora é o anfitrião'));
  r.dispose();
});
