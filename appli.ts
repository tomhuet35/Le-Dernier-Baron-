/// <reference types="vite/client" />
/**
 * Le jeu comme une application : service worker (lancement rapide, fichiers gardés sur l'appareil),
 * installation sur l'écran d'accueil et notifications d'invitation quand le jeu est fermé.
 */
import { useCallback, useEffect, useState } from 'react';
import { socket } from './socket';

// ---------- Configuration publique du serveur (lue une seule fois) ----------

export interface ConfigServeur {
  firebase: { apiKey: string; authDomain: string; projectId: string; appId?: string } | null;
  emulateurAuth?: string | null;
  /** Clé publique des notifications (null : notifications désactivées sur le serveur). */
  vapid?: string | null;
  contact?: string | null;
}
let config: Promise<ConfigServeur | null> | null = null;
export function configServeur(): Promise<ConfigServeur | null> {
  config ??= fetch('/api/config')
    .then((r) => (r.ok ? (r.json() as Promise<ConfigServeur>) : null))
    .catch(() => {
      config = null; // nouvel essai la prochaine fois
      return null;
    });
  return config;
}

type Reponse = { ok: boolean; erreur?: string };
function demander(evenement: string, data?: unknown): Promise<Reponse> {
  return new Promise((ok) => {
    if (!socket.connected) return ok({ ok: false, erreur: 'Connexion perdue, réessaie dans un instant.' });
    socket.timeout(8000).emit(evenement, data ?? {}, (err: unknown, r: Reponse) => ok(err ? { ok: false, erreur: 'Le serveur ne répond pas.' } : r));
  });
}

// ---------- Service worker ----------

const swDisponible = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

/** Le service worker garde les fichiers du jeu sur l'appareil : le jeu s'ouvre plus vite, même avec un réseau lent. */
export function enregistrerServiceWorker() {
  if (!swDisponible() || !import.meta.env.PROD) return;
  const enregistrer = () => void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  if (document.readyState === 'complete') enregistrer();
  else window.addEventListener('load', enregistrer, { once: true });
}

/** Messages du service worker : une invitation touchée alors que le jeu était déjà ouvert. */
export function ecouterServiceWorker(surInvitation: (inv: { id: string; de: string; code: string; heure: number }) => void) {
  if (!swDisponible()) return () => undefined;
  const surMessage = (e: MessageEvent) => {
    const d = e.data as { type?: string; invitation?: { id: string; de: string; code: string; heure: number } } | null;
    if (d?.type === 'invitation' && d.invitation) surInvitation(d.invitation);
  };
  navigator.serviceWorker.addEventListener('message', surMessage);
  return () => navigator.serviceWorker.removeEventListener('message', surMessage);
}

// ---------- Visibilité (pour savoir si l'invitation doit aussi partir en notification) ----------

export function suivreVisibilite() {
  if (typeof document === 'undefined') return;
  const envoyer = () => socket.emit('visibilite', { visible: document.visibilityState === 'visible' });
  document.addEventListener('visibilitychange', envoyer);
  window.addEventListener('pagehide', () => socket.emit('visibilite', { visible: false }));
  socket.on('connect', envoyer);
  if (socket.connected) envoyer();
}

// ---------- Installation sur l'écran d'accueil ----------

interface InviteInstallation extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type EtatInstallation = 'installe' | 'proposer' | 'ios' | 'mac' | 'autre';

let invite: InviteInstallation | null = null;
let installeIci = false;
const abonnesInstallation = new Set<() => void>();
const prevenirInstallation = () => abonnesInstallation.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // le jeu propose lui-même l'installation, au bon endroit
    invite = e as InviteInstallation;
    prevenirInstallation();
  });
  window.addEventListener('appinstalled', () => {
    invite = null;
    installeIci = true;
    prevenirInstallation();
  });
}

/** Jeu lancé depuis l'icône de l'écran d'accueil (et non dans un onglet du navigateur). */
export function estInstalle(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
export function estIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}
function estSafariMac(): boolean {
  const ua = navigator.userAgent;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints <= 1 && /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
}

function etatInstallation(): EtatInstallation {
  if (estInstalle()) return 'installe';
  if (invite) return 'proposer';
  if (installeIci) return 'installe';
  if (estIos()) return 'ios';
  if (estSafariMac()) return 'mac';
  return 'autre';
}

export function useInstallation(): { etat: EtatInstallation; installer: () => Promise<void> } {
  const [etat, setEtat] = useState(etatInstallation);
  useEffect(() => {
    const maj = () => setEtat(etatInstallation());
    abonnesInstallation.add(maj);
    maj();
    return () => {
      abonnesInstallation.delete(maj);
    };
  }, []);
  const installer = useCallback(async () => {
    const i = invite;
    if (!i) return;
    await i.prompt();
    const choix = await i.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    invite = null; // l'invitation du navigateur ne sert qu'une fois
    if (choix.outcome === 'accepted') installeIci = true;
    prevenirInstallation();
  }, []);
  return { etat, installer };
}

// ---------- Notifications d'invitation ----------

export type EtatNotifications =
  /** Le serveur n'a pas de notifications (comptes désactivés). */
  | 'serveur'
  /** Ce navigateur ne sait pas recevoir de notifications. */
  | 'indisponible'
  /** iPhone / iPad : il faut d'abord installer le jeu sur l'écran d'accueil. */
  | 'installer'
  | 'refusees'
  | 'actives'
  | 'inactives';

const pushDisponible = () => swDisponible() && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

async function abonnementActuel(): Promise<PushSubscription | null> {
  if (!pushDisponible()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
}

async function lireEtatNotifications(): Promise<EtatNotifications> {
  const c = await configServeur();
  if (!c?.vapid) return 'serveur';
  if (!pushDisponible()) return estIos() && !estInstalle() ? 'installer' : 'indisponible';
  if (Notification.permission === 'denied') return 'refusees';
  if (Notification.permission !== 'granted') return 'inactives';
  return (await abonnementActuel()) ? 'actives' : 'inactives';
}

function octetsCle(base64url: string): Uint8Array {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(b64);
  return Uint8Array.from(brut, (c) => c.charCodeAt(0));
}
const memeCle = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

/** À appeler directement depuis le toucher du bouton (le navigateur ne demande l'accord qu'après un geste). */
export async function activerNotifications(): Promise<{ etat: EtatNotifications; erreur?: string }> {
  if (!pushDisponible()) return { etat: await lireEtatNotifications() };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { etat: permission === 'denied' ? 'refusees' : 'inactives' };
  const c = await configServeur();
  if (!c?.vapid) return { etat: 'serveur' };
  try {
    const reg = await navigator.serviceWorker.ready;
    const cle = octetsCle(c.vapid);
    let abonnement = await reg.pushManager.getSubscription();
    // Clé du serveur changée : l'ancien abonnement ne marcherait plus.
    if (abonnement && !memeCle(abonnement.options.applicationServerKey, cle)) {
      await abonnement.unsubscribe().catch(() => undefined);
      abonnement = null;
    }
    abonnement ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle as BufferSource });
    const r = await demander('push_abonner', abonnement.toJSON());
    if (!r.ok) return { etat: 'inactives', erreur: r.erreur || 'Le serveur n’a pas enregistré l’abonnement.' };
    return { etat: 'actives' };
  } catch {
    return { etat: await lireEtatNotifications(), erreur: 'Les notifications n’ont pas pu être activées sur cet appareil.' };
  }
}

export async function desactiverNotifications(): Promise<EtatNotifications> {
  const abonnement = await abonnementActuel();
  if (abonnement) {
    await demander('push_desabonner', { endpoint: abonnement.endpoint });
    await abonnement.unsubscribe().catch(() => undefined);
  }
  return lireEtatNotifications();
}

/** Connexion au compte : l'abonnement de cet appareil (s'il existe) est rattaché au compte connecté. */
export async function rattacherNotifications() {
  if (!pushDisponible() || Notification.permission !== 'granted') return;
  const c = await configServeur();
  const abonnement = await abonnementActuel();
  if (c?.vapid && abonnement && memeCle(abonnement.options.applicationServerKey, octetsCle(c.vapid))) await demander('push_abonner', abonnement.toJSON());
}

export function useNotifications(): [EtatNotifications | null, (e: EtatNotifications) => void] {
  const [etat, setEtat] = useState<EtatNotifications | null>(null);
  useEffect(() => {
    let actif = true;
    const maj = () => void lireEtatNotifications().then((e) => actif && setEtat(e));
    maj();
    document.addEventListener('visibilitychange', maj);
    return () => {
      actif = false;
      document.removeEventListener('visibilitychange', maj);
    };
  }, []);
  return [etat, setEtat];
}
