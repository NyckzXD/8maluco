import { defineConfig } from 'vite';

// O cliente fica em client/ (index.html, src/, style.css e styles/) e importa as regras de shared/.
// O style.css só junta os arquivos de styles/ com @import; o build gera um CSS só.
// public/ vai para o build do jeito que está: fontes, ícones, cartas, sons, manifest e sw.js,
// sempre pelos mesmos caminhos (/fonts/..., /cards/...), porque o app.js monta alguns deles.
export default defineConfig({
  root: 'client',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    // shared/ fica fora de client/
    fs: { allow: ['..'] },
  },
});
