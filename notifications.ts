/**
 * Notifications (Web Push) : prévenir un ami qu'on l'invite, même quand le jeu est fermé sur son téléphone.
 *
 * Les clés VAPID identifient le serveur auprès des services de notification (Apple, Google, Mozilla).
 * Elles viennent des variables d'environnement VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY si elles existent ;
 * sinon, elles sont créées une seule fois et gardées avec les comptes (Firestore, collection « parametres »),
 * pour que les abonnements restent valables après chaque redémarrage du serveur.
 */
import webpush from 'web-push';
import type { AbonnementPush, ServiceComptes } from './comptes';

export interface MessagePush {
  titre: string;
  texte: string;
  /** Page ouverte quand on touche la notification. */
  url: string;
  /** Notifications de même étiquette : la nouvelle remplace l'ancienne. */
  etiquette?: string;
  /** Invitation transmise au jeu s'il est déjà ouvert. */
  invitation?: { id: string; de: string; code: string; heure: number };
}

/** Envoi d'une notification à un appareil ; renvoie le code HTTP du service (201 : envoyée, 404/410 : abonnement expiré). */
export type EnvoiPush = (abonnement: AbonnementPush, contenu: string, options: { ttl: number }) => Promise<number>;

export interface ServiceNotifications {
  clePublique: string;
  /** Envoie à tous les appareils abonnés du compte ; vrai si au moins un l'a reçue. */
  envoyer(uid: string, message: MessagePush): Promise<boolean>;
}

const estCle = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{40,120}$/.test(v);

export async function creerNotifications(
  comptes: ServiceComptes | null,
  env: Record<string, string | undefined> = process.env,
  envoiTest?: EnvoiPush,
): Promise<ServiceNotifications | null> {
  if (!comptes) return null;
  try {
    let cles: { publicKey: string; privateKey: string } | null = null;
    if (estCle(env.VAPID_PUBLIC_KEY) && estCle(env.VAPID_PRIVATE_KEY)) cles = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
    if (!cles) {
      const gardees = (await comptes.lireParametre('vapid')) as Record<string, unknown> | null;
      if (gardees && estCle(gardees.publique) && estCle(gardees.privee)) cles = { publicKey: gardees.publique, privateKey: gardees.privee };
    }
    if (!cles) {
      cles = webpush.generateVAPIDKeys();
      await comptes.ecrireParametre('vapid', { publique: cles.publicKey, privee: cles.privateKey, creeLe: Date.now() });
    }
    const { publicKey, privateKey } = cles;
    // Contact demandé par les services de notification : l'adresse du jeu, sinon son site.
    const contact = env.CONTACT_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.CONTACT_EMAIL) ? `mailto:${env.CONTACT_EMAIL}` : null;
    const site = env.RENDER_EXTERNAL_URL?.startsWith('https://') ? env.RENDER_EXTERNAL_URL : 'https://le-dernier-baron.onrender.com';
    const sujet = contact ?? site;

    const envoi: EnvoiPush =
      envoiTest ??
      (async (a, contenu, { ttl }) => {
        try {
          const r = await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, contenu, {
            TTL: ttl,
            urgency: 'high',
            vapidDetails: { subject: sujet, publicKey, privateKey },
            timeout: 8000,
          });
          return r.statusCode;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          return typeof code === 'number' ? code : 0;
        }
      });

    console.log(`Notifications activées${env.VAPID_PUBLIC_KEY ? '' : ' (clés gardées avec les comptes)'}.`);
    return {
      clePublique: publicKey,
      envoyer: async (uid, message) => {
        const stats = await comptes.lire(uid);
        const abonnements = stats?.push ?? [];
        if (!abonnements.length) return false;
        const contenu = JSON.stringify(message);
        // Une invitation ne sert plus à rien après 10 minutes : le service la jette si le téléphone reste éteint.
        const codes = await Promise.all(abonnements.map((a) => envoi(a, contenu, { ttl: 600 })));
        const expires = abonnements.filter((_, i) => codes[i] === 404 || codes[i] === 410).map((a) => a.endpoint);
        if (expires.length) await comptes.retirerPush(uid, expires).catch(() => undefined);
        return codes.some((c) => c >= 200 && c < 300);
      },
    };
  } catch (e) {
    console.log('Notifications désactivées : les clés n’ont pas pu être préparées.', e);
    return null;
  }
}
