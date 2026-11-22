// Arquivos dos links do app (App Links do Android e Universal Links do iOS).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer, configFromEnv } from '../server/index.js';
import { defaultAppId } from '../server/app-links.js';

const servers = [];
after(() => {
  for (const s of servers) {
    s.io.close();
    s.server.close();
  }
});

async function start(options) {
  const s = createGameServer({ client: null, snapshotFile: null, ...options });
  servers.push(s);
  await new Promise((resolve) => s.server.listen(0, resolve));
  return `http://localhost:${s.server.address().port}`;
}

test('o id do app vem do capacitor.config.json e as variáveis entram na configuração', () => {
  assert.equal(defaultAppId(), 'com.oitomaluco.app');
  const config = configFromEnv({ ANDROID_CERT_SHA256: ' aa:bb , cc:dd,', APPLE_TEAM_ID: ' ABCDE12345 ' });
  assert.equal(config.appId, 'com.oitomaluco.app');
  assert.deepEqual(config.androidCertFingerprints, ['AA:BB', 'CC:DD']);
  assert.equal(config.appleTeamId, 'ABCDE12345');
  assert.equal(configFromEnv({ APP_ID: 'br.com.outro' }).appId, 'br.com.outro');
});

test('sem configuração, os dois arquivos respondem 404', async () => {
  const url = await start({ appId: 'com.oitomaluco.app', androidCertFingerprints: [], appleTeamId: null });
  assert.equal((await fetch(`${url}/.well-known/assetlinks.json`)).status, 404);
  assert.equal((await fetch(`${url}/.well-known/apple-app-site-association`)).status, 404);
});

test('com configuração, o Android e o iOS recebem o JSON certo', async () => {
  const url = await start({
    appId: 'com.oitomaluco.app',
    androidCertFingerprints: ['AA:BB'],
    appleTeamId: 'ABCDE12345',
  });

  const android = await fetch(`${url}/.well-known/assetlinks.json`);
  assert.equal(android.status, 200);
  assert.match(android.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await android.json(), [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.oitomaluco.app', sha256_cert_fingerprints: ['AA:BB'] },
    },
  ]);

  const ios = await fetch(`${url}/.well-known/apple-app-site-association`, { redirect: 'manual' });
  assert.equal(ios.status, 200);
  assert.match(ios.headers.get('content-type'), /application\/json/);
  const { applinks } = await ios.json();
  assert.deepEqual(applinks.details[0].appIDs, ['ABCDE12345.com.oitomaluco.app']);
  assert.deepEqual(applinks.details[0].components[0]['?'], { sala: '?*' });
});
