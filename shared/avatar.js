// Avatar montável (fundo, pele, roupa, cabelo e rosto), desenhado em SVG vetorial num quadrado 100×100.
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
// Estilo vetorial chapado: formas geométricas, sem contorno e sem brilho. Cada peça usa a cor
// escolhida e, no máximo, um segundo tom. O que separa uma peça da outra é a diferença de tom
// (pescoço mais escuro que o rosto, sombra reta do cabelo na testa, disco claro atrás da figura).

const INK = '#2a2230';
const PAPER = '#f5f3ee';
const RED = '#e5484d';

// Mistura duas cores hex (t = 0 fica com a primeira, 1 com a segunda).
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
const darken = (hex, t) => mix(hex, '#000000', t);
const lighten = (hex, t) => mix(hex, '#ffffff', t);
const lum = (hex) => {
  const p = parseInt(hex.slice(1), 16);
  return 0.299 * (p >> 16) + 0.587 * ((p >> 8) & 255) + 0.114 * (p & 255);
};
const isLight = (hex) => lum(hex) > 170;
// Segundo tom de uma cor: mais escuro, ou mais claro quando a cor já é quase preta.
const tone = (hex, t = 0.16) => (lum(hex) < 55 ? lighten(hex, t) : darken(hex, t));
// Sem contorno, pelo colado na pele da mesma cor some: nesse caso escurece até dar leitura.
const against = (hex, skin) => (Math.abs(lum(hex) - lum(skin)) < 45 ? darken(skin, 0.55) : hex);

const fill = (d, color, extra = '') => `<path d="${d}" fill="${color}" ${extra}/>`;
// Forma com os cantos arredondados (um traço da mesma cor, com junta redonda).
const soft = (d, color, w = 1.6) =>
  `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"/>`;
const line = (d, stroke = INK, w = 2, extra = '') =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const dot = (x, y, r, color, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" ${extra}/>`;
// Elipse como caminho (para usar em recortes e nas sombras).
const ellipseD = (cx, cy, rx, ry) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;

const BODY = 'M10 104V98C10 85 24 77.5 41 75Q50 79.5 59 75C76 77.5 90 85 90 98V104Z';
const HEAD_D = 'M31 43C31 31 39 24 50 24C61 24 69 31 69 43V47C69 59 61 66 50 66C39 66 31 59 31 47Z';
const NECK = 'M43.5 58H56.5V77Q50 81 43.5 77Z';

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
  const shade = tone(c, 0.16);
  const deep = tone(c, 0.3);
  const trim = isLight(c) ? darken(c, 0.3) : PAPER;
  const neckTone = darken(skin, 0.12);
  // Tronco e os dois vincos que sugerem os braços.
  const torso = (color, crease = shade) =>
    fill(BODY, color) + line('M27.5 104V93', crease, 1.8) + line('M72.5 104V93', crease, 1.8);

  switch (style) {
    case 1: // gola V
      return torso(c) + fill('M41 75Q50 79.5 59 75L50 90Z', neckTone) + line('M41.6 76.2L50 90L58.4 76.2', shade, 2.4);
    case 2: // moletom: gola do capuz, cordões e bolso canguru
      return (
        torso(c) +
        soft('M37 104L40 95H60L63 104Z', shade) +
        soft('M41 75Q50 79.5 59 75L65 78.5Q50 91 35 78.5Z', shade) +
        line('M46 85.5V93', PAPER, 1.8) +
        line('M54 85.5V93', PAPER, 1.8)
      );
    case 3: {
      // social: paletó, camisa e gravata
      const tie = isLight(c) ? '#c4353a' : mix(c, RED, 0.6);
      return (
        torso(c) +
        fill('M41 75Q50 79.5 59 75L50 101Z', PAPER) +
        soft('M48 80H52L51.2 83.6H48.8Z', tie, 0.8) +
        soft('M48.8 83.6H51.2L52.8 94L50 97.5L47.2 94Z', tie, 0.8) +
        soft('M41 75L35 83L50 104V98Z', shade, 1) +
        soft('M59 75L65 83L50 104V98Z', deep, 1) +
        `<rect x="63.5" y="89.5" width="7" height="2.2" rx="1.1" fill="${PAPER}"/>`
      );
    }
    case 4: // regata: ombros à mostra
      return (
        torso(skin, neckTone) +
        soft(
          'M30 104L32 88Q33 80.5 38 78L40.5 77.5Q43 88.5 50 88.5Q57 88.5 59.5 77.5L62 78Q67 80.5 68 88L70 104Z',
          c,
          1,
        )
      );
    case 5: {
      // jaqueta aberta, com gola e bolsos, camiseta por baixo
      const tee = isLight(c) ? '#33303a' : PAPER;
      return (
        torso(c, deep) +
        fill('M41 75Q50 79.5 59 75L57.5 104H42.5Z', tee) +
        soft('M41 75L33 78.5L37 87L45 81Z', shade, 1.2) +
        soft('M59 75L67 78.5L63 87L55 81Z', shade, 1.2) +
        `<rect x="30" y="92" width="9" height="2.4" rx="1.2" fill="${shade}"/>` +
        `<rect x="61" y="92" width="9" height="2.4" rx="1.2" fill="${shade}"/>`
      );
    }
    case 6: // listrada: as listras são recortadas no tronco
      return (
        fill(BODY, c) +
        clip(BODY, fill('M0 82H100V85.6H0ZM0 89.4H100V93H0ZM0 96.8H100V100.4H0Z', trim)) +
        line('M41.8 76.4Q50 80.8 58.2 76.4', shade, 2.4)
      );
    case 7: {
      // gola alta dobrada
      const collar = 'M42 64H58Q59.6 64 59.7 66L60 76.5Q50 81.5 40 76.5L40.3 66Q40.4 64 42 64Z';
      return torso(c) + fill(collar, shade) + line('M40.6 71Q50 74.6 59.4 71', deep, 1.4);
    }
    default: // camiseta, com um naipe pequeno no peito
      return (
        torso(c) +
        line('M41.8 76.4Q50 80.8 58.2 76.4', shade, 2.4) +
        soft('M65 87L67.6 90.6L65 94.2L62.4 90.6Z', trim, 0.8)
      );
  }
}

// ---------- cabelos ----------
// Duas camadas: atrás da cabeça (e do corpo) e na frente da testa. `cast` são as formas que
// projetam uma sombra reta na testa (o mesmo desenho, um pouco mais abaixo, recortado no rosto).
// `ears: false` esconde as orelhas nos cortes que cobrem a lateral do rosto.

function hairSvg(style, c, skin) {
  const back = tone(c, 0.18);
  const accent = isLight(c) ? darken(c, 0.1) : lighten(c, 0.16);
  // Calota comum: contorna o alto da cabeça de uma têmpora à outra; cada corte fecha a testa do seu jeito.
  const cap = (hairline) => `M30 46C28 30 38 21.5 50 21.5C62 21.5 72 30 70 46${hairline}Z`;

  switch (style) {
    case 1: {
      // curto, franja de lado
      const F = cap('C69 40 67 36 64 33C55 37 43 36 35 38.5C32.5 40 31 43 30 46');
      return { cast: [F], front: fill(F, c) + line('M63 31.5Q58 26.5 50 25.5', accent, 1.6) };
    }
    case 2: {
      // espetado
      const F =
        'M30 45C29 37 30 31 33 27L31 18L39 22.5L42 13L48 20L53 11.5L57 20L64 14.5L64 23.5L71 20L68 28.5C70.5 33 71 39 70 45C66 37 60 33.5 50 33.5C40 33.5 34 37 30 45Z';
      return { cast: [F], front: soft(F, c, 2) };
    }
    case 3: {
      // topete
      const F =
        'M30.5 44C29.5 33 34 26.5 42 24.5C41 17 49 12.5 58 13.5C67 14.5 72 21 69 26C71 31 71 38 69.5 44C66.5 37 61 33.5 52 34C44 33.5 36 36.5 30.5 44Z';
      return { cast: [F], front: fill(F, c) + fill('M45.5 24.5C48 19 55 16.5 63 18C56 19.5 51 22 48 26.5Z', accent) };
    }
    case 4: {
      // comprido, repartido no meio
      const B = 'M28 46C26 27 38 19.5 50 19.5C62 19.5 74 27 72 46L74 80Q66 84 59 80L57 62H43L41 80Q34 84 26 80Z';
      const F = cap('C68 41 62 33 50 27C38 33 32 41 30 46');
      return { cast: [F], ears: false, back: soft(B, back, 1), front: fill(F, c) };
    }
    case 5: {
      // coque com elástico
      const F = cap('C66 36.5 59 32 50 32C41 32 34 36.5 30 46');
      return {
        cast: [F],
        back: dot(50, 17, 8.5, back),
        front: fill(F, c) + `<rect x="44.5" y="22.6" width="11" height="2.8" rx="1.4" fill="${RED}"/>`,
      };
    }
    case 6: {
      // black power: um círculo só, com a linha da testa na frente
      const F = 'M30.2 43C29 28 38 21.8 50 21.8C62 21.8 71 28 69.8 43C64 35.5 58 33.5 50 33.5C42 33.5 36 35.5 30.2 43Z';
      return {
        cast: [F],
        back: dot(50, 36, 29, c),
        front: fill(F, c) + [38, 50, 62].map((x, i) => dot(x, i === 1 ? 14.5 : 18.5, 1.5, accent)).join(''),
      };
    }
    case 7: {
      // chanel com franja reta
      const B = 'M27 46C26 27 38 20 50 20C62 20 74 27 73 46V63Q73 68 68 68H32Q27 68 27 63Z';
      const F = cap('L68 38H32L30 46');
      return { cast: [F], ears: false, back: fill(B, back), front: soft(F, c, 1) };
    }
    case 8: {
      // moicano: laterais raspadas e crista no meio
      const S = 'M31.2 42C31 30 40 24.2 50 24.2C60 24.2 69 30 68.8 42C64 34 36 34 31.2 42Z';
      const M = 'M44 35C42 25 44 12 50 8C56 12 58 25 56 35C53 33 47 33 44 35Z';
      return { cast: [M], front: fill(S, mix(skin, c, 0.3)) + soft(M, c, 1.4) };
    }
    case 9: {
      // cacheado: uma nuvem de círculos
      const puffs = [
        [35, 33, 7],
        [42, 26.5, 7.5],
        [50, 24, 8],
        [58, 26.5, 7.5],
        [65, 33, 7],
        [31.5, 41, 5],
        [68.5, 41, 5],
      ];
      return {
        cast: puffs.map(([x, y, r]) => ellipseD(x, y, r, r)),
        back: dot(28.5, 46, 6, back) + dot(71.5, 46, 6, back),
        front: puffs.map(([x, y, r]) => dot(x, y, r, c)).join('') + dot(44, 23, 1.5, accent) + dot(56, 22, 1.5, accent),
      };
    }
    case 10: {
      // chiquinhas com xuxinhas
      const F = cap('C68 35 60 29 50 28.5C40 29 32 35 30 46');
      return {
        cast: [F],
        back:
          `<ellipse cx="21" cy="50" rx="7" ry="11" fill="${back}"/><ellipse cx="79" cy="50" rx="7" ry="11" fill="${back}"/>` +
          dot(27, 39.5, 2.8, RED) +
          dot(73, 39.5, 2.8, RED),
        front: fill(F, c),
      };
    }
    default: // careca
      return {};
  }
}

// ---------- rostos ----------

function faceSvg(style, skin, hairColor, clip) {
  // Em pele escura o traço fica quase preto, para os olhos e a boca não sumirem.
  const ink = lum(skin) < 110 ? '#140e13' : INK;
  const browC = against(mix(hairColor, INK, isLight(hairColor) ? 0.5 : 0.25), skin);
  const mouthFill = '#5c1a24';
  const tongue = '#ff7a90';
  const eye = (x, r = 2.3) => dot(x, 47, r, ink);
  const eyes = (r) => eye(42, r) + eye(58, r);
  const brows = (lift = 0, w = 2) =>
    line(`M38.5 ${41 - lift}Q42 ${39.4 - lift} 45.5 ${41 - lift}`, browC, w) +
    line(`M54.5 ${41 - lift}Q58 ${39.4 - lift} 61.5 ${41 - lift}`, browC, w);
  const happyEyes = line('M39 48.5Q42 44.5 45 48.5', ink, 2.2) + line('M55 48.5Q58 44.5 61 48.5', ink, 2.2);
  const nose = line('M48.6 52.6Q50 54 51.4 52.6', darken(skin, 0.24), 1.6);
  const blush = (o = 0.3) =>
    dot(36.5, 54.5, 3.6, '#ff6b6b', `opacity="${o}"`) + dot(63.5, 54.5, 3.6, '#ff6b6b', `opacity="${o}"`);
  const smile = line('M44 56.5Q50 61.5 56 56.5', ink, 2.2);
  // Boca aberta: dentes em cima e língua embaixo, recortados no formato da boca.
  const openMouth = (d) =>
    fill(d, mouthFill) +
    clip(d, fill('M40 50H60V58H40Z', '#fff') + `<ellipse cx="50" cy="64" rx="5" ry="3" fill="${tongue}"/>`);
  const heart = (x, y) =>
    fill(
      `M${x} ${y + 3.6}C${x - 6} ${y - 0.4} ${x - 3.8} ${y - 5.8} ${x} ${y - 2.6}C${x + 3.8} ${y - 5.8} ${x + 6} ${y - 0.4} ${x} ${y + 3.6}Z`,
      RED,
    );

  switch (style) {
    case 1: // feliz
      return brows(1.4) + happyEyes + nose + openMouth('M43 55.5H57Q57 63.5 50 63.5Q43 63.5 43 55.5Z') + blush();
    case 2: // piscadinha
      return (
        line('M38.5 41Q42 39.4 45.5 41', browC) +
        line('M54.5 42.6Q58 41.4 61.5 42.8', browC) +
        eye(42) +
        line('M55 47Q58 49.6 61 47', ink, 2.2) +
        nose +
        line('M44.5 57Q50.5 61 56 55.5', ink, 2.2) +
        blush()
      );
    case 3: // surpreso
      return brows(3) + eyes(2.8) + nose + `<ellipse cx="50" cy="59.4" rx="3.2" ry="3.8" fill="${mouthFill}"/>`;
    case 4: // bravo
      return (
        line('M38 40.5L46 43.6', browC, 2.6) +
        line('M62 40.5L54 43.6', browC, 2.6) +
        eyes(2.1) +
        nose +
        line('M45 60Q50 56.4 55 60', ink, 2.2)
      );
    case 5: // óculos redondos
      return (
        brows(3) +
        dot(42, 47, 6, '#fff', 'opacity=".22"') +
        dot(58, 47, 6, '#fff', 'opacity=".22"') +
        eyes(2) +
        `<circle cx="42" cy="47" r="6" fill="none" stroke="${ink}" stroke-width="1.8"/><circle cx="58" cy="47" r="6" fill="none" stroke="${ink}" stroke-width="1.8"/>` +
        line('M48 46.4Q50 45.2 52 46.4', ink, 1.8) +
        line('M36 46.2L31.5 45.2M64 46.2L68.5 45.2', ink, 1.8) +
        nose +
        smile
      );
    case 6: // língua de fora
      return (
        brows(1) +
        happyEyes +
        nose +
        fill('M46.5 58H53.5V62Q53.5 65.6 50 65.6Q46.5 65.6 46.5 62Z', tongue) +
        line('M43.5 56Q50 61 56.5 56', ink, 2.2) +
        blush()
      );
    case 7: {
      // blasé: pálpebras caídas
      const half = (x) =>
        fill(`M${x - 3.2} 46.4A3.2 3.2 0 0 0 ${x + 3.2} 46.4Z`, ink) + line(`M${x - 3.6} 46.4H${x + 3.6}`, ink, 1.8);
      return (
        line('M38.5 41.4H45.5', browC) +
        line('M54.5 40.6Q58 39.8 61.5 40.4', browC) +
        half(42) +
        half(58) +
        nose +
        line('M45.5 58.4H54.5', ink, 2.2)
      );
    }
    case 8: // apaixonado
      return (
        brows(2.4) +
        heart(42, 47) +
        heart(58, 47) +
        nose +
        openMouth('M43.5 55.5H56.5Q56.5 62.8 50 62.8Q43.5 62.8 43.5 55.5Z') +
        blush(0.4)
      );
    case 9: {
      // óculos escuros
      const lens = '#1f1b24';
      return (
        brows(2.6) +
        nose +
        `<rect x="34.5" y="42.6" width="13.5" height="9.4" rx="4.4" fill="${lens}"/><rect x="52" y="42.6" width="13.5" height="9.4" rx="4.4" fill="${lens}"/>` +
        line('M47.5 45.4H52.5', lens, 1.8) +
        line('M35 45.2L31.5 44.8M65 45.2L68.5 44.8', lens, 1.8) +
        line('M38.4 49L41.6 45.6M55.9 49L59.1 45.6', '#fff', 1.4, 'opacity=".4"') +
        line('M45 57.5Q51 60.2 56 55.6', ink, 2.2)
      );
    }
    case 10: {
      // bigodão
      const M =
        'M50 54.4C46 51.6 39.5 52.6 37 57.4C40 58.6 46 58.4 50 56.6C54 58.4 60 58.6 63 57.4C60.5 52.6 54 51.6 50 54.4Z';
      return (
        brows(0.4, 2.8) +
        eyes() +
        line('M48.6 51Q50 52.4 51.4 51', darken(skin, 0.24), 1.6) +
        line('M47 60.6Q50 62 53 60.6', ink, 1.8) +
        soft(M, against(hairColor, skin), 1)
      );
    }
    case 11: {
      // sardas
      const freckles = [
        [35, 52],
        [38.4, 53.4],
        [36, 55.6],
        [65, 52],
        [61.6, 53.4],
        [64, 55.6],
      ];
      return brows(0.6) + eyes() + freckles.map(([x, y]) => dot(x, y, 0.9, darken(skin, 0.3))).join('') + nose + smile;
    }
    default: // sorriso
      return brows() + eyes() + nose + smile + blush(0.2);
  }
}

const escapeAttr = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// SVG completo como texto. `view` deixa recortar (ex.: só a cabeça nas miniaturas de cabelo e rosto).
/**
 * @param {any} avatar
 * @param {{ view?: string, title?: string }} [options]
 */
export function avatarSVG(avatar, { view = '0 0 100 100', title } = {}) {
  const a = sanitizeAvatar(avatar) ?? randomAvatar();
  const clip = clipper();
  const bg = BACKGROUNDS[a.bg].hex;
  const skin = SKINS[a.skin].hex;
  // Cabelo quase da cor da pele se confundiria com a testa: escurece um pouco para separar.
  const picked = HAIR_COLORS[a.hairColor].hex;
  const hairColor = Math.abs(lum(picked) - lum(skin)) < 30 ? darken(picked, 0.4) : picked;
  const hair = hairSvg(a.hair, hairColor, skin);
  const ear = darken(skin, 0.08);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeAttr(view)}" role="img" aria-label="${escapeAttr(title ?? 'Avatar')}">`,
    `<rect x="-20" y="-20" width="140" height="140" fill="${bg}"/>`,
    // disco mais claro atrás da figura: destaca roupa e cabelo mesmo quando têm a cor do fundo
    dot(50, 60, 43, lighten(bg, 0.24)),
    hair.back ?? '',
    fill(NECK, darken(skin, 0.12)),
    outfitSvg(a.outfit, OUTFIT_COLORS[a.outfitColor].hex, skin, clip),
    hair.ears === false ? '' : dot(31, 47.5, 4.2, ear) + dot(69, 47.5, 4.2, ear),
    fill(HEAD_D, skin),
    hair.cast
      ? clip(HEAD_D, hair.cast.map((d) => fill(d, darken(skin, 0.14), 'transform="translate(0 2.4)"')).join(''))
      : '',
    faceSvg(a.face, skin, hairColor, clip),
    hair.front ?? '',
    '</svg>',
  ].join('');
}
