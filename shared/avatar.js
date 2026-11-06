// Avatar montável (fundo, pele, roupa, cabelo e rosto), desenhado em SVG num quadrado 100×100.
// Fica em /shared porque o servidor também usa: valida o que chega do navegador e sorteia o avatar dos bots.
// Cada parte do avatar é só um índice nas listas abaixo, então o SVG nunca recebe texto vindo de fora.

const color = (name, hex) => ({ name, hex });

export const BACKGROUNDS = [
  color('Vermelho', '#c8463f'),
  color('Laranja', '#ff8a3d'),
  color('Amarelo', '#ffc83d'),
  color('Verde', '#6fcf5f'),
  color('Turquesa', '#2fc4a0'),
  color('Azul', '#3fa7f5'),
  color('Anil', '#5b6cf0'),
  color('Roxo', '#9b6cf0'),
  color('Rosa', '#f06cb4'),
  color('Prata', '#c2c1c2'),
  color('Grafite', '#3a3837'),
  color('Petróleo', '#1f6f6c'),
];

export const SKINS = [
  color('Pele 1', '#ffe3cc'),
  color('Pele 2', '#f9cfa8'),
  color('Pele 3', '#efb98a'),
  color('Pele 4', '#dea070'),
  color('Pele 5', '#c68757'),
  color('Pele 6', '#a96c40'),
  color('Pele 7', '#8a5230'),
  color('Pele 8', '#6b3d22'),
  color('Pele 9', '#4a2a17'),
];

export const HAIR_COLORS = [
  color('Preto', '#1c1714'),
  color('Castanho-escuro', '#3b2618'),
  color('Castanho', '#6b4226'),
  color('Acobreado', '#a0522d'),
  color('Ruivo', '#d2551f'),
  color('Loiro-escuro', '#c99a3e'),
  color('Loiro', '#f2d27a'),
  color('Grisalho', '#9aa0a6'),
  color('Branco', '#f1f1f1'),
  color('Rosa', '#ff6fb5'),
  color('Azul', '#3fa7f5'),
  color('Verde', '#6fcf5f'),
  color('Roxo', '#9b6cf0'),
];

export const OUTFIT_COLORS = [
  color('Vermelho', '#ed1c24'),
  color('Laranja', '#ff8a3d'),
  color('Amarelo', '#ffc83d'),
  color('Verde', '#43a047'),
  color('Turquesa', '#1fa38a'),
  color('Azul', '#2f80ed'),
  color('Marinho', '#283593'),
  color('Roxo', '#8e44ad'),
  color('Rosa', '#e84393'),
  color('Branco', '#f4f3f4'),
  color('Cinza', '#7d7c7d'),
  color('Preto', '#2a2a30'),
];

export const OUTFITS = ['Camiseta', 'Gola V', 'Moletom', 'Social', 'Regata', 'Jaqueta', 'Listrada', 'Gola alta'];
export const HAIRS = [
  'Careca',
  'Curto',
  'Espetado',
  'Topete',
  'Comprido',
  'Coque',
  'Black power',
  'Chanel',
  'Moicano',
  'Cacheado',
  'Chiquinhas',
];
export const FACES = [
  'Sorriso',
  'Feliz',
  'Piscadinha',
  'Surpreso',
  'Bravo',
  'Óculos',
  'Língua',
  'Blasé',
  'Apaixonado',
  'Óculos escuros',
  'Bigode',
  'Sardas',
];

// Quantas opções cada parte tem. A ordem das chaves é a ordem das abas do editor.
export const AVATAR_PARTS = {
  bg: BACKGROUNDS.length,
  skin: SKINS.length,
  outfit: OUTFITS.length,
  outfitColor: OUTFIT_COLORS.length,
  hair: HAIRS.length,
  hairColor: HAIR_COLORS.length,
  face: FACES.length,
};

const pick = (n) => Math.floor(Math.random() * n);

export function randomAvatar() {
  return Object.fromEntries(Object.entries(AVATAR_PARTS).map(([k, n]) => [k, pick(n)]));
}

// Aceita só índices inteiros dentro das listas; o que vier errado vira null (sem avatar, mostra a inicial).
export function sanitizeAvatar(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const [k, n] of Object.entries(AVATAR_PARTS)) {
    const v = input[k];
    if (!Number.isInteger(v) || v < 0 || v >= n) return null;
    out[k] = v;
  }
  return out;
}


// ---------- desenho ----------
// Estilo de desenho animado: contorno escuro, cor chapada e uma camada de sombra/luz
// (luz vindo de cima à esquerda). Sombras e brilhos são recortados (clipPath) na peça
// em que caem, então nunca vazam para o fundo.

const INK = '#1d1d28';
const SW = 1.8;

// Mistura duas cores hex (t = 0 fica com a primeira, 1 com a segunda).
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
const darken = (hex, t) => mix(hex, '#000000', t);
const lighten = (hex, t) => mix(hex, '#ffffff', t);
const isLight = (hex) => {
  const p = parseInt(hex.slice(1), 16);
  return 0.299 * (p >> 16) + 0.587 * ((p >> 8) & 255) + 0.114 * (p & 255) > 170;
};

const shape = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round" ${extra}/>`;
const line = (d, stroke = INK, w = 2, extra = '') =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const fillOnly = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const dot = (x, y, r, fill, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
// Elipse como caminho (para usar em recortes e no evenodd).
const ellipseD = (cx, cy, rx, ry) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;

const BODY = 'M10 104C10 86 23 76 41 73Q50 77 59 73C77 76 90 86 90 104Z';
const HEAD = { cx: 50, cy: 45, rx: 19, ry: 21 };
const HEAD_D = ellipseD(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry);
const NECK = 'M43 58V75Q50 79 57 75V58Z';

// Os ids dos recortes precisam ser únicos na página (há vários avatares ao mesmo tempo).
let uid = 0;
function clipper() {
  const id = `av${(++uid).toString(36)}`;
  let n = 0;
  return (d, content) => {
    const cid = `${id}-${n++}`;
    return `<clipPath id="${cid}"><path d="${d}"/></clipPath><g clip-path="url(#${cid})">${content}</g>`;
  };
}

// ---------- roupas ----------

function outfitSvg(style, c, skin, clip) {
  const light = isLight(c);
  const shade = darken(c, light ? 0.1 : 0.16);
  const dark = darken(c, light ? 0.22 : 0.3);
  const deep = darken(c, light ? 0.35 : 0.48);
  const trim = light ? darken(c, 0.35) : lighten(c, 0.28);
  const skinShade = darken(skin, 0.16);
  const tee = light ? '#2a2a30' : '#f4f3f4';

  // Tronco com sombra do lado direito e as dobras dos braços.
  const torso = (fill, sh = shade, cr = dark) =>
    fillOnly(BODY, fill) +
    clip(
      BODY,
      fillOnly('M65 71C73 81 75.5 93 74 104H100V71Z', sh) +
        fillOnly('M10 100Q50 93 90 100V104H10Z', sh, 'opacity=".6"'),
    ) +
    shape(BODY, 'none') +
    line('M26.5 104Q25.5 94 29.5 85', cr, 1.4) +
    line('M73.5 104Q74.5 94 70.5 85', cr, 1.4);
  // Sombra que o pescoço/queixo projeta no peito.
  const neckShadow = (d) => clip(BODY, fillOnly(d, deep, 'opacity=".35"'));

  switch (style) {
    case 1: {
      // gola V com bolsinho
      const v = 'M41.5 73.5L50 88L58.5 73.5Q50 77 41.5 73.5Z';
      return (
        torso(c) +
        shape(v, skin) +
        clip(v, fillOnly('M40 72H60L50 81Z', skinShade)) +
        line('M41.5 74L50 88L58.5 74', trim, 2.6) +
        shape('M60.5 87.5H69L68.5 96Q64.5 97.5 61 96Z', shade) +
        line('M60.7 89.6H68.8', dark, 1.1) +
        line('M64.8 93.5V95.8', dark, 1.1)
      );
    }
    case 2: {
      // moletom: capuz em volta do pescoço, cordões e bolso canguru
      const hood = 'M30 80C30.5 70 42 68 50 74.5C58 68 69.5 70 70 80C62 86.5 38 86.5 30 80Z';
      const pocket = 'M34.5 104L38 93.5Q50 91 62 93.5L65.5 104Z';
      return (
        torso(c) +
        shape(pocket, shade) +
        line('M38.8 96Q50 93.6 61.2 96', dark, 1, 'stroke-dasharray="1.6 1.6"') +
        line('M36 104L38.8 96', dark, 1, 'stroke-dasharray="1.6 1.6"') +
        line('M64 104L61.2 96', dark, 1, 'stroke-dasharray="1.6 1.6"') +
        shape(hood, dark) +
        line('M35 79Q42 74 50 78Q58 74 65 79', deep, 1.4) +
        line('M45.5 81Q44.5 87 45 92', '#f4f3f4', 1.6) +
        line('M54.5 81Q55.5 87 55 92', '#f4f3f4', 1.6) +
        `<rect x="43.9" y="91.5" width="2.2" height="3.4" rx=".8" fill="${INK}"/>` +
        `<rect x="53.9" y="91.5" width="2.2" height="3.4" rx=".8" fill="${INK}"/>`
      );
    }
    case 3: {
      // social: paletó, camisa branca, gravata e lencinho no bolso
      const tie = light ? '#c4141b' : mix(c, '#ed1c24', 0.55);
      const shirt = 'M41.5 73.5Q50 77 58.5 73.5L56 104H44Z';
      return (
        torso(c) +
        shape(shirt, '#f4f3f4') +
        clip(shirt, fillOnly('M50 70L62 70L56 104H52Z', '#dcdbe0')) +
        shape('M48.2 78.2H51.8L51.1 82H48.9Z', tie) +
        shape('M48.9 82H51.1L52.9 97L50 100.5L47.1 97Z', tie) +
        clip(
          'M48.9 82H51.1L52.9 97L50 100.5L47.1 97Z',
          line('M46 88L54 84M46 93L54 89M46 98L54 94', lighten(tie, 0.35), 1.1),
        ) +
        shape('M41 73L46.5 83.5L49.8 77.6Z', '#f4f3f4') +
        shape('M59 73L53.5 83.5L50.2 77.6Z', '#f4f3f4') +
        // lapelas do paletó
        shape('M41.5 73.5L36 81L40 83L44.6 104H41L37 94Z', shade) +
        shape('M58.5 73.5L64 81L60 83L55.4 104H59L63 94Z', dark) +
        line('M64 90.5H70.5', deep, 1.2) +
        shape('M64.6 90.5L65.6 87L67.2 89L68.6 86.6L69.8 90.5Z', '#f4f3f4')
      );
    }
    case 4: {
      // regata: ombros à mostra, com clavículas e acabamento nas cavas
      const tank = 'M28 104L31 85Q33 79 37 77L40 77Q43 87 50 87Q57 87 60 77L63 77Q67 79 69 85L72 104Z';
      return (
        torso(skin, skinShade, darken(skin, 0.3)) +
        line('M39.5 79.5Q43.5 81.5 46.5 80.5', darken(skin, 0.28), 1.3) +
        line('M60.5 79.5Q56.5 81.5 53.5 80.5', darken(skin, 0.28), 1.3) +
        shape(tank, c) +
        clip(tank, fillOnly('M62 76C68 84 70 94 69 104H80V76Z', shade) + fillOnly('M38 86Q50 92 62 86V90Q50 96 38 90Z', shade)) +
        shape(tank, 'none') +
        line('M40.6 78.5Q43.6 85.6 50 85.6Q56.4 85.6 59.4 78.5', trim, 1.4) +
        line('M31.2 86.5Q33.5 80.5 37 78.6', trim, 1.4) +
        line('M68.8 86.5Q66.5 80.5 63 78.6', trim, 1.4)
      );
    }
    case 5: {
      // jaqueta aberta com gola, zíper e bolsos, camiseta por baixo
      const shirt = 'M42 73.5Q50 77.5 58 73.5L57 104H43Z';
      return (
        torso(c) +
        shape(shirt, tee) +
        neckShadow('M42 73.5Q50 80 58 73.5Z') +
        line('M44.5 79Q50 81.5 55.5 79', isLight(tee) ? '#d4d3d8' : '#45454f', 1.2) +
        line('M43.2 77L46 104', deep, 1.1, 'stroke-dasharray="1 1.2"') +
        line('M56.8 77L54 104', deep, 1.1, 'stroke-dasharray="1 1.2"') +
        shape('M41.5 73.5Q38 72 33 75.5L36.5 83L43.5 78Z', shade) +
        shape('M58.5 73.5Q62 72 67 75.5L63.5 83L56.5 78Z', dark) +
        shape('M31.5 89H39.5L39 93.5H32Z', shade) +
        shape('M60.5 89H68.5L68 93.5H61Z', dark) +
        dot(35.6, 91.6, 0.9, trim) +
        dot(64.4, 91.6, 0.9, trim) +
        line('M24 104L26 92', deep, 1.6)
      );
    }
    case 6: {
      // listrada (navy): listras recortadas no tronco
      const stripes = 'M0 81H100V84.2H0ZM0 88.4H100V91.6H0ZM0 95.8H100V99H0Z';
      return (
        fillOnly(BODY, c) +
        clip(
          BODY,
          fillOnly(stripes, trim) +
            fillOnly('M65 71C73 81 75.5 93 74 104H100V71Z', '#000', 'opacity=".14"') +
            fillOnly('M10 100Q50 93 90 100V104H10Z', '#000', 'opacity=".08"'),
        ) +
        shape(BODY, 'none') +
        neckShadow('M41 73.5Q50 81 59 73.5Z') +
        line('M41 73.5Q50 81 59 73.5', dark, 3.2) +
        line('M26.5 104Q25.5 94 29.5 85', dark, 1.4) +
        line('M73.5 104Q74.5 94 70.5 85', dark, 1.4)
      );
    }
    case 7: {
      // gola alta dobrada, tricô canelado e colar com pingente
      const collar = 'M41 60.5H59L60 75.5Q50 80.5 40 75.5Z';
      return (
        torso(c) +
        clip(BODY, line('M33 104V86M40 104V82M60 104V82M67 104V86', shade, 1.1)) +
        shape(collar, shade) +
        clip(collar, line('M44 60V80M47 60V80M50 60V80M53 60V80M56 60V80', dark, 0.9) + fillOnly('M55 58H62V80H55Z', dark, 'opacity=".5"')) +
        shape(collar, 'none') +
        shape('M40.3 67.5Q50 71.5 59.7 67.5L60 75.5Q50 80.5 40 75.5Z', c) +
        clip('M40.3 67.5Q50 71.5 59.7 67.5L60 75.5Q50 80.5 40 75.5Z', fillOnly('M54 66H62V80H54Z', shade)) +
        shape('M40.3 67.5Q50 71.5 59.7 67.5L60 75.5Q50 80.5 40 75.5Z', 'none') +
        line('M40.5 77.5Q50 92 59.5 77.5', '#e8b93c', 1.1) +
        `<path d="M50 85.2L52.4 88.2L50 91.2L47.6 88.2Z" fill="#ffd34d" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
        dot(49.3, 87.6, 0.6, '#fff')
      );
    }
    default: {
      // camiseta: gola canelada e um naipe estampado no peito
      return (
        torso(c) +
        neckShadow('M41 73.5Q50 81 59 73.5Z') +
        line('M41 73.5Q50 81 59 73.5', dark, 3.4) +
        line('M42.4 75.6Q50 80.6 57.6 75.6', trim, 0.9, 'opacity=".7"') +
        `<path d="M64 87.2L66.6 90.8L64 94.4L61.4 90.8Z" fill="${trim}" stroke="${deep}" stroke-width=".8" stroke-linejoin="round"/>`
      );
    }
  }
}

// ---------- cabelos ----------
// Duas camadas: atrás da cabeça (e do corpo) e na frente da testa. `cast` são os contornos que
// projetam sombra na testa (o mesmo desenho, deslocado para baixo e recortado no rosto).

function hairSvg(style, c, skin) {
  const light = isLight(c);
  const shade = darken(c, light ? 0.16 : 0.24);
  const deep = darken(c, light ? 0.34 : 0.45);
  const hl = lighten(c, light ? 0.55 : 0.35);
  const strands = (d, w = 1.2) => line(d, deep, w);
  const shine = (d, w = 2.2) => line(d, hl, w, 'opacity=".85"');
  const back = (d) => shape(d, shade);
  const front = (d) => shape(d, c);
  const curls = (pts, col = deep, w = 1.1) => pts.map(([x, y]) => line(`M${x - 2} ${y + 0.6}q2 -3 4 0`, col, w)).join('');
  const sideburns = front('M30.7 44.5Q31 49.5 33 51.5L34.4 51V41.5Z') + front('M69.3 44.5Q69 49.5 67 51.5L65.6 51V41.5Z');

  switch (style) {
    case 1: {
      // curto, franja jogada de lado
      const F = 'M30.5 46C28.5 29 38 21.5 50 21.5C62 21.5 71.5 29 69.5 46C67 37 62 33 56 32C50 35 40 35 34 38.5C32 40.5 31 43 30.5 46Z';
      return {
        cast: [F],
        front:
          sideburns +
          front(F) +
          strands('M64 35Q64 28.5 59.5 24.5M55 32.5Q56.5 27.5 52 23.2M45 34.5Q48 29 44.5 24.5M37.5 36.5Q38.5 31.5 36.5 28.5') +
          shine('M38.5 30Q42.5 25.5 48.5 24.2'),
      };
    }
    case 2: {
      // espetado
      const F = 'M30.5 45C29.5 35 31 29 34 26.5L32 17L40 22.5L41.5 13L48 20.5L52 11L56 20.5L62.5 14L63 23.5L70 19L67.5 28C70.5 32 71 38 69.5 45C66 37 60 33.5 50 33.5C42 33.5 35 37 30.5 45Z';
      return {
        cast: [F],
        front:
          front(F) +
          strands('M34.5 21L37.5 29M41.5 16.5L43 28.5M51.5 15L50.5 28M61.5 18L59.5 29M67.5 22.5L64 30.5') +
          shine('M36.5 31Q38.5 26.5 41.5 25'),
      };
    }
    case 3: {
      // topete
      const F = 'M31 43C30 31 35 25 43 23.5C41 17.5 48 12.5 58 13.5C67 14.5 71 20 68 24.5C71 28.5 71 36 69.5 43C66 35 60 32 52 33C44 32 36 35.5 31 43Z';
      return {
        cast: [F],
        front:
          sideburns +
          front(F) +
          strands('M44.5 22.5Q49 17.5 58.5 17M45.5 27Q52 21.5 64.5 21.5M36 34Q44 28 58 28.5M66.5 33.5Q68 38 68.6 41') +
          shine('M47 18.5Q52 15.5 59 16'),
      };
    }
    case 4: {
      // comprido
      const B = 'M28.5 46C26 26 38 19 50 19C62 19 74 26 71.5 46L75 79C70 83 62 83 58.5 79L57 62H43L41.5 79C38 83 30 83 25 79Z';
      const F = 'M30.5 49C28 30 38 21 50 21C62 21 72 29.5 69.5 49C68 41 66.5 37 64 33.5C56 36.5 44 34.5 38 30C34 34 32 40 30.5 49Z';
      return {
        cast: [F],
        back:
          back(B) +
          strands('M28.5 54Q28 68 30 79M31.5 62Q32 72 34 80.5M71.5 54Q72 68 70 79M68.5 62Q68 72 66 80.5') +
          line('M27 56Q27 66 28.5 74', lighten(shade, 0.25), 1.6, 'opacity=".7"'),
        front:
          front(F) +
          strands('M38 30Q34.5 36 32.3 43M64 33.5Q66.5 38 67.8 43.5M43.5 32.5Q50 33 56 32M47 25Q55 27 62 31') +
          shine('M40 26.5Q47 22.5 56 23.2'),
      };
    }
    case 5: {
      // coque com elástico
      const F = 'M30.5 45C30 30 39 23.5 50 23.5C61 23.5 70 30 69.5 45C66 36 58 31.5 50 31.5C42 31.5 34 36 30.5 45Z';
      return {
        cast: [F],
        back: back('M41 19A9 9 0 1 1 59 19A9 9 0 1 1 41 19Z') + strands('M44 20Q46 13 52 12.5M47 23Q52 21 56 15.5') + line('M45 15.5Q48 11.5 52 11.5', hl, 1.6, 'opacity=".6"'),
        front:
          front(F) +
          strands('M35 39Q39 30 46.5 25.5M65 39Q61 30 53.5 25.5M50 31.5Q50.5 27.5 50 24') +
          shine('M38 30.5Q43 26 49 25') +
          shape('M43.5 25.8Q50 22.4 56.5 25.8L56 28.2Q50 25 44 28.2Z', '#ed1c24'),
      };
    }
    case 6: {
      // black power
      const B = 'M22 40C20 24 33 11 50 11C67 11 80 24 78 40C80 52 72 62 66 62L34 62C28 62 20 52 22 40Z';
      // A frente cobre o alto da cabeça (sem contorno) para o cabelo parecer um volume só.
      const F = 'M30.2 42C29 28 38 21.8 50 21.8C62 21.8 71 28 69.8 42C64 35 58 33.5 50 33.5C42 33.5 36 35 30.2 42Z';
      const hairline = 'M30.2 42C36 35 42 33.5 50 33.5C58 33.5 64 35 69.8 42';
      return {
        cast: [F],
        back:
          shape(B, c) +
          fillOnly('M70 18C78 26 80 40 76 50C73 57 70 60 66 62H74C79 56 81 48 78 40C80 31 76 23 70 18Z', shade) +
          curls([
            [28, 34], [26, 44], [29, 54], [34, 24], [42, 17], [52, 15], [61, 18], [69, 25], [74, 35], [75, 46], [71, 55],
            [37, 31], [64, 31],
          ]) +
          curls([[38, 19], [46, 15]], hl, 1.4),
        front:
          fillOnly(F, c) +
          fillOnly('M62 24C67 28 70 34 69.8 42C67.5 38.5 65 36.5 62.5 35.5Z', shade) +
          line(hairline, INK, SW) +
          curls([[39, 29], [47, 26], [55, 26.5], [63, 30], [43, 32.5], [57, 32.5]], deep, 1) +
          curls([[42, 25]], hl, 1.4),
      };
    }
    case 7: {
      // chanel com franja
      const B = 'M27 47C26 27 38 20 50 20C62 20 74 27 73 47L74.5 65C70 69 64 69 62 65H38C36 69 30 69 25.5 65Z';
      const F = 'M30.5 47C28.5 28.5 38 21 50 21C62 21 71.5 28.5 69.5 47L67.5 37.5H32.5Z';
      return {
        cast: [F],
        back: back(B) + strands('M28 50Q28 59 28.5 66.5M72 50Q72 59 71.5 66.5M31 56V66M69 56V66'),
        front:
          front(F) +
          strands('M39.5 37.5L40.5 30M45.5 37.5L46 29M51.5 37.5L51.8 29M57.5 37.5L57.5 30M63.5 37.5L62.6 31') +
          strands('M32.6 37.5Q31.4 42 31.2 46M67.4 37.5Q68.6 42 68.8 46') +
          shine('M37 28.5Q43 23.5 51 23'),
      };
    }
    case 8: {
      // moicano: laterais raspadas e crista no meio
      const S = 'M31.2 42C31 30 40 24.2 50 24.2C60 24.2 69 30 68.8 42C64 34 36 34 31.2 42Z';
      const M = 'M44.5 35C42.5 27 43 18 47 10L48.5 15.5L50 5L51.5 15.5L53 10C57 18 57.5 27 55.5 35C53 33 47 33 44.5 35Z';
      const stubble = darken(mix(skin, c, 0.5), 0.08);
      return {
        cast: [M],
        front:
          fillOnly(S, stubble) +
          [[36, 32], [39, 29], [34, 36.5], [42.5, 28], [64, 32], [61, 29], [66, 36.5], [57.5, 28]].map(([x, y]) => dot(x, y, 0.45, deep)).join('') +
          front(M) +
          strands('M50 32.5V13.5M47 31Q45.5 24 47.5 15.5M53 31Q54.5 24 52.5 15.5') +
          shine('M46.2 29Q45.4 22 47.4 16', 1.6),
      };
    }
    case 9: {
      // cacheado
      const F = 'M30.5 45C26 41 27.5 33.5 32 32C30 26 36 21.5 40.5 23.5C40.5 17.5 48 16.5 50 20.5C53 16.5 60 17.5 59.5 23.5C64.5 21.5 70.5 26 68 32C72.5 33.5 74 41 69.5 45C66 38.5 60 34.5 50 34.5C40 34.5 34 38.5 30.5 45Z';
      return {
        cast: [F],
        back: back('M28.5 50C24 47 23.5 40 27 36L73 36C76.5 40 76 47 71.5 50Z') + curls([[27, 44], [73, 44]]),
        front:
          front(F) +
          curls([[34, 30], [41, 26.5], [50, 24.5], [59, 26.5], [66, 30], [31, 39], [69, 39], [45, 31], [55, 31]]) +
          curls([[40, 22], [47, 20]], hl, 1.4),
      };
    }
    case 10: {
      // chiquinhas com xuxinhas
      const F = 'M30.5 45C29.5 28 38 21.5 50 21.5C62 21.5 70.5 28 69.5 45C68 34.5 60 28.5 51 28.5L50 32.5L49 28.5C40 28.5 32 34.5 30.5 45Z';
      return {
        cast: [F],
        back:
          back('M27 38C18 36 13 46 16 55C18 61 24 62 27 58Z') +
          back('M73 38C82 36 87 46 84 55C82 61 76 62 73 58Z') +
          strands('M22 41Q18 47 19.5 55M25.5 44Q22.5 50 24 57M78 41Q82 47 80.5 55M74.5 44Q77.5 50 76 57') +
          line('M19 44.5Q18 49 18.6 52', hl, 1.6, 'opacity=".7"') +
          shape('M25 37.5A3 3 0 1 1 31 37.5A3 3 0 1 1 25 37.5Z', '#ed1c24') +
          shape('M69 37.5A3 3 0 1 1 75 37.5A3 3 0 1 1 69 37.5Z', '#ed1c24') +
          dot(27, 36.4, 0.8, '#fff', 'opacity=".7"') +
          dot(71, 36.4, 0.8, '#fff', 'opacity=".7"'),
        front:
          front(F) +
          strands('M49.5 29.5Q42 28 36 33M50.5 29.5Q58 28 64 33M45 24.5Q38 27 34 33M55 24.5Q62 27 66 33') +
          shine('M37 30Q41.5 25.5 47 24.5'),
      };
    }
    default: {
      // careca: só o brilho na cabeça
      return {
        front:
          `<ellipse cx="42" cy="30" rx="5" ry="2.4" transform="rotate(-28 42 30)" fill="#fff" opacity=".35"/>` +
          dot(48.5, 27, 1, '#fff', 'opacity=".35"'),
      };
    }
  }
}

// ---------- rostos ----------

function faceSvg(style, skin, hairColor, clip) {
  const skinShade = darken(skin, 0.14);
  const browC = mix(hairColor, INK, isLight(hairColor) ? 0.55 : 0.3);
  const mouthFill = '#7a1a22';
  const tongue = '#ff6f8a';
  const eye = (x, y, r = 2.4) =>
    `<ellipse cx="${x}" cy="${y}" rx="${r * 0.85}" ry="${r * 1.15}" fill="${INK}"/>` + dot(x + r * 0.32, y - r * 0.45, r * 0.32, '#fff');
  const eyes = (r) => eye(42, 47, r) + eye(58, 47, r);
  const brows = (lift = 0, w = 2.1) =>
    line(`M38.5 ${41 - lift}Q42 ${39.2 - lift} 45.5 ${40.6 - lift}`, browC, w) + line(`M54.5 ${40.6 - lift}Q58 ${39.2 - lift} 61.5 ${41 - lift}`, browC, w);
  const happyEyes = line('M39 48.5Q42 44 45 48.5') + line('M55 48.5Q58 44 61 48.5');
  const nose = line('M49.4 49.2Q47.9 52.4 49.9 53.1Q51.3 53.4 52.1 52.5', darken(skin, 0.32), 1.4);
  const blush = (o = 0.3) => dot(36.5, 54, 3.4, '#ff5a6e', `opacity="${o}"`) + dot(63.5, 54, 3.4, '#ff5a6e', `opacity="${o}"`);
  const smile = line('M43.5 55.5Q50 61.5 56.5 55.5', INK, 2);
  // Boca aberta: dentes em cima e língua embaixo, recortados no formato da boca.
  const openMouth = (d, { teeth = true, tongueY = 62.6 } = {}) =>
    fillOnly(d, mouthFill) +
    clip(d, (teeth ? fillOnly('M40 50H60V57H40Z', '#fff') : '') + `<ellipse cx="50" cy="${tongueY}" rx="5.2" ry="3" fill="${tongue}"/>`) +
    shape(d, 'none');
  const heart = (x, y) =>
    `<path d="M${x} ${y + 3.4}C${x - 5.8} ${y - 0.5} ${x - 3.7} ${y - 5.8} ${x} ${y - 2.7}C${x + 3.7} ${y - 5.8} ${x + 5.8} ${y - 0.5} ${x} ${y + 3.4}Z" fill="#e8203a" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
    `<ellipse cx="${x - 2}" cy="${y - 1.6}" rx="1.1" ry=".7" transform="rotate(-35 ${x - 2} ${y - 1.6})" fill="#fff" opacity=".8"/>`;

  switch (style) {
    case 1: // feliz
      return brows(1.4) + happyEyes + nose + openMouth('M42.5 54.6H57.5Q56.6 64 50 64Q43.4 64 42.5 54.6Z') + blush();
    case 2: // piscadinha
      return (
        line('M38.5 41Q42 39.2 45.5 40.6', browC, 2.1) +
        line('M54.5 43Q58 41.6 61.5 43.4', browC, 2.1) +
        eye(42, 47) +
        line('M54.5 47.6Q58 50.2 61.5 47.6') +
        line('M61.4 47.7L63.3 46.6', INK, 1.4) +
        nose +
        line('M44.5 57.5Q51 60.8 56.5 54.6', INK, 2) +
        line('M55.6 53.5Q57.2 54.3 57.3 56', INK, 1.3) +
        blush()
      );
    case 3: {
      // surpreso
      const o = 'M50 54.6C53.3 54.6 53.6 57.6 53.6 59C53.6 61.4 52 62.8 50 62.8C48 62.8 46.4 61.4 46.4 59C46.4 57.6 46.7 54.6 50 54.6Z';
      return (
        brows(3, 1.9) +
        `<circle cx="42" cy="47" r="4.2" fill="#fff" stroke="${INK}" stroke-width="1.4"/><circle cx="58" cy="47" r="4.2" fill="#fff" stroke="${INK}" stroke-width="1.4"/>` +
        dot(42, 47.6, 2.1, INK) +
        dot(58, 47.6, 2.1, INK) +
        dot(42.8, 46.6, 0.7, '#fff') +
        dot(58.8, 46.6, 0.7, '#fff') +
        nose +
        fillOnly(o, mouthFill) +
        clip(o, `<ellipse cx="50" cy="62.4" rx="3" ry="2" fill="${tongue}"/>`) +
        shape(o, 'none', 'stroke-width="1.6"')
      );
    }
    case 4: {
      // bravo
      const lid = (d) => fillOnly(d, skin);
      return (
        eyes(2.2) +
        lid('M37 42L46.5 44.6V46L37 44Z') +
        lid('M63 42L53.5 44.6V46L63 44Z') +
        line('M38.6 44.3L45.8 45.9', INK, 1.5) +
        line('M61.4 44.3L54.2 45.9', INK, 1.5) +
        line('M37.5 40.4Q42 41.6 46.4 44.6', browC, 2.8) +
        line('M62.5 40.4Q58 41.6 53.6 44.6', browC, 2.8) +
        line('M48.6 43.2Q50 42 51.4 43.2', darken(skin, 0.3), 1.1) +
        nose +
        shape('M44.2 57.2Q50 55 55.8 57.2V60.2Q50 58.4 44.2 60.2Z', '#fff', 'stroke-width="1.6"') +
        line('M47.2 56.3V59.3M50 55.9V58.9M52.8 56.3V59.3', INK, 0.9)
      );
    }
    case 5: // óculos redondos
      return (
        brows(2.4) +
        eyes(2.1) +
        clip(
          `${ellipseD(42, 47, 5.6, 5.6)}${ellipseD(58, 47, 5.6, 5.6)}`,
          fillOnly('M0 0H100V100H0Z', '#bfe6ff', 'opacity=".22"') + line('M37.5 45L41 41.5M53.5 45L57 41.5', '#fff', 1.6, 'opacity=".9"'),
        ) +
        `<circle cx="42" cy="47" r="5.6" fill="none" stroke="${INK}" stroke-width="1.9"/><circle cx="58" cy="47" r="5.6" fill="none" stroke="${INK}" stroke-width="1.9"/>` +
        line('M47.6 46.5Q50 45 52.4 46.5', INK, 1.6) +
        line('M36.4 46L31.5 45', INK, 1.6) +
        line('M63.6 46L68.5 45', INK, 1.6) +
        nose +
        smile
      );
    case 6: // língua de fora
      return (
        brows(1) +
        happyEyes +
        nose +
        shape('M46 57.5Q45.8 65.5 50 65.5Q54.2 65.5 54 57.5Z', tongue) +
        line('M50 58.4V62.6', darken(tongue, 0.25), 1.1) +
        line('M42.8 55.4Q50 60.6 57.2 55.4', INK, 2) +
        blush()
      );
    case 7: {
      // blasé: pálpebras caídas, olhando de lado
      const half = (x) =>
        shape(`M${x - 3.6} 46.5A3.6 3.6 0 0 0 ${x + 3.6} 46.5Z`, '#fff', 'stroke-width="1.3"') +
        fillOnly(`M${x - 0.6} 46.5A2.1 2.1 0 0 0 ${x + 3.3} 46.5Z`, INK) +
        shape(`M${x - 3.6} 46.5A3.6 3.6 0 0 1 ${x + 3.6} 46.5Z`, skinShade, 'stroke-width="1.3"') +
        line(`M${x - 4.2} 46.5H${x + 4.2}`, INK, 2);
      return (
        line('M38.5 41.6Q42 40.8 45.5 41.6', browC, 2) +
        line('M54.5 41Q58 40 61.5 40.4', browC, 2) +
        half(42) +
        half(58) +
        nose +
        line('M45.5 58.2Q50 57.4 54.5 57.4', INK, 2) +
        line('M54.3 57.4L55.6 56.6', INK, 1.4)
      );
    }
    case 8: // apaixonado
      return brows(2) + heart(42, 47) + heart(58, 47) + nose + openMouth('M43.5 55H56.5Q55.6 62.6 50 62.6Q44.4 62.6 43.5 55Z', { tongueY: 61.4 }) + blush(0.45);
    case 9: {
      // óculos escuros com reflexo
      const L = 'M35.5 43.5H48L47 50Q42 53.5 37.5 50Z';
      const R = 'M52 43.5H64.5L62.5 50Q58 53.5 53 50Z';
      return (
        brows(1.6) +
        nose +
        shape(L, '#22222e') +
        shape(R, '#22222e') +
        clip(L + R, line('M36 49L44 41M40 51L48 43M52.5 49L60.5 41M56.5 51L64.5 43', '#fff', 1.4, 'opacity=".28"') + fillOnly('M30 43H70V45.5H30Z', '#fff', 'opacity=".12"')) +
        line('M48 44.5Q50 43.5 52 44.5', INK, 1.6) +
        line('M35.6 44.4L31 44.2M64.4 44.4L69 44.2', INK, 1.6) +
        line('M45 57.5Q51 60 56 55.5', INK, 2) +
        line('M55.1 54.5Q56.6 55 56.9 56.6', INK, 1.3)
      );
    }
    case 10: {
      // bigodão
      const M = 'M50 53.8C46 51 39.5 52 36.5 57.2C38 58.2 39.4 57.4 40.2 56.4C43 57.8 46.5 57.8 50 56.4C53.5 57.8 57 57.8 59.8 56.4C60.6 57.4 62 58.2 63.5 57.2C60.5 52 54 51 50 53.8Z';
      return (
        line('M38 41.2Q42 38.6 46 40.6', browC, 3) +
        line('M54 40.6Q58 38.6 62 41.2', browC, 3) +
        eyes() +
        line('M49.2 47.5Q47.4 51 49.8 51.8Q51.4 52.1 52.4 51', darken(skin, 0.32), 1.5) +
        line('M46.6 60Q50 62 53.4 60', INK, 1.8) +
        shape(M, hairColor) +
        line('M42 55.2Q45 54.2 48 55.2M52 55.2Q55 54.2 58 55.2', darken(hairColor, isLight(hairColor) ? 0.3 : 0.45), 1) +
        line('M44 53.8Q47 52.8 49 53.6', lighten(hairColor, 0.4), 1.1, 'opacity=".7"')
      );
    }
    case 11: {
      // sardas
      const freckles = [
        [35, 51.6, 0.85], [38.2, 52.8, 0.75], [35.8, 54.8, 0.9], [39.2, 55.6, 0.7], [37, 57.4, 0.6],
        [65, 51.6, 0.85], [61.8, 52.8, 0.75], [64.2, 54.8, 0.9], [60.8, 55.6, 0.7], [63, 57.4, 0.6],
        [47.6, 50.4, 0.5], [52.4, 50.4, 0.5],
      ];
      return (
        brows(0.6) +
        eyes() +
        blush(0.22) +
        freckles.map(([x, y, r]) => dot(x, y, r, darken(skin, 0.38))).join('') +
        nose +
        shape('M43 55.2Q50 58.4 57 55.2Q55.8 61.4 50 61.4Q44.2 61.4 43 55.2Z', '#fff', 'stroke-width="1.7"')
      );
    }
    default: // sorriso
      return brows() + eyes() + nose + smile + line('M42.7 54.6Q43.2 55.9 44.3 56', INK, 1.3) + line('M57.3 54.6Q56.8 55.9 55.7 56', INK, 1.3) + blush(0.18);
  }
}

// SVG completo como texto. `view` deixa recortar (ex.: só a cabeça nas miniaturas de cabelo e rosto).
export function avatarSVG(avatar, { view = '0 0 100 100', title } = {}) {
  const a = sanitizeAvatar(avatar) ?? randomAvatar();
  const clip = clipper();
  const bg = BACKGROUNDS[a.bg].hex;
  const skin = SKINS[a.skin].hex;
  const hairColor = HAIR_COLORS[a.hairColor].hex;
  const hair = hairSvg(a.hair, hairColor, skin);
  const skinShade = darken(skin, 0.18);
  const earInner = darken(skin, 0.28);
  // Sombra do lado direito do rosto e a do cabelo caindo na testa.
  const headShading =
    fillOnly(`M0 0H100V100H0Z${ellipseD(47.6, 43.2, 19, 21)}`, darken(skin, 0.09), 'fill-rule="evenodd"') +
    (hair.cast ?? []).map((d) => fillOnly(d, darken(skin, 0.2), 'transform="translate(.8 2.6)" opacity=".55"')).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" role="img" aria-label="${title ?? 'Avatar'}">`,
    `<rect x="-20" y="-20" width="140" height="140" fill="${bg}"/>`,
    `<circle cx="34" cy="26" r="46" fill="#fff" opacity=".12"/>`,
    `<circle cx="28" cy="20" r="22" fill="#fff" opacity=".08"/>`,
    `<path d="M-20 92Q50 80 120 92V120H-20Z" fill="#000" opacity=".08"/>`,
    hair.back ?? '',
    shape(NECK, skin),
    fillOnly('M43.9 61Q50 68 56.1 61V66Q50 71 43.9 66Z', skinShade),
    outfitSvg(a.outfit, OUTFIT_COLORS[a.outfitColor].hex, skin, clip),
    shape('M26.5 48A4.5 4.5 0 1 1 35.5 48A4.5 4.5 0 1 1 26.5 48Z', skin),
    shape('M64.5 48A4.5 4.5 0 1 1 73.5 48A4.5 4.5 0 1 1 64.5 48Z', skin),
    line('M29.6 46Q28.4 48 30.2 50.4', earInner, 1.3),
    line('M70.4 46Q71.6 48 69.8 50.4', earInner, 1.3),
    fillOnly(HEAD_D, skin),
    clip(HEAD_D, headShading),
    shape(HEAD_D, 'none'),
    faceSvg(a.face, skin, hairColor, clip),
    hair.front ?? '',
    '</svg>',
  ].join('');
}
