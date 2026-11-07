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
import { REACTION_LIMIT, isReaction } from "../shared/reactions.js";
import { BOT_NAME_ERROR, isBotName } from "../shared/names.js";

export const MAX_PLAYERS = 8;
const ROUND_BREAK_MS = 9000; // só usado quando não sobrou nenhum humano conectado para clicar em "pronto"
const BOT_DELAY_MS = [3000, 5000]; // bots esperam pelo menos 3s para dar tempo de acompanhar
const DEAL_MS = 3500; // tempo da animação de distribuir as cartas no começo da rodada (a primeira vez espera por ela)
const AWAY_DELAY_MS = 1500; // jogador desconectado: joga no automático rapidinho
const LOBBY_GRACE_MS = 30_000; // quanto tempo um desconectado segura o lugar no lobby
const HOST_GRACE_MS = 5000; // quanto tempo o anfitrião desconectado segura o cargo
const DROP_GRACE_MS = 10_000; // quem cai na própria vez tem pelo menos isso para voltar
const IDLE_TIMEOUTS = 2; // vezes seguidas com o tempo esgotado até o jogador ficar ausente
const SEAT_GRACE_MS = 3 * 60_000; // desconectado na partida por mais que isso sai da mesa
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

// Limite de frequência por janela deslizante: guarda os horários recentes e diz se cabe mais um.
// Devolve a lista já limpa (só os horários dentro da janela), com o novo incluído quando cabe.
export function takeSlot(times = [], now, { max, windowMs }) {
  const recent = times.filter((t) => now - t < windowMs);
  if (recent.length >= max) return { ok: false, times: recent };
  return { ok: true, times: [...recent, now] };
}

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
    this.rematchVotes = new Set(); // quem já pediu revanche no fim da partida
    this.emptyTimer = null;
    this.hostTimer = null; // anfitrião desconectado: quando o cargo passa para outro
    this.hostOrphan = false; // nenhum humano conectado para assumir: o próximo que entrar assume
    this.turnSeq = 0; // conta as vezes: distingue "esta vez" de "a próxima vez do mesmo jogador"
  }

  // ---------- membros ----------

  join(socket, { token, name, avatar }) {
    token = clean(token, 64);
    name = clean(name, 16) || "Jogador";
    avatar = sanitizeAvatar(avatar);
    if (!token) return { ok: false, error: "Sessão inválida" };
    if (isBotName(name)) return { ok: false, error: BOT_NAME_ERROR };

    let m = this.members.find((x) => !x.isBot && x.token === token);
    if (m) {
      // voltando com o mesmo apelido, mantém o nome que já tinha na sala (o "Ana 2" continua "Ana 2")
      if (name !== m.askedName) m.name = this.uniqueName(name, m.id);
      m.askedName = name;
      m.avatar = avatar;
      // Mesmo token por outra conexão (outra aba): a nova assume o lugar e a antiga perde
      // o acesso à sala de vez, não só o canal (senão ela ainda conseguiria jogar e falar).
      if (m.socketId && m.socketId !== socket.id) {
        const old = this.io.sockets.sockets.get(m.socketId);
        if (old) {
          old.leave(this.code);
          old.data.code = null;
          old.data.memberId = null;
          old.emit("room:replaced", { code: this.code });
        }
      }
    } else {
      if (this.members.length >= MAX_PLAYERS)
        return { ok: false, error: "A sala está cheia" };
      m = {
        id: randomUUID().slice(0, 8),
        token,
        name: this.uniqueName(name),
        askedName: name,
        avatar,
        color: this.freeColor(),
        isBot: false,
      };
      this.members.push(m);
      this.system(`${m.name} entrou na sala`);
    }
    m.socketId = socket.id;
    m.connected = true;
    clearTimeout(m.graceTimer);
    clearTimeout(m.seatTimer);
    clearTimeout(this.emptyTimer);
    if (m.id === this.hostId) {
      // o anfitrião voltou a tempo: continua com o cargo
      clearTimeout(this.hostTimer);
      this.hostOrphan = false;
    } else if (!this.members.some((x) => x.id === this.hostId)) this.hostId = m.id;
    else if (this.hostOrphan) this.setHost(m.id); // o cargo estava sem ninguém conectado

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
    // o anfitrião saiu: o cargo vai para o próximo humano conectado (ou, sem nenhum, o próximo humano)
    const wasHost = this.hostId === memberId;
    const heir = wasHost
      ? (this.nextHuman(memberId, (x) => x.connected) ?? this.nextHuman(memberId))
      : null;
    this.members = this.members.filter((x) => x.id !== memberId);
    if (m.socketId) this.io.sockets.sockets.get(m.socketId)?.leave(this.code);
    if (wasHost) {
      clearTimeout(this.hostTimer);
      this.hostId = heir?.id ?? null;
      this.hostOrphan = !!heir && !heir.connected;
    }
    if (!this.members.some((x) => !x.isBot))
      return this.manager.delete(this.code);
    this.system(`${m.name} saiu da sala`);
    if (heir?.connected) this.system(`${heir.name} agora é o anfitrião`);
    if (this.game?.players.some((p) => p.id === memberId)) {
      this.apply(removePlayer(this.game, memberId));
    }
    // quem saiu não segura a próxima rodada nem a revanche
    this.rematchVotes.delete(memberId);
    if (!this.checkReady() && !this.checkRematch()) this.broadcast();
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
    } else this.armSeatTimer(m);
    if (memberId === this.hostId) {
      clearTimeout(this.hostTimer);
      this.hostTimer = setTimeout(() => this.passHost(), HOST_GRACE_MS);
    }
    // caiu na própria vez: schedule() mantém o prazo desta vez
    const g = this.game;
    if (g?.phase === "playing" && g.players[g.turn]?.id === memberId)
      m.droppedTurn = this.turnSeq;
    if (!this.members.some((x) => !x.isBot && x.connected)) {
      this.emptyTimer = setTimeout(
        () => this.manager.delete(this.code),
        EMPTY_ROOM_MS,
      );
    }
    this.schedule(false);
    if (!this.checkReady() && !this.checkRematch()) this.broadcast();
  }

  // Desconectado na partida por SEAT_GRACE_MS: sai da mesa como quem clica em sair (as cartas
  // voltam para o baralho e a vez passa). Continua na sala até a partida acabar; se voltar
  // antes, o join() desarma o timer e nada muda.
  armSeatTimer(m) {
    clearTimeout(m.seatTimer);
    m.seatTimer = setTimeout(() => {
      const g = this.game;
      const p = g?.players.find((x) => x.id === m.id);
      if (m.connected || !p || p.eliminated || g.phase === "gameOver") return;
      this.system(`${m.name} ficou 3 minutos desconectado`);
      this.apply(removePlayer(g, m.id));
    }, SEAT_GRACE_MS);
  }

  // Apelido único na sala (sem diferenciar maiúsculas): "Ana", "Ana 2", "Ana 3"...
  uniqueName(name, selfId) {
    const taken = new Set(
      this.members.filter((x) => x.id !== selfId).map((x) => x.name.toLowerCase()),
    );
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const candidate = name.slice(0, 16 - suffix.length).trimEnd() + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  // Qualquer ação do jogador (jogar, falar, reagir, pronto, ou só tocar na tela) mostra que ele
  // está ali: zera a contagem de tempo esgotado e tira o "ausente". Se for a vez dele, ganha o
  // prazo cheio de novo.
  touch(memberId) {
    const m = this.member(memberId);
    if (!m || m.isBot) return;
    m.idleTimeouts = 0;
    if (!m.away) return;
    m.away = false;
    this.system(`${m.name} voltou`);
    const g = this.game;
    if (g?.phase === "playing" && g.players[g.turn]?.id === m.id) this.schedule(true);
    this.broadcast();
  }

  // ---------- anfitrião ----------
  // Anfitrião sem conexão por HOST_GRACE_MS passa o cargo para o próximo humano conectado, na
  // ordem dos assentos, e não recebe de volta quando reconecta. Sem nenhum humano conectado,
  // o cargo fica "órfão" e vai para quem voltar primeiro.

  passHost() {
    const host = this.member(this.hostId);
    if (!host || host.connected) return;
    const next = this.nextHuman(host.id, (x) => x.connected);
    if (!next) {
      this.hostOrphan = true;
      return;
    }
    this.setHost(next.id);
    this.broadcast();
  }

  setHost(memberId) {
    clearTimeout(this.hostTimer);
    this.hostId = memberId;
    this.hostOrphan = false;
    this.system(`${this.nameOf(memberId)} agora é o anfitrião`);
  }

  // Próximo humano depois de `fromId` na ordem dos assentos (dando a volta na mesa).
  nextHuman(fromId, accept = () => true) {
    const n = this.members.length;
    const i = this.members.findIndex((x) => x.id === fromId);
    for (let k = 1; k <= n; k++) {
      const x = this.members[(i + k + n) % n];
      if (x.id !== fromId && !x.isBot && accept(x)) return x;
    }
    return null;
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
    this.pushChat({ from: m.name, fromId: m.id, color: m.color, text });
  }

  // Reação rápida: vai para todos da sala (inclusive quem mandou), não entra no chat nem no
  // estado. Só ids da lista em shared/reactions.js e no máximo REACTION_LIMIT por pessoa.
  react(memberId, id, now = Date.now()) {
    const m = this.member(memberId);
    if (!m) return { ok: false, error: "Você não está nesta sala" };
    if (!isReaction(id)) return { ok: false, error: "Reação inválida" };
    const slot = takeSlot(m.reactTimes, now, REACTION_LIMIT);
    m.reactTimes = slot.times;
    if (!slot.ok)
      return { ok: false, error: "Calma! Espere um pouquinho para reagir de novo" };
    this.io.to(this.code).emit("reaction", { from: m.id, id });
    return { ok: true };
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
    this.newGame("A partida começou! Boa sorte!");
    return { ok: true };
  }

  // Partida nova com quem está na sala, na ordem dos assentos e com as configurações da sala.
  newGame(message) {
    this.rematchVotes.clear();
    this.ready.clear();
    this.game = createGame(
      this.members.map((m) => ({ id: m.id, name: m.name })),
    );
    this.system(message);
    this.apply(startRound(this.game));
  }

  // ---------- revanche ----------
  // No fim da partida cada humano pede revanche ("Jogar de novo" / "pronto"). Quando todos os
  // humanos conectados pediram, começa uma partida nova com a mesma mesa. Bots e desconectados
  // não seguram; jogando sozinho com bots, o seu pedido já basta.

  rematch(memberId) {
    const g = this.game;
    if (!g || g.phase !== "gameOver")
      return { ok: false, error: "A partida ainda não acabou" };
    const m = this.member(memberId);
    if (!m || m.isBot) return { ok: false, error: "Você não está nesta sala" };
    // quem caiu sai da mesa na revanche: contam só bots e quem está conectado
    if (this.members.filter((x) => x.isBot || x.connected).length < 2)
      return {
        ok: false,
        error: "Precisa de pelo menos 2 jogadores (volte para a sala e adicione um bot!)",
      };
    this.rematchVotes.add(memberId);
    if (!this.checkRematch()) this.broadcast();
    return { ok: true };
  }

  // Humanos conectados que ainda não pediram revanche.
  rematchWaitingOn() {
    if (this.game?.phase !== "gameOver") return [];
    return this.members
      .filter((m) => !m.isBot && m.connected && !m.away && !this.rematchVotes.has(m.id))
      .map((m) => m.id);
  }

  // Começa a revanche se todo mundo pediu. Retorna true se começou (e já avisou todos).
  checkRematch() {
    if (this.game?.phase !== "gameOver" || !this.rematchVotes.size) return false;
    if (this.rematchWaitingOn().length) return false;
    // quem caiu não entra na revanche (como na volta para a sala)
    for (const m of this.members.filter((x) => !x.isBot && !x.connected)) {
      clearTimeout(m.graceTimer);
      this.members = this.members.filter((x) => x.id !== m.id);
      this.system(`${m.name} saiu da sala`);
    }
    if (this.members.length < 2) return false;
    this.newGame("Revanche! Mesma mesa, partida nova. Boa sorte!");
    return true;
  }

  backToLobby(byId) {
    if (byId !== this.hostId)
      return { ok: false, error: "Só o anfitrião pode fazer isso" };
    if (this.game && this.game.phase !== "gameOver")
      return { ok: false, error: "A partida ainda está rolando" };
    this.rematchVotes.clear();
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
      .filter((m) => m && !m.isBot && m.connected && !m.away)
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
    if (over) {
      this.system(`${this.nameOf(over.winnerId)} é o grande vencedor!`);
      this.rematchVotes.clear();
    }

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
    if (newTurn) this.turnSeq++;
    const current = g.players[g.turn];
    const m = this.member(current.id);
    const seq = this.turnSeq;
    clearTimeout(this.timer);
    // Caiu na própria vez (bloqueou o celular, trocou de app): mantém o prazo que tinha, com
    // pelo menos DROP_GRACE_MS, para dar tempo de voltar. A jogada rápida só vale da próxima vez.
    if (m && !m.isBot && !m.connected && !m.away && m.droppedTurn === seq) {
      // o mínimo vale uma vez por vez: cair e voltar várias vezes não estica o prazo
      const floor = m.dropGraceSeq === seq ? 0 : Date.now() + DROP_GRACE_MS;
      m.dropGraceSeq = seq;
      this.deadline = Math.max(this.deadline ?? 0, floor);
      this.turnMs = Math.max(this.turnMs ?? 0, DROP_GRACE_MS);
      this.timer = setTimeout(
        () => this.turnSeq === seq && this.autoplay(current.id, false),
        this.deadline - Date.now(),
      );
      return;
    }
    if (!m || m.isBot || !m.connected || m.away) {
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
    this.timer = setTimeout(
      () => {
        if (this.game !== g || this.turnSeq !== seq) return;
        // Duas vezes seguidas sem jogar: fica ausente e passa a jogar no automático rápido.
        m.idleTimeouts = (m.idleTimeouts ?? 0) + 1;
        if (m.idleTimeouts >= IDLE_TIMEOUTS && !m.away) {
          m.away = true;
          this.system(`${m.name} está ausente, jogadas automáticas até voltar`);
        } else this.system(`O tempo de ${m.name} acabou, jogada automática`);
        this.autoplay(current.id, false);
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
    clearTimeout(this.hostTimer);
    for (const m of this.members) {
      clearTimeout(m.graceTimer);
      clearTimeout(m.seatTimer);
    }
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
        away: !!m.away,
      })),
      game: this.game ? viewFor(this.game, memberId) : null,
      deadline: this.deadline,
      turnMs: this.turnMs,
      ready: [...this.ready],
      waitingOn: this.waitingOn(),
      rematch: [...this.rematchVotes],
      rematchWaitingOn: this.rematchWaitingOn(),
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
