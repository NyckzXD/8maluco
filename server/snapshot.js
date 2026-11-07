// Salas em disco entre um processo e outro (deploy, reinício): grava no desligamento e lê na subida.
// O arquivo tem os tokens dos jogadores, então fica só no servidor (fora do git, veja o .gitignore).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Grava as salas. Sem nenhuma sala com gente, apaga o arquivo velho. Devolve quantas gravou.
export function saveSnapshot(rooms, file) {
  const data = rooms.snapshot();
  if (!data.rooms.length) {
    rmSync(file, { force: true });
    return 0;
  }
  mkdirSync(dirname(file), { recursive: true });
  // escreve ao lado e troca de uma vez: um desligamento no meio não deixa arquivo pela metade
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
  return data.rooms.length;
}

// Lê e apaga (cada gravação volta uma vez só: se o servidor cair depois sem gravar de novo,
// não ressuscita salas velhas). Devolve quantas salas voltaram.
export function loadSnapshot(rooms, file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return 0;
  }
  rmSync(file, { force: true });
  try {
    return rooms.restore(JSON.parse(raw));
  } catch (err) {
    console.error('[snapshot] arquivo inválido:', err);
    return 0;
  }
}
