// Service worker do 8 Maluco: deixa o app instalável e abre a casca do jogo mesmo sem internet
// (a partida em si precisa do servidor; sem conexão, o app mostra o aviso de rede).
//
// Estratégias:
// - página, CSS, JS e manifest: rede primeiro, cache como reserva. Com internet o código está
//   sempre atualizado (inclusive no desenvolvimento); sem internet, abre a última versão.
// - fontes, ícones, cartas e sons: cache primeiro. Quase nunca mudam; se mudarem, suba VERSION.
// - /socket.io/ (o tempo real) nunca passa pelo cache, só o arquivo do cliente.

const VERSION = "v2";
const CACHE = `8maluco-${VERSION}`;

const SHELL = [
  "/",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon.svg",
  "/bg-pattern.svg",
  "/shared/engine.js",
  "/shared/avatar.js",
  "/shared/reactions.js",
  "/shared/names.js",
  "/socket.io/socket.io.js",
];

const ASSETS = [
  "/fonts/russo-one-400.woff2",
  ...[400, 500, 600, 700, 800].map((w) => `/fonts/barlow-semi-condensed-${w}.woff2`),
  "/icons/icon-32.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  ...["J", "Q", "K"].flatMap((r) => ["S", "H", "D", "C"].map((s) => `/cards/${r}${s}.webp`)),
  ...["deal-1", "deal-2", "draw-1", "play-1", "play-2"].map((f) => `/sounds/${f}.mp3`),
];

// Arquivos que quase nunca mudam: servidos do cache quando já estão lá.
const LONG_LIVED = /^\/(fonts|icons|cards|sounds)\//;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...SHELL, ...ASSETS]))
      .then(() => self.skipWaiting()),
  );
});

// Versão nova assume na hora e apaga os caches das versões antigas.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("8maluco-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(fallbackUrl ?? request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(fallbackUrl ?? request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/socket.io/") && url.pathname !== "/socket.io/socket.io.js") return;
  if (url.pathname === "/health") return;

  // Qualquer página (/?sala=ABCDE inclusive) é a mesma casca: guarda e serve como "/".
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
    return;
  }
  if (LONG_LIVED.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
