// Contas: apelido + senha, sessões e apagar conta. Só fala com o banco (server/db.js); as rotas
// HTTP ficam em server/api.js.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { nicknameError, nicknameKey, passwordError, tidyNickname } from '../shared/names.js';

/** @type {(password: string, salt: Buffer, keylen: number, options: import('node:crypto').ScryptOptions) => Promise<Buffer>} */
const scrypt = promisify(scryptCb);

// scrypt com N = 2^15, r = 8, p = 1: uns 32MB e algumas dezenas de ms por senha. Sempre a versão
// assíncrona: a síncrona travaria os timers das partidas, que rodam neste mesmo processo.
const SCRYPT = { log2N: 15, r: 8, p: 1, keylen: 32 };
const MAXMEM = 64 * 1024 * 1024;

export const SESSION_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
const SESSION_MS = SESSION_DAYS * DAY;
const RENEW_BEFORE_MS = SESSION_MS / 2; // usou a sessão com menos da metade do prazo: renova

const WRONG_LOGIN = 'Apelido ou senha incorretos';
const NICK_TAKEN = 'Esse apelido já tem dono. Escolha outro!';
// Primeira vez com o Google: a pessoa ainda escolhe o apelido. O "ticket" segura o sub do Google
// enquanto isso (só na memória: um reinício no meio só pede para entrar com o Google de novo).
const GOOGLE_TICKET_MS = 10 * 60_000;

// Formato guardado: scrypt$log2N$r$p$sal$hash (sal e hash em base64url). Os parâmetros vão
// junto para dar para endurecer depois sem invalidar as senhas antigas.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const { log2N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password, salt, keylen, { N: 2 ** log2N, r, p, maxmem: MAXMEM });
  return ['scrypt', log2N, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, log2N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: 2 ** Number(log2N),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return timingSafeEqual(got, expected);
}

// Hash de uma senha qualquer: apelido que não existe gasta o mesmo tempo que senha errada.
let dummyHash = null;
const dummy = async () => (dummyHash ??= await hashPassword(randomBytes(16).toString('hex')));

/**
 * @typedef {{ id: number, nickname: string, nickname_key: string, password_hash: string | null,
 *   google_sub: string | null, avatar: string | null, created_at: number }} UserRow
 */

/** @typedef {{ ok: true, user: object, session: string } | { ok: false, error: string, status: number }} AuthResult */
/** @typedef {{ id: number, nickname: string, avatar: object | null, rank: number, wins: number, games: number, rounds: number }} LeaderRow */

const parseAvatar = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export class Accounts {
  /** @param {import('better-sqlite3').Database} db @param {{ now?: () => number }} [options] */
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
    /** @type {Map<string, { sub: string, expires: number }>} */
    this.googleTickets = new Map();
    this.q = {
      byKey: db.prepare('SELECT * FROM users WHERE nickname_key = ?'),
      byId: db.prepare('SELECT * FROM users WHERE id = ?'),
      byGoogle: db.prepare('SELECT * FROM users WHERE google_sub = ?'),
      insertUser: db.prepare(
        'INSERT INTO users (nickname, nickname_key, password_hash, google_sub, created_at) VALUES (?, ?, ?, ?, ?)',
      ),
      deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
      insertSession: db.prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      ),
      session: db.prepare(
        'SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      ),
      renewSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
      deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
      pruneUser: db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?'),
      prune: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
      insertGame: db.prepare('INSERT INTO games (room_code, finished_at, ranked, humans, bots) VALUES (?, ?, ?, ?, ?)'),
      // conta apagada no meio da partida: o SELECT não acha ninguém e a linha não entra
      insertGamePlayer: db.prepare(
        'INSERT INTO game_players (game_id, user_id, won, rounds_won) SELECT ?, id, ?, ? FROM users WHERE id = ?',
      ),
      setAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
      // Todo mundo que já jogou partida valendo: mais vitórias primeiro; empate, quem precisou de
      // menos partidas; depois o apelido. RANK() dá a mesma posição para quem empatou de verdade.
      leaderboard: db.prepare(`
        SELECT u.id, u.nickname, u.avatar,
          SUM(gp.won) AS wins, COUNT(*) AS games, SUM(gp.rounds_won) AS rounds,
          RANK() OVER (ORDER BY SUM(gp.won) DESC, COUNT(*) ASC) AS rank
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id AND g.ranked = 1
        JOIN users u ON u.id = gp.user_id
        GROUP BY u.id
        ORDER BY rank, u.nickname_key`),
    };
    /** @type {LeaderRow[] | null} */
    this.leaderCache = null; // refeito só quando muda (partida gravada, conta apagada)
  }

  // ---------- ranking ----------

  // Grava uma partida que acabou (resumo do Room.finishRecord). O avatar de cada um vai junto
  // para a conta, para o ranking mostrar a cara de quem está lá.
  /** @param {import('./rooms.js').GameSummary} summary */
  recordGame({ code, ranked, humans, bots, players }) {
    this.db.transaction(() => {
      const gameId = this.q.insertGame.run(code, this.now(), ranked ? 1 : 0, humans, bots).lastInsertRowid;
      for (const p of players) {
        this.q.insertGamePlayer.run(gameId, p.won ? 1 : 0, p.roundsWon, p.userId);
        if (p.avatar) this.q.setAvatar.run(JSON.stringify(p.avatar), p.userId);
      }
    })();
    this.leaderCache = null;
  }

  /** @returns {LeaderRow[]} */
  leaderboard() {
    this.leaderCache ??= this.q.leaderboard.all().map((/** @type {any} */ r) => ({
      id: r.id,
      nickname: r.nickname,
      avatar: parseAvatar(r.avatar),
      rank: r.rank,
      wins: r.wins,
      games: r.games,
      rounds: r.rounds,
    }));
    return this.leaderCache;
  }

  // O que sai para o navegador: nada de hash, sub do Google ou chave interna.
  /** @param {UserRow} row */
  static public(row) {
    return { id: row.id, nickname: row.nickname, hasPassword: !!row.password_hash, hasGoogle: !!row.google_sub };
  }

  /** @returns {Promise<AuthResult>} */
  async register({ nickname, password }) {
    const error = nicknameError(nickname) ?? passwordError(password);
    if (error) return { ok: false, error, status: 400 };
    if (this.nicknameTaken(nickname)) return { ok: false, error: NICK_TAKEN, status: 409 };
    return this.createUser({ nickname, passwordHash: await hashPassword(String(password)) });
  }

  /** @returns {AuthResult} */
  // Grava a conta nova e já abre uma sessão. O apelido pode ter sido pego no meio do caminho
  // (outra pessoa, enquanto o hash da senha era calculado): aí o UNIQUE do banco avisa.
  createUser({ nickname, passwordHash = null, googleSub = null }) {
    const nick = tidyNickname(nickname);
    let id;
    try {
      id = Number(this.q.insertUser.run(nick, nicknameKey(nick), passwordHash, googleSub, this.now()).lastInsertRowid);
    } catch (err) {
      if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') return { ok: false, error: NICK_TAKEN, status: 409 };
      throw err;
    }
    const user = /** @type {UserRow} */ (this.q.byId.get(id));
    return { ok: true, user: Accounts.public(user), session: this.createSession(id) };
  }

  // ---------- Google ----------

  // Entrou com o Google (sub já conferido em server/google.js). Conta existente: sessão nova.
  // Primeira vez: devolve um ticket para a pessoa escolher o apelido em registerGoogle().
  loginGoogle(sub) {
    const row = /** @type {UserRow | undefined} */ (this.q.byGoogle.get(sub));
    if (row) return { ok: true, user: Accounts.public(row), session: this.createSession(row.id) };
    const now = this.now();
    for (const [t, v] of this.googleTickets) if (v.expires <= now) this.googleTickets.delete(t);
    const ticket = randomBytes(24).toString('base64url');
    this.googleTickets.set(ticket, { sub, expires: now + GOOGLE_TICKET_MS });
    return { ok: true, needsNickname: true, ticket };
  }

  registerGoogle({ ticket, nickname }) {
    const t = typeof ticket === 'string' ? this.googleTickets.get(ticket) : null;
    if (!t || t.expires <= this.now())
      return { ok: false, error: 'O login com o Google expirou. Entre com o Google de novo.', status: 400 };
    // duas abas na mesma hora: a segunda só entra na conta que a primeira criou
    if (this.q.byGoogle.get(t.sub)) {
      this.googleTickets.delete(ticket);
      return this.loginGoogle(t.sub);
    }
    const error = nicknameError(nickname);
    if (error) return { ok: false, error, status: 400 };
    if (this.nicknameTaken(nickname)) return { ok: false, error: NICK_TAKEN, status: 409 };
    const result = this.createUser({ nickname, googleSub: t.sub });
    if (result.ok) this.googleTickets.delete(ticket);
    return result;
  }

  /** @returns {Promise<AuthResult>} */
  async login({ nickname, password }) {
    const pass = String(password ?? '');
    const row =
      pass.length <= 128 ? /** @type {UserRow | undefined} */ (this.q.byKey.get(nicknameKey(nickname))) : null;
    if (!row?.password_hash) {
      await verifyPassword(pass, await dummy());
      return { ok: false, error: WRONG_LOGIN, status: 401 };
    }
    if (!(await verifyPassword(pass, row.password_hash))) return { ok: false, error: WRONG_LOGIN, status: 401 };
    return { ok: true, user: Accounts.public(row), session: this.createSession(row.id) };
  }

  // Token de 32 bytes aleatórios; o banco guarda só o sha256 dele.
  createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    this.q.pruneUser.run(userId, now);
    this.q.insertSession.run(sha256(token), userId, now, now + SESSION_MS);
    return token;
  }

  // Dono da sessão (já no formato público), ou null. Sessão usada perto de vencer ganha prazo novo.
  userForSession(token) {
    if (typeof token !== 'string' || !token || token.length > 100) return null;
    const hash = sha256(token);
    const row = /** @type {(UserRow & { expires_at: number }) | undefined} */ (this.q.session.get(hash));
    if (!row) return null;
    const now = this.now();
    if (row.expires_at <= now) {
      this.q.deleteSession.run(hash);
      return null;
    }
    if (row.expires_at - now < RENEW_BEFORE_MS) this.q.renewSession.run(now + SESSION_MS, hash);
    return Accounts.public(row);
  }

  // O apelido é de alguma conta? (convidado não pode usar o nome de ninguém)
  nicknameTaken(name) {
    return !!this.q.byKey.get(nicknameKey(name));
  }

  logout(token) {
    if (typeof token === 'string' && token) this.q.deleteSession.run(sha256(token));
  }

  // Apaga a conta e todas as sessões dela (ON DELETE CASCADE). Uma sessão roubada sozinha não
  // basta: pede a senha ou, em conta do Google, entrar com o Google de novo (`googleSub`, já
  // conferido pela API).
  /**
   * @param {number} userId @param {{ password?: string, googleSub?: string | null }} [options]
   * @returns {Promise<{ ok: true } | { ok: false, error: string, status: number }>}
   */
  async deleteAccount(userId, { password, googleSub } = {}) {
    const row = /** @type {UserRow | undefined} */ (this.q.byId.get(userId));
    if (!row) return { ok: false, error: 'Conta não encontrada', status: 404 };
    const byGoogle = !!row.google_sub && googleSub === row.google_sub;
    const byPassword = !!row.password_hash && !!password && (await verifyPassword(String(password), row.password_hash));
    if (!byGoogle && !byPassword)
      return row.password_hash
        ? { ok: false, error: 'Senha incorreta', status: 401 }
        : { ok: false, error: 'Confirme com o Google para apagar a conta', status: 401 };
    this.q.deleteUser.run(userId);
    this.leaderCache = null;
    return { ok: true };
  }

  // Tira as sessões vencidas (roda na subida do servidor).
  prune() {
    return this.q.prune.run(this.now()).changes;
  }
}
