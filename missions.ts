/**
 * Les missions des jeux : chaque jeu a ses missions, et les finir toutes rapporte son trophée, un objet exposé dans
 * le Bureau du Baron (à part de la collection de la Salle des ventes). Pour l'instant : le Baron Express (la
 * locomotive dorée) et le Bal du Grand Hôtel (l'horloge de minuit).
 *
 * Une manche compte quand on a misé ; un bonus compte quand on avait misé sur la case du bonus qui sort ; un gain se
 * mesure en multiple de la mise posée sur la case gagnante (petite roue et multiplicateurs compris).
 *
 * Tout ce fichier est pur : le serveur (server/salonCasino.ts) tient l'avancement, gardé avec l'état du salon.
 */

export type JeuMission = 'express' | 'bal';
export type IdTrophee = 'locomotive' | 'horloge';
export type MesureMission = 'manches' | 'bonus' | 'final' | 'x100';

export interface Mission {
  /** Clé de l'avancement (« express.manches »…). */
  id: string;
  mesure: MesureMission;
  cible: number;
  nom: [string, string];
}

export const MISSIONS: Record<JeuMission, { trophee: IdTrophee; missions: Mission[] }> = {
  express: {
    trophee: 'locomotive',
    missions: [
      { id: 'express.manches', mesure: 'manches', cible: 50, nom: ['Jouer 50 manches', 'Play 50 rounds'] },
      { id: 'express.bonus', mesure: 'bonus', cible: 5, nom: ['Jouer 5 bonus (avoir misé sur le bonus qui sort)', 'Play 5 bonuses (bet on the bonus that comes up)'] },
      { id: 'express.x100', mesure: 'x100', cible: 1, nom: ['Gagner ×100 ou plus sur un bonus', 'Win ×100 or more on a bonus'] },
    ],
  },
  bal: {
    trophee: 'horloge',
    missions: [
      { id: 'bal.manches', mesure: 'manches', cible: 50, nom: ['Jouer 50 manches', 'Play 50 rounds'] },
      { id: 'bal.final', mesure: 'final', cible: 1, nom: ['Monter au penthouse : jouer le Bal masqué', 'Go up to the penthouse: play the Masked Ball'] },
      { id: 'bal.x100', mesure: 'x100', cible: 1, nom: ['Gagner ×100 ou plus sur un bonus', 'Win ×100 or more on a bonus'] },
    ],
  },
};

export const TROPHEES: Record<IdTrophee, { jeu: JeuMission; nom: [string, string]; image: string }> = {
  locomotive: { jeu: 'express', nom: ['La locomotive dorée', 'The golden locomotive'], image: '/cartes/trophee-locomotive.webp' },
  horloge: { jeu: 'bal', nom: ['L’horloge de minuit', 'The midnight clock'], image: '/cartes/trophee-horloge.webp' },
};
export const IDS_TROPHEES = Object.keys(TROPHEES) as IdTrophee[];
export const estTrophee = (x: unknown): x is IdTrophee => IDS_TROPHEES.includes(x as IdTrophee);
export const IDS_MISSIONS = Object.values(MISSIONS).flatMap((m) => m.missions.map((x) => x.id));

/** Les tenues de mission : faire ×1 000 (ou plus) dans le jeu donne son personnage (shared/tailleur.ts). */
export const SEUIL_AVATAR = 1000;
export const AVATARS_MISSION: Record<JeuMission, number> = { express: 23, bal: 22 };
/** La tenue gagnée par cette manche (null : rien de nouveau). */
export const avatarGagne = (tenues: number[], m: MancheMission): number | null => (m.x >= SEUIL_AVATAR && !tenues.includes(AVATARS_MISSION[m.jeu]) ? AVATARS_MISSION[m.jeu] : null);

/** Ce qu'une manche apporte aux missions d'un joueur. */
export interface MancheMission {
  jeu: JeuMission;
  /** Le joueur avait misé sur la case du bonus qui est sorti. */
  bonus: boolean;
  /** Ce bonus est le grand final (le Bal masqué). */
  final: boolean;
  /** Le gain en multiple de la mise posée sur la case gagnante (0 si rien dessus). */
  x: number;
}

export interface EtatMissions {
  missions: Partial<Record<string, number>>;
  trophees: IdTrophee[];
}

/** Avance les missions après une manche ; rend les missions finies à l'instant et le trophée gagné (s'il y en a un). */
export function avancerMissions(e: EtatMissions, m: MancheMission): { finies: Mission[]; trophee: IdTrophee | null } {
  const def = MISSIONS[m.jeu];
  if (e.trophees.includes(def.trophee)) return { finies: [], trophee: null };
  const finies: Mission[] = [];
  const suivant = { ...e.missions };
  for (const x of def.missions) {
    const avant = Math.min(x.cible, suivant[x.id] ?? 0);
    if (avant >= x.cible) continue;
    const plus = x.mesure === 'manches' ? 1 : x.mesure === 'bonus' ? (m.bonus ? 1 : 0) : x.mesure === 'final' ? (m.final ? 1 : 0) : m.bonus && m.x >= 100 ? 1 : 0;
    if (!plus) continue;
    const apres = Math.min(x.cible, avant + plus);
    suivant[x.id] = apres;
    if (apres >= x.cible) finies.push(x);
  }
  e.missions = suivant;
  const toutes = def.missions.every((x) => (suivant[x.id] ?? 0) >= x.cible);
  if (toutes) {
    e.trophees = [...e.trophees, def.trophee];
    return { finies, trophee: def.trophee };
  }
  return { finies, trophee: null };
}

/** Relit l'avancement gardé (valeurs bornées, clés connues seulement). */
export function normaliserMissions(missions: unknown, trophees: unknown): EtatMissions {
  const m: Partial<Record<string, number>> = {};
  if (missions && typeof missions === 'object')
    for (const [k, v] of Object.entries(missions as Record<string, unknown>)) {
      const def = Object.values(MISSIONS)
        .flatMap((x) => x.missions)
        .find((x) => x.id === k);
      if (def && typeof v === 'number' && Number.isFinite(v)) m[k] = Math.max(0, Math.min(def.cible, Math.floor(v)));
    }
  return { missions: m, trophees: Array.isArray(trophees) ? [...new Set(trophees.filter(estTrophee))] : [] };
}
