import { defineConfig } from 'vite';

// O cliente fica em client/ (index.html, app.js, style.css) e importa as regras de shared/.
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
