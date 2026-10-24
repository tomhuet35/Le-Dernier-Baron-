/*
 * Service worker du Dernier Baron.
 * - Garde les fichiers du jeu sur l'appareil : il s'ouvre plus vite, même avec un réseau lent.
 *   · la page : réseau d'abord (toujours la dernière version), copie gardée si le réseau traîne ;
 *   · le code (/assets/, nom unique à chaque version) : gardé une fois pour toutes ;
 *   · images et sons : copie gardée, rafraîchie en arrière-plan (une image remplacée apparaît à l'ouverture suivante).
 * - Affiche les notifications d'invitation, même quand le jeu est fermé.
 * La partie en ligne (/socket.io) et les réponses du serveur (/api) ne passent jamais par ici.
 */
const VERSION = 'v1';
const PAGES = `ldb-pages-${VERSION}`;
const CODE = `ldb-code-${VERSION}`;
const FICHIERS = `ldb-fichiers-${VERSION}`;
const GARDES = [PAGES, CODE, FICHIERS];
const MAX_CODE = 60;
const ATTENTE_RESEAU_MS = 3500;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(PAGES)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/icone-192.png']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((n) => n.startsWith('ldb-') && !GARDES.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

const ignorer = (url) => url.origin !== self.location.origin || /^\/(socket\.io|api|sante)(\/|$)/.test(url.pathname) || url.pathname === '/sw.js';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (ignorer(url)) return;
  // La musique est lue par morceaux (requêtes « Range ») : le navigateur s'en occupe seul.
  if (req.headers.has('range')) return;
  if (req.mode === 'navigate') return e.respondWith(page(req, e));
  if (url.pathname.startsWith('/assets/')) return e.respondWith(code(req));
  e.respondWith(fichier(req, e));
});

/** Page : réseau d'abord ; s'il tarde (serveur qui se réveille, réseau faible), la dernière copie gardée. */
async function page(req, e) {
  const cache = await caches.open(PAGES);
  const cle = new URL(req.url).pathname === '/confidentialite' || new URL(req.url).pathname === '/confidentialite.html' ? '/confidentialite' : '/';
  const reseau = fetch(req).then((r) => {
    if (r.ok && r.type === 'basic') e.waitUntil(cache.put(cle, r.clone()));
    return r;
  });
  const garde = await cache.match(cle);
  if (!garde) return reseau.catch(() => new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  const delai = new Promise((ok) => setTimeout(() => ok(garde), ATTENTE_RESEAU_MS));
  // Serveur en train de redémarrer (erreur 502, 503…) : la copie gardée plutôt qu'une page d'erreur.
  return Promise.race([reseau.then((r) => (r.ok ? r : garde)).catch(() => garde), delai]);
}

/** Code : le nom du fichier change à chaque version, la copie gardée est donc toujours la bonne. */
async function code(req) {
  const cache = await caches.open(CODE);
  const garde = await cache.match(req);
  if (garde) return garde;
  const r = await fetch(req);
  if (r.ok) {
    await cache.put(req, r.clone());
    // Les vieilles versions s'en vont peu à peu.
    const cles = await cache.keys();
    for (const k of cles.slice(0, Math.max(0, cles.length - MAX_CODE))) await cache.delete(k);
  }
  return r;
}

/** Images, sons, icônes : la copie tout de suite, et une copie fraîche pour la prochaine fois. */
async function fichier(req, e) {
  const cache = await caches.open(FICHIERS);
  const garde = await cache.match(req);
  const frais = fetch(req)
    .then((r) => {
      if (r.ok && r.type === 'basic') return cache.put(req, r.clone()).then(() => r);
      return r;
    })
    .catch(() => garde ?? Response.error());
  if (garde) {
    e.waitUntil(frais.catch(() => undefined));
    return garde;
  }
  return frais;
}

// ---------- Notifications d'invitation ----------

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { texte: e.data ? e.data.text() : '' };
  }
  const titre = d.titre || 'Le Dernier Baron';
  e.waitUntil(
    self.registration.showNotification(titre, {
      body: d.texte || 'Un ami t’invite à sa table.',
      icon: '/icone-192.png',
      badge: '/icone-192.png',
      tag: d.etiquette || 'invitation',
      renotify: true,
      lang: 'fr',
      vibrate: [90, 50, 90],
      data: { url: d.url || '/', invitation: d.invitation || null },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url = '/', invitation = null } = e.notification.data || {};
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (fenetres) => {
      const ouverte = fenetres.find((f) => new URL(f.url).origin === self.location.origin);
      if (ouverte) {
        // Jeu déjà ouvert : il affiche l'invitation, avec son bouton « Rejoindre ».
        await ouverte.focus().catch(() => undefined);
        if (invitation) ouverte.postMessage({ type: 'invitation', invitation: { ...invitation, heure: Date.now() } });
        else if ('navigate' in ouverte) await ouverte.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    }),
  );
});
