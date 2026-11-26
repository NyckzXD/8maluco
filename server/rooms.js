// Salas estilo "Gartic": código curto, lista de salas públicas, anfitrião, bots e chat.
import { randomUUID } from 'node:crypto';
import { createGame, startRound, playCard, drawCard, passTurn, removePlayer, viewFor } from '../shared/engine.js';
// Bots da mesa jogam com a heurística simples; a busca forte (evaluateMoves) só aparece como
// análise para as contas liberadas (ANALYSIS_USERS), na vez delas.
import { chooseMoveBasic, evaluateMoves } from '../shared/bot.js';
import { randomAvatar, sanitizeAvatar } from '../shared/avatar.js';
import { REACTION_LIMIT, isReaction } from '../shared/reactions.js';
import { BOT_NAME_ERROR, RESERVED_NAME_ERROR, isBotName } from '../shared/names.js';
import { RANKED_MIN_HUMANS } from '../shared/ranking.js';
import { cleanSignal } from './voice.js';

export const MAX_PLAYERS = 8; // lugares na mesa
export const TURN_SECONDS = [5, 10, 15, 30, 45, 60]; // opções de tempo por vez (o seletor do lobby)
export const MAX_SPECTATORS = 4; // e mais estes na plateia (só assistem até abrir lugar)
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
const SNAPSHOT_VERSION = 1;
const SNAPSHOT_MAX_AGE_MS = 10 * 60_000; // salas gravadas há mais que isso não voltam
const RESTORE_HOST_GRACE_MS = 15_000; // depois de reiniciar, o anfitrião tem mais tempo para voltar
const ANALYSIS_MS = 400; // quanto a análise pensa (mais que o bot da mesa: é só sob pedido)

/**
 * @typedef {{ code: string, ranked: boolean, humans: number, bots: number,
 *   players: { userId: number, won: boolean, roundsWon: number, avatar: object | null }[] }} GameSummary
 */

export const BOT_NAMES = [
  'Robô Scarlet',
  'Robô Nina',
  'Robô Duque',
  'Robô Tobias',
  'Robô Laila',
  'Robô Betoven',
  'Robô Meg',
  'Robô Piuli',
  'Robô Bububu',
  'Robô Pingo',
  'Robô Luke',
];
const COLORS = [
  '#ff6b6b',
  '#ffa94d',
  '#ffd43b',
  '#69db7c',
  '#38d9a9',
  '#4dabf7',
  '#9775fa',
  '#f783ac',
  '#a9e34b',
  '#66d9e8',
];

// Limite de frequência por janela deslizante: guarda os horários recentes e diz se cabe mais um.
// Devolve a lista já limpa (só os horários dentro da janela), com o novo incluído quando cabe.
export function takeSlot(times = [], now, { max, windowMs }) {
  const recent = times.filter((t) => now - t < windowMs);
  if (recent.length >= max) return { ok: false, times: recent };
  return { ok: true, times: [...recent, now] };
}

const clean = (text, max) =>
  String(text ?? '')
    // eslint-disable-next-line no-control-regex -- tira os caracteres de controle de propósito
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, max);

export class RoomManager {
  // `timing` troca os tempos de espera (os testes de rede não querem esperar 5s de verdade).
  // `nicknameTaken` diz se um apelido é de alguma conta (convidado não pode usar).
  // `onGameOver` recebe o resumo de cada partida que teve alguém com conta (o ranking grava).
  // `isTop1` diz se a conta está em 1º no ranking (o selo TOP 1 ao lado do nome).
  // `isAnalyst` diz se a conta pode ver a análise do bot forte na própria vez (ANALYSIS_USERS).
  // `iceServers` monta os servidores STUN/TURN de quem entra no voz (voice.js).
  /**
   * @param {any} io
   * @param {{ timing?: object, nicknameTaken?: (name: string) => boolean,
   *   onGameOver?: (summary: GameSummary) => void, isTop1?: (userId: number) => boolean,
   *   isAnalyst?: (user: { id: number, nickname: string }) => boolean,
   *   iceServers?: () => import('./voice.js').RTCIceServerLike[] }} [options]
   */
  constructor(
    io,
    {
      timing = {},
      nicknameTaken = (_name) => false,
      onGameOver = (_summary) => {},
      isTop1 = (_userId) => false,
      isAnalyst = (_user) => false,
      iceServers = () => [],
    } = {},
  ) {
    this.io = io;
    this.rooms = new Map();
    this.timing = { hostGraceMs: HOST_GRACE_MS, ...timing };
    this.nicknameTaken = nicknameTaken;
    this.onGameOver = onGameOver;
    this.isTop1 = isTop1;
    this.isAnalyst = isAnalyst;
    this.iceServers = iceServers;
  }

  create({ isPublic = true } = {}) {
    let code;
    do {
      code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(
        '',
      );
    } while (this.rooms.has(code));
    const room = new Room(this, code, isPublic);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(clean(code, 8).toUpperCase());
  }

  // Números para o /health.
  stats() {
    const rooms = [...this.rooms.values()];
    return {
      rooms: rooms.length,
      games: rooms.filter((r) => r.game && r.game.phase !== 'gameOver').length,
      players: rooms.reduce((n, r) => n + r.members.filter((m) => !m.isBot && m.connected).length, 0),
    };
  }

  // ---------- reinício ----------
  // No desligamento, snapshot() vira um JSON com tudo o que precisa para continuar (membros com
  // token, configurações, estado do motor com a seed, chat). Na subida, restore() recria as
  // salas com todo mundo desconectado; a partida fica parada até alguém voltar.

  snapshot(now = Date.now()) {
    return {
      version: SNAPSHOT_VERSION,
      savedAt: now,
      rooms: [...this.rooms.values()].filter((r) => r.members.some((m) => !m.isBot)).map((r) => r.toJSON()),
    };
  }

  // Devolve quantas salas voltaram. Snapshot velho (ninguém mais está esperando) é ignorado.
  restore(data, now = Date.now()) {
    if (data?.version !== SNAPSHOT_VERSION || !Array.isArray(data.rooms)) return 0;
    if (!(now - data.savedAt <= SNAPSHOT_MAX_AGE_MS)) return 0;
    let count = 0;
    for (const raw of data.rooms) {
      if (!raw?.code || this.rooms.has(raw.code)) continue;
      try {
        this.rooms.set(raw.code, Room.fromJSON(this, raw));
        count++;
      } catch (err) {
        console.error(`[restore] sala ${raw.code}:`, err);
      }
    }
    return count;
  }

  // Desligamento: avisa todas as salas e para os timers (ninguém joga sozinho enquanto fecha).
  shutdown(message) {
    for (const room of this.rooms.values()) {
      room.system(message);
      room.dispose();
    }
    this.io.emit('server:restart', { message });
  }

  delete(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.dispose();
    this.rooms.delete(code);
  }

  listPublic() {
    return [...this.rooms.values()]
      .filter((r) => r.settings.isPublic && r.members.some((m) => !m.isBot && m.connected))
      .map((r) => {
        const host = r.members.find((m) => m.id === r.hostId);
        return {
          code: r.code,
          host: host?.name ?? '?',
          hostAvatar: host?.avatar ?? null,
          hostColor: host?.color ?? null,
          players: r.seated().length,
          max: MAX_PLAYERS,
          watching: r.members.length - r.seated().length,
          // cheia de verdade só quando nem a plateia tem vaga
          full: r.members.length >= MAX_PLAYERS + MAX_SPECTATORS,
          playing: !!r.game && r.game.phase !== 'gameOver',
        };
      })
      .sort((a, b) => Number(a.playing) - Number(b.playing) || b.players - a.players);
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
    this.banned = new Set(); // tokens (e "u:<id>" das contas) de quem o anfitrião removeu (some junto com a sala)
    this.emptyTimer = null;
    this.hostTimer = null; // anfitrião desconectado: quando o cargo passa para outro
    this.hostOrphan = false; // nenhum humano conectado para assumir: o próximo que entrar assume
    this.turnSeq = 0; // conta as vezes: distingue "esta vez" de "a próxima vez do mesmo jogador"
    this.analysis = null; // última análise do bot forte (Room.analyze), reaproveitada na mesma vez
  }

  // ---------- membros ----------

  // Quem entrou na conta (socket.data.user, do handshake) aparece sempre com o apelido da conta;
  // convidado escolhe o nome, desde que não seja o de uma conta.
  join(socket, { token, name, avatar }) {
    /** @type {{ id: number, nickname: string } | null} */
    const user = socket.data.user ?? null;
    token = clean(token, 64);
    name = user ? user.nickname : clean(name, 16) || 'Jogador';
    avatar = sanitizeAvatar(avatar);
    if (!token) return { ok: false, error: 'Sessão inválida' };
    if (!user && isBotName(name)) return { ok: false, error: BOT_NAME_ERROR };

    if (this.banned.has(token) || (user && this.banned.has(`u:${user.id}`)))
      return { ok: false, error: 'Você foi removido desta sala' };

    // a mesma conta noutro aparelho (outro token) volta para o mesmo lugar
    let m = this.members.find((x) => !x.isBot && (x.token === token || (user && x.userId === user.id)));
    // Convidado com o apelido de uma conta: só se já estava na sala com ele (a conta pode ter
    // sido criada depois, e quem cai e volta não perde o lugar por isso).
    const keepsName = m && !m.userId && m.askedName === name;
    if (!user && !keepsName && this.manager.nicknameTaken(name)) return { ok: false, error: RESERVED_NAME_ERROR };

    if (m) {
      m.token = token;
      m.userId = user?.id ?? null;
      // conta: o apelido dela; convidado voltando com o mesmo apelido mantém o nome que já tinha
      // na sala (o "Ana 2" continua "Ana 2")
      if (user) m.name = name;
      else if (name !== m.askedName) m.name = this.uniqueName(name, m.id);
      m.askedName = name;
      m.avatar = avatar;
      // as conexões de voz eram da conexão antiga: quem volta entra no voz de novo (voice:join)
      if (m.socketId !== socket.id) this.dropVoice(m);
      // Mesmo token por outra conexão (outra aba): a nova assume o lugar e a antiga perde
      // o acesso à sala de vez, não só o canal (senão ela ainda conseguiria jogar e falar).
      if (m.socketId && m.socketId !== socket.id) {
        const old = this.io.sockets.sockets.get(m.socketId);
        if (old) {
          old.leave(this.code);
          old.data.code = null;
          old.data.memberId = null;
          old.emit('room:replaced', { code: this.code });
        }
      }
    } else {
      if (this.members.length >= MAX_PLAYERS + MAX_SPECTATORS) return { ok: false, error: 'A sala está cheia' };
      m = {
        id: randomUUID().slice(0, 8),
        token,
        userId: user?.id ?? null,
        name: user ? name : this.uniqueName(name),
        askedName: name,
        avatar,
        color: this.freeColor(),
        isBot: false,
      };
      this.members.push(m);
      this.system(`${m.name} entrou na sala`);
    }
    if (user) this.yieldName(m);
    // vale para esta conexão: outra conta (ou sair da conta) no mesmo lugar perde o acesso
    m.analyst = !!user && this.manager.isAnalyst(user);
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
    socket.emit('chat:history', this.chat);
    if (this.resumePending) this.resume();
    else this.schedule(false);
    this.broadcast();
    return { ok: true, code: this.code, spectator: this.spectating(m.id) };
  }

  // ---------- reinício ----------

  toJSON() {
    return {
      code: this.code,
      settings: this.settings,
      hostId: this.hostId,
      members: this.members.map((m) => ({
        id: m.id,
        token: m.token,
        userId: m.userId ?? null,
        name: m.name,
        askedName: m.askedName,
        avatar: m.avatar,
        color: m.color,
        isBot: m.isBot,
      })),
      chat: this.chat,
      game: this.game,
      ready: [...this.ready],
      rematchVotes: [...this.rematchVotes],
      record: this.record ?? null,
      banned: [...this.banned],
    };
  }

  // Sala que voltou de um reinício: todo mundo começa desconectado, com os mesmos prazos de uma
  // queda (lugar no lobby, lugar na mesa, sala vazia), e a partida espera o primeiro voltar.
  static fromJSON(manager, d) {
    const room = new Room(manager, d.code, d.settings?.isPublic !== false);
    room.settings = { ...room.settings, ...d.settings };
    room.members = d.members.map((m) => ({ ...m, connected: !!m.isBot, socketId: null }));
    room.hostId = d.hostId;
    room.chat = Array.isArray(d.chat) ? d.chat : [];
    room.game = d.game ?? null;
    room.ready = new Set(d.ready ?? []);
    room.record = d.record ?? null;
    room.rematchVotes = new Set(d.rematchVotes ?? []);
    room.banned = new Set(d.banned ?? []);
    room.resumePending = room.game?.phase === 'playing';
    for (const m of room.members) if (!m.isBot) room.armAbsence(m);
    room.hostTimer = room.later(() => room.passHost(), RESTORE_HOST_GRACE_MS);
    room.emptyTimer = room.later(() => manager.delete(room.code), EMPTY_ROOM_MS);
    room.system('O servidor reiniciou. A partida continua de onde parou!');
    return room;
  }

  // Primeira pessoa de volta depois do reinício: a vez de quem estava jogando recomeça com o
  // prazo cheio (mesmo que essa pessoa ainda não tenha voltado).
  resume() {
    this.resumePending = false;
    const g = this.game;
    if (g?.phase !== 'playing') return this.schedule(false);
    this.turnSeq++;
    this.turnMs = this.settings.turnSeconds * 1000;
    this.deadline = Date.now() + this.turnMs;
    const m = this.member(g.players[g.turn].id);
    if (m && !m.isBot && !m.connected) m.droppedTurn = this.turnSeq;
    this.schedule(false);
  }

  // Quem senta na mesa: na partida, quem está nela; fora dela, os MAX_PLAYERS primeiros a chegar.
  seated() {
    const g = this.game;
    if (g && g.phase !== 'gameOver') return this.members.filter((m) => g.players.some((p) => p.id === m.id));
    return this.members.slice(0, MAX_PLAYERS);
  }

  // Na plateia: assiste a partida atual (ou espera lugar na mesa) e entra na próxima se couber.
  spectating(memberId) {
    return !this.seated().some((m) => m.id === memberId);
  }

  leave(memberId) {
    const m = this.member(memberId);
    if (!m) return;
    // o anfitrião saiu: o cargo vai para o próximo humano conectado (ou, sem nenhum, o próximo humano)
    const wasHost = this.hostId === memberId;
    const heir = wasHost ? (this.nextHuman(memberId, (x) => x.connected) ?? this.nextHuman(memberId)) : null;
    this.dropVoice(m);
    this.members = this.members.filter((x) => x.id !== memberId);
    if (m.socketId) this.io.sockets.sockets.get(m.socketId)?.leave(this.code);
    if (wasHost) {
      clearTimeout(this.hostTimer);
      this.hostId = heir?.id ?? null;
      this.hostOrphan = !!heir && !heir.connected;
    }
    if (!this.members.some((x) => !x.isBot)) return this.manager.delete(this.code);
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
    this.dropVoice(m);
    m.connected = false;
    m.socketId = null;
    this.armAbsence(m);
    if (memberId === this.hostId) {
      clearTimeout(this.hostTimer);
      this.hostTimer = this.later(() => this.passHost(), this.manager.timing.hostGraceMs);
    }
    // caiu na própria vez: schedule() mantém o prazo desta vez
    const g = this.game;
    if (g?.phase === 'playing' && g.players[g.turn]?.id === memberId) m.droppedTurn = this.turnSeq;
    if (!this.members.some((x) => !x.isBot && x.connected)) {
      this.emptyTimer = this.later(() => this.manager.delete(this.code), EMPTY_ROOM_MS);
    }
    this.schedule(false);
    if (!this.checkReady() && !this.checkRematch()) this.broadcast();
  }

  // Quanto tempo quem está desconectado segura o lugar: no lobby, LOBBY_GRACE_MS; na mesa, SEAT_GRACE_MS.
  armAbsence(m) {
    const g = this.game;
    const seated = g && g.phase !== 'gameOver' && g.players.some((p) => p.id === m.id);
    if (seated) this.armSeatTimer(m);
    else m.graceTimer = this.later(() => this.leave(m.id), LOBBY_GRACE_MS);
  }

  // Desconectado na partida por SEAT_GRACE_MS: sai da mesa como quem clica em sair (as cartas
  // voltam para o baralho e a vez passa). Continua na sala até a partida acabar; se voltar
  // antes, o join() desarma o timer e nada muda.
  armSeatTimer(m) {
    clearTimeout(m.seatTimer);
    m.seatTimer = this.later(() => {
      const g = this.game;
      const p = g?.players.find((x) => x.id === m.id);
      if (m.connected || !p || p.eliminated || g.phase === 'gameOver') return;
      this.system(`${m.name} ficou 3 minutos desconectado`);
      this.apply(removePlayer(g, m.id));
    }, SEAT_GRACE_MS);
  }

  // Apelido único na sala (sem diferenciar maiúsculas): "Ana", "Ana 2", "Ana 3"...
  uniqueName(name, selfId) {
    const taken = new Set(this.members.filter((x) => x.id !== selfId).map((x) => x.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const candidate = name.slice(0, 16 - suffix.length).trimEnd() + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  // O apelido da conta é dela: um convidado da sala com o mesmo nome vira "Ana 2".
  yieldName(owner) {
    const key = owner.name.toLowerCase();
    for (const x of this.members)
      if (x !== owner && !x.isBot && !x.userId && x.name.toLowerCase() === key) x.name = this.uniqueName(x.name, x.id);
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
    if (g?.phase === 'playing' && g.players[g.turn]?.id === m.id) this.schedule(true);
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
  /** @param {(member: any) => boolean} [accept] */
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
    if (byId !== this.hostId) return { ok: false, error: 'Só o anfitrião pode adicionar bots' };
    if (this.game && this.game.phase !== 'gameOver') return { ok: false, error: 'Espere a partida acabar' };
    if (this.members.length >= MAX_PLAYERS) return { ok: false, error: 'A sala está cheia' };
    const used = new Set(this.members.map((m) => m.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Robô ${this.members.length + 1}`;
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
    if (byId !== this.hostId) return { ok: false, error: 'Só o anfitrião pode remover jogadores' };
    if (memberId === byId) return { ok: false, error: 'Use o botão de sair' };
    const m = this.member(memberId);
    if (!m) return { ok: false, error: 'Jogador não encontrado' };
    // pessoa removida não volta pelo mesmo link: o token fica barrado enquanto a sala existir
    if (!m.isBot) this.banned.add(m.token);
    if (m.userId) this.banned.add(`u:${m.userId}`); // nem pela mesma conta em outro aparelho
    if (m.socketId) this.io.to(m.socketId).emit('room:kicked');
    this.leave(memberId);
    return { ok: true };
  }

  updateSettings(byId, patch) {
    if (byId !== this.hostId) return { ok: false, error: 'Só o anfitrião muda as configurações' };
    if (typeof patch.isPublic === 'boolean') this.settings.isPublic = patch.isPublic;
    if (TURN_SECONDS.includes(patch.turnSeconds)) this.settings.turnSeconds = patch.turnSeconds;
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
    if (!m) return { ok: false, error: 'Você não está nesta sala' };
    if (!isReaction(id)) return { ok: false, error: 'Reação inválida' };
    const slot = takeSlot(m.reactTimes, now, REACTION_LIMIT);
    m.reactTimes = slot.times;
    if (!slot.ok) return { ok: false, error: 'Calma! Espere um pouquinho para reagir de novo' };
    this.io.to(this.code).emit('reaction', { from: m.id, id });
    return { ok: true };
  }

  // ---------- voz ----------
  // Quem está no voz tem `m.voice = { muted }`. O estado da sala mostra isso nos assentos; o
  // áudio em si não passa por aqui. Quem entra recebe a lista de quem já está e manda a oferta
  // para cada um (voiceSignal repassa); quem sai avisa os outros com `voice:peer-left`, para
  // fecharem a conexão na hora. Nada disso vai para o snapshot: depois de um reinício, cada um
  // entra de novo.

  // Entrar (ou, já dentro, pedir de novo a lista e as credenciais, como depois de reconectar).
  voiceJoin(memberId, { muted = false } = {}) {
    const m = this.member(memberId);
    if (!m || m.isBot || !m.connected) return { ok: false, error: 'Você não está nesta sala' };
    const already = !!m.voice;
    m.voice = { muted: !!muted };
    const peers = this.voicePeers(m.id).map((x) => x.id);
    if (!already) this.broadcast();
    return { ok: true, peers, iceServers: this.manager.iceServers() };
  }

  voiceLeave(memberId) {
    const m = this.member(memberId);
    if (!m?.voice) return { ok: true };
    this.dropVoice(m);
    this.broadcast();
    return { ok: true };
  }

  voiceMute(memberId, muted) {
    const m = this.member(memberId);
    if (!m?.voice) return { ok: false, error: 'Você não está no voz' };
    if (m.voice.muted !== !!muted) {
      m.voice.muted = !!muted;
      this.broadcast();
    }
    return { ok: true };
  }

  // Repassa uma mensagem de negociação para outra pessoa do voz desta sala, com o id de quem
  // mandou. Só entre dois que estão no voz e conectados; o conteúdo passa pelo cleanSignal.
  /** @param {string} memberId @param {{ to?: unknown, data?: unknown }} [message] */
  voiceSignal(memberId, message = {}) {
    const { to, data } = message;
    const m = this.member(memberId);
    if (!m?.voice) return { ok: false, error: 'Você não está no voz' };
    const target = typeof to === 'string' && to !== m.id ? this.member(to) : null;
    if (!target?.voice || !target.connected || !target.socketId)
      return { ok: false, error: 'Essa pessoa não está no voz' };
    const signal = cleanSignal(data);
    if (!signal) return { ok: false, error: 'Mensagem de voz inválida' };
    this.io.to(target.socketId).emit('voice:signal', { from: m.id, ...signal });
    return { ok: true };
  }

  // Os outros que estão no voz agora (sempre conectados: a queda tira do voz).
  voicePeers(exceptId) {
    return this.members.filter((x) => x.voice && x.id !== exceptId && x.socketId);
  }

  // Tira do voz sem mandar o estado (quem chama já manda); avisa quem ficou.
  dropVoice(m) {
    if (!m?.voice) return;
    m.voice = null;
    for (const x of this.voicePeers(m.id)) this.io.to(x.socketId).emit('voice:peer-left', { id: m.id });
  }

  system(text) {
    this.pushChat({ system: true, text });
  }

  pushChat(msg) {
    msg.at = Date.now();
    this.chat.push(msg);
    if (this.chat.length > 60) this.chat.shift();
    this.io.to(this.code).emit('chat', msg);
  }

  // ---------- partida ----------

  start(byId) {
    if (byId !== this.hostId) return { ok: false, error: 'Só o anfitrião pode começar' };
    if (this.game && this.game.phase !== 'gameOver') return { ok: false, error: 'A partida já começou' };
    if (this.members.length < 2)
      return {
        ok: false,
        error: 'Precisa de pelo menos 2 jogadores (adicione um bot!)',
      };
    this.newGame('A partida começou! Boa sorte!');
    return { ok: true };
  }

  // Partida nova com quem está na sala, na ordem dos assentos e com as configurações da sala.
  newGame(message) {
    this.rematchVotes.clear();
    this.ready.clear();
    // na mesa entra quem couber, pela ordem de chegada; o resto continua na plateia
    this.game = createGame(this.members.slice(0, MAX_PLAYERS).map((m) => ({ id: m.id, name: m.name })));
    this.startRecord();
    this.system(message);
    this.apply(startRound(this.game));
  }

  // ---------- ranking ----------
  // Quem sentou no começo da partida: a conta de cada lugar (quem sai no meio ainda conta a
  // partida, sem vitória) e se a mesa tinha gente o bastante para valer no ranking.

  startRecord() {
    const players = this.game.players.map((p) => {
      const m = this.member(p.id);
      return { id: p.id, userId: m?.userId ?? null, isBot: !!m?.isBot, roundsWon: 0 };
    });
    const humans = players.filter((p) => !p.isBot).length;
    this.record = { players, humans, ranked: humans >= RANKED_MIN_HUMANS, done: false };
  }

  // Fim da partida: manda o resumo para o ranking (só se tinha alguém com conta).
  finishRecord(winnerId) {
    const rec = this.record;
    if (!rec || rec.done) return;
    rec.done = true;
    const accounts = rec.players.filter((p) => p.userId);
    if (!accounts.length) return;
    try {
      this.manager.onGameOver({
        code: this.code,
        ranked: rec.ranked,
        humans: rec.humans,
        bots: rec.players.length - rec.humans,
        players: accounts.map((p) => ({
          userId: p.userId,
          won: p.id === winnerId,
          roundsWon: p.roundsWon,
          avatar: this.member(p.id)?.avatar ?? null,
        })),
      });
    } catch (err) {
      console.error(`[ranking] sala ${this.code}:`, err);
    }
  }

  // ---------- revanche ----------
  // No fim da partida cada humano pede revanche ("Jogar de novo" / "pronto"). Quando todos os
  // humanos conectados pediram, começa uma partida nova com a mesma mesa. Bots e desconectados
  // não seguram; jogando sozinho com bots, o seu pedido já basta.

  rematch(memberId) {
    const g = this.game;
    if (!g || g.phase !== 'gameOver') return { ok: false, error: 'A partida ainda não acabou' };
    const m = this.member(memberId);
    if (!m || m.isBot) return { ok: false, error: 'Você não está nesta sala' };
    // quem caiu sai da mesa na revanche: contam só bots e quem está conectado
    if (this.members.filter((x) => x.isBot || x.connected).length < 2)
      return {
        ok: false,
        error: 'Precisa de pelo menos 2 jogadores (volte para a sala e adicione um bot!)',
      };
    this.rematchVotes.add(memberId);
    if (!this.checkRematch()) this.broadcast();
    return { ok: true };
  }

  // Humanos conectados que vão sentar na revanche e ainda não pediram. Quem caiu sai da mesa
  // nova, e quem fica na plateia (não coube) não segura ninguém.
  rematchWaitingOn() {
    if (this.game?.phase !== 'gameOver') return [];
    return this.members
      .filter((m) => m.isBot || m.connected)
      .slice(0, MAX_PLAYERS)
      .filter((m) => !m.isBot && !m.away && !this.rematchVotes.has(m.id))
      .map((m) => m.id);
  }

  // Começa a revanche se todo mundo pediu. Retorna true se começou (e já avisou todos).
  checkRematch() {
    if (this.game?.phase !== 'gameOver' || !this.rematchVotes.size) return false;
    if (this.rematchWaitingOn().length) return false;
    // quem caiu não entra na revanche (como na volta para a sala)
    for (const m of this.members.filter((x) => !x.isBot && !x.connected)) {
      clearTimeout(m.graceTimer);
      // o anfitrião caiu e ficou de fora: o cargo passa antes de ele sair (como no leave())
      const heir = m.id === this.hostId ? this.nextHuman(m.id, (x) => x.connected) : undefined;
      this.members = this.members.filter((x) => x.id !== m.id);
      this.system(`${m.name} saiu da sala`);
      if (heir) this.setHost(heir.id);
      else if (heir === null) {
        // ninguém conectado para assumir: o próximo que entrar vira anfitrião (join())
        clearTimeout(this.hostTimer);
        this.hostId = null;
      }
    }
    if (this.members.length < 2) return false;
    this.newGame('Revanche! Mesma mesa, partida nova. Boa sorte!');
    return true;
  }

  backToLobby(byId) {
    if (byId !== this.hostId) return { ok: false, error: 'Só o anfitrião pode fazer isso' };
    if (this.game && this.game.phase !== 'gameOver') return { ok: false, error: 'A partida ainda está rolando' };
    this.rematchVotes.clear();
    this.game = null;
    this.clearTimer();
    for (const m of this.members.filter((x) => !x.isBot && !x.connected)) this.leave(m.id);
    this.broadcast();
    return { ok: true };
  }

  act(memberId, action) {
    if (!this.game) return { ok: false, error: 'Nenhuma partida em andamento' };
    let result;
    if (action.type === 'play') result = playCard(this.game, memberId, clean(action.cardId, 16), action.suit);
    else if (action.type === 'draw') result = drawCard(this.game, memberId);
    else if (action.type === 'pass') result = passTurn(this.game, memberId);
    else return { ok: false, error: 'Ação desconhecida' };
    if (!result.ok) return result;
    this.apply(result);
    return { ok: true };
  }

  // O que o bot forte jogaria agora, na vez de quem pediu. Só para as contas liberadas.
  // A mesma situação (mesma vez, antes ou depois de comprar) devolve a análise já feita.
  analyze(memberId) {
    const m = this.member(memberId);
    if (!m?.analyst) return { ok: false, error: 'Análise não liberada para esta conta' };
    const g = this.game;
    if (!g || g.phase !== 'playing' || g.players[g.turn]?.id !== memberId)
      return { ok: false, error: 'A análise é só na sua vez' };
    const key = `${g.round}:${this.turnSeq}:${g.hasDrawn ? 1 : 0}:${g.players[g.turn].hand.length}`;
    if (this.analysis?.key !== key) {
      const { moves, samples } = evaluateMoves(g, memberId, { maxMs: ANALYSIS_MS, maxRollouts: 60000 });
      const best = moves.find((x) => x.best);
      this.analysis = {
        key,
        samples,
        moves: moves
          .map(({ move, value, samples: n, best: isBest }) => ({
            ...move,
            // diferença para a melhor, em pontos de resultado médio da rodada (0 = a melhor)
            loss: isBest ? 0 : Math.max(0, best.value - value),
            value,
            samples: n,
            best: isBest,
          }))
          .sort((a, b) => b.value - a.value),
      };
    }
    return { ok: true, key, samples: this.analysis.samples, moves: this.analysis.moves };
  }

  setReady(memberId) {
    const g = this.game;
    if (!g || g.phase !== 'roundOver') return { ok: false, error: 'A rodada ainda não acabou' };
    if (!g.players.some((p) => p.id === memberId && !p.eliminated))
      return { ok: false, error: 'Você não está na próxima rodada' };
    this.ready.add(memberId);
    if (!this.checkReady()) this.broadcast();
    return { ok: true };
  }

  // Humanos conectados que ainda vão jogar e não clicaram em "pronto". Bots e desconectados não seguram a mesa.
  waitingOn() {
    const g = this.game;
    if (!g || g.phase !== 'roundOver') return [];
    return g.players
      .filter((p) => !p.eliminated && !this.ready.has(p.id))
      .map((p) => this.member(p.id))
      .filter((m) => m && !m.isBot && m.connected && !m.away)
      .map((m) => m.id);
  }

  // Começa a próxima rodada se todo mundo estiver pronto. Retorna true se começou (e já avisou todos).
  checkReady() {
    const g = this.game;
    if (!g || g.phase !== 'roundOver' || this.waitingOn().length) return false;
    if (!this.ready.size) return false; // ninguém para clicar: quem cuida é o timer de apply()
    this.ready.clear();
    this.apply(startRound(g));
    return true;
  }

  // Aplica o resultado de uma jogada: avisa todo mundo e agenda o próximo passo.
  /** @param {any} result @param {{ newTurn?: boolean }} [options] */
  apply(result, { newTurn } = {}) {
    const events = result.events ?? [];
    const g = this.game;
    newTurn ??= events.some((e) => ['play', 'pass', 'roundStart', 'left'].includes(e.type));

    const end = events.find((e) => e.type === 'roundEnd');
    if (end) {
      const seat = this.record?.players.find((p) => p.id === end.winnerId);
      if (seat) seat.roundsWon++;
    }
    if (end) this.system(`${this.nameOf(end.winnerId)} bateu e venceu a rodada ${end.round}!`);
    for (const e of events)
      if (e.type === 'left' && g.phase !== 'gameOver') this.system(`${this.nameOf(e.playerId)} saiu da mesa`);
    const over = events.find((e) => e.type === 'gameOver');
    if (over) {
      this.finishRecord(over.winnerId);
      this.system(`${this.nameOf(over.winnerId)} é o grande vencedor!`);
      this.rematchVotes.clear();
    }

    if (end && g.phase === 'roundOver') {
      this.clearTimer();
      this.ready.clear();
      // Sem nenhum humano conectado na mesa não há quem clique em "pronto": segue sozinho.
      if (!this.waitingOn().length)
        this.timer = this.later(() => {
          if (this.game === g && g.phase === 'roundOver') this.apply(startRound(g));
        }, ROUND_BREAK_MS);
    }
    const dealing = events.some((e) => e.type === 'roundStart');
    this.schedule(newTurn, dealing ? DEAL_MS : 0);
    this.broadcast(events);
  }

  // Cuida do relógio da vez: bots jogam sozinhos, humanos têm um tempo limite.
  // `extraMs` dá um tempo a mais nesta vez (a distribuição das cartas no começo da rodada).
  schedule(newTurn, extraMs = 0) {
    const g = this.game;
    if (!g || g.phase !== 'playing') {
      if (!g || g.phase === 'gameOver') this.clearTimer();
      this.deadline = null;
      return;
    }
    // voltou de um reinício e ninguém reconectou ainda: o relógio fica parado (resume() solta)
    if (this.resumePending) {
      clearTimeout(this.timer);
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
      this.timer = this.later(
        () => this.turnSeq === seq && this.autoplay(current.id, false),
        this.deadline - Date.now(),
      );
      return;
    }
    if (!m || m.isBot || !m.connected || m.away) {
      const [min, max] = BOT_DELAY_MS;
      let delay = m?.isBot ? min + Math.random() * (max - min) : AWAY_DELAY_MS;
      delay += extraMs;
      // Bot e ausente também têm prazo: é quando a jogada automática acontece,
      // e o anel de tempo dos outros esvazia até lá.
      this.deadline = Date.now() + delay;
      this.turnMs = delay;
      this.timer = this.later(() => this.autoplay(current.id, !!m?.isBot), delay);
      return;
    }
    if (newTurn || !this.deadline || !this.turnMs || this.turnMs < this.settings.turnSeconds * 1000) {
      this.turnMs = this.settings.turnSeconds * 1000 + extraMs;
      this.deadline = Date.now() + this.turnMs;
    }
    this.timer = this.later(
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
      if (!g || g.phase !== 'playing' || g.players[g.turn].id !== playerId) break;
      const move = chooseMoveBasic(g, playerId);
      const r =
        move.type === 'play'
          ? playCard(g, playerId, move.cardId, move.suit)
          : move.type === 'draw'
            ? drawCard(g, playerId)
            : passTurn(g, playerId);
      if (!r.ok) break;
      events.push(...r.events);
      if (singleStep) break;
    }
    if (events.length) this.apply({ events });
  }

  // setTimeout com o erro no log (com o código da sala) em vez de derrubar o processo.
  later(fn, ms) {
    return setTimeout(() => {
      try {
        fn();
      } catch (err) {
        console.error(`[timer] sala ${this.code}:`, err);
      }
    }, ms);
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
      this.io.to(m.socketId).emit('state', this.viewFor(m.id, events));
    }
  }

  viewFor(memberId, events) {
    return {
      code: this.code,
      me: memberId,
      hostId: this.hostId,
      settings: this.settings,
      maxPlayers: MAX_PLAYERS,
      maxSpectators: MAX_SPECTATORS,
      ranked: !!this.record?.ranked, // a partida atual (ou a que acabou) vale para o ranking
      spectators: this.members.filter((m) => this.spectating(m.id)).map((m) => m.id),
      members: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        color: m.color,
        isBot: m.isBot,
        account: !!m.userId, // entrou com conta (o nome é o apelido dela)
        top1: !!m.userId && this.manager.isTop1(m.userId), // 1º do ranking
        connected: m.connected,
        away: !!m.away,
        voice: !!m.voice, // no chat de voz
        voiceMuted: !!m.voice?.muted,
      })),
      // a conta de quem recebe pode pedir a análise do bot forte (game:analyze)
      analyst: !!this.member(memberId)?.analyst,
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
    return this.member(id)?.name ?? this.game?.players.find((p) => p.id === id)?.name ?? '?';
  }

  freeColor() {
    const used = new Set(this.members.map((m) => m.color));
    return COLORS.find((c) => !used.has(c)) ?? COLORS[this.members.length % COLORS.length];
  }
}
