// Onde o cliente está rodando: no navegador (servido pelo próprio servidor do jogo) ou dentro
// do app Android/iOS (Capacitor), que abre os arquivos de dentro do aparelho e fala com o
// servidor por outra origem (capacitor://localhost no iOS, https://localhost no Android).
//
// Também ficam aqui as funções do aparelho que mudam entre os dois (vibrar, compartilhar,
// copiar): no navegador usam a API web, no app o plugin nativo. Este módulo não importa os
// outros do cliente, para qualquer um poder usá-lo.
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';

export const isNative = Capacitor.isNativePlatform();

// Endereço do servidor do jogo, sem a barra no fim. Vazio no navegador: tudo vai para a mesma
// origem da página. No app vem do VITE_SERVER_URL do build (`npm run build:mobile`, que
// confere se ele existe).
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/+$/, '');

// Endereço público do jogo, usado nos links de convite. No app a página é localhost, então o
// link precisa apontar para o servidor.
export const publicUrl = () => (isNative ? `${SERVER_URL}/` : `${location.origin}${location.pathname}`);

// Vibrações do jogo, da mais leve à mais forte. No navegador, a duração em ms (o iOS não vibra
// pela web); no app, o toque do motor de vibração do sistema, que funciona nos dois.
const BUZZ = {
  tip: { ms: 10, style: ImpactStyle.Light }, // segurou a carta e abriu a dica
  select: { ms: 15, style: ImpactStyle.Light }, // escolheu a carta (confirmar com outro toque)
  tick: { ms: 30, style: ImpactStyle.Medium }, // últimos segundos da vez
  turn: { ms: 60, style: ImpactStyle.Heavy }, // chegou a sua vez
};

/** @param {keyof typeof BUZZ} kind */
export function vibrate(kind) {
  const { ms, style } = BUZZ[kind];
  if (isNative) Haptics.impact({ style }).catch(() => {});
  else navigator.vibrate?.(ms);
}

// Dá para abrir o compartilhamento do sistema? No app sempre; no navegador, só no celular (no
// computador a janela de compartilhar é estranha, e copiar o link é melhor).
export const canShare = () => isNative || (!!navigator.share && matchMedia('(pointer: coarse)').matches);

/**
 * Abre o compartilhamento do sistema. Resolve 'shared', 'canceled' (fechou sem escolher) ou
 * 'failed' (não deu: quem chamou tenta copiar).
 * @param {{ title: string, text: string, url: string }} data
 */
export async function shareLink(data) {
  try {
    if (isNative) await Share.share({ ...data, dialogTitle: data.title });
    else await navigator.share(data);
    return 'shared';
  } catch (err) {
    // o navegador avisa com AbortError; o plugin, com a mensagem "Share canceled"
    if (err?.name === 'AbortError' || /cancel/i.test(err?.message ?? '')) return 'canceled';
    return 'failed';
  }
}

// Copia para a área de transferência. Resolve true se deu certo.
export async function copyText(text) {
  try {
    if (isNative) await Clipboard.write({ string: text });
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
