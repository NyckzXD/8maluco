// Chat de voz da mesa: uma conexão WebRTC só de áudio com cada pessoa que está no voz da sala
// (malha). O servidor só apresenta as pessoas e repassa a negociação (server/voice.js); o
// áudio vai direto de um aparelho para o outro, ou pelo TURN quando a rede não deixa.
//
// Quem entra recebe do servidor a lista de quem já está e manda a oferta para cada um. Para as
// duas pontas nunca brigarem (as duas oferecendo ao mesmo tempo, numa troca de rede), vale o
// padrão "perfect negotiation": a ponta "educada" (o menor id) desiste da própria oferta e
// aceita a do outro; a outra ignora a oferta que colidiu.
//
// Este módulo não mexe na tela: quem desenha (botão, assentos) assina com onVoiceChange() e lê
// voiceStatus(). Ele cuida sozinho das quedas: a conexão caiu, o servidor tirou a pessoa do voz;
// quando a sala volta (o 'state' sem a pessoa no voz), entra de novo.
import { emit, flash, roomCode, socket, store } from './core.js';

const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
const SPEAK_LEVEL = 0.035; // volume (RMS de 0 a 1) a partir do qual alguém está falando
const SPEAK_HOLD_MS = 350; // continua "falando" um pouquinho depois de parar (sem piscar entre palavras)
const METER_MS = 100;

/**
 * @typedef {{
 *   pc: RTCPeerConnection, polite: boolean, makingOffer: boolean, ignoreOffer: boolean,
 *   audio: HTMLAudioElement, meter: Meter | null,
 * }} Peer
 * @typedef {{ analyser: AnalyserNode, source: MediaStreamAudioSourceNode, data: Uint8Array<ArrayBuffer>, lastLoud: number }} Meter
 */

// Quer estar no voz (tocou no botão). Continua true durante uma queda, para entrar de novo.
let wanted = false;
let joining = false;
let listenOnly = false;
let muted = store.get('om_voice_muted') === '1';
let room = null; // sala em que entrou no voz: trocar de sala tira do voz
let myId = null;
/** @type {MediaStream | null} */
let localStream = null;
/** @type {RTCIceServer[]} */
let iceServers = [];
/** @type {Map<string, Peer>} */
const peers = new Map();
/** @type {Set<string>} quem eu silenciei só para mim */
const silenced = new Set();
/** @type {Set<string>} quem está falando agora (o meu id também, com o microfone aberto) */
let speaking = new Set();
/** @type {Meter | null} */
let localMeter = null;
/** @type {AudioContext | null} */
let ctx = null;
let meterTimer = 0;
const listeners = new Set();

// Os elementos de áudio ficam num canto escondido da página (o iOS toca melhor com eles no DOM).
const audioBox = document.createElement('div');
audioBox.hidden = true;
audioBox.setAttribute('aria-hidden', 'true');
document.body.append(audioBox);

// ---------- o que a tela lê ----------

/** Estado do voz para a tela desenhar. */
export function voiceStatus() {
  return {
    active: wanted && !!room,
    joining,
    muted: muted || listenOnly,
    listenOnly,
    speaking: new Set(speaking),
    silenced: new Set(silenced),
    // por pessoa: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'
    peers: new Map([...peers].map(([id, p]) => [id, p.pc.connectionState])),
  };
}

/** Chama `fn` sempre que algo do voz mudar. Devolve a função que cancela. */
export function onVoiceChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  const status = voiceStatus();
  for (const fn of listeners) {
    try {
      fn(status);
    } catch (err) {
      console.error('[voz]', err);
    }
  }
}

// O navegador só deixa usar o microfone em https (ou localhost): pela rede de casa
// (http://192.168...) o mediaDevices nem existe.
export const voiceSupported = () => !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection === 'function';

// ---------- entrar e sair ----------

/**
 * Entra no voz da sala atual. Pede o microfone (só ouvindo, `listenOnly`, não pede). Precisa vir
 * de um toque da pessoa: é o que libera o áudio tocar sozinho no navegador.
 * @param {{ listenOnly?: boolean }} [options]
 */
export async function joinVoice(options = {}) {
  if (wanted || joining) return true;
  if (!voiceSupported()) {
    flash('O chat de voz precisa de uma conexão segura (https) e de um navegador atualizado.');
    return false;
  }
  if (!roomCode) return false;
  listenOnly = !!options.listenOnly;
  joining = true;
  room = roomCode;
  // ainda dentro do toque: depois de esperar a permissão do microfone, o navegador pode não
  // deixar mais o áudio começar
  audioContext();
  changed();
  try {
    if (!listenOnly) localStream = await navigator.mediaDevices.getUserMedia({ audio: MIC });
  } catch (err) {
    joining = false;
    room = null;
    changed();
    flash(micError(err));
    return false;
  }
  if (localStream) {
    localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    localMeter = meter(localStream);
  }
  wanted = true;
  joining = false;
  const ok = await sendJoin();
  if (!ok) leaveVoice({ tellServer: false });
  return ok;
}

function micError(err) {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Sem permissão para usar o microfone. Libere nas configurações do navegador ou do aparelho.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhum microfone encontrado.';
  if (name === 'NotReadableError') return 'O microfone está ocupado por outro aplicativo.';
  return 'Não deu para abrir o microfone.';
}

// Pede ao servidor para entrar (ou entrar de novo, depois de uma queda) e oferece para cada um
// que já está no voz.
async function sendJoin() {
  joining = true;
  changed();
  const res = await emit('voice:join', { muted: muted || listenOnly });
  joining = false;
  if (!res.ok || !wanted) {
    if (!res.ok) wanted = false;
    changed();
    return !!res.ok;
  }
  iceServers = Array.isArray(res.iceServers) ? res.iceServers : [];
  for (const p of peers.values()) p.pc.setConfiguration({ iceServers });
  for (const id of res.peers ?? []) if (!peers.has(id)) createPeer(id, { offer: true });
  changed();
  return true;
}

/** Sai do voz: fecha as conexões, solta o microfone e avisa o servidor. */
export function leaveVoice({ tellServer = true } = {}) {
  const was = wanted || joining || peers.size > 0;
  wanted = false;
  joining = false;
  closeAll();
  stopLocal();
  room = null;
  if (was && tellServer && socket.connected) socket.emit('voice:leave');
  if (was) changed();
}

function stopLocal() {
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  dropMeter(localMeter);
  localMeter = null;
  listenOnly = false;
  speaking.clear();
  if (!peers.size) stopMeters();
}

/** Liga ou desliga o próprio microfone (os outros veem o "mutado" no assento). */
export function setVoiceMuted(on) {
  muted = !!on;
  store.set('om_voice_muted', muted ? '1' : '0');
  localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  if (wanted && !listenOnly) emit('voice:mute', { muted });
  if (muted && myId) speaking.delete(myId);
  changed();
}

/** Silencia (ou volta a ouvir) uma pessoa só para mim. */
export function setSilenced(id, on) {
  if (on) silenced.add(id);
  else silenced.delete(id);
  const p = peers.get(id);
  if (p) p.audio.muted = on;
  changed();
}

// ---------- conexões ----------

/** @param {string} id @param {{ offer?: boolean }} [options] */
function createPeer(id, { offer = false } = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  const audio = new Audio();
  audio.autoplay = true;
  audio.setAttribute('playsinline', '');
  audio.muted = silenced.has(id);
  audioBox.append(audio);
  /** @type {Peer} */
  const p = { pc, polite: !!myId && myId < id, makingOffer: false, ignoreOffer: false, audio, meter: null };
  peers.set(id, p);

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) send(id, { candidate: candidate.toJSON() });
  };
  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true;
      await pc.setLocalDescription();
      send(id, { description: pc.localDescription });
    } catch (err) {
      console.warn('[voz] oferta', err);
    } finally {
      p.makingOffer = false;
    }
  };
  pc.ontrack = ({ track, streams }) => {
    const stream = streams[0] ?? new MediaStream([track]);
    audio.srcObject = stream;
    audio.play().catch(() => {});
    dropMeter(p.meter);
    p.meter = meter(stream);
  };
  pc.onconnectionstatechange = () => changed();
  // A rede trocou (Wi-Fi para 4G) ou o caminho caiu: renegocia o caminho sem fechar a conexão.
  // Só a ponta não educada começa, para as duas não oferecerem juntas.
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' && !p.polite) pc.restartIce();
  };

  // Quem chega oferece: o transceptor com o microfone dispara o onnegotiationneeded.
  if (offer) pc.addTransceiver(localTrack() ?? 'audio', { direction: localTrack() ? 'sendrecv' : 'recvonly' });
  changed();
  return p;
}

const localTrack = () => localStream?.getAudioTracks()[0] ?? null;

/** @param {string} to @param {{ description?: RTCSessionDescription | null, candidate?: RTCIceCandidateInit }} data */
function send(to, data) {
  if (!wanted || !socket.connected) return;
  const payload =
    'description' in data
      ? { description: { type: data.description?.type, sdp: data.description?.sdp } }
      : { candidate: data.candidate };
  socket.emit('voice:signal', { to, data: payload });
}

/** @param {{ from?: string, description?: RTCSessionDescriptionInit, candidate?: RTCIceCandidateInit | null }} msg */
async function onSignal({ from, description, candidate } = {}) {
  if (!wanted || typeof from !== 'string') return;
  // alguém que entrou depois oferecendo: a conexão com ele nasce aqui
  const p = peers.get(from) ?? (description?.type === 'offer' ? createPeer(from) : null);
  if (!p) return;
  const { pc } = p;
  try {
    if (description) {
      const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await pc.setRemoteDescription(description); // a educada desfaz a própria oferta sozinha aqui
      if (description.type === 'offer') {
        await answerWithMic(pc);
        await pc.setLocalDescription();
        send(from, { description: pc.localDescription });
      }
    } else if (candidate) {
      await pc.addIceCandidate(candidate);
    }
  } catch (err) {
    // candidato da oferta que foi ignorada: esperado
    if (!(candidate && p.ignoreOffer)) console.warn('[voz] negociação', err);
  }
}

// A oferta de quem chegou criou um transceptor só para receber: põe o microfone nele antes de
// responder, assim a resposta já leva o áudio daqui (sem uma segunda negociação).
async function answerWithMic(pc) {
  const track = localTrack();
  if (!track) return;
  const t = pc.getTransceivers().find((x) => x.receiver.track?.kind === 'audio' && !x.stopped);
  if (!t || t.sender.track) return;
  await t.sender.replaceTrack(track);
  t.direction = 'sendrecv';
}

function closePeer(id) {
  const p = peers.get(id);
  if (!p) return;
  peers.delete(id);
  p.pc.onicecandidate = p.pc.onnegotiationneeded = p.pc.ontrack = null;
  p.pc.onconnectionstatechange = p.pc.oniceconnectionstatechange = null;
  p.pc.close();
  p.audio.srcObject = null;
  p.audio.remove();
  dropMeter(p.meter);
  speaking.delete(id);
  changed();
}

function closeAll() {
  for (const id of [...peers.keys()]) closePeer(id);
}

// ---------- quem está falando ----------
// Um analisador por fluxo (o meu e o de cada um), lido a cada 100ms; nada disso vai pela rede.

function audioContext() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  } catch {
    ctx = null;
  }
  return ctx;
}

/** @param {MediaStream} stream @returns {Meter | null} */
function meter(stream) {
  const ac = audioContext();
  if (!ac || !stream.getAudioTracks().length) return null;
  try {
    const source = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser); // só mede: não liga na saída (quem toca é o <audio>)
    meterTimer ||= window.setInterval(measure, METER_MS);
    return { analyser, source, data: new Uint8Array(analyser.fftSize), lastLoud: 0 };
  } catch {
    return null;
  }
}

/** @param {Meter | null} m */
function dropMeter(m) {
  if (!m) return;
  m.source.disconnect();
  m.analyser.disconnect();
}

function stopMeters() {
  clearInterval(meterTimer);
  meterTimer = 0;
}

/** @param {Meter} m */
function loud(m, now) {
  m.analyser.getByteTimeDomainData(m.data);
  let sum = 0;
  for (const v of m.data) sum += ((v - 128) / 128) ** 2;
  if (Math.sqrt(sum / m.data.length) >= SPEAK_LEVEL) m.lastLoud = now;
  return now - m.lastLoud < SPEAK_HOLD_MS;
}

function measure() {
  if (!localMeter && !peers.size) return stopMeters();
  const now = performance.now();
  const next = new Set();
  if (localMeter && myId && loud(localMeter, now) && !muted) next.add(myId);
  for (const [id, p] of peers) if (p.meter && loud(p.meter, now) && !silenced.has(id)) next.add(id);
  if (next.size === speaking.size && [...next].every((id) => speaking.has(id))) return;
  speaking = next;
  changed();
}

// ---------- conexão com o servidor ----------

socket.on('voice:signal', onSignal);
socket.on('voice:peer-left', ({ id } = {}) => closePeer(id));

// Caiu: o servidor já tirou do voz e as conexões morreram junto com ele. Continua querendo
// estar no voz; o 'state' da volta para a sala chama sendJoin().
socket.on('disconnect', () => {
  closeAll();
  joining = false;
});

// Removido, ou outra aba assumiu o lugar: sai de vez (o servidor já tirou do voz).
socket.on('room:kicked', () => leaveVoice({ tellServer: false }));
socket.on('room:replaced', () => leaveVoice({ tellServer: false }));

socket.on('state', (s) => {
  myId = s?.me ?? null;
  if (!wanted) return;
  // trocou de sala: o voz era da outra
  if (room && s.code !== room) return leaveVoice({ tellServer: false });
  room = s.code;
  const inVoice = new Set(s.members.filter((m) => m.voice).map((m) => m.id));
  // alguém saiu do voz e o aviso se perdeu: fecha a conexão com ele
  for (const id of peers.keys()) if (!inVoice.has(id)) closePeer(id);
  // voltou para a sala (queda, servidor reiniciado) e o servidor não tem a pessoa no voz: entra de novo
  if (!joining && !inVoice.has(s.me)) sendJoin();
});
