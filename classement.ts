/**
 * Classement de la semaine : le meilleur score de chaque joueur connecté à son compte, entre le lundi 0 h et le
 * dimanche minuit (heure de Paris). Seules comptent les parties enregistrées (au moins 2 joueurs humains, ni test
 * ni tutoriel), jouées jusqu'au bout. Les 3 premiers portent la couronne d'or, d'argent ou de bronze.
 *
 * Le serveur garde la semaine en cours en mémoire (un seul serveur) et l'écrit dans Firestore (collection
 * « classements », un document par semaine) pour la retrouver après un redémarrage.
 */
import { pseudoAcceptable } from '../shared/moderation';
import type { EntreeClassementVue, MeneurSemaine, Rang, VueClassement } from '../shared/types';

export interface EntreeClassement {
  nom: string;
  avatar: number;
  niveau: number;
  score: number;
  /** Moment où ce score a été fait : à score égal, le premier arrivé passe devant. */
  date: number;
}

export interface Semaine {
  /** « 2026-S45 » : année et numéro de semaine (norme ISO). */
  cle: string;
  debut: number;
  fin: number;
}

/** Où sont rangés les classements (Firestore en production, la mémoire pendant les tests). */
export interface StockageClassement {
  lireClassement(cle: string): Promise<Record<string, EntreeClassement> | null>;
  noterClassement(semaine: Semaine, uid: string, entree: EntreeClassement): Promise<void>;
  retirerDuClassement(cles: string[], uid: string): Promise<void>;
  /** Supprime les semaines commencées avant cette date ; renvoie leur nombre. */
  purgerClassements(avant: number): Promise<number>;
}

/** Les semaines plus anciennes que 8 semaines sont effacées. */
export const SEMAINES_GARDEES = 8;
/** Nombre de joueurs montrés dans le classement. */
export const TAILLE_CLASSEMENT = 50;

const FUSEAU = 'Europe/Paris';
const JOURS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const formatParis = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU,
  hourCycle: 'h23',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function partiesParis(t: number) {
  const p = Object.fromEntries(formatParis.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { an: +p.year, mois: +p.month, jour: +p.day, heure: +p.hour, minute: +p.minute, seconde: +p.second, jourSemaine: JOURS.indexOf(p.weekday) };
}

/** Avance de l'heure de Paris sur l'heure universelle à cet instant (1 h l'hiver, 2 h l'été), en millisecondes. */
function avanceParis(t: number): number {
  const p = partiesParis(t);
  return Date.UTC(p.an, p.mois - 1, p.jour, p.heure, p.minute, p.seconde) - Math.floor(t / 1000) * 1000;
}

/** Minuit, heure de Paris, de ce jour du calendrier. */
function minuitParis(an: number, mois: number, jour: number): number {
  const utc = Date.UTC(an, mois - 1, jour);
  const t = utc - avanceParis(utc);
  const corrige = utc - avanceParis(t); // changement d'heure entre les deux instants
  return corrige === t ? t : corrige;
}

/** La semaine (du lundi 0 h au lundi suivant 0 h, heure de Paris) qui contient cet instant. */
export function semaineDe(t: number): Semaine {
  const p = partiesParis(t);
  const lundi = new Date(Date.UTC(p.an, p.mois - 1, p.jour - p.jourSemaine));
  const suivant = new Date(Date.UTC(lundi.getUTCFullYear(), lundi.getUTCMonth(), lundi.getUTCDate() + 7));
  // Numéro ISO : le jeudi de la semaine donne l'année ; la semaine 1 est celle du premier jeudi de janvier.
  const jeudi = Date.UTC(lundi.getUTCFullYear(), lundi.getUTCMonth(), lundi.getUTCDate() + 3);
  const annee = new Date(jeudi).getUTCFullYear();
  const numero = 1 + Math.floor((jeudi - Date.UTC(annee, 0, 1)) / 86_400_000 / 7);
  return {
    cle: `${annee}-S${String(numero).padStart(2, '0')}`,
    debut: minuitParis(lundi.getUTCFullYear(), lundi.getUTCMonth() + 1, lundi.getUTCDate()),
    fin: minuitParis(suivant.getUTCFullYear(), suivant.getUTCMonth() + 1, suivant.getUTCDate()),
  };
}

const nombre = (v: unknown, defaut = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : defaut);

/** Relit une entrée stockée en tolérant les champs manquants. */
export function normaliserEntree(brut: unknown): EntreeClassement | null {
  if (!brut || typeof brut !== 'object') return null;
  const d = brut as Record<string, unknown>;
  if (typeof d.score !== 'number' || !Number.isFinite(d.score)) return null;
  return { nom: typeof d.nom === 'string' ? d.nom : '', avatar: nombre(d.avatar, 1), niveau: nombre(d.niveau, 1), score: d.score, date: nombre(d.date) };
}

/** Meilleur score d'abord ; à égalité, celui qui l'a fait le premier. */
const avant = (a: EntreeClassement, b: EntreeClassement) => b.score - a.score || a.date - b.date;
const meilleur = (a: EntreeClassement | undefined, b: EntreeClassement) => !a || avant(b, a) < 0;

interface Tableau {
  semaine: Semaine;
  scores: Map<string, EntreeClassement>;
}

export interface Classement {
  /** Relit la semaine en cours et la précédente (au démarrage du serveur). */
  charger(): Promise<void>;
  /** Passe à la semaine suivante si elle a commencé ; renvoie true si c'est le cas. */
  verifierSemaine(): boolean;
  /** Note le score d'une partie ; il ne compte que s'il bat le meilleur score de la semaine du joueur. */
  noter(uid: string, entree: Omit<EntreeClassement, 'date'>): Promise<{ ameliore: boolean; podiumChange: boolean }>;
  /** Couronne du joueur : 1 (or), 2 (argent), 3 (bronze), ou null. */
  couronneDe(uid: string | null | undefined): Rang | null;
  /** Place et meilleur score du joueur cette semaine. */
  rangDe(uid: string): { rang: number; score: number } | null;
  /** Place du joueur à la fin de la semaine dernière (pour sa récompense en XP). */
  rangPrecedent(uid: string): Promise<{ semaine: Semaine; rang: number } | null>;
  /** Premier de la semaine (ou, s'il n'y a encore aucun score, de la semaine dernière) : bannière de l'accueil. */
  meneur(): MeneurSemaine | null;
  vue(uid: string | null, taille?: number): Promise<VueClassement>;
  /** Suppression de compte : le joueur disparaît des classements. */
  retirer(uid: string): Promise<void>;
  purger(): Promise<number>;
  semaineCourante(): Semaine;
}

export function creerClassement(stockage: StockageClassement, horloge: () => number = Date.now): Classement {
  let courante: Tableau = { semaine: semaineDe(horloge()), scores: new Map() };
  let precedente: Tableau | null = null;
  let podium: string[] = [];

  const trie = (t: Tableau) => [...t.scores.entries()].sort(([, a], [, b]) => avant(a, b));
  const recalculerPodium = () => {
    const nouveau = trie(courante)
      .slice(0, 3)
      .map(([uid]) => uid);
    const change = nouveau.join('|') !== podium.join('|');
    podium = nouveau;
    return change;
  };
  const fusionner = (t: Tableau, lus: Record<string, EntreeClassement> | null) => {
    for (const [uid, brut] of Object.entries(lus ?? {})) {
      const e = normaliserEntree(brut);
      if (e && meilleur(t.scores.get(uid), e)) t.scores.set(uid, e);
    }
  };
  const lire = async (semaine: Semaine): Promise<Tableau> => {
    const t: Tableau = { semaine, scores: new Map() };
    fusionner(t, await stockage.lireClassement(semaine.cle));
    return t;
  };

  function verifierSemaine(): boolean {
    const s = semaineDe(horloge());
    if (s.cle === courante.semaine.cle) return false;
    const cleAvant = semaineDe(s.debut - 1).cle;
    precedente = courante.semaine.cle === cleAvant ? courante : null; // une semaine sans aucune partie : on la relira
    courante = { semaine: s, scores: new Map() };
    podium = [];
    return true;
  }

  const vueEntrees = (lignes: [string, EntreeClassement][], uid: string | null): EntreeClassementVue[] =>
    lignes.map(([u, e], i) => ({
      rang: i + 1,
      nom: pseudoAcceptable(e.nom) ? e.nom : null,
      avatar: e.avatar,
      niveau: e.niveau,
      score: e.score,
      ...(uid && u === uid ? { moi: true } : {}),
    }));

  async function precedenteChargee(): Promise<Tableau | null> {
    const s = semaineDe(courante.semaine.debut - 1);
    if (precedente?.semaine.cle === s.cle) return precedente;
    precedente = await lire(s);
    return precedente;
  }

  return {
    semaineCourante: () => {
      verifierSemaine();
      return courante.semaine;
    },
    async charger() {
      verifierSemaine();
      const t = courante;
      fusionner(t, await stockage.lireClassement(t.semaine.cle));
      recalculerPodium();
      await precedenteChargee();
    },
    verifierSemaine,
    async noter(uid, entree) {
      verifierSemaine();
      const e: EntreeClassement = { ...entree, date: horloge() };
      if (!meilleur(courante.scores.get(uid), e)) return { ameliore: false, podiumChange: false };
      courante.scores.set(uid, e);
      const podiumChange = recalculerPodium();
      await stockage.noterClassement(courante.semaine, uid, e);
      return { ameliore: true, podiumChange };
    },
    couronneDe(uid) {
      if (!uid) return null;
      verifierSemaine();
      const i = podium.indexOf(uid);
      return i < 0 ? null : ((i + 1) as Rang);
    },
    rangDe(uid) {
      verifierSemaine();
      const e = courante.scores.get(uid);
      if (!e) return null;
      return { rang: 1 + [...courante.scores.values()].filter((x) => avant(x, e) < 0).length, score: e.score };
    },
    async rangPrecedent(uid) {
      verifierSemaine();
      const prec = await precedenteChargee();
      const e = prec?.scores.get(uid);
      if (!prec || !e) return null;
      return { semaine: prec.semaine, rang: 1 + [...prec.scores.values()].filter((x) => avant(x, e) < 0).length };
    },
    meneur() {
      verifierSemaine();
      const [premier] = trie(courante);
      const source = premier ? { e: premier[1], semaine: 'courante' as const } : precedente?.semaine.cle === semaineDe(courante.semaine.debut - 1).cle ? { e: trie(precedente)[0]?.[1], semaine: 'precedente' as const } : null;
      if (!source?.e) return null;
      return { nom: pseudoAcceptable(source.e.nom) ? source.e.nom : null, avatar: source.e.avatar, niveau: source.e.niveau, score: source.e.score, semaine: source.semaine };
    },
    async vue(uid, taille = TAILLE_CLASSEMENT) {
      verifierSemaine();
      const lignes = trie(courante);
      const tous = vueEntrees(lignes, uid);
      const prec = await precedenteChargee().catch(() => null);
      return {
        semaine: { ...courante.semaine, entrees: tous.slice(0, taille), moi: tous.find((x) => x.moi) ?? null, total: lignes.length },
        precedente: prec && prec.scores.size ? { ...prec.semaine, entrees: vueEntrees(trie(prec), uid).slice(0, 10) } : null,
      };
    },
    async retirer(uid) {
      const cles = [courante.semaine.cle];
      courante.scores.delete(uid);
      if (precedente) {
        precedente.scores.delete(uid);
        cles.push(precedente.semaine.cle);
      }
      recalculerPodium();
      await stockage.retirerDuClassement(cles, uid);
    },
    purger: () => stockage.purgerClassements(semaineDe(horloge()).debut - SEMAINES_GARDEES * 7 * 86_400_000),
  };
}

/** Classements gardés en mémoire (tests, ou serveur sans Firestore). */
export function stockageClassementMemoire(): StockageClassement & { semaines: Map<string, { debut: number; fin: number; scores: Record<string, EntreeClassement> }> } {
  const semaines = new Map<string, { debut: number; fin: number; scores: Record<string, EntreeClassement> }>();
  return {
    semaines,
    lireClassement: async (cle) => structuredClone(semaines.get(cle)?.scores ?? null),
    noterClassement: async (semaine, uid, entree) => {
      const s = semaines.get(semaine.cle) ?? { debut: semaine.debut, fin: semaine.fin, scores: {} };
      s.scores[uid] = structuredClone(entree);
      semaines.set(semaine.cle, s);
    },
    retirerDuClassement: async (cles, uid) => {
      for (const cle of cles) delete semaines.get(cle)?.scores[uid];
    },
    purgerClassements: async (limite) => {
      let n = 0;
      for (const [cle, s] of [...semaines]) {
        if (s.debut < limite) {
          semaines.delete(cle);
          n += 1;
        }
      }
      return n;
    },
  };
}
