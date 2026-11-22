import { defineConfig, loadEnv } from 'vite';

// O cliente fica em client/ (index.html, src/, style.css e styles/) e importa as regras de shared/.
// O style.css só junta os arquivos de styles/ com @import; o build gera um CSS só.
// public/ vai para o build do jeito que está: fontes, ícones, cartas, sons, manifest e sw.js,
// sempre pelos mesmos caminhos (/fonts/..., /cards/...), porque o app.js monta alguns deles.
//
// As variáveis VITE_* vêm dos .env da raiz (o mesmo lugar do .env do servidor; só as que
// começam com VITE_ chegam ao cliente). O build do app (`--mode mobile`, em `npm run
// build:mobile`) lê o .env.mobile e precisa do VITE_SERVER_URL: o app abre os arquivos de
// dentro do aparelho e não teria com quem falar.
export default defineConfig(({ mode }) => {
  if (mode === 'mobile') {
    const url = loadEnv(mode, '.', 'VITE_').VITE_SERVER_URL ?? '';
    if (!/^https:\/\/[^/]/.test(url))
      throw new Error(
        'Build do app sem VITE_SERVER_URL: crie o .env.mobile na raiz com VITE_SERVER_URL=https://seu-servidor ' +
          '(veja o .env.mobile.example). Precisa ser https: o app roda em https://localhost e capacitor://localhost.',
      );
  }
  return {
    root: 'client',
    publicDir: '../public',
    envDir: '..',
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      target: 'es2022',
    },
    server: {
      // shared/ fica fora de client/
      fs: { allow: ['..'] },
    },
  };
});
