/**
 * Les Tickets du Baron (Salon privé, au Bar) : des tickets à gratter.
 *
 * Trois tickets, du moins cher au plus cher. Chaque ticket cache 9 cases (3 × 3), chacune un montant : trois montants
 * identiques font gagner ce montant (une seule fois par ticket, jamais deux brelans). Le Groom « Coup double » double
 * le gain quand il apparaît sur un ticket gagnant.
 *
 * Le serveur tire le ticket à l'achat (crypto) : mise débitée, gain crédité d'un bloc, rien en suspens. Le téléphone
 * ne fait que laisser gratter : le gain s'affiche quand le ticket est découvert.
 *
 * Chaque ticket rend environ 93 % des mises en moyenne ; un ticket sur quatre environ gagne au moins sa mise.
 */

export type ModeleTicket = 'veinard' | 'epoque' | 'baron';
export const MODELES_TICKETS: ModeleTicket[] = ['veinard', 'epoque', 'baron'];
export const estModeleTicket = (x: unknown): x is ModeleTicket => MODELES_TICKETS.includes(x as ModeleTicket);

export interface InfosTicket {
  nom: [string, string];
  prix: number;
  /** Multiplicateur du gros lot (× le prix). */
  grosLot: number;
}
export const TICKETS: Record<ModeleTicket, InfosTicket> = {
  veinard: { nom: ['Le Petit Veinard', 'The Lucky Break'], prix: 10_000, grosLot: 1_000 },
  epoque: { nom: ['La Belle Époque', 'The Belle Époque'], prix: 100_000, grosLot: 2_000 },
  baron: { nom: ['Le Grand Baron', 'The Grand Baron'], prix: 1_000_000, grosLot: 5_000 },
};

/** Les lots ordinaires (× le prix) et leur chance ; le gros lot dépend du ticket (voir LOT_MAX). */
const LOTS: { x: number; p: number }[] = [
  { x: 1, p: 0.08 },
  { x: 2, p: 0.08 },
  { x: 3, p: 0.05 },
  { x: 5, p: 0.025 },
  { x: 10, p: 0.01 },
  { x: 20, p: 0.005 },
  { x: 50, p: 0.0015 },
  { x: 100, p: 0.0005 },
];
/** Chance du gros lot : il rend 6 % des mises, quel que soit le ticket. */
const PART_GROS_LOT = 0.06;
/** Chance du « Coup double » sur un ticket gagnant (le gain est doublé). */
export const CHANCE_COUP_DOUBLE = 0.04;

/** Les lots d'un ticket, du plus petit au gros lot, avec leur chance. */
export function lotsTicket(modele: ModeleTicket): { x: number; p: number }[] {
  const g = TICKETS[modele].grosLot;
  return [...LOTS, { x: g, p: PART_GROS_LOT / g }];
}

/** Ce que rend un ticket en moyenne (0,93 = 93 %), Coup double compris. */
export function rtpTicket(modele: ModeleTicket): number {
  return lotsTicket(modele).reduce((s, l) => s + l.p * l.x, 0) * (1 + CHANCE_COUP_DOUBLE);
}

/** Les montants possibles d'une case (× le prix), du plus petit au gros lot. */
export const montantsTicket = (modele: ModeleTicket) => lotsTicket(modele).map((l) => l.x);

/** Un ticket acheté, tel que le serveur l'a tiré. */
export interface Ticket {
  id: number;
  modele: ModeleTicket;
  prix: number;
  /** Les 9 cases (× le prix), ligne par ligne. */
  cases: number[];
  /** Les cases du brelan gagnant (vide si perdu). */
  gagnantes: number[];
  /** Le Groom « Coup double » : sa case (ou null). */
  coupDouble: number | null;
  /** Ce qui revient au joueur (0 si perdu). */
  gain: number;
}

/**
 * Tire un ticket. `hasard(n)` rend un entier de 0 à n − 1 ; `u()` un réel de 0 à 1 (le lot).
 * Les cases perdantes ne contiennent jamais trois fois le même montant.
 */
export function tirerTicket(modele: ModeleTicket, id: number, hasard: (n: number) => number, u: () => number): Ticket {
  const lots = lotsTicket(modele);
  const montants = lots.map((l) => l.x);
  let r = u();
  let lot: number | null = null;
  for (const l of lots) {
    if (r < l.p) {
      lot = l.x;
      break;
    }
    r -= l.p;
  }
  const cases: number[] = [];
  const compte = new Map<number, number>();
  const poser = (x: number) => {
    cases.push(x);
    compte.set(x, (compte.get(x) ?? 0) + 1);
  };
  if (lot !== null) for (let k = 0; k < 3; k++) poser(lot);
  // Les autres cases : des montants tirés, deux fois au plus chacun (et jamais le lot gagnant une quatrième fois).
  while (cases.length < 9) {
    const x = montants[hasard(montants.length)];
    if (x === lot || (compte.get(x) ?? 0) >= 2) continue;
    poser(x);
  }
  // Mélange (Fisher-Yates).
  for (let i = cases.length - 1; i > 0; i--) {
    const j = hasard(i + 1);
    [cases[i], cases[j]] = [cases[j], cases[i]];
  }
  const gagnantes = lot === null ? [] : cases.map((x, i) => (x === lot ? i : -1)).filter((i) => i >= 0);
  const coupDouble = lot !== null && u() < CHANCE_COUP_DOUBLE ? gagnantes[hasard(gagnantes.length)] : null;
  const prix = TICKETS[modele].prix;
  const gain = lot === null ? 0 : prix * lot * (coupDouble === null ? 1 : 2);
  return { id, modele, prix, cases, gagnantes, coupDouble, gain };
}
