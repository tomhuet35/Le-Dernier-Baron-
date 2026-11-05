/**
 * Roulette du jour : un tour gratuit par jour (du minuit au minuit suivant, heure de Paris), pour les joueurs avec un compte.
 * Huit cases de même taille, chacune avec la même chance. Une case fait gagner un personnage : la Danseuse, puis la
 * Journaliste, puis le Barman (chacun une seule fois) ; quand les trois sont gagnés, elle devient le gros lot d'XP.
 */

export type CaseRoulette = { type: 'xp'; xp: number } | { type: 'personnage' };

/** Dans l'ordre des aiguilles d'une montre, en partant du haut. */
export const CASES_ROULETTE: CaseRoulette[] = [
  { type: 'xp', xp: 20 },
  { type: 'xp', xp: 50 },
  { type: 'xp', xp: 10 },
  { type: 'personnage' },
  { type: 'xp', xp: 30 },
  { type: 'xp', xp: 100 },
  { type: 'xp', xp: 15 },
  { type: 'xp', xp: 40 },
];

/** Personnages à gagner, dans l'ordre (numéros d'avatar) : la Danseuse, la Journaliste, le Barman. */
export const PERSONNAGES_ROULETTE = [7, 8, 9];
/** Gros lot de la case personnage, une fois tous les personnages gagnés. */
export const XP_GROS_LOT = 200;

export type GainRoulette = { type: 'xp'; xp: number } | { type: 'personnage'; avatar: number };

/** Prochain personnage à gagner (null : tous gagnés). */
export function prochainPersonnage(debloques: readonly number[]): number | null {
  return PERSONNAGES_ROULETTE.find((p) => !debloques.includes(p)) ?? null;
}

/** Ce que rapporte une case pour ce joueur (selon les personnages qu'il a déjà). */
export function gainDeCase(i: number, debloques: readonly number[]): GainRoulette {
  const c = CASES_ROULETTE[i];
  if (!c) return { type: 'xp', xp: 0 };
  if (c.type === 'xp') return { type: 'xp', xp: c.xp };
  const p = prochainPersonnage(debloques);
  return p === null ? { type: 'xp', xp: XP_GROS_LOT } : { type: 'personnage', avatar: p };
}

// ----- Jours à l'heure de Paris -----
const formatJour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
function parties(t: number) {
  const p = Object.fromEntries(formatJour.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { an: +p.year, mois: +p.month, jour: +p.day, heure: +p.hour, minute: +p.minute, seconde: +p.second };
}
/** Avance de l'heure de Paris sur l'heure universelle à cet instant (1 h l'hiver, 2 h l'été). */
function avance(t: number): number {
  const p = parties(t);
  return Date.UTC(p.an, p.mois - 1, p.jour, p.heure, p.minute, p.seconde) - Math.floor(t / 1000) * 1000;
}

/** Le jour du calendrier à Paris, « 2026-11-05 ». */
export function jourParis(t: number): string {
  const p = parties(t);
  return `${p.an}-${String(p.mois).padStart(2, '0')}-${String(p.jour).padStart(2, '0')}`;
}

/** Minuit suivant à Paris : la roulette redevient disponible à cet instant. */
export function lendemainParis(t: number): number {
  const p = parties(t);
  const utc = Date.UTC(p.an, p.mois - 1, p.jour + 1);
  const essai = utc - avance(utc);
  const corrige = utc - avance(essai); // changement d'heure dans la nuit
  return corrige === essai ? essai : corrige;
}
