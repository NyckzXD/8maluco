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

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export class Accounts {
  /** @param {import('better-sqlite3').Database} db @param {{ now?: () => number }} [options] */
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
    this.q = {
      byKey: db.prepare('SELECT * FROM users WHERE nickname_key = ?'),
      byId: db.prepare('SELECT * FROM users WHERE id = ?'),
      insertUser: db.prepare(
        'INSERT INTO users (nickname, nickname_key, password_hash, created_at) VALUES (?, ?, ?, ?)',
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
    };
  }

  // O que sai para o navegador: nada de hash, sub do Google ou chave interna.
  /** @param {UserRow} row */
  static public(row) {
    return { id: row.id, nickname: row.nickname, hasPassword: !!row.password_hash, hasGoogle: !!row.google_sub };
  }

  /** @returns {Promise<{ ok: true, user: object, session: string } | { ok: false, error: string, status: number }>} */
  async register({ nickname, password }) {
    const error = nicknameError(nickname) ?? passwordError(password);
    if (error) return { ok: false, error, status: 400 };
    const nick = tidyNickname(nickname);
    const key = nicknameKey(nick);
    if (this.q.byKey.get(key)) return { ok: false, error: 'Esse apelido já tem dono. Escolha outro!', status: 409 };
    const hash = await hashPassword(String(password));
    let id;
    try {
      id = Number(this.q.insertUser.run(nick, key, hash, this.now()).lastInsertRowid);
    } catch (err) {
      // outra pessoa pegou o mesmo apelido enquanto o hash era calculado
      if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE')
        return { ok: false, error: 'Esse apelido já tem dono. Escolha outro!', status: 409 };
      throw err;
    }
    const user = /** @type {UserRow} */ (this.q.byId.get(id));
    return { ok: true, user: Accounts.public(user), session: this.createSession(id) };
  }

  /** @returns {Promise<{ ok: true, user: object, session: string } | { ok: false, error: string, status: number }>} */
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

  logout(token) {
    if (typeof token === 'string' && token) this.q.deleteSession.run(sha256(token));
  }

  // Apaga a conta e todas as sessões dela (ON DELETE CASCADE). Conta com senha pede a senha:
  // uma sessão roubada sozinha não basta.
  /** @returns {Promise<{ ok: true } | { ok: false, error: string, status: number }>} */
  /** @param {number} userId @param {{ password?: string }} [options] */
  async deleteAccount(userId, { password } = {}) {
    const row = /** @type {UserRow | undefined} */ (this.q.byId.get(userId));
    if (!row) return { ok: false, error: 'Conta não encontrada', status: 404 };
    if (row.password_hash && !(await verifyPassword(String(password ?? ''), row.password_hash)))
      return { ok: false, error: 'Senha incorreta', status: 401 };
    this.q.deleteUser.run(userId);
    return { ok: true };
  }

  // Tira as sessões vencidas (roda na subida do servidor).
  prune() {
    return this.q.prune.run(this.now()).changes;
  }
}
