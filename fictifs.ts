/**
 * Joueurs de remplissage du classement de la semaine, tant que le jeu a encore peu de joueurs.
 *
 * 50 joueurs, chacun avec un profil fixe (pseudo, avatar, niveau qui monte au fil des semaines). Chaque semaine, ils
 * sont tous au classement dès le lundi 0 h avec un premier score, puis leur meilleur score monte pendant la semaine,
 * partie après partie, jusqu'à son niveau final : des scores répartis régulièrement de 0 à 380 points.
 * Tout est tiré d'une graine (la semaine et le joueur) : le même classement est recalculé à l'identique après un
 * redémarrage du serveur, sans rien écrire dans Firestore.
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
  /** Talent (-1 à 1) : les plus doués finissent plus souvent en haut du classement. */
  talent: number;
}

// Avatars : 1 le Parrain, 2 la Chanteuse, 3 le Détective, 4 le Croupier, 5 la Contrebandière, 6 le Boxeur,
// 7 la Danseuse, 8 la Journaliste, 9 le Barman.
const PROFILS: ProfilFictif[] = [
  { id: 'f01', nom: 'Mathis_22', avatar: 3, niveau: 9, progression: 0.9, talent: 0.4 },
  { id: 'f02', nom: 'Camille.lb', avatar: 2, niveau: 6, progression: 0.6, talent: 0 },
  { id: 'f03', nom: 'Le Comte', avatar: 1, niveau: 17, progression: 0.5, talent: 0.7 },
  { id: 'f04', nom: 'Valou35', avatar: 5, niveau: 4, progression: 0.8, talent: -0.3 },
  { id: 'f05', nom: 'Nounours56', avatar: 6, niveau: 12, progression: 0.4, talent: -0.5 },
  { id: 'f06', nom: 'Tifenn', avatar: 7, niveau: 11, progression: 0.7, talent: 0.3 },
  { id: 'f07', nom: 'Enzo29', avatar: 6, niveau: 3, progression: 1.1, talent: -0.6 },
  { id: 'f08', nom: 'Morgane B', avatar: 2, niveau: 8, progression: 0.5, talent: 0.1 },
  { id: 'f09', nom: 'Kylian', avatar: 3, niveau: 5, progression: 0.9, talent: -0.2 },
  { id: 'f10', nom: 'Gaëtan', avatar: 4, niveau: 21, progression: 0.3, talent: 0.6 },
  { id: 'f11', nom: 'Lisa_M', avatar: 8, niveau: 7, progression: 0.6, talent: 0 },
  { id: 'f12', nom: 'Ewen', avatar: 1, niveau: 2, progression: 1.2, talent: -0.7 },
  { id: 'f13', nom: 'Maëlys', avatar: 5, niveau: 10, progression: 0.5, talent: 0.1 },
  { id: 'f14', nom: 'Rémi.B', avatar: 4, niveau: 14, progression: 0.4, talent: 0.3 },
  { id: 'f15', nom: 'Big Boss', avatar: 9, niveau: 19, progression: 0.6, talent: 0.5 },
  { id: 'f16', nom: 'Océane', avatar: 2, niveau: 5, progression: 0.7, talent: -0.3 },
  { id: 'f17', nom: 'Pierrick', avatar: 3, niveau: 13, progression: 0.3, talent: 0 },
  { id: 'f18', nom: 'Juju', avatar: 6, niveau: 6, progression: 0.8, talent: -0.1 },
  { id: 'f19', nom: 'Nathan.R', avatar: 3, niveau: 8, progression: 0.7, talent: 0.2 },
  { id: 'f20', nom: 'Loïc_29', avatar: 4, niveau: 15, progression: 0.4, talent: 0.4 },
  { id: 'f21', nom: 'Kévin56', avatar: 6, niveau: 4, progression: 1, talent: -0.4 },
  { id: 'f22', nom: 'Baptiste', avatar: 1, niveau: 11, progression: 0.5, talent: 0.1 },
  { id: 'f23', nom: 'Titouan', avatar: 3, niveau: 3, progression: 1.1, talent: -0.5 },
  { id: 'f24', nom: 'Florian B', avatar: 4, niveau: 9, progression: 0.6, talent: 0 },
  { id: 'f25', nom: 'Axel_35', avatar: 6, niveau: 7, progression: 0.8, talent: -0.2 },
  { id: 'f26', nom: 'Dylan', avatar: 9, niveau: 16, progression: 0.5, talent: 0.5 },
  { id: 'f27', nom: 'Yohann', avatar: 1, niveau: 24, progression: 0.3, talent: 0.8 },
  { id: 'f28', nom: 'Maxence', avatar: 3, niveau: 5, progression: 0.9, talent: -0.3 },
  { id: 'f29', nom: 'Tristan.G', avatar: 4, niveau: 12, progression: 0.5, talent: 0.2 },
  { id: 'f30', nom: 'Corentin', avatar: 6, niveau: 10, progression: 0.6, talent: 0 },
  { id: 'f31', nom: 'Erwan', avatar: 1, niveau: 6, progression: 0.7, talent: -0.1 },
  { id: 'f32', nom: 'Quentin_B', avatar: 3, niveau: 18, progression: 0.4, talent: 0.6 },
  { id: 'f33', nom: 'Anaïs', avatar: 2, niveau: 9, progression: 0.6, talent: 0.2 },
  { id: 'f34', nom: 'Lou.anne', avatar: 5, niveau: 4, progression: 0.9, talent: -0.4 },
  { id: 'f35', nom: 'Manon_22', avatar: 8, niveau: 13, progression: 0.5, talent: 0.3 },
  { id: 'f36', nom: 'Elodie B', avatar: 2, niveau: 7, progression: 0.6, talent: -0.1 },
  { id: 'f37', nom: 'Sarah', avatar: 5, niveau: 3, progression: 1, talent: -0.6 },
  { id: 'f38', nom: 'Nolwenn', avatar: 7, niveau: 20, progression: 0.4, talent: 0.7 },
  { id: 'f39', nom: 'Clémence', avatar: 2, niveau: 10, progression: 0.5, talent: 0.1 },
  { id: 'f40', nom: 'Pauline.m', avatar: 8, niveau: 6, progression: 0.7, talent: -0.2 },
  { id: 'f41', nom: 'Gwen', avatar: 5, niveau: 14, progression: 0.4, talent: 0.4 },
  { id: 'f42', nom: 'Laura56', avatar: 2, niveau: 5, progression: 0.8, talent: -0.3 },
  { id: 'f43', nom: 'Justine', avatar: 5, niveau: 8, progression: 0.6, talent: 0 },
  { id: 'f44', nom: 'Lena_bzh', avatar: 7, niveau: 11, progression: 0.5, talent: 0.2 },
  { id: 'f45', nom: 'Black Jack', avatar: 4, niveau: 26, progression: 0.3, talent: 0.9 },
  { id: 'f46', nom: 'Lucky 7', avatar: 1, niveau: 8, progression: 0.7, talent: -0.1 },
  { id: 'f47', nom: 'Tonton', avatar: 9, niveau: 15, progression: 0.3, talent: 0 },
  { id: 'f48', nom: 'Moustache', avatar: 3, niveau: 12, progression: 0.4, talent: 0.3 },
  { id: 'f49', nom: 'Kiki', avatar: 2, niveau: 2, progression: 1.2, talent: -0.8 },
  { id: 'f50', nom: 'Romain', avatar: 6, niveau: 9, progression: 0.6, talent: 0.1 },
];

/** Préfixe des identifiants (jamais envoyés aux téléphones ; ne peut pas être celui d'un vrai compte Firebase). */
export const PREFIXE_FICTIF = 'fictif:';

/** Meilleur score de la semaine le plus haut chez les joueurs fictifs : leurs scores finaux vont de 0 à ce nombre. */
export const SCORE_MAX_FICTIF = 380;

/** Lundi 9 novembre 2026, 0 h à Paris : niveaux de départ des joueurs fictifs (ils montent ensuite chaque semaine). */
const LANCEMENT = Date.UTC(2026, 10, 8, 23, 0, 0);
const JOUR_MS = 86_400_000;
const SEMAINE_MS = 7 * JOUR_MS;
const NIVEAU_MAX = 60;

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

/**
 * Score final de chaque joueur fictif pour la semaine : 50 scores répartis régulièrement de 0 à 380, distribués
 * selon le talent de chacun et un peu de hasard (le classement change d'une semaine à l'autre).
 */
function scoresFinaux(semaine: Semaine): Map<string, number> {
  const alea = aleaDe(`${semaine.cle}|finaux`);
  const ordre = PROFILS.map((p) => ({ id: p.id, cle: p.talent + (alea() + alea() + alea() - 1.5) * 1.2 })).sort((a, b) => b.cle - a.cle);
  const n = ordre.length;
  return new Map(ordre.map((x, i) => [x.id, Math.round((SCORE_MAX_FICTIF * (n - 1 - i + alea() * 0.9)) / n)]));
}

export interface PartieFictive {
  date: number;
  score: number;
}

/**
 * Les parties d'un joueur fictif pendant une semaine, avec son meilleur score à chacune : la première dans la nuit de
 * lundi (il est au classement dès le début de la semaine), puis de 1 à 5 autres où son score monte jusqu'au final.
 */
export function partiesFictives(profil: ProfilFictif, semaine: Semaine, final: number): PartieFictive[] {
  const alea = aleaDe(`${semaine.cle}|${profil.id}`);
  const autres = 1 + Math.floor(alea() * 5);
  const debut = Math.round(final * (0.7 + alea() * 0.25));
  const dates = Array.from({ length: autres }, () => {
    const jour = Math.floor(alea() * 7);
    return Math.min(semaine.fin - 60_000, semaine.debut + jour * JOUR_MS + heureDePartie(alea) * 3_600_000 + Math.floor(alea() * 60) * 60_000);
  }).sort((a, b) => a - b);
  const parties: PartieFictive[] = [{ date: semaine.debut + Math.floor(alea() * 30) * 60_000, score: debut }];
  dates.forEach((date, k) => {
    const part = k === autres - 1 ? 1 : (k + 1 + (alea() - 0.5) * 0.6) / autres;
    parties.push({ date: Math.max(date, parties[parties.length - 1].date + 60_000), score: Math.round(debut + (final - debut) * Math.min(1, Math.max(0, part))) });
  });
  return parties;
}

function niveauDe(profil: ProfilFictif, semaine: Semaine): number {
  const semaines = Math.max(0, Math.round((semaine.debut - LANCEMENT) / SEMAINE_MS));
  return Math.min(NIVEAU_MAX, profil.niveau + Math.floor(semaines * profil.progression));
}

/**
 * Meilleur score de chaque joueur fictif dans la semaine, en ne comptant que les parties déjà jouées à cet instant.
 * Clés : PREFIXE_FICTIF + identifiant.
 */
export function scoresFictifs(semaine: Semaine, jusqua: number): Map<string, EntreeClassement> {
  const scores = new Map<string, EntreeClassement>();
  const finaux = scoresFinaux(semaine);
  for (const p of PROFILS) {
    let meilleur: PartieFictive | null = null;
    for (const partie of partiesFictives(p, semaine, finaux.get(p.id) ?? 0)) {
      if (partie.date > jusqua) break;
      if (!meilleur || partie.score > meilleur.score) meilleur = partie;
    }
    if (meilleur) scores.set(PREFIXE_FICTIF + p.id, { nom: p.nom, avatar: p.avatar, niveau: niveauDe(p, semaine), score: meilleur.score, date: meilleur.date });
  }
  return scores;
}

export const PROFILS_FICTIFS: readonly ProfilFictif[] = PROFILS;
