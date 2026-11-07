import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// Só objetos simples chegam aos handlers: null, número, string ou array viram {}.
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// Monta o servidor sem ligar a porta (os testes sobem um em porta qualquer).
export function createGameServer() {
  const app = express();
  app.use(express.static(`${root}/public`));
  app.use('/shared', express.static(`${root}/shared`));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const server = createServer(app);
  // CORS aberto para o futuro app mobile conseguir conectar no mesmo servidor.
  const io = new Server(server, { cors: { origin: '*' } });
  const rooms = new RoomManager(io);

  io.on('connection', (socket) => {
    const reply = (ack, result) => ack && ack(result ?? { ok: true });
    const current = () => {
      const room = socket.data.code && rooms.get(socket.data.code);
      return room && room.member(socket.data.memberId) ? room : null;
    };
    const leaveCurrent = () => {
      const room = current();
      if (room) room.leave(socket.data.memberId);
      socket.data.code = null;
      socket.data.memberId = null;
    };

    // Todo evento passa por aqui: o ack (se veio) é sempre o último argumento, os dados viram
    // objeto e um erro num handler responde "Erro no servidor" em vez de derrubar todas as salas.
    const on = (event, fn) =>
      socket.on(event, (...args) => {
        const ack = typeof args.at(-1) === 'function' ? args.pop() : null;
        try {
          reply(ack, fn(asObject(args[0])));
        } catch (err) {
          console.error(`[${event}] sala ${socket.data.code ?? '-'}:`, err);
          reply(ack, { ok: false, error: 'Erro no servidor' });
        }
      });
    // Executa algo na sala atual do socket, respondendo erro se ele não estiver em nenhuma.
    const inRoom = (event, fn) =>
      on(event, (data) => {
        const room = current();
        if (!room) return { ok: false, error: 'Você não está em uma sala' };
        return fn(room, socket.data.memberId, data);
      });

    on('room:list', () => ({ ok: true, rooms: rooms.listPublic() }));

    on('room:create', (data) => {
      leaveCurrent();
      const room = rooms.create({ isPublic: data.isPublic !== false });
      const result = room.join(socket, data);
      if (!result.ok) rooms.delete(room.code);
      return result;
    });

    on('room:join', (data) => {
      const room = rooms.get(data.code);
      if (!room) return { ok: false, error: 'Sala não encontrada' };
      if (socket.data.code && socket.data.code !== room.code) leaveCurrent();
      return room.join(socket, data);
    });

    on('room:leave', () => leaveCurrent());

    inRoom('room:addBot', (room, me) => room.addBot(me));
    inRoom('room:kick', (room, me, d) => room.kick(me, d.id));
    inRoom('room:settings', (room, me, d) => room.updateSettings(me, d));
    inRoom('room:start', (room, me) => room.start(me));
    inRoom('room:lobby', (room, me) => room.backToLobby(me));
    inRoom('game:rematch', (room, me) => room.rematch(me));
    inRoom('chat', (room, me, d) => room.say(me, d.text));
    inRoom('reaction', (room, me, d) => room.react(me, d.id));
    inRoom('game:play', (room, me, d) => room.act(me, { type: 'play', cardId: d.cardId, suit: d.suit }));
    inRoom('game:draw', (room, me) => room.act(me, { type: 'draw' }));
    inRoom('game:pass', (room, me) => room.act(me, { type: 'pass' }));
    inRoom('game:ready', (room, me) => room.setReady(me));

    socket.on('disconnect', () => {
      try {
        const room = current();
        if (room) room.disconnect(socket.data.memberId, socket.id);
      } catch (err) {
        console.error(`[disconnect] sala ${socket.data.code ?? '-'}:`, err);
      }
    });
  });

  return { app, server, io, rooms };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const PORT = Number(process.env.PORT) || 3000;
  // Um erro que escapou (num timer de bot, por exemplo) fica no log em vez de derrubar todas as salas.
  process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
  createGameServer().server.listen(PORT, () => {
    console.log(`8 Maluco rodando em http://localhost:${PORT}`);
  });
}
