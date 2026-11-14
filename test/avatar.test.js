import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_PARTS, avatarSVG, randomAvatar, sanitizeAvatar } from '../shared/avatar.js';

test('avatar sorteado é sempre válido e desenha um SVG', () => {
  for (let i = 0; i < 200; i++) {
    const a = randomAvatar();
    assert.deepEqual(sanitizeAvatar(a), a);
    assert.match(avatarSVG(a), /^<svg[^>]*>.*<\/svg>$/s);
  }
});

test('todas as combinações de cada parte desenham sem erro', () => {
  const base = randomAvatar();
  for (const [key, n] of Object.entries(AVATAR_PARTS)) {
    for (let v = 0; v < n; v++) assert.doesNotMatch(avatarSVG({ ...base, [key]: v }), /undefined|NaN/);
  }
});

test('avatar inválido vindo do navegador vira null', () => {
  const ok = randomAvatar();
  assert.equal(sanitizeAvatar(null), null);
  assert.equal(sanitizeAvatar('x'), null);
  assert.equal(sanitizeAvatar({ ...ok, bg: 999 }), null);
  assert.equal(sanitizeAvatar({ ...ok, hair: -1 }), null);
  assert.equal(sanitizeAvatar({ ...ok, face: 1.5 }), null);
  assert.equal(sanitizeAvatar({ ...ok, skin: '1' }), null);
  const { outfit: _outfit, ...missing } = ok;
  assert.equal(sanitizeAvatar(missing), null);
  // campos extras são descartados
  assert.deepEqual(sanitizeAvatar({ ...ok, evil: '<script>' }), ok);
});
