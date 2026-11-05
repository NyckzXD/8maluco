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
const line = (d, stroke = INK, w = 2) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const fillOnly = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;

const BODY = 'M10 104C10 86 23 76 41 73Q50 77 59 73C77 76 90 86 90 104Z';
const HEAD = { cx: 50, cy: 45, rx: 19, ry: 21 };

function outfitSvg(style, c, skin) {
  const dark = darken(c, 0.25);
  const trim = isLight(c) ? darken(c, 0.35) : lighten(c, 0.25);
  switch (style) {
    case 1: // gola V
      return shape(BODY, c) + shape('M42 73.5L50 87L58 73.5Q50 77 42 73.5Z', skin) + line('M42 74L50 87L58 74', trim, 2.4);
    case 2: // moletom com capuz
      return (
        shape(BODY, c) +
        shape('M32 79C34 70 43 69 50 74C57 69 66 70 68 79C60 84 40 84 32 79Z', dark) +
        line('M46 81L45 92', '#f4f3f4', 1.6) +
        line('M54 81L55 92', '#f4f3f4', 1.6) +
        line('M35 104L38.5 93H61.5L65 104', dark, 2.2)
      );
    case 3: // social com gravata
      return (
        shape(BODY, c) +
        shape('M48 79L52 79L53.5 82L51.5 96L50 98.5L48.5 96L46.5 82Z', isLight(c) ? '#c4141b' : darken(c, 0.5)) +
        shape('M41 73L46.5 84L50 77.5Z', '#f4f3f4') +
        shape('M59 73L53.5 84L50 77.5Z', '#f4f3f4')
      );
    case 4: // regata
      return (
        shape(BODY, skin) +
        shape('M28 104L31 85Q33 79 37 77L40 77Q43 87 50 87Q57 87 60 77L63 77Q67 79 69 85L72 104Z', c)
      );
    case 5: // jaqueta aberta com camiseta branca
      return (
        shape(BODY, c) +
        shape('M42 73.5Q50 77.5 58 73.5L56 104H44Z', '#f4f3f4') +
        line('M41.5 74L46 93', dark, 2.4) +
        line('M58.5 74L54 93', dark, 2.4) +
        line('M24 104L26 92', dark, 2)
      );
    case 6: // listrada
      return (
        shape(BODY, c) +
        fillOnly('M0 87H100V91H0ZM0 95H100V99H0Z', trim) +
        shape(BODY, 'none') +
        line('M41 73.5Q50 81 59 73.5', dark, 3)
      );
    case 7: // gola alta
      return (
        shape(BODY, c) +
        shape('M41.5 61H58.5L59.5 75Q50 80 40.5 75Z', dark) +
        line('M42 67Q50 69 58 67', darken(c, 0.4), 1.2) +
        line('M41.5 71Q50 73.5 58.5 71', darken(c, 0.4), 1.2)
      );
    default: // camiseta
      return shape(BODY, c) + line('M41 73.5Q50 81 59 73.5', dark, 3);
  }
}

// Cabelo em duas camadas: atrás da cabeça (e do corpo) e na frente da testa.
function hairSvg(style, c) {
  const back = (d) => shape(d, c);
  const front = (d) => shape(d, c);
  switch (style) {
    case 1: // curto
      return { front: front('M30.5 46C28.5 29 38 21.5 50 21.5C62 21.5 71.5 29 69.5 46C67 37 62 33 56 32C50 35 40 35 34 38.5C32 40.5 31 43 30.5 46Z') };
    case 2: // espetado
      return {
        front: front('M30.5 45C29.5 35 31 29 34 26.5L32 17L40 22.5L41.5 13L48 20.5L52 11L56 20.5L62.5 14L63 23.5L70 19L67.5 28C70.5 32 71 38 69.5 45C66 37 60 33.5 50 33.5C42 33.5 35 37 30.5 45Z'),
      };
    case 3: // topete
      return {
        front: front('M31 43C30 31 35 25 43 23.5C41 17.5 48 12.5 58 13.5C67 14.5 71 20 68 24.5C71 28.5 71 36 69.5 43C66 35 60 32 52 33C44 32 36 35.5 31 43Z'),
      };
    case 4: // comprido
      return {
        back: back('M28.5 46C26 26 38 19 50 19C62 19 74 26 71.5 46L75 79C70 83 62 83 58.5 79L57 62H43L41.5 79C38 83 30 83 25 79Z'),
        front: front('M30.5 49C28 30 38 21 50 21C62 21 72 29.5 69.5 49C68 41 66.5 37 64 33.5C56 36.5 44 34.5 38 30C34 34 32 40 30.5 49Z'),
      };
    case 5: // coque
      return {
        back: back('M41 19A9 9 0 1 1 59 19A9 9 0 1 1 41 19Z'),
        front: front('M30.5 45C30 30 39 23.5 50 23.5C61 23.5 70 30 69.5 45C66 36 58 31.5 50 31.5C42 31.5 34 36 30.5 45Z') + line('M44 25Q50 22.5 56 25', darken(c, 0.3), 1.4),
      };
    case 6: // black power
      return {
        back: back('M22 40C20 24 33 11 50 11C67 11 80 24 78 40C80 52 72 62 66 62L34 62C28 62 20 52 22 40Z'),
        front: fillOnly('M31 41C32 31 40 27.5 50 27.5C60 27.5 68 31 69 41C64 35 58 33.5 50 33.5C42 33.5 36 35 31 41Z', c),
      };
    case 7: // chanel com franja
      return {
        back: back('M27 47C26 27 38 20 50 20C62 20 74 27 73 47L74.5 65C70 69 64 69 62 65H38C36 69 30 69 25.5 65Z'),
        front: front('M30.5 47C28.5 28.5 38 21 50 21C62 21 71.5 28.5 69.5 47L67.5 37.5H32.5Z'),
      };
    case 8: // moicano
      return {
        front:
          fillOnly('M31.2 42C31 30 40 24.2 50 24.2C60 24.2 69 30 68.8 42C64 34 36 34 31.2 42Z', c, 'opacity=".35"') +
          front('M44.5 35C42 25 44 15 50 6C56 15 58 25 55.5 35C53 33 47 33 44.5 35Z'),
      };
    case 9: // cacheado
      return {
        front: front('M30.5 45C26 41 27.5 33.5 32 32C30 26 36 21.5 40.5 23.5C40.5 17.5 48 16.5 50 20.5C53 16.5 60 17.5 59.5 23.5C64.5 21.5 70.5 26 68 32C72.5 33.5 74 41 69.5 45C66 38.5 60 34.5 50 34.5C40 34.5 34 38.5 30.5 45Z'),
      };
    case 10: // chiquinhas
      return {
        back:
          back('M27 38C18 36 13 46 16 55C18 61 24 62 27 58Z') +
          back('M73 38C82 36 87 46 84 55C82 61 76 62 73 58Z') +
          shape('M25 37.5A3 3 0 1 1 31 37.5A3 3 0 1 1 25 37.5Z', '#ed1c24') +
          shape('M69 37.5A3 3 0 1 1 75 37.5A3 3 0 1 1 69 37.5Z', '#ed1c24'),
        front: front('M30.5 45C29.5 28 38 21.5 50 21.5C62 21.5 70.5 28 69.5 45C68 34.5 60 28.5 51 28.5L50 32.5L49 28.5C40 28.5 32 34.5 30.5 45Z'),
      };
    default: // careca
      return {};
  }
}

function faceSvg(style, skin, hairColor) {
  const eyes = (r = 2.4) =>
    `<ellipse cx="42" cy="47" rx="${r * 0.85}" ry="${r * 1.15}" fill="${INK}"/><ellipse cx="58" cy="47" rx="${r * 0.85}" ry="${r * 1.15}" fill="${INK}"/>`;
  const smile = line('M44 56Q50 61.5 56 56', INK, 2);
  const blush = `<circle cx="36.5" cy="54" r="3.2" fill="#ff5a6e" opacity=".3"/><circle cx="63.5" cy="54" r="3.2" fill="#ff5a6e" opacity=".3"/>`;
  const nose = line('M48.8 51.5Q50 53.2 51.2 51.5', darken(skin, 0.3), 1.4);
  const mouthFill = '#7a1a22';
  const heart = (x, y) => `<path d="M${x} ${y + 3.2}C${x - 5.5} ${y - 0.5} ${x - 3.5} ${y - 5.5} ${x} ${y - 2.6}C${x + 3.5} ${y - 5.5} ${x + 5.5} ${y - 0.5} ${x} ${y + 3.2}Z" fill="#e8203a" stroke="${INK}" stroke-width="1"/>`;
  switch (style) {
    case 1: // feliz
      return line('M39 48.5Q42 44 45 48.5') + line('M55 48.5Q58 44 61 48.5') + nose + shape('M43 55H57Q56 63.5 50 63.5Q44 63.5 43 55Z', mouthFill) + blush;
    case 2: // piscadinha
      return `<ellipse cx="42" cy="47" rx="2" ry="2.8" fill="${INK}"/>` + line('M55 47.5Q58 49.5 61 47.5') + nose + line('M45 57Q51 60.5 56.5 55', INK, 2) + blush;
    case 3: // surpreso
      return (
        line('M38.5 40.5Q42 38.5 45.5 40.5', INK, 1.6) +
        line('M54.5 40.5Q58 38.5 61.5 40.5', INK, 1.6) +
        `<circle cx="42" cy="47" r="4" fill="#fff" stroke="${INK}" stroke-width="1.4"/><circle cx="58" cy="47" r="4" fill="#fff" stroke="${INK}" stroke-width="1.4"/>` +
        `<circle cx="42" cy="47.5" r="1.9" fill="${INK}"/><circle cx="58" cy="47.5" r="1.9" fill="${INK}"/>` +
        nose +
        `<ellipse cx="50" cy="58.5" rx="3" ry="3.6" fill="${mouthFill}" stroke="${INK}" stroke-width="1.6"/>`
      );
    case 4: // bravo
      return line('M38 41.5L46 44.5', INK, 2.4) + line('M62 41.5L54 44.5', INK, 2.4) + eyes(2.2) + nose + line('M45 59Q50 55.5 55 59', INK, 2);
    case 5: // óculos
      return (
        eyes(2) +
        `<circle cx="42" cy="47" r="5.6" fill="#fff" fill-opacity=".25" stroke="${INK}" stroke-width="1.8"/><circle cx="58" cy="47" r="5.6" fill="#fff" fill-opacity=".25" stroke="${INK}" stroke-width="1.8"/>` +
        line('M47.6 46.5Q50 45 52.4 46.5', INK, 1.6) +
        line('M36.4 46L31.5 45', INK, 1.6) +
        line('M63.6 46L68.5 45', INK, 1.6) +
        nose +
        smile
      );
    case 6: // língua
      return (
        line('M39 47.5Q42 44.5 45 47.5') +
        line('M55 47.5Q58 44.5 61 47.5') +
        nose +
        shape('M46.5 57.5Q46.5 64.5 50 64.5Q53.5 64.5 53.5 57.5Z', '#ff6f8a') +
        line('M43 55.5Q50 60.5 57 55.5', INK, 2) +
        blush
      );
    case 7: // blasé
      return (
        `<path d="M38.8 46.5A3.2 3.2 0 0 0 45.2 46.5Z" fill="${INK}"/><path d="M54.8 46.5A3.2 3.2 0 0 0 61.2 46.5Z" fill="${INK}"/>` +
        line('M38.5 46.5H45.5', INK, 1.8) +
        line('M54.5 46.5H61.5', INK, 1.8) +
        nose +
        line('M45.5 57.5H54.5', INK, 2)
      );
    case 8: // apaixonado
      return heart(42, 47) + heart(58, 47) + nose + shape('M43.5 55H56.5Q55.5 62.5 50 62.5Q44.5 62.5 43.5 55Z', mouthFill) + blush;
    case 9: // óculos escuros
      return (
        shape('M35.5 43.5H48L47 50Q42 53.5 37.5 50Z', INK) +
        shape('M52 43.5H64.5L62.5 50Q58 53.5 53 50Z', INK) +
        line('M48 44.5Q50 43.5 52 44.5', INK, 1.6) +
        line('M38.5 45.5L41.5 45.5', '#fff', 1.2) +
        line('M54.5 45.5L57.5 45.5', '#fff', 1.2) +
        nose +
        line('M45 57.5Q51 60 56 55.5', INK, 2)
      );
    case 10: // bigode
      return (
        eyes() +
        line('M48.8 50.5Q50 52.2 51.2 50.5', darken(skin, 0.3), 1.4) +
        shape('M50 54C46 51.5 40 52.5 37.5 57C42 55.5 46 57.5 50 56.5C54 57.5 58 55.5 62.5 57C60 52.5 54 51.5 50 54Z', hairColor) +
        line('M47 60Q50 61.5 53 60', INK, 1.8)
      );
    case 11: // sardas
      return (
        eyes() +
        nose +
        smile +
        [
          [36, 52],
          [39, 54.5],
          [35.5, 55.5],
          [64, 52],
          [61, 54.5],
          [64.5, 55.5],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="${darken(skin, 0.4)}"/>`)
          .join('')
      );
    default: // sorriso
      return eyes() + nose + smile;
  }
}

// SVG completo como texto. `view` deixa recortar (ex.: só a cabeça nas miniaturas de cabelo e rosto).
export function avatarSVG(avatar, { view = '0 0 100 100', title } = {}) {
  const a = sanitizeAvatar(avatar) ?? randomAvatar();
  const bg = BACKGROUNDS[a.bg].hex;
  const skin = SKINS[a.skin].hex;
  const hairColor = HAIR_COLORS[a.hairColor].hex;
  const hair = hairSvg(a.hair, hairColor);
  const skinShade = darken(skin, 0.18);
  const { cx, cy, rx, ry } = HEAD;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" role="img" aria-label="${title ?? 'Avatar'}">`,
    `<rect x="-20" y="-20" width="140" height="140" fill="${bg}"/>`,
    `<circle cx="34" cy="26" r="46" fill="#fff" opacity=".12"/>`,
    hair.back ?? '',
    shape('M43 58V75Q50 79 57 75V58Z', skin),
    fillOnly('M43.9 61Q50 68 56.1 61V66Q50 71 43.9 66Z', skinShade),
    outfitSvg(a.outfit, OUTFIT_COLORS[a.outfitColor].hex, skin),
    shape('M26.5 48A4.5 4.5 0 1 1 35.5 48A4.5 4.5 0 1 1 26.5 48Z', skin),
    shape('M64.5 48A4.5 4.5 0 1 1 73.5 48A4.5 4.5 0 1 1 64.5 48Z', skin),
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${skin}" stroke="${INK}" stroke-width="${SW}"/>`,
    faceSvg(a.face, skin, hairColor),
    hair.front ?? '',
    '</svg>',
  ].join('');
}
