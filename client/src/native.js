// Só no app Android/iOS (Capacitor): botão voltar do Android, volta do segundo plano e convites
// que abrem o app pelo link. No navegador este módulo não faz nada.
import { App } from '@capacitor/app';
import { $$, roomCode, socket } from './core.js';
import { openInvite } from './home.js';
import { leaveRoom } from './lobby.js';
import { closeTopLayer } from './modals.js';
import { isNative } from './platform.js';

// Mais que isso em segundo plano, a conexão que parece aberta pode estar morta (o iOS congela o
// app e o servidor só percebe a queda pelo ping, em até 50s): ao voltar, reconecta de uma vez.
// A sala volta sozinha pelo token (main.js, no 'connect'), com as mesmas cartas.
const STALE_MS = 15_000;

if (isNative) {
  // Voltar do Android: fecha o que estiver aberto (como o Esc); na sala, é o mesmo que tocar em
  // "Sair" (no meio da partida pede confirmação); na tela inicial, só minimiza o app, para não
  // perder a conexão.
  App.addListener('backButton', () => {
    if (closeTopLayer()) return;
    if (roomCode) {
      const leave = $$('.leave-btn').find((b) => b.offsetParent);
      if (leave) leave.click();
      else leaveRoom();
      return;
    }
    App.minimizeApp().catch(() => {});
  });

  let pausedAt = 0;
  App.addListener('pause', () => (pausedAt = Date.now()));
  App.addListener('resume', () => {
    const away = pausedAt ? Date.now() - pausedAt : 0;
    pausedAt = 0;
    if (!socket.connected) socket.connect();
    else if (away > STALE_MS) socket.disconnect().connect();
  });

  // Convite (https://servidor/?sala=CODIGO) aberto com o app fechado ou aberto. Com o app
  // fechado, o mesmo link pode chegar pelos dois caminhos: o repetido logo em seguida é ignorado.
  let last = { url: '', at: 0 };
  const onUrl = (url) => {
    if (!url || (url === last.url && Date.now() - last.at < 3000)) return;
    last = { url, at: Date.now() };
    openInvite(url);
  };
  App.addListener('appUrlOpen', ({ url }) => onUrl(url));
  App.getLaunchUrl()
    .then((launch) => onUrl(launch?.url))
    .catch(() => {});
}
