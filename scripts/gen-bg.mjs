// Gera public/bg-scene.svg: cena de fundo com pintas 3D nas bordas.
// Posições em % (a cena se adapta a qualquer proporção de tela); tamanhos em px.
import { writeFileSync } from 'node:fs';

// uso: node scripts/gen-bg.mjs  (sobrescreve public/bg-scene.svg)
const out = process.argv[2] ?? new URL("../public/bg-scene.svg", import.meta.url);

// [pinta, x%, y%, tamanho px, estilo, rotação, classes]
// estilos: dark (grafite em relevo), red (vermelho brilhante), hot (vermelho com brilho forte),
//          dim (vermelho escuro desfocado), ghost (grafite desfocado)
const suits = [
  // ---- esquerda ----
  ['H', 3, 5, 44, 'dim', -8, 'w'],
  ['S', 20.5, 9.5, 88, 'dark', 0, ''],
  ['H', 9, 16.5, 82, 'hot', -10, ''],
  ['C', 16, 26.5, 58, 'dark', 0, ''],
  ['D', 32, 9.5, 40, 'dim', 0, 'w'],
  ['H', 12, 44.5, 52, 'red', 8, ''],
  ['C', 14, 56, 52, 'dark', 0, 'w'],
  ['C', 4, 65, 150, 'ghost', 0, ''],
  ['D', 12.5, 80.5, 46, 'red', 0, ''],
  ['S', 19, 88.5, 100, 'dark', 0, ''],
  ['D', 41.5, 96, 40, 'red', 0, 'w'],
  ['C', 58, 94, 44, 'dark', 0, 'w'],
  // ---- direita ----
  ['H', 63, 6, 46, 'dim', 0, 'w'],
  ['H', 85, 9, 112, 'hot', 8, ''],
  ['S', 96, 6, 68, 'dark', 0, ''],
  ['D', 79.5, 20.5, 60, 'red', 10, ''],
  ['C', 96, 26.5, 108, 'dark', 0, ''],
  ['D', 91, 38.5, 38, 'red', 0, 'w'],
  ['S', 97, 52, 82, 'ghost', 0, ''],
  ['H', 87, 57, 58, 'dim', 10, 'w'],
  ['D', 80.5, 67.5, 64, 'red', 6, ''],
  ['C', 89, 77.5, 50, 'dark', 0, 'w'],
  ['H', 96, 73.5, 44, 'dim', 0, ''],
  ['H', 93, 90, 124, 'hot', -8, ''],
  ['S', 82, 95, 104, 'dark', 0, ''],
  ['D', 70, 94, 44, 'red', 0, 'w'],
];

// cartas inclinadas e transparentes: [x%, y%, rotação, pinta, desfocada]
const cards = [
  [5, 37, -14, 'H', false],
  [4, 92, 18, 'C', true],
  [96, 56, 14, 'S', false],
];

// rede de linhas vermelhas: cada linha é uma sequência de pontos (x%, y%)
const lines = [
  [[-2, 22], [13, 10], [23, 0]],
  [[13, 10], [22, 23], [28, 33]],
  [[22, 23], [9, 37]],
  [[-2, 50], [15, 68], [18, 74], [34, 95], [40, 102]],
  [[15, 68], [4, 78]],
  [[18, 74], [8, 98]],
  [[28, -2], [22, 23]],
  [[68, -2], [73, 8], [85, 25], [102, 15]],
  [[73, 8], [80, -2]],
  [[85, 25], [94, 35], [102, 40]],
  [[102, 62], [90, 70], [82, 85], [76, 102]],
  [[82, 85], [94, 84], [102, 80]],
  [[90, 70], [78, 60]],
];
// nós brilhantes (quadradinhos) nas junções
const nodes = [
  [13, 10], [22, 23], [15, 68], [18, 74], [34, 95],
  [73, 8], [85, 25], [94, 35], [90, 70], [82, 85],
];

// bolinhas desfocadas (bokeh): [x%, y%, raio]
const bokeh = [
  [46, 4, 10], [27, 30, 9], [20, 53, 34], [35, 82, 30], [27, 85, 7],
  [71, 26, 24], [91, 20, 22], [83, 45, 10], [74, 80, 26], [60, 99, 18], [56, 16, 6],
];

const PATHS = {
  H: 'M50 90 C22 68 4 52 4 31 C4 16 15 6 29 6 C39 6 46 12 50 21 C54 12 61 6 71 6 C85 6 96 16 96 31 C96 52 78 68 50 90 Z',
  D: 'M50 3 Q66 28 86 50 Q66 72 50 97 Q34 72 14 50 Q34 28 50 3 Z',
  S: 'M50 4 C78 28 96 44 96 63 C96 77 86 85 74 85 C65 85 58 81 54 74 C55 84 59 91 67 96 L33 96 C41 91 45 84 46 74 C42 81 35 85 26 85 C14 85 4 77 4 63 C4 44 22 28 50 4 Z',
  C: 'M28 30 A22 22 0 1 1 72 30 A22 22 0 1 1 28 30 Z M6 62 A22 22 0 1 1 50 62 A22 22 0 1 1 6 62 Z M50 62 A22 22 0 1 1 94 62 A22 22 0 1 1 50 62 Z M38 44 L62 44 L62 66 L38 66 Z M56 66 C56 80 60 89 68 96 L32 96 C40 89 44 80 44 66 Z',
};
const NAME = { H: 'copas', D: 'ouros', S: 'espadas', C: 'paus' };

const STYLE = {
  dark: { fill: 'url(#g-dark)', filter: 'url(#f-dark)', opacity: 1 },
  red: { fill: 'url(#g-red)', filter: 'url(#f-red)', opacity: 1 },
  hot: { fill: 'url(#g-red)', filter: 'url(#f-hot)', opacity: 1 },
  dim: { fill: 'url(#g-dim)', filter: 'url(#f-blur)', opacity: 0.75 },
  ghost: { fill: 'url(#g-dark)', filter: 'url(#f-ghost)', opacity: 0.85 },
};

const r = (n) => +n.toFixed(3);
const pt = ([x, y]) => [`${x}%`, `${y}%`];

function suitEl([s, x, y, size, style, rot, cls]) {
  const st = STYLE[style];
  const k = r(size / 100);
  return `  <svg x="${x}%" y="${y}%" overflow="visible"><g class="m${cls ? ' ' + cls : ''}"><use href="#${NAME[s]}" fill="${st.fill}" filter="${st.filter}"${st.opacity < 1 ? ` opacity="${st.opacity}"` : ''} transform="rotate(${rot}) scale(${k}) translate(-50 -50)"/></g></svg>`;
}

function cardEl([x, y, rot, s, blurred]) {
  const inner = `<use href="#${NAME[s]}" fill="url(#g-dim)" opacity="0.45" transform="translate(-44 -60) scale(0.5)"/>`;
  return `  <svg x="${x}%" y="${y}%" overflow="visible"><g class="m"><g transform="rotate(${rot})"${blurred ? ' filter="url(#f-card-blur)" opacity="0.7"' : ''}>
    <rect x="-80" y="-112" width="160" height="224" rx="14" fill="url(#g-card)" stroke="#ed1c24" stroke-opacity="0.3" stroke-width="1.5" filter="url(#f-edge)"/>
    ${inner}
  </g></g></svg>`;
}

const lineSegs = lines
  .flatMap((pts) => pts.slice(1).map((p, i) => [pts[i], p]))
  .map(([a, b]) => {
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  })
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
  <!-- Gerado por scripts/gen-bg.mjs: cena de fundo do 8 Maluco (pintas 3D, cartas, rede de linhas). -->
  <style>
    /* telas estreitas: pintas e cartas menores, e somem os detalhes secundários */
    .m { transform-box: view-box; }
    @media (max-width: 900px) { .m { transform: scale(0.7); } }
    @media (max-width: 600px) { .m { transform: scale(0.55); } .w { display: none; } }
  </style>
  <defs>
    <linearGradient id="g-dark" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#4d4241"/>
      <stop offset="0.5" stop-color="#241b1b"/>
      <stop offset="1" stop-color="#0c0909"/>
    </linearGradient>
    <linearGradient id="g-red" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#ff5a60"/>
      <stop offset="0.45" stop-color="#e3141c"/>
      <stop offset="1" stop-color="#6e080d"/>
    </linearGradient>
    <linearGradient id="g-dim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8e0e13"/>
      <stop offset="1" stop-color="#3a0608"/>
    </linearGradient>
    <linearGradient id="g-card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ed1c24" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#ed1c24" stop-opacity="0.02"/>
    </linearGradient>
    <radialGradient id="g-bokeh">
      <stop offset="0" stop-color="#ed1c24" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ed1c24" stop-opacity="0"/>
    </radialGradient>
    <!-- grade de losangos que aparece só perto das bordas -->
    <pattern id="p-grid" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0 H56 M0 0 V56" fill="none" stroke="#ed1c24" stroke-opacity="0.09" stroke-width="1"/>
      <rect x="4" y="4" width="22" height="22" fill="#ed1c24" fill-opacity="0.025"/>
    </pattern>
    <radialGradient id="g-edge-mask" cx="50%" cy="50%" r="72%">
      <stop offset="0.45" stop-color="#000"/>
      <stop offset="1" stop-color="#fff"/>
    </radialGradient>
    <mask id="m-edge"><rect width="100%" height="100%" fill="url(#g-edge-mask)"/></mask>

    <!-- filtros em coordenadas da pinta (caixa 100x100), então escalam junto -->
    <filter id="f-dark" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="h"/>
      <feSpecularLighting in="h" surfaceScale="6" specularConstant="0.9" specularExponent="20" lighting-color="#ffe2e2" result="s1">
        <feDistantLight azimuth="235" elevation="40"/>
      </feSpecularLighting>
      <feComposite in="s1" in2="SourceAlpha" operator="in" result="s1in"/>
      <feSpecularLighting in="h" surfaceScale="6" specularConstant="0.8" specularExponent="14" lighting-color="#ff2a32" result="s2">
        <feDistantLight azimuth="45" elevation="25"/>
      </feSpecularLighting>
      <feComposite in="s2" in2="SourceAlpha" operator="in" result="s2in"/>
      <feComposite in="SourceGraphic" in2="s1in" operator="arithmetic" k2="1" k3="0.35" result="l1"/>
      <feComposite in="l1" in2="s2in" operator="arithmetic" k2="1" k3="0.3" result="lit"/>
      <feOffset in="SourceAlpha" dx="4" dy="9" result="o"/>
      <feGaussianBlur in="o" stdDeviation="6" result="ob"/>
      <feFlood flood-color="#000" flood-opacity="0.85"/>
      <feComposite in2="ob" operator="in" result="sh"/>
      <feMerge><feMergeNode in="sh"/><feMergeNode in="lit"/></feMerge>
    </filter>
    <filter id="f-red" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="h"/>
      <feSpecularLighting in="h" surfaceScale="6" specularConstant="1.1" specularExponent="24" lighting-color="#ffffff" result="s">
        <feDistantLight azimuth="235" elevation="42"/>
      </feSpecularLighting>
      <feComposite in="s" in2="SourceAlpha" operator="in" result="sin"/>
      <feComposite in="SourceGraphic" in2="sin" operator="arithmetic" k2="1" k3="0.55" result="lit"/>
      <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="g"/>
      <feColorMatrix in="g" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.55 0" result="glow"/>
      <feOffset in="SourceAlpha" dx="3" dy="8" result="o"/>
      <feGaussianBlur in="o" stdDeviation="5" result="ob"/>
      <feFlood flood-color="#000" flood-opacity="0.7"/>
      <feComposite in2="ob" operator="in" result="sh"/>
      <feMerge><feMergeNode in="sh"/><feMergeNode in="glow"/><feMergeNode in="lit"/></feMerge>
    </filter>
    <filter id="f-hot" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="h"/>
      <feSpecularLighting in="h" surfaceScale="6" specularConstant="1.2" specularExponent="26" lighting-color="#ffffff" result="s">
        <feDistantLight azimuth="235" elevation="42"/>
      </feSpecularLighting>
      <feComposite in="s" in2="SourceAlpha" operator="in" result="sin"/>
      <feComposite in="SourceGraphic" in2="sin" operator="arithmetic" k2="1" k3="0.6" result="lit"/>
      <feGaussianBlur in="SourceGraphic" stdDeviation="22" result="g1"/>
      <feColorMatrix in="g1" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.6 0" result="glow1"/>
      <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="g2"/><feColorMatrix in="g2" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.7 0" result="glow2"/>
      <feMerge><feMergeNode in="glow1"/><feMergeNode in="glow2"/><feMergeNode in="lit"/></feMerge>
    </filter>
    <filter id="f-blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4"/>
    </filter>
    <filter id="f-ghost" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="h"/>
      <feSpecularLighting in="h" surfaceScale="6" specularConstant="0.9" specularExponent="14" lighting-color="#ff2a32" result="s">
        <feDistantLight azimuth="45" elevation="22"/>
      </feSpecularLighting>
      <feComposite in="s" in2="SourceAlpha" operator="in" result="sin"/>
      <feComposite in="SourceGraphic" in2="sin" operator="arithmetic" k2="1" k3="0.5" result="lit"/>
      <feGaussianBlur in="lit" stdDeviation="2.5"/>
    </filter>
    <filter id="f-card-blur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <filter id="f-edge" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="f-line-glow" x="-5%" y="-5%" width="110%" height="110%">
      <feGaussianBlur stdDeviation="2.5"/>
    </filter>
    <filter id="f-node" x="-300%" y="-300%" width="700%" height="700%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

${Object.entries(PATHS).map(([k, d]) => `    <path id="${NAME[k]}" d="${d}"/>`).join('\n')}
  </defs>

  <!-- grade nas bordas -->
  <rect width="100%" height="100%" fill="url(#p-grid)" mask="url(#m-edge)"/>

  <!-- bokeh -->
${bokeh.map(([x, y, rad]) => `  <circle cx="${x}%" cy="${y}%" r="${rad}" fill="url(#g-bokeh)"/>`).join('\n')}

  <!-- rede de linhas -->
  <g stroke="#ed1c24" stroke-width="3" stroke-opacity="0.22" filter="url(#f-line-glow)">${lineSegs}</g>
  <g stroke="#ed1c24" stroke-width="1" stroke-opacity="0.45">${lineSegs}</g>
${nodes.map(([x, y]) => `  <svg x="${x}%" y="${y}%" overflow="visible"><rect x="-5" y="-5" width="10" height="10" rx="1.5" fill="#ff2a32" filter="url(#f-node)"/></svg>`).join('\n')}

  <!-- cartas -->
${cards.map(cardEl).join('\n')}

  <!-- pintas -->
${suits.map(suitEl).join('\n')}
</svg>
`;

writeFileSync(out, svg);
console.log('ok', svg.length, 'bytes');
