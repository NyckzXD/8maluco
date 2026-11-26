// Grava o domínio do servidor (VITE_SERVER_URL do .env.mobile) nos projetos nativos, para os
// convites https://servidor/?sala=CODIGO abrirem direto no app. Roda no `npm run build:mobile`,
// depois do build do Vite (que já conferiu a variável), então o domínio sempre acompanha o build.
//
// - Android: o intent-filter com autoVerify entre os marcadores do AndroidManifest.xml. O Android
//   só filtra pelo caminho, então qualquer link para a raiz do site abre o app (o resto do site,
//   não). Ele confere o /.well-known/assetlinks.json do servidor ao instalar.
// - iOS: o App.entitlements com o "Associated Domains". O iOS confere o
//   /.well-known/apple-app-site-association, que só libera os links com ?sala=.
// Os dois arquivos do servidor estão em server/app-links.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const url = loadEnv('mobile', root, 'VITE_').VITE_SERVER_URL ?? '';
let host;
try {
  host = new URL(url).hostname;
} catch {
  console.error(`[app-links] VITE_SERVER_URL inválido: "${url}" (veja o .env.mobile.example)`);
  process.exit(1);
}

// Android
const manifestFile = `${root}android/app/src/main/AndroidManifest.xml`;
const manifest = readFileSync(manifestFile, 'utf8');
const markers = /(<!-- app-links:[^\n]*-->\n)[\s\S]*?<!-- \/app-links -->/;
const endMarker = '            <!-- /app-links -->';
if (!markers.test(manifest)) {
  console.error('[app-links] marcadores <!-- app-links --> sumiram do AndroidManifest.xml');
  process.exit(1);
}
const filter = `            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${host}" android:path="/" />
            </intent-filter>`;
writeFileSync(
  manifestFile,
  manifest.replace(markers, (_, start) => `${start}${filter}\n${endMarker}`),
);

// iOS
writeFileSync(
  `${root}ios/App/App/App.entitlements`,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Gerado pelo scripts/app-links.mjs (npm run build:mobile) a partir do VITE_SERVER_URL. -->
<plist version="1.0">
<dict>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:${host}</string>
	</array>
</dict>
</plist>
`,
);

console.log(`[app-links] convites de https://${host}/?sala=... abrem o app (Android e iOS)`);
