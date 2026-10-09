// News Factory service worker: only Web Push notifications (no offline caching).
self.addEventListener("install", function() { self.skipWaiting(); });
self.addEventListener("activate", function(event) { event.waitUntil(self.clients.claim()); });
self.addEventListener("push", function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "News Factory", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "News Factory", {
    body: data.body || "", tag: data.tag || "news-factory", icon: "/icon-192.png", badge: "/icon-192.png",
    data: { url: data.url || "/admin" }
  }));
});
self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list) {
    for (var i = 0; i < list.length; i += 1) { if (list[i].url.indexOf("/admin") >= 0 && "focus" in list[i]) return list[i].focus(); }
    return self.clients.openWindow(target);
  }));
});
