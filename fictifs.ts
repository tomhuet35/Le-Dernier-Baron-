/**
 * Joueurs de remplissage du classement de la semaine, tant que le jeu a encore peu de joueurs.
 *
 * Chacun a un profil fixe (pseudo, avatar, niveau qui monte au fil des semaines) et « joue » quelques parties par
 * semaine, à des heures réalistes (surtout le soir) : son score apparaît au classement au moment de sa partie, comme
 * pour un vrai joueur. Tout est tiré d'une graine (la semaine et le joueur) : le même classement est recalculé à
 * l'identique après un redémarrage du serveur, sans rien écrire dans Firestore.
 *
 * Ce qui est envoyé aux téléphones (pseudo, avatar, niveau, score) est exactement le même que pour un vrai joueur.
 * Variable JOUEURS_FICTIFS=non sur Render pour les retirer.
 */
import type { EntreeClassement, Semaine } from './classement';

interface ProfilFictif {
  id: string;
  nom: string;
  avatar: number;
  /** Niveau la semaine du lancement, puis niveaux gagnés par semaine (en moyenne). */
  niveau: number;
  progression: number;
  /** Chance de jouer une semaine donnée (0 à 1). */
  assiduite: number;
  /** Parties au plus dans la semaine. */
  parties: number;
  /** Talent : décale ses scores vers le haut (positif) ou vers le bas (négatif). */
  talent: number;
}

const PROFILS: ProfilFictif[] = [
  { id: 'f01', nom: 'Mathis_22', avatar: 3, niveau: 9, progression: 0.9, assiduite: 0.85, parties: 6, talent: 0.08 },
  { id: 'f02', nom: 'Camille.lb', avatar: 2, niveau: 6, progression: 0.6, assiduite: 0.7, parties: 4, talent: 0 },
  { id: 'f03', nom: 'Le Comte', avatar: 1, niveau: 17, progression: 0.5, assiduite: 0.8, parties: 5, talent: 0.14 },
  { id: 'f04', nom: 'Valou35', avatar: 5, niveau: 4, progression: 0.8, assiduite: 0.65, parties: 3, talent: -0.05 },
  { id: 'f05', nom: 'Nounours56', avatar: 6, niveau: 12, progression: 0.4, assiduite: 0.55, parties: 3, talent: -0.1 },
  { id: 'f06', nom: 'Tifenn', avatar: 7, niveau: 11, progression: 0.7, assiduite: 0.75, parties: 4, talent: 0.05 },
  { id: 'f07', nom: 'Enzo29', avatar: 6, niveau: 3, progression: 1.1, assiduite: 0.6, parties: 5, talent: -0.12 },
  { id: 'f08', nom: 'Morgane B', avatar: 2, niveau: 8, progression: 0.5, assiduite: 0.6, parties: 2, talent: 0.03 },
  { id: 'f09', nom: 'Kylian', avatar: 3, niveau: 5, progression: 0.9, assiduite: 0.7, parties: 4, talent: -0.03 },
  { id: 'f10', nom: 'Gaëtan', avatar: 4, niveau: 21, progression: 0.3, assiduite: 0.5, parties: 3, talent: 0.12 },
  { id: 'f11', nom: 'Lisa_M', avatar: 8, niveau: 7, progression: 0.6, assiduite: 0.65, parties: 3, talent: 0 },
  { id: 'f12', nom: 'Ewen', avatar: 1, niveau: 2, progression: 1.2, assiduite: 0.5, parties: 4, talent: -0.15 },
  { id: 'f13', nom: 'Maëlys', avatar: 5, niveau: 10, progression: 0.5, assiduite: 0.6, parties: 3, talent: 0.02 },
  { id: 'f14', nom: 'Rémi.B', avatar: 4, niveau: 14, progression: 0.4, assiduite: 0.45, parties: 2, talent: 0.06 },
  { id: 'f15', nom: 'Big Boss', avatar: 9, niveau: 19, progression: 0.6, assiduite: 0.7, parties: 6, talent: 0.1 },
  { id: 'f16', nom: 'Océane', avatar: 2, niveau: 5, progression: 0.7, assiduite: 0.55, parties: 3, talent: -0.06 },
  { id: 'f17', nom: 'Pierrick', avatar: 3, niveau: 13, progression: 0.3, assiduite: 0.4, parties: 2, talent: 0 },
  { id: 'f18', nom: 'Juju', avatar: 6, niveau: 6, progression: 0.8, assiduite: 0.6, parties: 4, talent: -0.02 },
];

/** Préfixe des identifiants (jamais envoyés aux téléphones ; ne peut pas être celui d'un vrai compte Firebase). */
export const PREFIXE_FICTIF = 'fictif:';

/** Lundi 9 novembre 2026, 0 h à Paris : niveaux de départ des joueurs fictifs (ils montent ensuite chaque semaine). */
const LANCEMENT = Date.UTC(2026, 10, 8, 23, 0, 0);
const SEMAINE_MS = 7 * 86_400_000;
const NIVEAU_MAX = 60;

/**
 * Scores de fin de partie, mesurés sur 600 parties simulées de 3 à 5 joueurs (quantile → score) :
 * la moitié des parties finissent sous 38 points, une sur dix au-dessus de 134.
 */
const QUANTILES: [number, number][] = [
  [0, -110],
  [0.05, -73],
  [0.1, -50],
  [0.25, -10],
  [0.5, 38],
  [0.75, 88],
  [0.9, 134],
  [0.95, 164],
  [0.99, 223],
  [1, 250],
];

/**
 * Les scores positifs des joueurs fictifs sont un peu réduits : une belle partie d'un vrai joueur (150 points et plus)
 * le met en général sur le podium, et 200 points suffisent souvent pour être 1er.
 */
const FORCE = 0.85;

function scoreAuQuantile(u: number): number {
  for (let i = 1; i < QUANTILES.length; i++) {
    const [q1, s1] = QUANTILES[i];
    if (u <= q1) {
      const [q0, s0] = QUANTILES[i - 1];
      return Math.round(s0 + ((u - q0) / (q1 - q0)) * (s1 - s0));
    }
  }
  return QUANTILES[QUANTILES.length - 1][1];
}

/** Tirage pseudo-aléatoire reproductible (FNV-1a pour la graine, puis mulberry32). */
function aleaDe(texte: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) h = Math.imul(h ^ texte.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Heure d'une partie : surtout le soir, un peu le midi et l'après-midi, rarement la nuit ou le matin. */
function heureDePartie(alea: () => number): number {
  const r = alea();
  if (r < 0.05) return Math.floor(alea() * 2); // minuit – 1 h
  if (r < 0.13) return 7 + Math.floor(alea() * 5); // 7 h – 11 h
  if (r < 0.25) return 12 + Math.floor(alea() * 2); // midi
  if (r < 0.45) return 14 + Math.floor(alea() * 4); // après-midi
  return 18 + Math.floor(alea() * 6); // 18 h – 23 h
}

export interface PartieFictive {
  date: number;
  score: number;
}

/** Les parties d'un joueur fictif pendant une semaine (vide s'il ne joue pas cette semaine-là). */
export function partiesFictives(profil: ProfilFictif, semaine: Semaine): PartieFictive[] {
  const alea = aleaDe(`${semaine.cle}|${profil.id}`);
  if (alea() >= profil.assiduite) return [];
  const n = 1 + Math.floor(alea() ** 2 * profil.parties);
  const parties: PartieFictive[] = [];
  for (let k = 0; k < n; k++) {
    const jour = Math.floor(alea() * 7);
    const date = Math.min(semaine.fin - 60_000, semaine.debut + jour * 86_400_000 + heureDePartie(alea) * 3_600_000 + Math.floor(alea() * 60) * 60_000);
    // Le talent tire les scores vers le haut (ou le bas) sans jamais coller au maximum ; un petit écart évite les égalités.
    const u = alea() ** Math.exp(-2 * profil.talent);
    const brut = scoreAuQuantile(u);
    parties.push({ date, score: Math.round(brut > 0 ? brut * FORCE : brut) + Math.round((alea() - 0.5) * 6) });
  }
  return parties.sort((a, b) => a.date - b.date);
}

function niveauDe(profil: ProfilFictif, semaine: Semaine): number {
  const semaines = Math.max(0, Math.round((semaine.debut - LANCEMENT) / SEMAINE_MS));
  return Math.min(NIVEAU_MAX, profil.niveau + Math.floor(semaines * profil.progression));
}

/**
 * Meilleur score de chaque joueur fictif dans la semaine, en ne comptant que les parties déjà jouées à cet instant
 * (le classement se remplit au fil de la semaine). Clés : PREFIXE_FICTIF + identifiant.
 */
export function scoresFictifs(semaine: Semaine, jusqua: number): Map<string, EntreeClassement> {
  const scores = new Map<string, EntreeClassement>();
  for (const p of PROFILS) {
    let meilleur: PartieFictive | null = null;
    for (const partie of partiesFictives(p, semaine)) {
      if (partie.date > jusqua) break;
      if (!meilleur || partie.score > meilleur.score) meilleur = partie;
    }
    if (meilleur) scores.set(PREFIXE_FICTIF + p.id, { nom: p.nom, avatar: p.avatar, niveau: niveauDe(p, semaine), score: meilleur.score, date: meilleur.date });
  }
  return scores;
}

export const PROFILS_FICTIFS: readonly ProfilFictif[] = PROFILS;
