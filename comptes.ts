/**
 * Comptes joueurs : identité vérifiée par Firebase Authentication, victoires et niveaux rangés dans Cloud Firestore.
 *
 * Configuration sur Render (sans elle, le jeu fonctionne normalement, sans comptes) :
 * - variable d'environnement FIREBASE_CONFIG : la configuration web copiée depuis la console Firebase ;
 * - fichier secret firebase-admin.json : la clé du compte de service (Paramètres du projet > Comptes de service).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResultatJoueur } from '../shared/niveaux';
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
}

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
}

export interface ServiceComptes {
  configWeb: ConfigWeb;
  /** Adresse de l'émulateur d'authentification (tests en local uniquement). */
  emulateurAuth: string | null;
  verifier(jeton: string): Promise<Identite | null>;
  lire(uid: string): Promise<StatsCompte | null>;
  enregistrer(uid: string, nom: string, resultat: ResultatJoueur, contexte: ContexteResultat): Promise<StatsCompte>;
  supprimer(uid: string): Promise<void>;
}

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
  };
}

/** Ajoute une partie terminée aux statistiques d'un compte. */
export function appliquerResultat(avant: StatsCompte | null, nom: string, r: ResultatJoueur, c: ContexteResultat): StatsCompte {
  const base: StatsCompte = avant ?? {
    nom,
    parties: 0,
    victoires: 0,
    nuitsGagnees: 0,
    annoncesReussies: 0,
    meilleurScore: null,
    xp: 0,
    historique: [],
    creeLe: c.date,
    majLe: c.date,
  };
  const entree: EntreeHistorique = {
    date: c.date,
    rang: r.rang,
    nbJoueurs: c.nbJoueurs,
    score: r.score,
    victoire: r.victoire,
    nuitsGagnees: r.nuitsGagnees,
    xp: r.xp,
    adversaires: c.adversaires.slice(0, 5),
  };
  return {
    ...base,
    nom: nom || base.nom,
    parties: base.parties + 1,
    victoires: base.victoires + (r.victoire ? 1 : 0),
    nuitsGagnees: base.nuitsGagnees + r.nuitsGagnees,
    annoncesReussies: base.annoncesReussies + r.annoncesReussies,
    meilleurScore: base.meilleurScore === null ? r.score : Math.max(base.meilleurScore, r.score),
    xp: base.xp + r.xp,
    historique: [entree, ...base.historique].slice(0, TAILLE_HISTORIQUE),
    majLe: c.date,
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
  };
}

export function creerServiceComptes(parties: {
  configWeb: ConfigWeb;
  emulateurAuth?: string | null;
  authentification: Authentification;
  stockage: Stockage;
}): ServiceComptes {
  const { authentification, stockage } = parties;
  return {
    configWeb: parties.configWeb,
    emulateurAuth: parties.emulateurAuth ?? null,
    verifier: (jeton) => authentification.verifier(jeton),
    lire: (uid) => stockage.lire(uid),
    enregistrer: (uid, nom, resultat, contexte) => stockage.modifier(uid, (avant) => appliquerResultat(avant, nom, resultat, contexte)),
    supprimer: async (uid) => {
      await stockage.supprimer(uid);
      await authentification.supprimerUtilisateur(uid);
    },
  };
}

export function stockageMemoire(): Stockage & { donnees: Map<string, StatsCompte> } {
  const donnees = new Map<string, StatsCompte>();
  return {
    donnees,
    lire: async (uid) => structuredClone(donnees.get(uid) ?? null),
    modifier: async (uid, changement) => {
      const apres = changement(structuredClone(donnees.get(uid) ?? null));
      donnees.set(uid, structuredClone(apres));
      return apres;
    },
    supprimer: async (uid) => {
      donnees.delete(uid);
    },
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
      };
    }
    console.log(`Comptes joueurs activés (projet Firebase « ${configWeb.projectId} »).`);
    return creerServiceComptes({ configWeb, emulateurAuth, authentification, stockage });
  } catch (e) {
    console.log('Comptes joueurs désactivés : Firebase n’a pas pu démarrer.', e);
    return null;
  }
}
