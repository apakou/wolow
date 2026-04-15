// Wolow Service Worker — network-first for pages/API, cache-first for static assets
const CACHE_NAME = "wolow-v1";
const STATIC_ASSETS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip cross-origin requests (Supabase, analytics, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip API routes and Next.js internal routes — always network
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) {
    return;
  }

  // For navigation requests: network-first with offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // For static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// ── Push Notifications ──────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Wolow", body: event.data.text() || "New message" };
  }

  const { title = "Wolow", body = "New message", url, conversationId } = payload;

  const options = {
    body,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    data: { url: url || "/" },
    // Collapse notifications per conversation so the user isn't flooded
    tag: conversationId || "wolow-default",
    renotify: true,
  };

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Skip notification if the target page is already open and focused
        const isFocused =
          url != null &&
          clients.some(
            (c) =>
              c.visibilityState === "visible" &&
              new URL(c.url).pathname === url
          );
        if (isFocused) return;
        return self.registration.showNotification(title, options);
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab if one is already at the target URL
      for (const client of clientList) {
        if (new URL(client.url).pathname === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(targetUrl);
    })
  );
});
