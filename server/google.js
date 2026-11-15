// "Entrar com o Google": o navegador recebe do Google um ID token (um JWT assinado) e manda para
// cá. Conferimos a assinatura com as chaves públicas do Google, o emissor, o destinatário (o
// nosso GOOGLE_CLIENT_ID) e a validade. Da resposta só usamos o `sub`, o id fixo da pessoa no
// Google: nada de e-mail, nome ou foto.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Devolve uma função que recebe o ID token e resolve o `sub` (ou null se não valer).
 * @param {string} clientId
 * @param {{ keys?: Parameters<typeof jwtVerify>[1] }} [options] `keys` troca as chaves do Google (testes)
 * @returns {(credential: unknown) => Promise<string | null>}
 */
export function googleVerifier(clientId, { keys } = {}) {
  // o jose guarda as chaves em cache e só busca de novo quando o Google troca de chave
  const jwks = keys ?? createRemoteJWKSet(new URL(GOOGLE_CERTS));
  return async (credential) => {
    if (typeof credential !== 'string' || !credential || credential.length > 4096) return null;
    try {
      const { payload } = await jwtVerify(credential, jwks, {
        issuer: ISSUERS,
        audience: clientId,
        algorithms: ['RS256'],
        clockTolerance: 60,
      });
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  };
}
