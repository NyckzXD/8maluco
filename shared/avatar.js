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

// Acessórios usam a mesma paleta das roupas.
export const ACCESSORY_COLORS = OUTFIT_COLORS;

export const OUTFITS = [
  'Camiseta',
  'Gola V',
  'Moletom',
  'Social',
  'Regata',
  'Jaqueta',
  'Listrada',
  'Gola alta',
  'Camisa 8',
  'Xadrez',
  'Macacão',
  'Crupiê',
  'Florida',
];
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
  'Rabo de cavalo',
  'Tranças',
  'Tigela',
  'Ondulado',
  'Raspado',
  'Dreads',
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
  'Gargalhada',
  'Estrelas',
  'Desconfiado',
  'Triste',
  'Barba',
  'Cavanhaque',
];
export const ACCESSORIES = [
  'Nenhum',
  'Boné',
  'Gorro',
  'Fone',
  'Brincos',
  'Cartola',
  'Coroa',
  'Laço',
  'Faixa',
  'Viseira',
  'Flor',
  'Bandana',
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
  accessory: ACCESSORIES.length,
  accessoryColor: ACCESSORY_COLORS.length,
};

// Partes que entraram depois: avatares salvos antes delas (no navegador e no banco) não as têm,
// então a falta vira este valor em vez de invalidar o avatar inteiro.
const LATER_PARTS = { accessory: 0, accessoryColor: 0 };

const pick = (n) => Math.floor(Math.random() * n);

export function randomAvatar() {
  const a = Object.fromEntries(Object.entries(AVATAR_PARTS).map(([k, n]) => [k, pick(n)]));
  // Sem acessório em boa parte dos sorteios, para a mesa não virar um desfile de chapéus.
  if (Math.random() < 0.4) a.accessory = 0;
  return a;
}

// Aceita só índices inteiros dentro das listas; o que vier errado vira null (sem avatar, mostra a inicial).
export function sanitizeAvatar(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const [k, n] of Object.entries(AVATAR_PARTS)) {
    const v = input[k] === undefined && k in LATER_PARTS ? LATER_PARTS[k] : input[k];
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
  return (d, content, rule = 'nonzero') => {
    const cid = `${id}-${n++}`;
    return `<clipPath id="${cid}"><path d="${d}" clip-rule="${rule}"/></clipPath><g clip-path="url(#${cid})">${content}</g>`;
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
    case 8: // camisa de time, com o 8 no peito e faixa nas mangas
      return (
        torso(c) +
        fill('M41 75Q50 79.5 59 75L50 86Z', neckTone) +
        line('M41.6 76.2L50 86L58.4 76.2', trim, 2.2) +
        line('M24 96.5L29 93M76 96.5L71 93', trim, 2.4) +
        `<circle cx="50" cy="89.6" r="2.7" fill="none" stroke="${trim}" stroke-width="2.1"/>` +
        `<circle cx="50" cy="96.2" r="3.4" fill="none" stroke="${trim}" stroke-width="2.1"/>`
      );
    case 9: {
      // camisa xadrez: faixas largas no tom escuro e finas no claro, com gola de ponta
      const dark = darken(c, 0.32);
      const bands = [16, 32, 50, 68, 84];
      const grid =
        bands
          .map((x) => `<rect x="${x - 2.6}" y="70" width="5.2" height="40" fill="${dark}" opacity=".45"/>`)
          .join('') +
        [84, 98]
          .map((y) => `<rect x="0" y="${y - 2.6}" width="100" height="5.2" fill="${dark}" opacity=".45"/>`)
          .join('') +
        bands.map((x) => `<rect x="${x + 6.6}" y="70" width="1.2" height="40" fill="${trim}" opacity=".45"/>`).join('');
      return (
        fill(BODY, c) +
        clip(BODY, grid) +
        line('M27.5 104V93M72.5 104V93', dark, 1.8) +
        fill('M41 75Q50 79.5 59 75L50 86Z', neckTone) +
        soft('M41 75L50 86L44 88L38.5 79Z', shade, 1) +
        soft('M59 75L50 86L56 88L61.5 79Z', shade, 1)
      );
    }
    case 10: {
      // macacão: alças e peitilho por cima de uma camiseta
      const tee = isLight(c) ? '#e5484d' : PAPER;
      return (
        torso(tee, darken(tee, 0.16)) +
        line('M41.8 76.4Q50 80.8 58.2 76.4', darken(tee, 0.16), 2.4) +
        soft('M37.5 104V89Q37.5 87 39.5 87H60.5Q62.5 87 62.5 89V104Z', c, 1.4) +
        line('M36 77.5L40 88M64 77.5L60 88', c, 3.6) +
        `<rect x="45" y="91.5" width="10" height="6.5" rx="1.6" fill="${shade}"/>` +
        dot(40.4, 89.6, 1.5, '#ffc83d') +
        dot(59.6, 89.6, 1.5, '#ffc83d')
      );
    }
    case 11: {
      // crupiê: camisa branca, colete e gravata-borboleta
      const shirt = PAPER;
      const vest = isLight(c) ? darken(c, 0.12) : c;
      const bow = isLight(c) ? '#2a2a30' : '#e5484d';
      return (
        torso(shirt, '#d6d2c8') +
        soft('M41 75L50 91V104H27.5V88Q29 79 41 75Z', vest, 1.2) +
        soft('M59 75L50 91V104H72.5V88Q71 79 59 75Z', tone(vest, 0.1), 1.2) +
        [95, 100.5].map((y) => dot(50.2, y, 1.1, '#ffc83d')).join('') +
        soft('M50 79.2L44.2 76.2V82.2Z', bow, 1) +
        soft('M50 79.2L55.8 76.2V82.2Z', bow, 1) +
        dot(50, 79.2, 1.7, darken(bow, 0.2))
      );
    }
    case 12: {
      // camisa florida, aberta no pescoço
      const petal = isLight(c) ? '#e84393' : PAPER;
      const flower = (x, y) =>
        [0, 72, 144, 216, 288]
          .map((a) => {
            const r = (a * Math.PI) / 180;
            return dot(+(x + Math.cos(r) * 2.3).toFixed(2), +(y + Math.sin(r) * 2.3).toFixed(2), 1.7, petal);
          })
          .join('') + dot(x, y, 1.2, '#ffc83d');
      return (
        fill(BODY, c) +
        clip(
          BODY,
          [
            [20, 90],
            [33, 99],
            [64, 86],
            [79, 96],
            [57, 100],
            [42, 92],
          ]
            .map(([x, y]) => flower(x, y))
            .join(''),
        ) +
        line('M27.5 104V93M72.5 104V93', shade, 1.8) +
        fill('M41 75Q50 79.5 59 75L50 89Z', neckTone) +
        soft('M41 75L50 89L43.5 90L37 80Z', shade, 1) +
        soft('M59 75L50 89L56.5 90L63 80Z', shade, 1)
      );
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
      return {
        cast: [F],
        ears: false,
        back: soft(B, back, 1),
        front: fill(F, c) + line('M44 28Q38.5 32 35.5 38', accent, 1.6),
      };
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
      return {
        cast: [F],
        ears: false,
        back: fill(B, back),
        front: soft(F, c, 1) + line('M36 31Q41 25.5 49 24.5', accent, 1.6),
      };
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
        front: fill(F, c) + line('M60 27Q55 24.5 50 24.5', accent, 1.6),
      };
    }
    case 11: {
      // rabo de cavalo balançando para o lado
      const F = cap('C68 38 62 33 50 32.5C38 33 32 38 30 46');
      const P = 'M63 25C76 22 84 35 81 49C79.5 57 75 62 70.5 64.5C73 56 73.5 48 70.5 41C68.5 35.5 66 31 61.5 29Z';
      return {
        cast: [F],
        back: soft(P, back, 1.2) + line('M76.5 34Q79.5 43 76 53', tone(back, 0.15), 1.4),
        front: fill(F, c) + dot(66.4, 27.6, 2.8, RED) + line('M58 27Q53 25 47 25.5', accent, 1.6),
      };
    }
    case 12: {
      // duas tranças caindo na frente dos ombros
      const F = cap('C68 41 62 34 50 31C38 34 32 41 30 46');
      const braid = (x) =>
        [52, 58.6, 65.2, 71.8, 78.4]
          .map((y, i) => `<ellipse cx="${x}" cy="${y}" rx="${4.2 - i * 0.25}" ry="3.9" fill="${i % 2 ? back : c}"/>`)
          .join('') +
        `<rect x="${x - 2.8}" y="81.6" width="5.6" height="2.6" rx="1.3" fill="${RED}"/>` +
        soft(`M${x - 1.6} 84.2H${x + 1.6}L${x + 2.4} 88.6H${x - 2.4}Z`, c, 1);
      return {
        cast: [F],
        ears: false,
        back: fill('M28.5 47C27 28 38 20.5 50 20.5C62 20.5 73 28 71.5 47Z', back),
        front: fill(F, c) + braid(27.4) + braid(72.6) + line('M50 30.5V23', back, 1.4),
      };
    }
    case 13: {
      // tigela: franja reta e laterais até a orelha
      const F = 'M29 48C27 30 38 21 50 21C62 21 73 30 71 48H67V37.6H33V48Z';
      return {
        cast: ['M29 48C27 30 38 21 50 21C62 21 73 30 71 48V37.6H29Z'],
        ears: false,
        front: soft(F, c, 1.2) + line('M36 31Q41 25.5 49 24.5', accent, 1.8),
      };
    }
    case 14: {
      // ondulado comprido, com franja de lado
      const B =
        'M27 46C25 27 38 19.5 50 19.5C62 19.5 75 27 73 46C76.5 52 71 56 74 62C77 68 72 72 74 78Q66 82 60 77L57 62H43L40 77Q34 82 26 78C28 72 23 68 26 62C29 56 23.5 52 27 46Z';
      const F = cap('C68 40 64 33 56 30C48 33 38 33 33 38C31.5 40.5 30.5 43 30 46');
      return {
        cast: [F],
        ears: false,
        back: soft(B, back, 1),
        front: fill(F, c) + line('M62 28.5Q56 25 48 25', accent, 1.6),
      };
    }
    case 15: {
      // raspado: só a sombra do cabelo bem curto
      const S = 'M31 44C30.5 30 39 23.6 50 23.6C61 23.6 69.5 30 69 44C66 37.5 60 35 50 35C40 35 34 37.5 31 44Z';
      return { front: fill(S, mix(skin, c, 0.6)) };
    }
    case 16: {
      // dreads: fios grossos atrás e dois caindo na frente
      const F = cap('C68 39 63 34.5 50 34C37 34.5 32 39 30 46');
      const strands = [24.5, 29.5, 70.5, 75.5]
        .map((x) => line(`M${x} 34Q${x + (x < 50 ? -1.6 : 1.6)} 52 ${x} 72`, back, 5))
        .join('');
      return {
        cast: [F],
        ears: false,
        back: fill('M27.5 46C26 28 38 20 50 20C62 20 74 28 72.5 46Z', back) + strands,
        front:
          fill(F, c) +
          line('M31.5 40Q29 50 30 60M68.5 40Q71 50 70 60', c, 4.4) +
          line('M27.9 47.4H32.1M27.8 52H32M68 47.4H72.1M68 52H72.2', back, 1) +
          dot(30, 56, 1.7, '#ffc83d') +
          dot(70, 56, 1.7, '#ffc83d') +
          line('M43 24.6Q40.6 28.6 40.2 34.2M50 23.8V34M57 24.6Q59.4 28.6 59.8 34.2', back, 1.2),
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
  // Olho redondo com um pontinho de brilho, que dá vida ao olhar.
  const eye = (x, r = 2.3, dx = 0) =>
    dot(x + dx, 47, r, ink) +
    dot(+(x + dx + r * 0.36).toFixed(2), +(47 - r * 0.36).toFixed(2), +(r * 0.34).toFixed(2), '#fff');
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
    case 12: // gargalhada: olhos espremidos e uma lágrima de rir
      return (
        brows(2) +
        line('M39 44.6L44.6 47.2L39 49.8', ink, 2.2) +
        line('M61 44.6L55.4 47.2L61 49.8', ink, 2.2) +
        nose +
        openMouth('M41.5 54.6H58.5Q58.5 65.4 50 65.4Q41.5 65.4 41.5 54.6Z') +
        fill('M36.2 49.6Q34.4 52.6 36.2 53.8Q38 52.6 36.2 49.6Z', '#59c3ff') +
        blush(0.4)
      );
    case 13: {
      // olhos de estrela
      const star = (cx, cy, r) => {
        const pts = Array.from({ length: 10 }, (_, i) => {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 ? r * 0.45 : r;
          return `${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`;
        });
        return soft(`M${pts.join('L')}Z`, '#ffb300', 0.9) + dot(cx, cy + 0.4, r * 0.22, '#fff3c4');
      };
      return (
        brows(2.6) +
        star(42, 47, 4.6) +
        star(58, 47, 4.6) +
        nose +
        openMouth('M43 55.5H57Q57 63.5 50 63.5Q43 63.5 43 55.5Z') +
        blush(0.3)
      );
    }
    case 14: // desconfiado: uma sobrancelha erguida e olhar de lado
      return (
        line('M38.5 42.6H45.5', browC, 2.2) +
        line('M54.5 39.6Q58 37 61.5 39', browC, 2.2) +
        eye(42, 2.4, 1.4) +
        eye(58, 2.4, 1.4) +
        // pálpebras baixas: a pele cobre o alto dos olhos e um traço marca a borda
        `<rect x="38" y="42.8" width="8.6" height="3.6" fill="${skin}"/><rect x="54" y="43.4" width="8.6" height="3" fill="${skin}"/>` +
        line('M38.8 46.4H46M54.8 46.4H62', ink, 1.7) +
        nose +
        line('M45 58.8Q50.5 59.4 55.5 57.2', ink, 2.2)
      );
    case 15: // triste: sobrancelhas caídas, beicinho e uma lágrima
      return (
        line('M38.5 42.4Q42 41.4 45.5 39.6', browC) +
        line('M61.5 42.4Q58 41.4 54.5 39.6', browC) +
        eyes(2.5) +
        nose +
        line('M45 60.4Q50 56.8 55 60.4', ink, 2.2) +
        fill('M60.6 50.4Q58.6 53.8 60.6 55Q62.6 53.8 60.6 50.4Z', '#59c3ff')
      );
    case 16: {
      // barba cheia, da cor do cabelo, com bigode e a boca aparecendo
      const beardC = against(hairColor, skin);
      const B =
        'M31 47C31 60.5 39 70 50 70C61 70 69 60.5 69 47C67 53 63.5 55.5 59 55.5C56 53.4 44 53.4 41 55.5C36.5 55.5 33 53 31 47Z';
      return (
        brows(0.6, 2.4) +
        eyes() +
        line('M48.6 51Q50 52.4 51.4 51', darken(skin, 0.24), 1.6) +
        soft(B, beardC, 1) +
        line('M42.6 64.6Q50 67.4 57.4 64.6', tone(beardC, 0.25), 1.2) +
        `<ellipse cx="50" cy="59.8" rx="4.8" ry="2.5" fill="${darken(skin, 0.1)}"/>` +
        line('M46.8 59.4Q50 61.6 53.2 59.4', ink, 1.8) +
        soft(
          'M50 56.6C47 54.4 42.6 54.8 41.2 57.8C44 58.6 47.6 58.2 50 57.4C52.4 58.2 56 58.6 58.8 57.8C57.4 54.8 53 54.4 50 56.6Z',
          beardC,
          1,
        )
      );
    }
    case 17: {
      // cavanhaque e bigodinho, com meio sorriso
      const beardC = against(hairColor, skin);
      return (
        brows(1) +
        eyes() +
        nose +
        soft('M44.6 56.2Q50 53.2 55.4 56.2Q50 55.4 44.6 56.2Z', beardC, 1.4) +
        line('M46 58.8Q51 60.6 55 57.8', ink, 2) +
        soft('M46.6 62Q50 61 53.4 62Q53.4 67 50 68.2Q46.6 67 46.6 62Z', beardC, 1)
      );
    }
    default: // sorriso
      return brows() + eyes() + nose + smile + blush(0.2);
  }
}

// ---------- acessórios ----------
// Ficam por cima de tudo. Chapéus têm `hat`: o cabelo que ficaria acima da aba some
// (recortado), menos o que escapa pelos lados. `cast` projeta sombra na testa, como no cabelo.

function accessorySvg(style, c, skin) {
  const shade = tone(c, 0.18);
  const deep = tone(c, 0.32);
  const trim = isLight(c) ? darken(c, 0.4) : PAPER;
  const GOLD = '#ffc83d';
  const GOLD_DEEP = '#e0a21c';

  switch (style) {
    case 1: // boné com aba para a frente e um naipe na copa
      return {
        hat: { y: 36, left: 29, right: 71 },
        cast: ['M30 37Q50 34 70 37V41Q50 38 30 41Z'],
        svg:
          fill('M29 36.5C29 24 38 16.5 50 16.5C62 16.5 71 24 71 36.5Z', c) +
          line('M50 17V35M40 20Q37.5 27 37.5 35.5M60 20Q62.5 27 62.5 35.5', shade, 1.2) +
          dot(50, 17.2, 1.9, shade) +
          fill(
            'M50 25.4C48.4 27.4 46.8 28.3 46.8 29.7C46.8 31 48.2 31.4 49.2 30.6L48.7 31.9H51.3L50.8 30.6C51.8 31.4 53.2 31 53.2 29.7C53.2 28.3 51.6 27.4 50 25.4Z',
            trim,
          ) +
          soft('M26.6 36.6Q50 31 73.4 36.6Q74.4 41.6 66.4 41.8Q50 38.2 33.6 41.8Q25.6 41.6 26.6 36.6Z', deep, 1.2) +
          line('M31 38.4Q50 34.4 69 38.4', shade, 1.1),
      };
    case 2: // gorro com barra canelada e pompom
      return {
        hat: { y: 38, left: 27.5, right: 72.5 },
        cast: ['M29 38H71V41.5H29Z'],
        svg:
          dot(50, 13.6, 5.6, trim) +
          fill('M28.6 38C28.6 23.5 38 15.5 50 15.5C62 15.5 71.4 23.5 71.4 38Z', c) +
          `<rect x="27.4" y="31" width="45.2" height="8.6" rx="3.4" fill="${shade}"/>` +
          [33, 39, 45, 50, 55, 61, 67].map((x) => line(`M${x} 33V37.6`, deep, 1.2)).join(''),
      };
    case 3: // fone de ouvido
      return {
        svg:
          line('M27.6 46C26.4 25 37 15.6 50 15.6C63 15.6 73.6 25 72.4 46', c, 3.6) +
          line('M30.6 30Q33.6 21.6 42 18.4', lighten(c, 0.3), 1.2, 'opacity=".7"') +
          [
            [22.4, 30.6],
            [69.4, 77.6],
          ]
            .map(
              ([x, pad]) =>
                `<rect x="${pad - 1.4}" y="40.6" width="4" height="13.8" rx="2" fill="${INK}"/>` +
                `<rect x="${x}" y="39" width="8.2" height="17" rx="4.1" fill="${c}"/>` +
                `<rect x="${x + 2}" y="43" width="4.2" height="9" rx="2.1" fill="${shade}"/>`,
            )
            .join(''),
      };
    case 4: {
      // brincos de argola com uma pedrinha
      const ring = against(c, skin);
      return {
        svg: [30.8, 69.2]
          .map(
            (x) =>
              `<circle cx="${x}" cy="55" r="2.8" fill="none" stroke="${ring}" stroke-width="1.5"/>` +
              dot(x, 57.8, 1.4, GOLD),
          )
          .join(''),
      };
    }
    case 5: // cartola com faixa
      return {
        hat: { y: 31, left: 24, right: 76 },
        cast: ['M31 31H69V35Q50 33 31 35Z'],
        svg:
          soft('M35.5 30V9.4Q35.5 6.8 38 6.8H62Q64.5 6.8 64.5 9.4V30Z', c, 1) +
          `<rect x="35.5" y="22.6" width="29" height="5" fill="${trim}"/>` +
          line('M39 10V21', lighten(c, 0.22), 1.6, 'opacity=".6"') +
          soft(
            'M23.6 31Q23.6 27.4 29.6 27.8H70.4Q76.4 27.4 76.4 31Q76.4 34 70.4 33.4Q50 31.4 29.6 33.4Q23.6 34 23.6 31Z',
            shade,
            1,
          ),
      };
    case 6: // coroa dourada com a pedra na cor escolhida
      return {
        svg:
          soft('M37 27.4L35.2 13.4L43 19.8L50 10.4L57 19.8L64.8 13.4L63 27.4Z', GOLD, 1.4) +
          `<rect x="36.4" y="23.8" width="27.2" height="4.4" rx="1.2" fill="${GOLD_DEEP}"/>` +
          [35.2, 50, 64.8].map((x, i) => dot(x, i === 1 ? 10.4 : 13.4, 1.6, GOLD)).join('') +
          dot(50, 21.4, 2.2, c) +
          dot(42.4, 25.9, 1.1, lighten(GOLD, 0.5)) +
          dot(57.6, 25.9, 1.1, lighten(GOLD, 0.5)),
      };
    case 7: // laço no alto da cabeça
      return {
        svg:
          '<g transform="rotate(-18 63 25)">' +
          soft('M63 25L54.2 19Q51.8 25 54.2 31Z', c, 1.6) +
          soft('M63 25L71.8 19Q74.2 25 71.8 31Z', c, 1.6) +
          line('M58 23.6L55.6 22.4M68 23.6L70.4 22.4', shade, 1.2) +
          `<rect x="60.6" y="22" width="4.8" height="6" rx="2" fill="${shade}"/>` +
          '</g>',
      };
    case 8: // faixa na testa, com as pontas do nó
      return {
        cast: ['M30 36.5H70V39.5H30Z'],
        svg:
          soft('M70.4 33.6L77.4 31.4L76.6 35.8Z', shade, 1.2) +
          soft('M70.4 34.8L76 39.6L72.4 41.2Z', shade, 1.2) +
          `<rect x="29" y="30.6" width="42" height="6.2" rx="3" fill="${c}"/>` +
          line('M30.6 33.7H69.4', trim, 1.1, 'opacity=".75"'),
      };
    case 9: // viseira de crupiê, translúcida
      return {
        svg:
          `<rect x="29.4" y="30.2" width="41.2" height="4" rx="2" fill="${shade}"/>` +
          fill('M29.6 33.4Q50 30.4 70.4 33.4Q71.2 41.4 50 43.6Q28.8 41.4 29.6 33.4Z', c, 'opacity=".72"') +
          line('M30.4 34.2Q50 31.4 69.6 34.2', lighten(c, 0.35), 1.2, 'opacity=".8"'),
      };
    case 10: {
      // flor atrás da orelha
      const petals = [0, 72, 144, 216, 288]
        .map((a) => {
          const r = (a * Math.PI) / 180;
          return dot(+(66 + Math.cos(r) * 3.6).toFixed(2), +(31 + Math.sin(r) * 3.6).toFixed(2), 3, c);
        })
        .join('');
      return {
        svg:
          soft('M64 36Q68.4 40.4 73.6 38.6Q70 34 64 36Z', '#43a047', 1) +
          petals +
          dot(66, 31, 2.4, isLight(c) ? '#e5484d' : GOLD),
      };
    }
    case 11: {
      // bandana amarrada, com bolinhas
      const D = 'M29 38C29 24.5 38 17 50 17C62 17 71 24.5 71 38Q50 33.4 29 38Z';
      return {
        hat: { y: 37, left: 29, right: 71 },
        cast: ['M30 37Q50 33.4 70 37V40Q50 36.4 30 40Z'],
        svg:
          soft('M69 33L78.6 37.6L72 41.4Z', shade, 1.2) +
          soft('M69.6 35.4L76 44.6L70.6 44Z', shade, 1.2) +
          fill(D, c) +
          [
            [40, 23],
            [50, 21.6],
            [60, 23],
            [35, 30.6],
            [45, 28.6],
            [55, 28.6],
            [65, 30.6],
          ]
            .map(([x, y]) => dot(x, y, 1.3, trim))
            .join('') +
          dot(70.2, 35.8, 2.6, deep),
      };
    }
    default: // nenhum
      return {};
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
  const acc = accessorySvg(a.accessory, ACCESSORY_COLORS[a.accessoryColor].hex, skin);
  // Com chapéu, o cabelo dentro de uma cúpula um pouco maior que ele some (o chapéu fica por cima);
  // o que passa dessa cúpula, como o volume do black power ou um rabo de cavalo, continua.
  const hat = acc.hat;
  const underHat = (svg) => {
    if (!hat || !svg) return svg ?? '';
    const rx = (hat.right - hat.left) / 2 + 8;
    const dome = `M${50 - rx} ${hat.y}A${rx} ${hat.y - 2} 0 0 1 ${50 + rx} ${hat.y}Z`;
    return clip(`M-10 -10H110V110H-10Z${dome}`, svg, 'evenodd');
  };
  const ear = darken(skin, 0.08);
  const earIn = darken(skin, 0.22);
  const neck = darken(skin, 0.12);
  const cast = [...(hair.cast ?? []), ...(acc.cast ?? [])];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeAttr(view)}" role="img" aria-label="${escapeAttr(title ?? 'Avatar')}">`,
    `<rect x="-20" y="-20" width="140" height="140" fill="${bg}"/>`,
    // disco mais claro atrás da figura: destaca roupa e cabelo mesmo quando têm a cor do fundo
    dot(50, 60, 43, lighten(bg, 0.24)),
    underHat(hair.back),
    // pescoço com a sombra do queixo
    fill(NECK, neck),
    clip(NECK, `<ellipse cx="50" cy="63.5" rx="10" ry="6" fill="${darken(skin, 0.24)}"/>`),
    outfitSvg(a.outfit, OUTFIT_COLORS[a.outfitColor].hex, skin, clip),
    hair.ears === false
      ? ''
      : dot(31, 47.5, 4.2, ear) +
        dot(69, 47.5, 4.2, ear) +
        line('M30.6 45.4Q28.8 47.6 30.8 49.8M69.4 45.4Q71.2 47.6 69.2 49.8', earIn, 1.3),
    fill(HEAD_D, skin),
    cast.length
      ? clip(HEAD_D, cast.map((d) => fill(d, darken(skin, 0.14), 'transform="translate(0 2.4)"')).join(''))
      : '',
    faceSvg(a.face, skin, hairColor, clip),
    underHat(hair.front),
    acc.svg ?? '',
    '</svg>',
  ].join('');
}
