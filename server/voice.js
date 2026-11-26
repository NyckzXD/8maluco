// Chat de voz da mesa: o áudio vai direto de um aparelho para o outro (WebRTC, uma conexão por
// par) e o servidor só faz a apresentação, repassando as mensagens de negociação (descrição da
// sessão e candidatos de rede) entre quem está no voz da mesma sala (Room.voiceSignal).
//
// Este módulo tem as partes que não dependem da sala: a lista de servidores STUN/TURN que o
// cliente usa para atravessar o roteador e a limpeza das mensagens de negociação.
import { createHmac, randomBytes } from 'node:crypto';

// Uma oferta só de áudio tem uns 2-6KB; o socket aceita até 16KB por mensagem.
export const SDP_MAX = 12_000;
const CANDIDATE_MAX = 1000;
const MID_MAX = 64;
const UFRAG_MAX = 256;

/**
 * Servidores para o RTCPeerConnection do cliente. O STUN descobre o endereço público; o TURN
 * retransmite o áudio quando a conexão direta não passa (operadora de celular, NAT simétrico).
 *
 * O TURN usa credenciais temporárias no padrão "TURN REST API" (o `use-auth-secret` do coturn):
 * usuário `<expira em segundos>:<aleatório>`, senha = base64(HMAC-SHA1(segredo, usuário)). O
 * segredo fica só no servidor; quem recebe a credencial só consegue usá-la até ela vencer.
 * @param {{ stunUrls?: string[], turnUrls?: string[], turnSecret?: string | null, turnTtlSeconds?: number }} config
 * @returns {RTCIceServerLike[]}
 */
export function iceServers(
  { stunUrls = [], turnUrls = [], turnSecret = null, turnTtlSeconds = 6 * 3600 },
  now = Date.now(),
) {
  /** @type {RTCIceServerLike[]} */
  const servers = [];
  if (stunUrls.length) servers.push({ urls: stunUrls });
  if (turnUrls.length && turnSecret) {
    const expires = Math.floor(now / 1000) + turnTtlSeconds;
    const username = `${expires}:${randomBytes(6).toString('hex')}`;
    const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
    servers.push({ urls: turnUrls, username, credential });
  }
  return servers;
}

/** @typedef {{ urls: string[], username?: string, credential?: string }} RTCIceServerLike */

const str = (v, max) => typeof v === 'string' && v.length <= max;

/**
 * Mensagem de negociação vinda do cliente, já no formato que vai para o outro lado, ou null se
 * não for válida. Só passa o que o WebRTC precisa (nada de campo extra viajando pela sala):
 * - `{ description: { type: 'offer' | 'answer', sdp } }`
 * - `{ candidate: { candidate, sdpMid, sdpMLineIndex, usernameFragment } }`
 * - `{ candidate: null }`: acabaram os candidatos daquele lado.
 */
export function cleanSignal(data) {
  if (!data || typeof data !== 'object') return null;
  if ('description' in data) {
    const d = data.description;
    if (!d || (d.type !== 'offer' && d.type !== 'answer') || !str(d.sdp, SDP_MAX) || !d.sdp) return null;
    return { description: { type: d.type, sdp: d.sdp } };
  }
  if ('candidate' in data) {
    const c = data.candidate;
    if (c === null) return { candidate: null };
    if (!c || typeof c !== 'object' || !str(c.candidate, CANDIDATE_MAX)) return null;
    const sdpMid = c.sdpMid ?? null;
    const sdpMLineIndex = c.sdpMLineIndex ?? null;
    const usernameFragment = c.usernameFragment ?? null;
    if (sdpMid !== null && !str(sdpMid, MID_MAX)) return null;
    if (sdpMLineIndex !== null && !(Number.isInteger(sdpMLineIndex) && sdpMLineIndex >= 0 && sdpMLineIndex < 16))
      return null;
    if (usernameFragment !== null && !str(usernameFragment, UFRAG_MAX)) return null;
    return { candidate: { candidate: c.candidate, sdpMid, sdpMLineIndex, usernameFragment } };
  }
  return null;
}
