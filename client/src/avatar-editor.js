// Avatar do jogador: salvo neste navegador, com editor na tela inicial.
import {
  ACCESSORIES,
  ACCESSORY_COLORS,
  BACKGROUNDS,
  FACES,
  HAIRS,
  HAIR_COLORS,
  OUTFITS,
  OUTFIT_COLORS,
  SKINS,
  randomAvatar,
  sanitizeAvatar,
} from '../../shared/avatar.js';
import { icon } from './cards.js';
import { $, $$, avatarArt, el, flash, store } from './core.js';
import { closeModal, openModal } from './modals.js';

// ---------- avatar ----------
// Fica salvo neste navegador e vai junto ao entrar numa sala. Na primeira visita, sorteia um.

function loadAvatar() {
  try {
    return sanitizeAvatar(JSON.parse(store.get('om_avatar')));
  } catch {
    return null;
  }
}

export let myAvatar = loadAvatar();
if (!myAvatar) {
  myAvatar = randomAvatar();
  store.set('om_avatar', JSON.stringify(myAvatar));
}

function updateHomeAvatar() {
  const home = $('#homeAvatar');
  $('.avatar-art', home)?.remove();
  home.prepend(avatarArt(myAvatar, { title: 'Seu avatar' }));
}
updateHomeAvatar();

// Abas do editor: cada uma mexe em um estilo (miniaturas) e/ou em uma cor (bolinhas).
// `view` recorta a miniatura para dar destaque à parte que está sendo escolhida.
const AVATAR_TABS = [
  { label: 'Fundo', icon: 'image', colors: { key: 'bg', list: BACKGROUNDS } },
  { label: 'Pele', icon: 'droplet', colors: { key: 'skin', list: SKINS } },
  {
    label: 'Roupa',
    icon: 'shirt',
    styles: { key: 'outfit', list: OUTFITS, view: '4 36 92 64' },
    colors: { key: 'outfitColor', list: OUTFIT_COLORS },
  },
  {
    label: 'Cabelo',
    icon: 'scissors',
    styles: { key: 'hair', list: HAIRS, view: '12 2 76 76' },
    colors: { key: 'hairColor', list: HAIR_COLORS },
  },
  {
    label: 'Rosto',
    icon: 'smile',
    styles: { key: 'face', list: FACES, view: '27 28 46 46' },
  },
  {
    label: 'Extras',
    icon: 'hat',
    styles: { key: 'accessory', list: ACCESSORIES, view: '12 2 76 76' },
    colors: { key: 'accessoryColor', list: ACCESSORY_COLORS },
  },
];

let avatarDraft = null;
let avatarTab = 0;

// As abas são criadas uma vez só; escolher uma opção atualiza o estado no lugar, sem recriar os
// botões, para o foco do teclado continuar onde está.
const avatarTabs = AVATAR_TABS.map((t, i) => {
  const b = el('button', 'avatar-tab');
  b.type = 'button';
  b.id = `avatarTab${i}`;
  b.setAttribute('role', 'tab');
  b.setAttribute('aria-controls', 'avatarOptions');
  b.append(icon(t.icon), el('span', null, t.label));
  b.addEventListener('click', () => selectAvatarTab(i));
  return b;
});
$('#avatarTabs').replaceChildren(...avatarTabs);

// Setas trocam de aba (tabindex móvel): Tab sai da lista e vai direto para as opções.
$('#avatarTabs').addEventListener('keydown', (e) => {
  const n = AVATAR_TABS.length;
  const next = {
    ArrowRight: avatarTab + 1,
    ArrowLeft: avatarTab - 1,
    Home: 0,
    End: n - 1,
  }[e.key];
  if (next == null) return;
  e.preventDefault();
  selectAvatarTab((next + n) % n);
  avatarTabs[avatarTab].focus();
});

function selectAvatarTab(i) {
  avatarTab = i;
  renderAvatarOptions();
  $('#avatarOptions').scrollTop = 0;
}

function syncAvatarTabs() {
  avatarTabs.forEach((b, i) => {
    b.setAttribute('aria-selected', String(i === avatarTab));
    b.tabIndex = i === avatarTab ? 0 : -1;
  });
  $('#avatarOptions').setAttribute('aria-labelledby', avatarTabs[avatarTab].id);
}

function renderAvatarPreview() {
  $('#avatarPreview').replaceChildren(avatarArt(avatarDraft, { title: 'Prévia do avatar' }));
}

// Atualiza seleção e miniaturas sem tirar os botões do lugar.
function syncAvatarOptions() {
  const box = $('#avatarOptions');
  for (const b of $$('[data-key]', box)) {
    b.setAttribute('aria-pressed', String(avatarDraft[b.dataset.key] === Number(b.dataset.value)));
  }
  const view = AVATAR_TABS[avatarTab].styles?.view;
  for (const b of $$('.style-opt', box)) {
    b.replaceChildren(
      avatarArt({ ...avatarDraft, [b.dataset.key]: Number(b.dataset.value) }, { view, title: b.title }),
    );
  }
}

function setAvatarPart(key, value) {
  avatarDraft = { ...avatarDraft, [key]: value };
  renderAvatarPreview();
  syncAvatarOptions();
}

function optionButton(className, key, value, name) {
  const b = el('button', className);
  b.type = 'button';
  b.title = name;
  b.dataset.key = key;
  b.dataset.value = String(value);
  b.setAttribute('aria-label', name);
  b.addEventListener('click', () => setAvatarPart(key, value));
  return b;
}

function renderAvatarOptions() {
  syncAvatarTabs();
  const tab = AVATAR_TABS[avatarTab];
  const box = $('#avatarOptions');
  box.replaceChildren();

  // A cor vem primeiro (é uma fileira curta), assim ela aparece sem precisar rolar.
  if (tab.colors) {
    const { key, list } = tab.colors;
    if (tab.styles) box.append(el('h3', 'opt-label', 'Cor'));
    const row = el('div', `swatches${tab.styles ? '' : ' big'}`);
    list.forEach(({ name, hex }, i) => {
      const b = optionButton('swatch', key, i, name);
      b.style.setProperty('--c', hex);
      row.append(b);
    });
    box.append(row);
  }

  if (tab.styles) {
    const { key, list } = tab.styles;
    if (tab.colors) box.append(el('h3', 'opt-label', 'Estilo'));
    const grid = el('div', 'style-grid');
    list.forEach((name, i) => grid.append(optionButton('style-opt', key, i, name)));
    box.append(grid);
  }
  syncAvatarOptions();
}

function openAvatarEditor() {
  avatarDraft = { ...myAvatar };
  renderAvatarPreview();
  renderAvatarOptions();
  openModal('avatarModal');
  $('#avatarOptions').scrollTop = 0;
}

$('#homeAvatar').addEventListener('click', openAvatarEditor);
$('#avatarRandom').addEventListener('click', () => {
  avatarDraft = randomAvatar();
  renderAvatarPreview();
  syncAvatarOptions();
});
$('#avatarSave').addEventListener('click', () => {
  myAvatar = sanitizeAvatar(avatarDraft) ?? myAvatar;
  store.set('om_avatar', JSON.stringify(myAvatar));
  updateHomeAvatar();
  closeModal('avatarModal');
  flash('Avatar salvo!', { info: true });
});
