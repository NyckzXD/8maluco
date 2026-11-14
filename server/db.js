// Banco das contas (SQLite num arquivo só). Fica no mesmo disco persistente do SNAPSHOT_FILE:
// sem volume, cada deploy começa sem nenhuma conta (README, "Publicando").
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Cada passo roda uma vez só, na ordem; o número do último aplicado fica no `user_version`
// do próprio arquivo. Para mudar o esquema, acrescente um passo no fim (nunca edite um antigo).
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    nickname TEXT NOT NULL,               -- como a pessoa escreveu ("Zé Maria")
    nickname_key TEXT NOT NULL UNIQUE,    -- para comparar ("ze maria"): sem acento nem caixa
    password_hash TEXT,                   -- null em conta só do Google
    google_sub TEXT UNIQUE,               -- id da pessoa no Google (nada de e-mail)
    avatar TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,          -- sha256 do token: o arquivo vazado não vira sessão válida
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  `,
];

/** @param {string} file caminho do arquivo, ou ":memory:" (testes) */
export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // leitura não espera escrita
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = Number(db.pragma('user_version', { simple: true }));
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
