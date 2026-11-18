/**
 * Les Cercles (Grand Hôtel du Baron) : les clubs du Salon privé, comme les cercles de jeu d'avant les casinos.
 *
 * - Un cercle : un nom, un blason, 20 membres au plus. Rôles : Président (le fondateur), Croupier en chef (nommé par le
 *   président, il peut aussi exclure), Membres. Fonder un cercle coûte 50 rubis, changer de blason 10 rubis.
 * - Ouvert : on y entre librement ; sur invitation : il faut que le président ou le croupier accepte la demande.
 * - La cagnotte : 1 % des mises des membres l'alimente (offert par la maison, rien n'est retiré aux joueurs). Chaque lundi
 *   à 0 h (heure de Paris), elle est tirée au sort entre les membres qui ont misé pendant la semaine passée.
 * - Le classement des cercles : la somme des mises des membres pendant la semaine.
 * - La discussion du cercle : les 60 derniers messages, filtrés comme le chat du jeu.
 *
 * Tout ce fichier est pur : le serveur (server/cerclesCasino.ts) tient l'état et l'argent.
 */
import { filtrerMessage, pseudoAcceptable } from './moderation';

export const MEMBRES_MAX = 20;
export const PRIX_FONDER = 50;
export const PRIX_BLASON = 10;
export const PART_CAGNOTTE = 0.01;
export const MESSAGES_MAX = 60;
export const DEMANDES_MAX = 30;
export const NOM_MIN = 3;
export const NOM_MAX = 24;
export const MESSAGE_MAX = 200;

export const BLASONS = ['lion', 'aigle', 'rose', 'pique', 'serpent', 'hibou', 'cheval', 'loup'] as const;
export type Blason = (typeof BLASONS)[number];
export const estBlason = (x: unknown): x is Blason => BLASONS.includes(x as Blason);
export const NOMS_BLASONS: Record<Blason, [string, string]> = {
  lion: ['Le Lion', 'The Lion'],
  aigle: ['L’Aigle', 'The Eagle'],
  rose: ['La Rose', 'The Rose'],
  pique: ['L’As de pique', 'The Ace of Spades'],
  serpent: ['Le Serpent', 'The Serpent'],
  hibou: ['Le Hibou', 'The Owl'],
  cheval: ['Le Cheval', 'The Horse'],
  loup: ['Le Loup', 'The Wolf'],
};

export type Role = 'president' | 'croupier' | 'membre';
export const NOMS_ROLES: Record<Role, [string, string]> = {
  president: ['Président', 'President'],
  croupier: ['Croupier en chef', 'Head croupier'],
  membre: ['Membre', 'Member'],
};

export interface MembreCercle {
  uid: string;
  nom: string;
  avatar: number;
  role: Role;
  depuis: number;
  /** Mises de la semaine en cours (classement, cagnotte). */
  mise: number;
}

export interface MessageCercle {
  t: number;
  uid: string;
  nom: string;
  avatar: number;
  texte: string;
}

export interface Cercle {
  id: string;
  nom: string;
  blason: Blason;
  ouvert: boolean;
  creeLe: number;
  membres: MembreCercle[];
  /** Demandes d'entrée (cercle sur invitation). */
  demandes: { uid: string; nom: string; avatar: number; t: number }[];
  cagnotte: number;
  messages: MessageCercle[];
  /** La semaine (« 2026-S47 ») des mises et de la cagnotte en cours. */
  semaine: string;
  /** Le dernier tirage de la cagnotte (gagnant, montant, semaine). */
  dernierTirage: { nom: string; montant: number; semaine: string } | null;
}

export const roleDe = (c: Cercle, uid: string): Role | null => c.membres.find((m) => m.uid === uid)?.role ?? null;
export const peutGerer = (c: Cercle, uid: string) => {
  const r = roleDe(c, uid);
  return r === 'president' || r === 'croupier';
};
export const miseCercle = (c: Cercle) => c.membres.reduce((s, m) => s + m.mise, 0);

/** Le nom d'un cercle : 3 à 24 caractères, lettres, chiffres, espaces et ponctuation simple, et pas d'insulte. */
export function nomCercleValide(nom: unknown): string | null {
  if (typeof nom !== 'string') return null;
  const n = nom.replace(/\s+/g, ' ').trim();
  if (n.length < NOM_MIN || n.length > NOM_MAX) return null;
  if (!/^[\p{L}\p{N} '’\-.&]+$/u.test(n)) return null;
  return pseudoAcceptable(n) ? n : null;
}

/** Un message de la discussion : coupé, nettoyé, insultes masquées (null s'il est vide). */
export function messageValide(texte: unknown): string | null {
  if (typeof texte !== 'string') return null;
  const t = texte.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX);
  if (!t) return null;
  return filtrerMessage(t).texte;
}

export function nouveauCercle(id: string, nom: string, blason: Blason, ouvert: boolean, fondateur: Omit<MembreCercle, 'role' | 'depuis' | 'mise'>, t: number, semaine: string): Cercle {
  return { id, nom, blason, ouvert, creeLe: t, membres: [{ ...fondateur, role: 'president', depuis: t, mise: 0 }], demandes: [], cagnotte: 0, messages: [], semaine, dernierTirage: null };
}

/** Un membre s'en va (départ ou exclusion) : si c'était le président, le croupier (ou le plus ancien) prend sa place. */
export function retirerMembre(c: Cercle, uid: string): void {
  const m = c.membres.find((x) => x.uid === uid);
  if (!m) return;
  c.membres = c.membres.filter((x) => x.uid !== uid);
  if (m.role === 'president' && c.membres.length) {
    const suivant = c.membres.find((x) => x.role === 'croupier') ?? [...c.membres].sort((a, b) => a.depuis - b.depuis)[0];
    suivant.role = 'president';
  }
}

/**
 * Nouvelle semaine : la cagnotte est tirée au sort entre les membres qui ont misé (pondéré à parts égales), puis tout
 * repart à zéro. Renvoie le gagnant et le montant (null si personne n'a misé ou si la cagnotte est vide : elle est gardée).
 */
export function tirerCagnotte(c: Cercle, semaine: string, hasard: (n: number) => number): { uid: string; nom: string; montant: number } | null {
  if (c.semaine === semaine) return null;
  const actifs = c.membres.filter((m) => m.mise > 0);
  const ancienne = c.semaine;
  c.semaine = semaine;
  for (const m of c.membres) m.mise = 0;
  if (!actifs.length || c.cagnotte <= 0) return null;
  const g = actifs[hasard(actifs.length)];
  const montant = Math.floor(c.cagnotte);
  c.cagnotte = 0;
  c.dernierTirage = { nom: g.nom, montant, semaine: ancienne };
  return { uid: g.uid, nom: g.nom, montant };
}

/** Relit l'ensemble des cercles (gardé avec les réglages du serveur). */
export function normaliserCercles(brut: unknown): Cercle[] {
  if (!Array.isArray(brut)) return [];
  const ent = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const txt = (v: unknown, n = 40) => (typeof v === 'string' ? v.slice(0, n) : '');
  const res: Cercle[] = [];
  for (const b of brut) {
    if (!b || typeof b !== 'object') continue;
    const c = b as Record<string, unknown>;
    if (typeof c.id !== 'string' || typeof c.nom !== 'string') continue;
    const membres = (Array.isArray(c.membres) ? c.membres : [])
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).uid === 'string')
      .slice(0, MEMBRES_MAX)
      .map((m) => ({
        uid: m.uid as string,
        nom: txt(m.nom),
        avatar: ent(m.avatar) || 1,
        role: (m.role === 'president' || m.role === 'croupier' ? m.role : 'membre') as Role,
        depuis: ent(m.depuis),
        mise: ent(m.mise),
      }));
    if (!membres.length) continue;
    if (!membres.some((m) => m.role === 'president')) membres[0].role = 'president';
    const dt = c.dernierTirage as Record<string, unknown> | null | undefined;
    res.push({
      id: c.id.slice(0, 40),
      nom: txt(c.nom, NOM_MAX),
      blason: estBlason(c.blason) ? c.blason : 'lion',
      ouvert: c.ouvert !== false,
      creeLe: ent(c.creeLe),
      membres,
      demandes: (Array.isArray(c.demandes) ? c.demandes : [])
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && typeof (d as Record<string, unknown>).uid === 'string')
        .slice(0, DEMANDES_MAX)
        .map((d) => ({ uid: d.uid as string, nom: txt(d.nom), avatar: ent(d.avatar) || 1, t: ent(d.t) })),
      cagnotte: ent(c.cagnotte),
      messages: (Array.isArray(c.messages) ? c.messages : [])
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).texte === 'string')
        .slice(-MESSAGES_MAX)
        .map((m) => ({ t: ent(m.t), uid: txt(m.uid), nom: txt(m.nom), avatar: ent(m.avatar) || 1, texte: txt(m.texte, MESSAGE_MAX) })),
      semaine: txt(c.semaine, 12),
      dernierTirage: dt && typeof dt === 'object' ? { nom: txt(dt.nom), montant: ent(dt.montant), semaine: txt(dt.semaine, 12) } : null,
    });
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------
// Vues (téléphone)

/** Un cercle en bref (liste, classement). */
export interface ResumeCercle {
  id: string;
  nom: string;
  blason: Blason;
  ouvert: boolean;
  membres: number;
  mise: number;
  cagnotte: number;
}
export const resumeCercle = (c: Cercle): ResumeCercle => ({ id: c.id, nom: c.nom, blason: c.blason, ouvert: c.ouvert, membres: c.membres.length, mise: miseCercle(c), cagnotte: c.cagnotte });

export interface VueCercles {
  /** Mon cercle (complet), ou null. */
  mien: (Omit<Cercle, 'semaine'> & { moi: Role; finSemaine: number }) | null;
  /** Ma demande en attente (id du cercle), le cas échéant. */
  demande: string | null;
  /** Les cercles du salon, triés par mises de la semaine (le classement). */
  classement: ResumeCercle[];
}
