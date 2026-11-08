// Regras de apelido que valem no servidor e no navegador.

// "Robô ..." é dos bots: humano não pode usar (com ou sem acento, qualquer caixa).
export const isBotName = (name) =>
  /^rob[oô](\s|$)/i.test(
    String(name ?? '')
      .normalize('NFC')
      .trim(),
  );

export const BOT_NAME_ERROR = 'Apelidos começando com "Robô" são dos bots. Escolha outro!';
