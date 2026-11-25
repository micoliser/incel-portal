const NOTIFICATION_ICON = "/logo2.png";

// libsodium (copied into /vendor by scripts/copy-sodium.mjs) and the chat
// preview decrypter. Service workers can only load scripts while starting, so
// these load here; if they fail, chat notifications still show, without text.
try {
  importScripts("/vendor/libsodium-sumo.js", "/vendor/libsodium-wrappers.js", "/chat-push.js");
} catch {
  // Previews are off for this worker.
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function showPush(payload) {
  let title = payload.title || "Notification";
  let body = payload.body || "";

  // Chat pushes carry the message encrypted; open it here if this browser has
  // chat unlocked and previews are on, otherwise keep the plain title and body.
  if (payload.chat && typeof self.chatPushPreview === "function") {
    const preview = await self.chatPushPreview(payload.chat, payload.title);
    if (preview) {
      title = preview.title;
      body = preview.body;
    }
  }

  const options = {
    body,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    data: {
      url: payload.url || "/dashboard",
    },
  };
  // Chat pushes carry a tag per conversation, so a new message replaces the
  // previous notice instead of stacking.
  if (payload.tag) {
    options.tag = payload.tag;
    options.renotify = true;
  }
  return self.registration.showNotification(title, options);
}

self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Notification",
      body: event.data.text(),
      url: "/dashboard",
    };
  }

  event.waitUntil(showPush(payload));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/dashboard";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }

        return undefined;
      }),
  );
});
