// Arquivos que provam ao Android e ao iOS que o app é dono deste endereço: com eles, um convite
// (https://servidor/?sala=CODIGO) abre direto no app quando ele está instalado, e no site quando
// não está. O Android confere o /.well-known/assetlinks.json (App Links) e o iOS, o
// /.well-known/apple-app-site-association (Universal Links), os dois ao instalar o app.
// Sem a configuração de cada um (README, "App Android e iOS"), o arquivo dele responde 404.
import express from 'express';
import { readFileSync } from 'node:fs';

// O id do app (o mesmo nas duas lojas) vem do capacitor.config.json, para não ficar em dois lugares.
export function defaultAppId(file = new URL('../capacitor.config.json', import.meta.url)) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).appId ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {{ appId?: string | null, androidCertFingerprints?: string[], appleTeamId?: string | null }} config
 */
export function appLinks({ appId, androidCertFingerprints = [], appleTeamId }) {
  const router = express.Router();

  // Android: o pacote e a impressão digital (SHA-256) do certificado que assina o app. Com o Play
  // App Signing, é a do certificado do Google (Play Console → Integridade do app), não a da sua
  // chave de upload; para testar o build de debug, inclua também a da chave de debug.
  router.get('/.well-known/assetlinks.json', (_req, res) => {
    if (!appId || !androidCertFingerprints.length) return res.sendStatus(404);
    res.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: appId, sha256_cert_fingerprints: androidCertFingerprints },
      },
    ]);
  });

  // iOS: "TEAMID.appId", e só os links de convite (/?sala=...) abrem o app; o resto do site não.
  // O arquivo não tem extensão, mas tem que ir como JSON e sem redirecionamento.
  router.get('/.well-known/apple-app-site-association', (_req, res) => {
    if (!appId || !appleTeamId) return res.sendStatus(404);
    res.json({
      applinks: {
        details: [
          {
            appIDs: [`${appleTeamId}.${appId}`],
            components: [{ '/': '/', '?': { sala: '?*' }, comment: 'convite para uma sala' }],
          },
        ],
      },
    });
  });

  return router;
}
