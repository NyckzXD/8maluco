// Salas estilo "Gartic": código curto, lista de salas públicas, anfitrião, bots e chat.
import { randomUUID } from "node:crypto";
import {
  createGame,
  startRound,
  playCard,
  drawCard,
  passTurn,
  removePlayer,
  viewFor,
} from "../shared/engine.js";
import { chooseMove } from "../shared/bot.js";
import { randomAvatar, sanitizeAvatar } from "../shared/avatar.js";

export const MAX_PLAYERS = 8;
const ROUND_BREAK_MS = 9000; // só usado quando não sobrou nenhum humano conectado para clicar em "pronto"
const BOT_DELAY_MS = [3000, 5000]; // bots esperam pelo menos 3s para dar tempo de acompanhar
const DEAL_MS = 3500; // tempo da animação de distribuir as cartas no começo da rodada (a primeira vez espera por ela)
const AWAY_DELAY_MS = 1500; // jogador desconectado: joga no automático rapidinho
const LOBBY_GRACE_MS = 30_000; // quanto tempo um desconectado segura o lugar no lobby
const EMPTY_ROOM_MS = 5 * 60_000;

const BOT_NAMES = [
  "Robô Zeca",
  "Robô Cida",
  "Robô Juca",
  "Robô Lurdes",
  "Robô Tonho",
  "Robô Neide",
  "Robô Biu",
  "Robô Fia",
];
const COLORS = [
  "#ff6b6b",
  "#ffa94d",
  "#ffd43b",
  "#69db7c",
  "#38d9a9",
  "#4dabf7",
  "#9775fa",
  "#f783ac",
  "#a9e34b",
  "#66d9e8",
];

const clean = (text, max) =>
  String(text ?? "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, max);

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  create({ isPublic = true } = {}) {
    let code;
    do {
      code = Array.from(
        { length: 5 },
        () =>
          "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
      ).join("");
    } while (this.rooms.has(code));
    const room = new Room(this, code, isPublic);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(clean(code, 8).toUpperCase());
  }

  delete(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.dispose();
    this.rooms.delete(code);
  }

  listPublic() {
    return [...this.rooms.values()]
      .filter(
        (r) =>
          r.settings.isPublic && r.members.some((m) => !m.isBot && m.connected),
      )
      .map((r) => {
        const host = r.members.find((m) => m.id === r.hostId);
        return {
          code: r.code,
          host: host?.name ?? "?",
          hostAvatar: host?.avatar ?? null,
          hostColor: host?.color ?? null,
          players: r.members.length,
          max: MAX_PLAYERS,
          playing: !!r.game && r.game.phase !== "gameOver",
        };
      })
      .sort((a, b) => a.playing - b.playing || b.players - a.players);
  }
}

class Room {
  constructor(manager, code, isPublic) {
    this.manager = manager;
    this.io = manager.io;
    this.code = code;
    this.settings = { isPublic, turnSeconds: 30 };
    this.members = []; // a ordem aqui é a ordem dos assentos (para a direita)
    this.hostId = null;
    this.chat = [];
    this.game = null;
    this.timer = null;
    this.deadline = null;
    this.turnMs = null; // duração total do prazo atual (o anel de tempo do cliente mede contra ela)
    this.ready = new Set(); // quem já clicou em "pronto" no intervalo entre rodadas
    this.emptyTimer = null;
  }

  // ---------- membros ----------

  join(socket, { token, name, avatar }) {
    token = clean(token, 64);
    name = clean(name, 16) || "Jogador";
    avatar = sanitizeAvatar(avatar);
    if (!token) return { ok: false, error: "Sessão inválida" };

    let m = this.members.find((x) => !x.isBot && x.token === token);
    if (m) {
      m.name = name;
      m.avatar = avatar;
      if (m.socketId && m.socketId !== socket.id)
        this.io.sockets.sockets.get(m.socketId)?.leave(this.code);
    } else {
      if (this.members.length >= MAX_PLAYERS)
        return { ok: false, error: "A sala está cheia" };
      m = {
        id: randomUUID().slice(0, 8),
        token,
        name,
        avatar,
        color: this.freeColor(),
        isBot: false,
      };
      this.members.push(m);
      this.system(`${name} entrou na sala`);
    }
    m.socketId = socket.id;
    m.connected = true;
    clearTimeout(m.graceTimer);
    clearTimeout(this.emptyTimer);
    if (!this.members.some((x) => x.id === this.hostId)) this.hostId = m.id;

    socket.join(this.code);
    socket.data.code = this.code;
    socket.data.memberId = m.id;
    socket.emit("chat:history", this.chat);
    this.schedule(false);
    this.broadcast();
    return { ok: true, code: this.code };
  }

  leave(memberId) {
    const m = this.member(memberId);
    if (!m) return;
    this.members = this.members.filter((x) => x.id !== memberId);
    if (m.socketId) this.io.sockets.sockets.get(m.socketId)?.leave(this.code);
    this.system(`${m.name} saiu da sala`);
    if (this.game?.players.some((p) => p.id === memberId)) {
      this.apply(removePlayer(this.game, memberId));
    }
    if (this.hostId === memberId)
      this.hostId = this.members.find((x) => !x.isBot)?.id ?? null;
    if (!this.members.some((x) => !x.isBot))
      return this.manager.delete(this.code);
    if (!this.checkReady()) this.broadcast();
  }

  disconnect(memberId, socketId) {
    const m = this.member(memberId);
    // Se o jogador já voltou por outra conexão, a queda da antiga não conta.
    if (!m || m.socketId !== socketId) return;
    m.connected = false;
    m.socketId = null;
    const seated =
      this.game &&
      this.game.phase !== "gameOver" &&
      this.game.players.some((p) => p.id === memberId);
    if (!seated) {
      m.graceTimer = setTimeout(() => this.leave(memberId), LOBBY_GRACE_MS);
    }
    if (!this.members.some((x) => !x.isBot && x.connected)) {
      this.emptyTimer = setTimeout(
        () => this.manager.delete(this.code),
        EMPTY_ROOM_MS,
      );
    }
    this.schedule(false);
    if (!this.checkReady()) this.broadcast();
  }

  addBot(byId) {
    if (byId !== this.hostId)
      return { ok: false, error: "Só o anfitrião pode adicionar bots" };
    if (this.game && this.game.phase !== "gameOver")
      return { ok: false, error: "Espere a partida acabar" };
    if (this.members.length >= MAX_PLAYERS)
      return { ok: false, error: "A sala está cheia" };
    const used = new Set(this.members.map((m) => m.name));
    const name =
      BOT_NAMES.find((n) => !used.has(n)) ?? `Robô ${this.members.length + 1}`;
    this.members.push({
      id: randomUUID().slice(0, 8),
      name,
      avatar: randomAvatar(),
      color: this.freeColor(),
      isBot: true,
      connected: true,
    });
    this.broadcast();
    return { ok: true };
  }

  kick(byId, memberId) {
    if (byId !== this.hostId)
      return { ok: false, error: "Só o anfitrião pode remover jogadores" };
    if (memberId === byId) return { ok: false, error: "Use o botão de sair" };
    const m = this.member(memberId);
    if (!m) return { ok: false, error: "Jogador não encontrado" };
    if (m.socketId) this.io.to(m.socketId).emit("room:kicked");
    this.leave(memberId);
    return { ok: true };
  }

  updateSettings(byId, patch) {
    if (byId !== this.hostId)
      return { ok: false, error: "Só o anfitrião muda as configurações" };
    if (typeof patch.isPublic === "boolean")
      this.settings.isPublic = patch.isPublic;
    if ([15, 30, 45, 60].includes(patch.turnSeconds))
      this.settings.turnSeconds = patch.turnSeconds;
    this.broadcast();
    return { ok: true };
  }

  say(memberId, text) {
    const m = this.member(memberId);
    text = clean(text, 200);
    if (!m || !text) return;
    const now = Date.now();
    if (now - (m.lastChat ?? 0) < 400) return;
    m.lastChat = now;
    this.pushChat({ from: m.name, color: m.color, text });
  }

  system(text) {
    this.pushChat({ system: true, text });
  }

  pushChat(msg) {
    msg.at = Date.now();
    this.chat.push(msg);
    if (this.chat.length > 60) this.chat.shift();
    this.io.to(this.code).emit("chat", msg);
  }

  // ---------- partida ----------

  start(byId) {
    if (byId !== this.hostId)
      return { ok: false, error: "Só o anfitrião pode começar" };
    if (this.game && this.game.phase !== "gameOver")
      return { ok: false, error: "A partida já começou" };
    if (this.members.length < 2)
      return {
        ok: false,
        error: "Precisa de pelo menos 2 jogadores (adicione um bot!)",
      };
    this.game = createGame(
      this.members.map((m) => ({ id: m.id, name: m.name })),
    );
    this.system("A partida começou! Boa sorte!");
    this.apply(startRound(this.game));
    return { ok: true };
  }

  backToLobby(byId) {
    if (byId !== this.hostId)
      return { ok: false, error: "Só o anfitrião pode fazer isso" };
    if (this.game && this.game.phase !== "gameOver")
      return { ok: false, error: "A partida ainda está rolando" };
    this.game = null;
    this.clearTimer();
    for (const m of this.members.filter((x) => !x.isBot && !x.connected))
      this.leave(m.id);
    this.broadcast();
    return { ok: true };
  }

  act(memberId, action) {
    if (!this.game) return { ok: false, error: "Nenhuma partida em andamento" };
    let result;
    if (action.type === "play")
      result = playCard(
        this.game,
        memberId,
        clean(action.cardId, 16),
        action.suit,
      );
    else if (action.type === "draw") result = drawCard(this.game, memberId);
    else if (action.type === "pass") result = passTurn(this.game, memberId);
    else return { ok: false, error: "Ação desconhecida" };
    if (!result.ok) return result;
    this.apply(result);
    return { ok: true };
  }

  setReady(memberId) {
    const g = this.game;
    if (!g || g.phase !== "roundOver")
      return { ok: false, error: "A rodada ainda não acabou" };
    if (!g.players.some((p) => p.id === memberId && !p.eliminated))
      return { ok: false, error: "Você não está na próxima rodada" };
    this.ready.add(memberId);
    if (!this.checkReady()) this.broadcast();
    return { ok: true };
  }

  // Humanos conectados que ainda vão jogar e não clicaram em "pronto". Bots e desconectados não seguram a mesa.
  waitingOn() {
    const g = this.game;
    if (!g || g.phase !== "roundOver") return [];
    return g.players
      .filter((p) => !p.eliminated && !this.ready.has(p.id))
      .map((p) => this.member(p.id))
      .filter((m) => m && !m.isBot && m.connected)
      .map((m) => m.id);
  }

  // Começa a próxima rodada se todo mundo estiver pronto. Retorna true se começou (e já avisou todos).
  checkReady() {
    const g = this.game;
    if (!g || g.phase !== "roundOver" || this.waitingOn().length) return false;
    if (!this.ready.size) return false; // ninguém para clicar: quem cuida é o timer de apply()
    this.ready.clear();
    this.apply(startRound(g));
    return true;
  }

  // Aplica o resultado de uma jogada: avisa todo mundo e agenda o próximo passo.
  apply(result, { newTurn } = {}) {
    const events = result.events ?? [];
    const g = this.game;
    newTurn ??= events.some((e) =>
      ["play", "pass", "roundStart", "left"].includes(e.type),
    );

    const end = events.find((e) => e.type === "roundEnd");
    if (end)
      this.system(
        `${this.nameOf(end.winnerId)} bateu e venceu a rodada ${end.round}!`,
      );
    for (const e of events)
      if (e.type === "left" && g.phase !== "gameOver")
        this.system(`${this.nameOf(e.playerId)} saiu da mesa`);
    const over = events.find((e) => e.type === "gameOver");
    if (over)
      this.system(`${this.nameOf(over.winnerId)} é o grande vencedor!`);

    if (end && g.phase === "roundOver") {
      this.clearTimer();
      this.ready.clear();
      // Sem nenhum humano conectado na mesa não há quem clique em "pronto": segue sozinho.
      if (!this.waitingOn().length)
        this.timer = setTimeout(() => {
          if (this.game === g && g.phase === "roundOver")
            this.apply(startRound(g));
        }, ROUND_BREAK_MS);
    }
    const dealing = events.some((e) => e.type === "roundStart");
    this.schedule(newTurn, dealing ? DEAL_MS : 0);
    this.broadcast(events);
  }

  // Cuida do relógio da vez: bots jogam sozinhos, humanos têm um tempo limite.
  // `extraMs` dá um tempo a mais nesta vez (a distribuição das cartas no começo da rodada).
  schedule(newTurn, extraMs = 0) {
    const g = this.game;
    if (!g || g.phase !== "playing") {
      if (!g || g.phase === "gameOver") this.clearTimer();
      this.deadline = null;
      return;
    }
    const current = g.players[g.turn];
    const m = this.member(current.id);
    clearTimeout(this.timer);
    if (!m || m.isBot || !m.connected) {
      const [min, max] = BOT_DELAY_MS;
      let delay = m?.isBot
        ? min + Math.random() * (max - min)
        : AWAY_DELAY_MS;
      delay += extraMs;
      // Bot e ausente também têm prazo: é quando a jogada automática acontece,
      // e o anel de tempo dos outros esvazia até lá.
      this.deadline = Date.now() + delay;
      this.turnMs = delay;
      this.timer = setTimeout(
        () => this.autoplay(current.id, !!m?.isBot),
        delay,
      );
      return;
    }
    if (newTurn || !this.deadline || !this.turnMs || this.turnMs < this.settings.turnSeconds * 1000) {
      this.turnMs = this.settings.turnSeconds * 1000 + extraMs;
      this.deadline = Date.now() + this.turnMs;
    }
    const turnKey = `${g.round}:${g.turn}`;
    this.timer = setTimeout(
      () => {
        if (this.game === g && `${g.round}:${g.turn}` === turnKey) {
          this.system(`O tempo de ${m.name} acabou, jogada automática`);
          this.autoplay(current.id, false);
        }
      },
      Math.max(0, this.deadline - Date.now()),
    );
  }

  // Joga pelo jogador. Bot faz um passo por vez (pra dar tempo de ver); humano ausente resolve a vez toda.
  autoplay(playerId, singleStep) {
    const g = this.game;
    const events = [];
    for (let i = 0; i < 3; i++) {
      if (!g || g.phase !== "playing" || g.players[g.turn].id !== playerId)
        break;
      const move = chooseMove(g, playerId);
      const r =
        move.type === "play"
          ? playCard(g, playerId, move.cardId, move.suit)
          : move.type === "draw"
            ? drawCard(g, playerId)
            : passTurn(g, playerId);
      if (!r.ok) break;
      events.push(...r.events);
      if (singleStep) break;
    }
    if (events.length) this.apply({ events });
  }

  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  dispose() {
    this.clearTimer();
    clearTimeout(this.emptyTimer);
    for (const m of this.members) clearTimeout(m.graceTimer);
  }

  // ---------- envio de estado ----------

  broadcast(events = []) {
    for (const m of this.members) {
      if (m.isBot || !m.connected || !m.socketId) continue;
      this.io.to(m.socketId).emit("state", this.viewFor(m.id, events));
    }
  }

  viewFor(memberId, events) {
    return {
      code: this.code,
      me: memberId,
      hostId: this.hostId,
      settings: this.settings,
      maxPlayers: MAX_PLAYERS,
      members: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        color: m.color,
        isBot: m.isBot,
        connected: m.connected,
      })),
      game: this.game ? viewFor(this.game, memberId) : null,
      deadline: this.deadline,
      turnMs: this.turnMs,
      ready: [...this.ready],
      waitingOn: this.waitingOn(),
      serverNow: Date.now(),
      events,
    };
  }

  member(id) {
    return this.members.find((m) => m.id === id);
  }

  nameOf(id) {
    return (
      this.member(id)?.name ??
      this.game?.players.find((p) => p.id === id)?.name ??
      "?"
    );
  }

  freeColor() {
    const used = new Set(this.members.map((m) => m.color));
    return (
      COLORS.find((c) => !used.has(c)) ??
      COLORS[this.members.length % COLORS.length]
    );
  }
}
