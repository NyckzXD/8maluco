// Sons do jogo: arquivos gravados com reserva sintetizada.
import { muted } from './core.js';

// ---------- som ----------

let audio;
// O contexto de áudio só nasce depois de um gesto do usuário; se o navegador suspendeu, retoma.
function audioCtx() {
  if (!audio) {
    audio = new AudioContext();
    decodeSamples();
  }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}
// O primeiro toque na página já prepara o áudio, para os sons gravados estarem prontos na hora da partida.
for (const type of ['pointerdown', 'keydown'])
  addEventListener(
    type,
    () => {
      try {
        audioCtx();
      } catch {}
    },
    { once: true, capture: true },
  );

// Sons gravados de carta (public/sounds). Várias versões de cada um, sorteadas a cada vez;
// `gain` iguala o volume entre as versões. Os arquivos já baixam ao abrir a página e são
// decodificados quando o áudio nasce; até lá vale o som sintetizado de rustle().
const SAMPLES = {
  // só o estalo da carta no monte, sem a deslizada antes
  play: [
    { file: 'play-1', gain: 0.8 },
    { file: 'play-2', gain: 1.5 },
  ],
  // comprar é a mesma deslizada da distribuição, um pouco mais lenta e grave
  draw: [
    { file: 'draw-1', gain: 0.7 },
    { file: 'deal-1', gain: 0.8, rate: 0.9 },
    { file: 'deal-2', gain: 1.3, rate: 0.9 },
  ],
  deal: [
    { file: 'deal-1', gain: 0.8 },
    { file: 'deal-2', gain: 1.3 },
  ],
};
// Cada arquivo baixa e decodifica uma vez só, mesmo usado por mais de um som.
const sampleFiles = new Map();
for (const v of Object.values(SAMPLES).flat()) {
  if (!sampleFiles.has(v.file))
    sampleFiles.set(v.file, {
      bytes: fetch(`/sounds/${v.file}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null),
      buffer: null,
    });
  v.src = sampleFiles.get(v.file);
}
function decodeSamples() {
  for (const f of sampleFiles.values())
    f.bytes
      .then((bytes) => bytes && audio.decodeAudioData(bytes))
      .then(
        (buf) => (f.buffer = buf),
        () => {},
      );
}

// Toca uma versão sorteada do som; devolve false se nenhuma estiver pronta (aí entra o sintetizado).
function sample(kind, volume) {
  if (muted) return true;
  try {
    audioCtx();
    const ready = SAMPLES[kind].filter((v) => v.src.buffer);
    if (!ready.length) return false;
    const v = ready[Math.floor(Math.random() * ready.length)];
    const src = audio.createBufferSource();
    src.buffer = v.src.buffer;
    // Leve variação de velocidade (e altura) para sons repetidos não ficarem iguais.
    src.playbackRate.value = (v.rate ?? 1) * (0.94 + Math.random() * 0.12);
    const g = audio.createGain();
    g.gain.value = volume * v.gain;
    src.connect(g).connect(audio.destination);
    src.start();
    return true;
  } catch {
    return true;
  }
}

function beep(freqs, dur = 0.08, type = 'triangle', gain = 0.06) {
  if (muted) return;
  try {
    audioCtx();
    let t = audio.currentTime;
    for (const f of freqs) {
      const osc = audio.createOscillator();
      const g = audio.createGain();
      osc.type = type;
      osc.frequency.value = f;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur * 0.9;
    }
  } catch {}
}

// Sons de carta sintetizados com ruído filtrado: reserva enquanto os gravados não carregaram.
let noiseBuffer;
function noiseBuf() {
  if (!noiseBuffer) {
    noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// Um sopro de ruído: `freq` é o centro do filtro (e `to`, para onde ele desliza no caminho).
function rustle({ dur, freq, to = freq, q = 1, type = 'bandpass', gain, attack = 0.005 }) {
  if (muted) return;
  try {
    audioCtx();
    const t = audio.currentTime;
    const src = audio.createBufferSource();
    src.buffer = noiseBuf();
    const filter = audio.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(audio.destination);
    // Cada carta começa num ponto diferente do ruído, para nenhuma soar igual à outra.
    src.start(t, Math.random() * 0.8, dur + 0.02);
  } catch {}
}

// Pequena variação de altura para sons repetidos não ficarem robóticos.
const jitter = (f, amount = 0.12) => f * (1 + (Math.random() * 2 - 1) * amount);

export const sounds = {
  // carta batendo no monte: estalo do papel e uma batidinha grave na mesa
  card: () => {
    if (sample('play', 0.5)) return;
    rustle({
      dur: 0.09,
      freq: jitter(2600),
      to: 900,
      q: 0.8,
      gain: 0.35,
      attack: 0.002,
    });
    rustle({
      dur: 0.07,
      freq: jitter(260),
      type: 'lowpass',
      q: 1.5,
      gain: 0.5,
      attack: 0.002,
    });
  },
  // carta saindo do baralho: deslizada de papel
  draw: () =>
    sample('draw', 0.22) ||
    rustle({
      dur: 0.16,
      freq: jitter(1800),
      to: jitter(4200),
      q: 1.2,
      gain: 0.22,
      attack: 0.02,
    }),
  // distribuição: deslizada curta e leve, muitas seguidas
  deal: () =>
    sample('deal', 0.18) ||
    rustle({
      dur: 0.08,
      freq: jitter(2400, 0.2),
      to: jitter(4800, 0.2),
      q: 1.4,
      gain: 0.13,
      attack: 0.008,
    }),
  select: () => beep([740], 0.04, 'triangle', 0.03),
  turn: () => beep([660, 880], 0.12),
  bad: () => beep([220, 160], 0.12, 'sawtooth', 0.03),
  tick: () => beep([990], 0.05, 'square', 0.025),
  win: () => beep([523, 659, 784, 1046], 0.14),
};
