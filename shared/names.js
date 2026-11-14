// Regras de apelido que valem no servidor e no navegador.

// "Robô ..." é dos bots: humano não pode usar (com ou sem acento, qualquer caixa).
export const isBotName = (name) =>
  /^rob[oô](\s|$)/i.test(
    String(name ?? '')
      .normalize('NFC')
      .trim(),
  );

export const BOT_NAME_ERROR = 'Apelidos começando com "Robô" são dos bots. Escolha outro!';
export const RESERVED_NAME_ERROR = 'Esse apelido é de uma conta. Entre nela ou escolha outro!';

// ---------- apelido de conta ----------
// Mais rígido que o apelido de convidado: vai para o ranking, então nada de caractere invisível
// ou símbolo que imite outra pessoa. Letras (com acento), números, espaço, ponto, hífen e _.

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
const NICKNAME_CHARS = /^[\p{L}\p{N} ._-]+$/u;

// Apelido como vai ser mostrado: NFC e espaços repetidos viram um só.
export const tidyNickname = (name) =>
  String(name ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();

// Chave para comparar: "Zé Maria", "ze maria" e "ZE  MARIA" são o mesmo apelido.
export const nicknameKey = (name) => tidyNickname(name).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Mensagem de erro, ou null se o apelido serve para uma conta.
export function nicknameError(name) {
  const nick = tidyNickname(name);
  if (nick.length < NICKNAME_MIN) return `O apelido precisa ter pelo menos ${NICKNAME_MIN} letras`;
  if (nick.length > NICKNAME_MAX) return `O apelido pode ter até ${NICKNAME_MAX} letras`;
  if (!NICKNAME_CHARS.test(nick)) return 'Use só letras, números, espaço, ponto, hífen ou _';
  if (isBotName(nick)) return BOT_NAME_ERROR;
  return null;
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function passwordError(password) {
  const p = String(password ?? '');
  if (p.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres`;
  if (p.length > PASSWORD_MAX) return `A senha pode ter até ${PASSWORD_MAX} caracteres`;
  return null;
}
