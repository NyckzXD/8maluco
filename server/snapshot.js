// Salas em disco entre um processo e outro (deploy, reinício, queda): grava de tempos em tempos
// enquanto roda (só quando algo mudou), grava de novo no desligamento e lê na subida.
// O arquivo tem os tokens dos jogadores, então fica só no servidor (fora do git, veja o .gitignore).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// De quanto em quanto tempo o servidor grava as salas enquanto roda (um crash perde no máximo isso).
export const SNAPSHOT_INTERVAL_MS = 30_000;

// Escreve ao lado e troca de uma vez: uma queda no meio não deixa arquivo pela metade.
function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Grava as salas. Sem nenhuma sala com gente, apaga o arquivo velho. Devolve quantas gravou.
export function saveSnapshot(rooms, file) {
  const data = rooms.snapshot();
  if (!data.rooms.length) {
    rmSync(file, { force: true });
    return 0;
  }
  writeAtomic(file, JSON.stringify(data));
  return data.rooms.length;
}

// Gravação periódica: a cada `intervalMs` compara as salas com a última gravação e só escreve
// se algo mudou (o `savedAt` não conta). `save()` força uma passada agora; `stop()` para o timer.
// Um erro de disco fica no log e a próxima passada tenta de novo.
export function startSnapshots(rooms, file, { intervalMs = SNAPSHOT_INTERVAL_MS, log = console } = {}) {
  let last = null;
  const save = () => {
    const data = rooms.snapshot();
    const key = JSON.stringify(data.rooms);
    if (key === last) return false;
    try {
      if (data.rooms.length) writeAtomic(file, JSON.stringify(data));
      else rmSync(file, { force: true });
      last = key;
      return true;
    } catch (err) {
      log.error('[snapshot] gravação periódica falhou:', err);
      return false;
    }
  };
  const timer = setInterval(save, intervalMs);
  timer.unref(); // não segura o processo aberto
  return { save, stop: () => clearInterval(timer) };
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
