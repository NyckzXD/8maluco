import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.static(`${root}/public`));
app.use('/shared', express.static(`${root}/shared`));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = createServer(app);
// CORS aberto para o futuro app mobile conseguir conectar no mesmo servidor.
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);

io.on('connection', (socket) => {
  const reply = (ack, result) => typeof ack === 'function' && ack(result ?? { ok: true });
  const current = () => {
    const room = socket.data.code && rooms.get(socket.data.code);
    return room && room.member(socket.data.memberId) ? room : null;
  };
  // Executa algo na sala atual do socket, respondendo erro se ele não estiver em nenhuma.
  const inRoom = (fn) => (data, ack) => {
    if (typeof data === 'function') [data, ack] = [{}, data];
    const room = current();
    if (!room) return reply(ack, { ok: false, error: 'Você não está em uma sala' });
    reply(ack, fn(room, socket.data.memberId, data ?? {}));
  };
  const leaveCurrent = () => {
    const room = current();
    if (room) room.leave(socket.data.memberId);
    socket.data.code = null;
    socket.data.memberId = null;
  };

  socket.on('room:list', (_data, ack) => reply(ack, { ok: true, rooms: rooms.listPublic() }));

  socket.on('room:create', (data = {}, ack) => {
    leaveCurrent();
    const room = rooms.create({ isPublic: data.isPublic !== false });
    const result = room.join(socket, data);
    if (!result.ok) rooms.delete(room.code);
    reply(ack, result);
  });

  socket.on('room:join', (data = {}, ack) => {
    const room = rooms.get(data.code);
    if (!room) return reply(ack, { ok: false, error: 'Sala não encontrada' });
    if (socket.data.code && socket.data.code !== room.code) leaveCurrent();
    reply(ack, room.join(socket, data));
  });

  socket.on('room:leave', (_data, ack) => {
    leaveCurrent();
    reply(ack);
  });

  socket.on('room:addBot', inRoom((room, me) => room.addBot(me)));
  socket.on('room:kick', inRoom((room, me, d) => room.kick(me, d.id)));
  socket.on('room:settings', inRoom((room, me, d) => room.updateSettings(me, d)));
  socket.on('room:start', inRoom((room, me) => room.start(me)));
  socket.on('room:lobby', inRoom((room, me) => room.backToLobby(me)));
  socket.on('chat', inRoom((room, me, d) => room.say(me, d.text)));
  socket.on('game:play', inRoom((room, me, d) => room.act(me, { type: 'play', cardId: d.cardId, suit: d.suit })));
  socket.on('game:draw', inRoom((room, me) => room.act(me, { type: 'draw' })));
  socket.on('game:pass', inRoom((room, me) => room.act(me, { type: 'pass' })));
  socket.on('game:ready', inRoom((room, me) => room.setReady(me)));

  socket.on('disconnect', () => {
    const room = current();
    if (room) room.disconnect(socket.data.memberId, socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`8 Maluco rodando em http://localhost:${PORT}`);
});
