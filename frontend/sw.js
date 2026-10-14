const CACHE = "mindkeep-shell-v77";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/peach.css?v=24",
  "/design.js?v=2",
  "/logo-peach.svg",
  "/fonts/Poppins-Regular.ttf",
  "/fonts/Poppins-SemiBold.ttf",
  "/fonts/Poppins-Bold.ttf",
  "/fonts/Poppins-Italic.ttf",
  "/fonts/Poppins-SemiBoldItalic.ttf",
  "/fonts/Poppins-BoldItalic.ttf",

  "/fonts/garamond-regular.ttf",
  "/fonts/garamond-italic.ttf",
  "/app.js",
  "/app.js?v=63",
  "/masonry.js",
  "/note-preview.js",
  "/ui-feedback.js",
  "/button-click.wav",
  "/api.js",
  "/offline.js",
  "/editor.js",
  "/editor.js?v=34",
  "/icons.js",
  "/logo-ribbon-blue.svg",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/share/")
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && ASSETS.includes(url.pathname + url.search)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then(
            (cached) =>
              cached ||
              (event.request.mode === "navigate"
                ? caches.match("/index.html")
                : Response.error()),
          ),
      ),
  );
});
