/**
 * Comptes joueurs : identité vérifiée par Firebase Authentication, victoires et niveaux rangés dans Cloud Firestore.
 *
 * Configuration sur Render (sans elle, le jeu fonctionne normalement, sans comptes) :
 * - variable d'environnement FIREBASE_CONFIG : la configuration web copiée depuis la console Firebase ;
 * - fichier secret firebase-admin.json : la clé du compte de service (Paramètres du projet > Comptes de service).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estLangue, type Langue } from '../shared/langue';
import { estTapis, niveauDepuisXp, tapisActif, tapisDebloque, TAPIS_PAR_DEFAUT, type IdTapis, type ResultatJoueur } from '../shared/niveaux';
import type { EntreeHistorique, ProfilCompte } from '../shared/types';

export interface ConfigWeb {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
}

export interface Identite {
  uid: string;
  nom: string | null;
  email: string | null;
}

/** Ce qui est rangé pour chaque compte (collection « comptes », un document par joueur). */
export interface StatsCompte {
  nom: string;
  parties: number;
  victoires: number;
  nuitsGagnees: number;
  annoncesReussies: number;
  meilleurScore: number | null;
  xp: number;
  historique: EntreeHistorique[];
  creeLe: number;
  majLe: number;
  /** Code à partager pour être ajouté en ami (6 caractères). */
  codeAmi: string | null;
  /** Dernier personnage joué (affiché dans la liste d'amis). */
  avatar: number;
  /** Tapis de jeu choisi (récompense de niveau). */
  tapis: IdTapis;
  amis: string[];
  demandesRecues: string[];
  demandesEnvoyees: string[];
  /** Abonnements aux notifications (un par téléphone ou navigateur), pour recevoir les invitations jeu fermé. */
  push: AbonnementPush[];
  /** Parties quittées avant la fin. */
  abandons: number;
  /** Langue du jeu sur le dernier appareil utilisé (pour écrire les notifications dans sa langue). */
  langue: Langue;
}

/** Signalement d'un joueur par un autre (gardé 6 mois pour vérification). */
export interface Signalement {
  date: number;
  salon: string;
  publique: boolean;
  motif: string;
  signaleur: { nom: string; uid: string | null };
  signale: { nom: string; uid: string | null };
  messages: { texte: string; heure: number }[];
}
export const DUREE_SIGNALEMENTS_MS = 183 * 24 * 60 * 60 * 1000;

/** Abonnement Web Push fourni par le navigateur (adresse du service de notification et clés de chiffrement). */
export interface AbonnementPush {
  endpoint: string;
  p256dh: string;
  auth: string;
  depuis: number;
}
export const MAX_ABONNEMENTS_PUSH = 5;

export interface ContexteResultat {
  date: number;
  nbJoueurs: number;
  adversaires: string[];
}

export interface Authentification {
  verifier(jeton: string): Promise<Identite | null>;
  supprimerUtilisateur(uid: string): Promise<void>;
}

export interface Stockage {
  lire(uid: string): Promise<StatsCompte | null>;
  /** Lit puis réécrit le compte d'un seul bloc (transaction). */
  modifier(uid: string, changement: (avant: StatsCompte | null) => StatsCompte): Promise<StatsCompte>;
  supprimer(uid: string): Promise<void>;
  /** Plusieurs comptes d'un coup (liste d'amis). */
  lirePlusieurs(uids: string[]): Promise<Record<string, StatsCompte | null>>;
  /** Modifie plusieurs comptes ensemble (transaction) : deux joueurs qui deviennent amis. */
  modifierPlusieurs(
    uids: string[],
    changement: (avant: Record<string, StatsCompte | null>) => Record<string, StatsCompte>,
  ): Promise<Record<string, StatsCompte>>;
  /** Compte qui porte ce code ami. */
  chercherCode(code: string): Promise<string | null>;
  /** Réglage du serveur gardé avec les comptes (clés des notifications). */
  lireParametre?(cle: string): Promise<unknown>;
  ecrireParametre?(cle: string, valeur: Record<string, unknown>): Promise<void>;
  /** Signalements de joueurs : ajout, et suppression des plus anciens. */
  ajouterSignalement?(s: Signalement): Promise<void>;
  purgerSignalements?(avant: number): Promise<number>;
}

export type RelationAmi = 'ami' | 'demande_envoyee' | 'demande_recue' | 'aucune';
export type ResultatDemande = 'envoyee' | 'amis' | 'deja_amis' | 'deja_envoyee' | 'soi_meme' | 'limite';

export interface ServiceComptes {
  configWeb: ConfigWeb;
  /** Adresse de l'émulateur d'authentification (tests en local uniquement). */
  emulateurAuth: string | null;
  verifier(jeton: string): Promise<Identite | null>;
  lire(uid: string): Promise<StatsCompte | null>;
  enregistrer(uid: string, nom: string, resultat: ResultatJoueur, contexte: ContexteResultat, avatar?: number): Promise<StatsCompte>;
  supprimer(uid: string): Promise<void>;
  /** Crée le compte au premier passage et lui attribue un code ami. */
  /** nom : pseudo du compte (null s'il n'en a pas) ; repli : nom utilisé à défaut (début de l'e-mail). */
  preparer(uid: string, nom: string | null, repli?: string): Promise<StatsCompte>;
  lirePlusieurs(uids: string[]): Promise<Record<string, StatsCompte | null>>;
  chercherCode(code: string): Promise<string | null>;
  demanderAmi(de: string, vers: string): Promise<{ resultat: ResultatDemande; stats: Record<string, StatsCompte> }>;
  /** Accepte (ou refuse) une demande reçue. */
  repondreAmi(uid: string, autre: string, accepter: boolean): Promise<Record<string, StatsCompte>>;
  /** Retire un ami, annule ou refuse une demande : supprime tout lien entre les deux comptes. */
  retirerLien(uid: string, autre: string): Promise<Record<string, StatsCompte>>;
  /** Pose un tapis de jeu ; refusé (null) si le niveau du compte ne l'a pas encore débloqué. */
  choisirTapis(uid: string, tapis: IdTapis): Promise<StatsCompte | null>;
  /** Ajoute (ou rafraîchit) l'abonnement aux notifications d'un appareil ; les plus anciens partent au-delà de 5. */
  abonnerPush(uid: string, abonnement: Omit<AbonnementPush, 'depuis'>): Promise<StatsCompte | null>;
  /** Retire des abonnements (désactivés par le joueur, ou expirés). */
  retirerPush(uid: string, endpoints: string[]): Promise<void>;
  lireParametre(cle: string): Promise<unknown>;
  ecrireParametre(cle: string, valeur: Record<string, unknown>): Promise<void>;
  /** Langue du joueur (notifications). */
  definirLangue(uid: string, langue: Langue): Promise<void>;
  signaler(s: Signalement): Promise<void>;
  /** Supprime les signalements de plus de 6 mois ; renvoie le nombre supprimé. */
  purgerSignalements(maintenant?: number): Promise<number>;
}

export const MAX_AMIS = 100;
export const MAX_DEMANDES = 50;
const ALPHABET_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Code ami tiré du compte (toujours le même), plus long en cas de doublon. */
export function codeAmiPour(uid: string, longueur = 6): string {
  const h = createHash('sha256').update(`ldb:${uid}`).digest();
  return Array.from({ length: longueur }, (_, i) => ALPHABET_CODE[h[i] % ALPHABET_CODE.length]).join('');
}

export function relationEntre(moi: StatsCompte | null, autre: string): RelationAmi {
  if (!moi) return 'aucune';
  if (moi.amis.includes(autre)) return 'ami';
  if (moi.demandesEnvoyees.includes(autre)) return 'demande_envoyee';
  if (moi.demandesRecues.includes(autre)) return 'demande_recue';
  return 'aucune';
}

export function statsVides(nom: string, date: number): StatsCompte {
  return {
    nom,
    parties: 0,
    victoires: 0,
    nuitsGagnees: 0,
    annoncesReussies: 0,
    meilleurScore: null,
    xp: 0,
    historique: [],
    creeLe: date,
    majLe: date,
    codeAmi: null,
    avatar: 1,
    tapis: TAPIS_PAR_DEFAUT,
    amis: [],
    demandesRecues: [],
    demandesEnvoyees: [],
    push: [],
    abandons: 0,
    langue: 'fr',
  };
}

const sans = (liste: string[], uid: string) => liste.filter((x) => x !== uid);
const avec = (liste: string[], uid: string) => (liste.includes(uid) ? liste : [...liste, uid]);
const textes = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []);

export const TAILLE_HISTORIQUE = 20;

const nombre = (v: unknown, defaut = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : defaut);

/** Relit un document stocké en tolérant les champs manquants ou abîmés. */
export function normaliserStats(brut: unknown): StatsCompte | null {
  if (!brut || typeof brut !== 'object') return null;
  const d = brut as Record<string, unknown>;
  const historique = Array.isArray(d.historique)
    ? d.historique
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => ({
          date: nombre(e.date),
          rang: nombre(e.rang, 1),
          nbJoueurs: nombre(e.nbJoueurs),
          score: nombre(e.score),
          victoire: e.victoire === true,
          nuitsGagnees: nombre(e.nuitsGagnees),
          xp: nombre(e.xp),
          adversaires: Array.isArray(e.adversaires) ? e.adversaires.filter((a): a is string => typeof a === 'string') : [],
          ...(e.abandon === true ? { abandon: true } : {}),
        }))
    : [];
  return {
    nom: typeof d.nom === 'string' ? d.nom : '',
    parties: nombre(d.parties),
    victoires: nombre(d.victoires),
    nuitsGagnees: nombre(d.nuitsGagnees),
    annoncesReussies: nombre(d.annoncesReussies),
    meilleurScore: typeof d.meilleurScore === 'number' ? d.meilleurScore : null,
    xp: nombre(d.xp),
    historique,
    creeLe: nombre(d.creeLe),
    majLe: nombre(d.majLe),
    codeAmi: typeof d.codeAmi === 'string' ? d.codeAmi : null,
    avatar: nombre(d.avatar, 1),
    tapis: estTapis(d.tapis) ? d.tapis : TAPIS_PAR_DEFAUT,
    amis: textes(d.amis),
    demandesRecues: textes(d.demandesRecues),
    demandesEnvoyees: textes(d.demandesEnvoyees),
    push: Array.isArray(d.push)
      ? d.push
          .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
          .filter((a) => typeof a.endpoint === 'string' && typeof a.p256dh === 'string' && typeof a.auth === 'string')
          .map((a) => ({ endpoint: a.endpoint as string, p256dh: a.p256dh as string, auth: a.auth as string, depuis: nombre(a.depuis) }))
          .slice(-MAX_ABONNEMENTS_PUSH)
      : [],
    abandons: nombre(d.abandons),
    langue: estLangue(d.langue) ? d.langue : 'fr',
  };
}

/** Ajoute une partie terminée aux statistiques d'un compte. */
export function appliquerResultat(avant: StatsCompte | null, nom: string, r: ResultatJoueur, c: ContexteResultat, avatar?: number): StatsCompte {
  const base: StatsCompte = avant ?? statsVides(nom, c.date);
  const entree: EntreeHistorique = {
    date: c.date,
    rang: r.rang,
    nbJoueurs: c.nbJoueurs,
    score: r.score,
    victoire: r.victoire,
    nuitsGagnees: r.nuitsGagnees,
    xp: r.xp,
    adversaires: c.adversaires.slice(0, 5),
    ...(r.abandon ? { abandon: true } : {}),
  };
  // Partie abandonnée : comptée comme jouée, mais l'ordinateur a fini à sa place : ni victoire, ni XP, ni record.
  const ab = !!r.abandon;
  return {
    ...base,
    // Le nom du compte (pseudo choisi à l'inscription) reste stable ; à défaut, le pseudo de la partie.
    nom: base.nom || nom,
    parties: base.parties + 1,
    victoires: base.victoires + (r.victoire && !ab ? 1 : 0),
    nuitsGagnees: base.nuitsGagnees + (ab ? 0 : r.nuitsGagnees),
    annoncesReussies: base.annoncesReussies + (ab ? 0 : r.annoncesReussies),
    meilleurScore: ab ? base.meilleurScore : base.meilleurScore === null ? r.score : Math.max(base.meilleurScore, r.score),
    abandons: (base.abandons ?? 0) + (ab ? 1 : 0),
    xp: base.xp + (ab ? 0 : r.xp),
    historique: [entree, ...base.historique].slice(0, TAILLE_HISTORIQUE),
    majLe: c.date,
    avatar: avatar ?? base.avatar,
  };
}

/** Profil envoyé au joueur lui-même. */
export function profilDe(identite: Identite, stats: StatsCompte | null): ProfilCompte {
  const nom = identite.nom || stats?.nom || (identite.email ? identite.email.split('@')[0] : 'Joueur');
  return {
    nom,
    email: identite.email,
    parties: stats?.parties ?? 0,
    victoires: stats?.victoires ?? 0,
    nuitsGagnees: stats?.nuitsGagnees ?? 0,
    annoncesReussies: stats?.annoncesReussies ?? 0,
    meilleurScore: stats?.meilleurScore ?? null,
    xp: stats?.xp ?? 0,
    historique: stats?.historique ?? [],
    tapis: tapisActif(stats?.tapis, stats?.xp ?? 0),
  };
}

export function creerServiceComptes(parties: {
  configWeb: ConfigWeb;
  emulateurAuth?: string | null;
  authentification: Authentification;
  stockage: Stockage;
}): ServiceComptes {
  const { authentification, stockage } = parties;
  const parametresMemoire = new Map<string, unknown>();
  const signalementsMemoire: Signalement[] = [];
  return {
    configWeb: parties.configWeb,
    emulateurAuth: parties.emulateurAuth ?? null,
    verifier: (jeton) => authentification.verifier(jeton),
    lire: (uid) => stockage.lire(uid),
    enregistrer: (uid, nom, resultat, contexte, avatar) => stockage.modifier(uid, (avant) => appliquerResultat(avant, nom, resultat, contexte, avatar)),
    supprimer: async (uid) => {
      // Retire d'abord le joueur des listes de ses amis et des demandes en cours.
      const stats = await stockage.lire(uid);
      const lies = stats ? [...new Set([...stats.amis, ...stats.demandesRecues, ...stats.demandesEnvoyees])] : [];
      for (const autre of lies) {
        await stockage
          .modifierPlusieurs([autre], (avant) => {
            const a = avant[autre];
            if (!a) return {};
            return { [autre]: { ...a, amis: sans(a.amis, uid), demandesRecues: sans(a.demandesRecues, uid), demandesEnvoyees: sans(a.demandesEnvoyees, uid) } };
          })
          .catch(() => undefined);
      }
      await stockage.supprimer(uid);
      await authentification.supprimerUtilisateur(uid);
    },
    preparer: async (uid, nom, repli = '') => {
      const actuel = await stockage.lire(uid);
      if (actuel?.codeAmi && (nom ? actuel.nom === nom : actuel.nom)) return actuel;
      let code = actuel?.codeAmi ?? null;
      if (!code) {
        for (let longueur = 6; longueur <= 10 && !code; longueur++) {
          const candidat = codeAmiPour(uid, longueur);
          const proprietaire = await stockage.chercherCode(candidat);
          if (!proprietaire || proprietaire === uid) code = candidat;
        }
      }
      return stockage.modifier(uid, (avant) => {
        const base = avant ?? statsVides('', Date.now());
        return { ...base, nom: nom || base.nom || repli || 'Joueur', codeAmi: base.codeAmi ?? code };
      });
    },
    lirePlusieurs: (uids) => stockage.lirePlusieurs(uids),
    chercherCode: (code) => stockage.chercherCode(code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')),
    demanderAmi: async (de, vers) => {
      if (de === vers) return { resultat: 'soi_meme', stats: {} };
      let resultat: ResultatDemande = 'envoyee';
      const stats = await stockage.modifierPlusieurs([de, vers], (avant) => {
        const a = avant[de] ?? statsVides('', Date.now());
        const b = avant[vers] ?? statsVides('', Date.now());
        if (a.amis.includes(vers)) {
          resultat = 'deja_amis';
          return { [de]: a, [vers]: b };
        }
        if (a.demandesRecues.includes(vers)) {
          // L'autre avait déjà demandé : on devient amis tout de suite.
          resultat = 'amis';
          return {
            [de]: { ...a, amis: avec(a.amis, vers), demandesRecues: sans(a.demandesRecues, vers), demandesEnvoyees: sans(a.demandesEnvoyees, vers) },
            [vers]: { ...b, amis: avec(b.amis, de), demandesEnvoyees: sans(b.demandesEnvoyees, de), demandesRecues: sans(b.demandesRecues, de) },
          };
        }
        if (a.demandesEnvoyees.includes(vers)) {
          resultat = 'deja_envoyee';
          return { [de]: a, [vers]: b };
        }
        if (a.amis.length >= MAX_AMIS || a.demandesEnvoyees.length >= MAX_DEMANDES || b.demandesRecues.length >= MAX_DEMANDES) {
          resultat = 'limite';
          return { [de]: a, [vers]: b };
        }
        return {
          [de]: { ...a, demandesEnvoyees: avec(a.demandesEnvoyees, vers) },
          [vers]: { ...b, demandesRecues: avec(b.demandesRecues, de) },
        };
      });
      return { resultat, stats };
    },
    repondreAmi: (uid, autre, accepter) =>
      stockage.modifierPlusieurs([uid, autre], (avant) => {
        const a = avant[uid] ?? statsVides('', Date.now());
        const b = avant[autre] ?? statsVides('', Date.now());
        if (!a.demandesRecues.includes(autre)) return { [uid]: a, [autre]: b };
        const amisA = accepter && a.amis.length < MAX_AMIS;
        return {
          [uid]: { ...a, demandesRecues: sans(a.demandesRecues, autre), amis: amisA ? avec(a.amis, autre) : a.amis },
          [autre]: { ...b, demandesEnvoyees: sans(b.demandesEnvoyees, uid), amis: amisA ? avec(b.amis, uid) : b.amis },
        };
      }),
    retirerLien: (uid, autre) =>
      stockage.modifierPlusieurs([uid, autre], (avant) => {
        const nettoyer = (s: StatsCompte | null, x: string) =>
          s ? { ...s, amis: sans(s.amis, x), demandesRecues: sans(s.demandesRecues, x), demandesEnvoyees: sans(s.demandesEnvoyees, x) } : null;
        const res: Record<string, StatsCompte> = {};
        const a = nettoyer(avant[uid], autre);
        const b = nettoyer(avant[autre], uid);
        if (a) res[uid] = a;
        if (b) res[autre] = b;
        return res;
      }),
    choisirTapis: async (uid, tapis) => {
      const actuel = await stockage.lire(uid);
      if (!actuel || !tapisDebloque(tapis, niveauDepuisXp(actuel.xp))) return null;
      return stockage.modifier(uid, (avant) => {
        const base = avant ?? actuel;
        return tapisDebloque(tapis, niveauDepuisXp(base.xp)) ? { ...base, tapis } : base;
      });
    },
    abonnerPush: async (uid, abonnement) => {
      if (!(await stockage.lire(uid))) return null;
      return stockage.modifier(uid, (avant) => {
        const base = avant ?? statsVides('', Date.now());
        const autres = (base.push ?? []).filter((a) => a.endpoint !== abonnement.endpoint);
        return { ...base, push: [...autres, { ...abonnement, depuis: Date.now() }].slice(-MAX_ABONNEMENTS_PUSH) };
      });
    },
    retirerPush: async (uid, endpoints) => {
      const actuel = await stockage.lire(uid);
      if (!actuel?.push.some((a) => endpoints.includes(a.endpoint))) return;
      await stockage.modifier(uid, (avant) => {
        const base = avant ?? actuel;
        return { ...base, push: base.push.filter((a) => !endpoints.includes(a.endpoint)) };
      });
    },
    definirLangue: async (uid, langue) => {
      const actuel = await stockage.lire(uid);
      if (!actuel || actuel.langue === langue) return;
      await stockage.modifier(uid, (avant) => ({ ...(avant ?? actuel), langue }));
    },
    signaler: async (s) => {
      if (stockage.ajouterSignalement) await stockage.ajouterSignalement(s);
      else signalementsMemoire.push(s);
    },
    purgerSignalements: async (maintenant = Date.now()) => {
      const avant = maintenant - DUREE_SIGNALEMENTS_MS;
      if (stockage.purgerSignalements) return stockage.purgerSignalements(avant);
      const n = signalementsMemoire.length;
      signalementsMemoire.splice(0, n, ...signalementsMemoire.filter((s) => s.date >= avant));
      return n - signalementsMemoire.length;
    },
    lireParametre: async (cle) => (stockage.lireParametre ? stockage.lireParametre(cle) : (parametresMemoire.get(cle) ?? null)),
    ecrireParametre: async (cle, valeur) => {
      if (stockage.ecrireParametre) await stockage.ecrireParametre(cle, valeur);
      else parametresMemoire.set(cle, valeur);
    },
  };
}

export function stockageMemoire(): Stockage & { donnees: Map<string, StatsCompte>; signalements: Signalement[] } {
  const donnees = new Map<string, StatsCompte>();
  const signalements: Signalement[] = [];
  return {
    donnees,
    signalements,
    ajouterSignalement: async (s) => {
      signalements.push(structuredClone(s));
    },
    purgerSignalements: async (avant) => {
      const n = signalements.length;
      signalements.splice(0, n, ...signalements.filter((s) => s.date >= avant));
      return n - signalements.length;
    },
    lire: async (uid) => structuredClone(donnees.get(uid) ?? null),
    modifier: async (uid, changement) => {
      const apres = changement(structuredClone(donnees.get(uid) ?? null));
      donnees.set(uid, structuredClone(apres));
      return apres;
    },
    supprimer: async (uid) => {
      donnees.delete(uid);
    },
    lirePlusieurs: async (uids) => Object.fromEntries(uids.map((u) => [u, structuredClone(donnees.get(u) ?? null)])),
    modifierPlusieurs: async (uids, changement) => {
      const apres = changement(Object.fromEntries(uids.map((u) => [u, structuredClone(donnees.get(u) ?? null)])));
      for (const [u, s] of Object.entries(apres)) donnees.set(u, structuredClone(s));
      return apres;
    },
    chercherCode: async (code) => [...donnees.entries()].find(([, s]) => s.codeAmi === code)?.[0] ?? null,
  };
}

/** Comptes de test : chaque jeton connu correspond à une identité. */
export function authentificationTest(jetons: Record<string, Identite>): Authentification & { supprimes: string[] } {
  const supprimes: string[] = [];
  return {
    supprimes,
    verifier: async (jeton) => jetons[jeton] ?? null,
    supprimerUtilisateur: async (uid) => {
      supprimes.push(uid);
    },
  };
}

/**
 * Lit la configuration web Firebase. Accepte le JSON ou le bloc JavaScript copié tel quel depuis la console
 * (« const firebaseConfig = { apiKey: "…", … }; »).
 */
export function lireConfigWeb(texte: string | undefined): ConfigWeb | null {
  if (!texte) return null;
  const v: Record<string, string> = {};
  for (const m of texte.matchAll(/["']?([A-Za-z]+)["']?\s*:\s*["']([^"']*)["']/g)) v[m[1]] = m[2].trim();
  if (!v.apiKey || !v.projectId) return null;
  const config: ConfigWeb = { apiKey: v.apiKey, authDomain: v.authDomain || `${v.projectId}.firebaseapp.com`, projectId: v.projectId };
  if (v.appId) config.appId = v.appId;
  return config;
}

export interface CompteDeService {
  project_id: string;
  client_email: string;
  private_key: string;
  [cle: string]: unknown;
}

function analyserCompteService(texte: string): CompteDeService | null {
  const essais = [texte.trim()];
  if (!texte.trim().startsWith('{')) {
    try {
      essais.push(Buffer.from(texte.trim(), 'base64').toString('utf8'));
    } catch {
      /* pas du base64 */
    }
  }
  for (const essai of essais) {
    try {
      const d = JSON.parse(essai) as Record<string, unknown>;
      if (typeof d.project_id === 'string' && typeof d.client_email === 'string' && typeof d.private_key === 'string') {
        return { ...d, private_key: d.private_key.replace(/\\n/g, '\n') } as CompteDeService;
      }
    } catch {
      /* essai suivant */
    }
  }
  return null;
}

/**
 * Cherche la clé du compte de service : variable FIREBASE_SERVICE_ACCOUNT, sinon un fichier secret Render
 * (/etc/secrets/*.json ou à la racine du service), quel que soit son nom.
 */
export function lireCompteService(env: NodeJS.ProcessEnv, dossiers = ['/etc/secrets', process.cwd()]): CompteDeService | null {
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = analyserCompteService(env.FIREBASE_SERVICE_ACCOUNT);
    if (sa) return sa;
  }
  for (const dossier of dossiers) {
    let fichiers: string[] = [];
    try {
      fichiers = readdirSync(dossier).filter((f) => f.endsWith('.json') && !f.startsWith('package'));
    } catch {
      continue;
    }
    fichiers.sort((a, b) => Number(b === 'firebase-admin.json') - Number(a === 'firebase-admin.json'));
    for (const f of fichiers) {
      try {
        const sa = analyserCompteService(readFileSync(join(dossier, f), 'utf8'));
        if (sa) return sa;
      } catch {
        /* fichier illisible */
      }
    }
  }
  return null;
}

/** Construit le service de comptes à partir des variables d'environnement, ou renvoie null (comptes désactivés). */
export async function comptesDepuisEnvironnement(env: NodeJS.ProcessEnv = process.env): Promise<ServiceComptes | null> {
  const configWeb = lireConfigWeb(env.FIREBASE_CONFIG);
  if (!configWeb) {
    console.log(env.FIREBASE_CONFIG ? 'Comptes joueurs désactivés : FIREBASE_CONFIG est illisible.' : 'Comptes joueurs désactivés (FIREBASE_CONFIG absente).');
    return null;
  }
  const emulateurAuth = env.FIREBASE_AUTH_EMULATOR_HOST || null;
  const compteService = lireCompteService(env);
  if (!compteService && !emulateurAuth) {
    console.log('Comptes joueurs désactivés : clé du compte de service introuvable (fichier secret firebase-admin.json).');
    return null;
  }
  if (compteService && compteService.project_id !== configWeb.projectId) {
    console.log(
      `Comptes joueurs désactivés : la clé appartient au projet « ${compteService.project_id} » mais FIREBASE_CONFIG au projet « ${configWeb.projectId} ».`,
    );
    return null;
  }
  try {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    const app = initializeApp(
      compteService ? { credential: cert(compteService as never), projectId: configWeb.projectId } : { projectId: configWeb.projectId },
      'le-dernier-baron',
    );
    const auth = getAuth(app);
    const authentification: Authentification = {
      verifier: async (jeton) => {
        try {
          const d = await auth.verifyIdToken(jeton);
          return { uid: d.uid, nom: typeof d.name === 'string' ? d.name : null, email: d.email ?? null };
        } catch {
          return null;
        }
      },
      supprimerUtilisateur: async (uid) => {
        await auth.deleteUser(uid).catch(() => undefined);
      },
    };
    let stockage: Stockage;
    if (env.COMPTES_STOCKAGE === 'memoire') stockage = stockageMemoire();
    else {
      const { getFirestore } = await import('firebase-admin/firestore');
      const db = getFirestore(app);
      db.settings({ ignoreUndefinedProperties: true });
      const doc = (uid: string) => db.collection('comptes').doc(uid);
      stockage = {
        lire: async (uid) => {
          const snap = await doc(uid).get();
          return snap.exists ? normaliserStats(snap.data()) : null;
        },
        modifier: (uid, changement) =>
          db.runTransaction(async (t) => {
            const snap = await t.get(doc(uid));
            const apres = changement(snap.exists ? normaliserStats(snap.data()) : null);
            t.set(doc(uid), apres);
            return apres;
          }),
        supprimer: async (uid) => {
          await doc(uid).delete();
        },
        lirePlusieurs: async (uids) => {
          if (!uids.length) return {};
          const snaps = await db.getAll(...uids.map(doc));
          return Object.fromEntries(snaps.map((s, i) => [uids[i], s.exists ? normaliserStats(s.data()) : null]));
        },
        modifierPlusieurs: (uids, changement) =>
          db.runTransaction(async (t) => {
            const uniques = [...new Set(uids)];
            const snaps = await t.getAll(...uniques.map(doc));
            const avant = Object.fromEntries(snaps.map((s, i) => [uniques[i], s.exists ? normaliserStats(s.data()) : null]));
            const apres = changement(avant);
            for (const [u, s] of Object.entries(apres)) t.set(doc(u), s);
            return apres;
          }),
        chercherCode: async (code) => {
          const r = await db.collection('comptes').where('codeAmi', '==', code).limit(1).get();
          return r.empty ? null : r.docs[0].id;
        },
        lireParametre: async (cle) => {
          const snap = await db.collection('parametres').doc(cle).get();
          return snap.exists ? snap.data() : null;
        },
        ecrireParametre: async (cle, valeur) => {
          await db.collection('parametres').doc(cle).set(valeur);
        },
        ajouterSignalement: async (s) => {
          await db.collection('signalements').add(s);
        },
        purgerSignalements: async (avant) => {
          const vieux = await db.collection('signalements').where('date', '<', avant).limit(400).get();
          if (vieux.empty) return 0;
          const lot = db.batch();
          vieux.docs.forEach((d) => lot.delete(d.ref));
          await lot.commit();
          return vieux.size;
        },
      };
    }
    console.log(`Comptes joueurs activés (projet Firebase « ${configWeb.projectId} »).`);
    return creerServiceComptes({ configWeb, emulateurAuth, authentification, stockage });
  } catch (e) {
    console.log('Comptes joueurs désactivés : Firebase n’a pas pu démarrer.', e);
    return null;
  }
}
