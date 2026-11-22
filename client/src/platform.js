// Onde o cliente está rodando: no navegador (servido pelo próprio servidor do jogo) ou dentro
// do app Android/iOS (Capacitor), que abre os arquivos de dentro do aparelho e fala com o
// servidor por outra origem (capacitor://localhost no iOS, https://localhost no Android).
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

// Endereço do servidor do jogo, sem a barra no fim. Vazio no navegador: tudo vai para a mesma
// origem da página. No app vem do VITE_SERVER_URL do build (`npm run build:mobile`, que
// confere se ele existe).
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/+$/, '');

// Endereço público do jogo, usado nos links de convite. No app a página é localhost, então o
// link precisa apontar para o servidor.
export const publicUrl = () => (isNative ? `${SERVER_URL}/` : `${location.origin}${location.pathname}`);
