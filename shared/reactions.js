// Reações rápidas: um balão em cima do avatar de quem reagiu, visto por toda a mesa.
// Fica em /shared porque o servidor valida o id (só passa o que está nesta lista) e o
// navegador desenha os botões e o balão a partir dela. O desenho de cada uma é o símbolo
// SVG `#r-<id>` do sprite em client/src/cards.js.

export const REACTIONS = [
  { id: 'boa', label: 'Boa!' },
  { id: 'haha', label: 'Haha' },
  { id: 'ops', label: 'Ops!' },
  { id: 'grr', label: 'Grr!' },
  { id: 'uau', label: 'Uau!' },
  { id: 'vai', label: 'Vai logo!' },
  { id: 'silas', label: 'Conheceu o Silas' },
];

// Por pessoa: no máximo `max` reações dentro de `windowMs` (dá para uma rajada curta, sem flood).
export const REACTION_LIMIT = { max: 3, windowMs: 5000 };

// Quanto tempo o balão fica em cima do avatar.
export const REACTION_MS = 2000;

const IDS = new Set(REACTIONS.map((r) => r.id));
export const isReaction = (id) => typeof id === 'string' && IDS.has(id);
export const reactionLabel = (id) => REACTIONS.find((r) => r.id === id)?.label ?? '';
