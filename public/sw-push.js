/* Movie Hub Background Web Push Handler (imported by Service Worker) */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (_e) {
    try {
      payload = { notificationTitle: event.data ? event.data.text() : 'New Release on Movie Hub' };
    } catch (_e2) {
      payload = {};
    }
  }

  const id = String(payload.id || Date.now()).trim();
  const movieId = String(payload.movieId || '').trim();
  const titleText = String(payload.appTitle || 'Movie Hub').trim() || 'Movie Hub';
  const headline = String(
    payload.notificationTitle ||
      (payload.title ? `Watch Now : ${payload.title} available now` : 'New Movie / Series Uploaded!')
  ).trim();
  const subline = String(payload.notificationBody || payload.message || 'Tap to stream or download now').trim();
  const iconUrl = String(payload.posterUrl || '/pwa-192x192.png').trim() || '/pwa-192x192.png';
  const bannerUrl = String(payload.imageUrl || payload.backdropUrl || payload.posterUrl || '').trim();

  const options = {
    body: subline ? `${headline}\n${subline}` : headline,
    icon: iconUrl,
    badge: '/pwa-192x192.png',
    ...(bannerUrl ? { image: bannerUrl } : {}),
    tag: `mp-release-${id}`,
    renotify: false,
    data: {
      id,
      movieId,
      url: movieId ? `/?open=${encodeURIComponent(movieId)}` : '/',
    },
  };

  event.waitUntil(
    self.registration.showNotification(titleText, options).catch(() => {})
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const movieId = String(data.movieId || '').trim();
  const targetUrl = String(data.url || (movieId ? `/?open=${encodeURIComponent(movieId)}` : '/'));

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client && 'focus' in client) {
            client.focus().catch(() => {});
            if (movieId) {
              try {
                client.postMessage({ type: 'MOVIE_PORTAL_OPEN_MOVIE', movieId });
              } catch (_e) {}
            }
            return;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
      .catch(() => {})
  );
});
