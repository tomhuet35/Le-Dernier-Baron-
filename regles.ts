import { CARTE } from './cartes';
import {
  BONUS_ALLIANCE,
  BONUS_BARON_HOMME_DE_MAIN,
  BONUS_BRAQUAGE,
  DESCENTE_BLOQUE_BONUS,
  MULTIPLICATEUR_BUTIN_CASSE,
  MULTIPLICATEUR_BUTIN_DESCENTE,
  PENALITE_PAR_ECART,
  POINTS_ANNONCE_ZERO_PAR_NUIT,
  POINTS_PAR_PLI_ANNONCE,
} from './config';
import type { Carte, CartePosee, Famille, TypeEvenement } from './types';

export function carte(id: string): Carte {
  const c = CARTE[id];
  if (!c) throw new Error(`Carte inconnue : ${id}`);
  return c;
}

export const estSpeciale = (c: Carte) => c.type === 'speciale';
/** Carte numérotée = carte de gang ou Chat noir. */
export const estNumerotee = (c: Carte) => c.type === 'gang' || c.type === 'atout';

export type FamilleDemandee = Famille | 'chat_noir';

/** La famille demandée est fixée par la première carte numérotée posée : une carte de gang, ou un Chat noir (Chat noir demandé). */
export function familleDemandee(pli: CartePosee[]): FamilleDemandee | null {
  for (const p of pli) {
    const c = carte(p.carteId);
    if (estNumerotee(c)) return c.famille as FamilleDemandee;
  }
  return null;
}

/**
 * Cartes qu'un joueur peut poser. S'il a la famille demandée, il doit la suivre ou jouer une carte spéciale ;
 * un Chat noir se joue aussi à tout moment sur une famille de gang. Si c'est le Chat noir qui est demandé,
 * il doit fournir un Chat noir (ou une carte spéciale).
 */
export function cartesJouables(main: string[], pli: CartePosee[]): string[] {
  const fam = familleDemandee(pli);
  if (!fam) return [...main];
  const deLaFamille = (id: string) => estNumerotee(carte(id)) && carte(id).famille === fam;
  if (!main.some(deLaFamille)) return [...main];
  return main.filter((id) => deLaFamille(id) || estSpeciale(carte(id)) || carte(id).type === 'atout');
}

function valeurDe(p: CartePosee): number {
  const c = carte(p.carteId);
  if (estNumerotee(c)) return c.valeur ?? 0;
  if (c.speciale === 'croupier') return p.valeurCroupier ?? 0;
  return -1;
}

/** Départage à valeur égale : Chat noir, puis famille demandée (Croupier compris), puis autre famille. */
function rangDepartage(p: CartePosee, fam: FamilleDemandee | null): number {
  const c = carte(p.carteId);
  if (c.type === 'atout') return 2;
  if (c.speciale === 'croupier' || (c.type === 'gang' && c.famille === fam)) return 1;
  return 0;
}

/** Index de la carte la plus forte (valeur, puis départage, puis première posée). Avec inverse, la plus petite valeur l'emporte. */
function meilleure(indices: number[], pli: CartePosee[], fam: FamilleDemandee | null, inverse = false): number {
  let best = indices[0];
  for (const i of indices.slice(1)) {
    const vi = inverse ? -valeurDe(pli[i]) : valeurDe(pli[i]);
    const vb = inverse ? -valeurDe(pli[best]) : valeurDe(pli[best]);
    if (vi > vb || (vi === vb && rangDepartage(pli[i], fam) > rangDepartage(pli[best], fam))) best = i;
  }
  return best;
}

export interface ResultatPli {
  gagnant: number; // index dans le pli
  butin: number | null; // index de la carte gardée en butin
  braquage: boolean;
  hommesDeMainCaptures: number; // > 0 seulement si le Baron gagne un pli avec des Hommes de main
  regle: 'juge' | 'braquage' | 'baron' | 'homme_de_main' | 'chat_noir' | 'famille' | 'pickpocket' | 'ouvreur';
}

/** Détermine le gagnant et le butin d'un pli complet (sections 6.3 à 6.5). */
export function resoudrePli(pli: CartePosee[]): ResultatPli {
  if (pli.length === 0) throw new Error('Pli vide');
  const fam = familleDemandee(pli);
  const cartes = pli.map((p) => carte(p.carteId));
  const indices = (test: (c: Carte) => boolean) =>
    cartes.map((c, i) => (test(c) ? i : -1)).filter((i) => i >= 0);
  const speciales = (s: string) => indices((c) => c.speciale === s);

  const gangs = indices((c) => c.type === 'gang');
  const avecValeur = indices((c) => estNumerotee(c) || c.speciale === 'croupier');
  // Le butin est toujours la carte de gang de plus forte valeur (jamais un Chat noir).
  const butin = gangs.length ? meilleure(gangs, pli, fam) : null;

  let gagnant: number;
  let regle: ResultatPli['regle'];
  if (speciales('juge').length && avecValeur.length) {
    // Avec le Juge, l'ordre est inversé : la plus petite valeur gagne.
    gagnant = meilleure(avecValeur, pli, fam, true);
    regle = 'juge';
  } else {
    const baron = speciales('baron');
    const pickpocket = speciales('pickpocket');
    const hommes = speciales('homme_de_main');
    const chats = indices((c) => c.type === 'atout');
    const famille = indices((c) => c.speciale === 'croupier' || (c.type === 'gang' && c.famille === fam));
    if (baron.length && pickpocket.length) [gagnant, regle] = [pickpocket[0], 'braquage'];
    else if (baron.length) [gagnant, regle] = [baron[0], 'baron'];
    else if (hommes.length) [gagnant, regle] = [hommes[0], 'homme_de_main'];
    else if (chats.length) [gagnant, regle] = [meilleure(chats, pli, fam), 'chat_noir'];
    else if (famille.length) [gagnant, regle] = [meilleure(famille, pli, fam), 'famille'];
    else if (pickpocket.length) [gagnant, regle] = [pickpocket[0], 'pickpocket'];
    else [gagnant, regle] = [0, 'ouvreur'];
  }
  const hommesDeMainCaptures = cartes[gagnant].speciale === 'baron' ? speciales('homme_de_main').length : 0;
  return { gagnant, butin, braquage: regle === 'braquage', hommesDeMainCaptures, regle };
}

export interface DetailScore {
  reussie: boolean;
  pointsAnnonce: number;
  pointsButin: number;
  bonus: number;
  total: number;
}

/** Score d'un joueur pour une nuit (section 7.2). */
export function calculerScore(p: {
  nuit: number;
  annonce: number;
  plis: number;
  butin: number[];
  evenement: TypeEvenement | null;
  bonusBaron: number;
  braquages: number;
  allianceReussie: boolean;
}): DetailScore {
  const reussie = p.plis === p.annonce;
  const pointsAnnonce =
    p.annonce === 0
      ? (reussie ? 1 : -1) * POINTS_ANNONCE_ZERO_PAR_NUIT * p.nuit
      : reussie
        ? POINTS_PAR_PLI_ANNONCE * p.annonce
        : -PENALITE_PAR_ECART * Math.abs(p.plis - p.annonce);
  const multiplicateur =
    p.evenement === 'casse_du_siecle'
      ? MULTIPLICATEUR_BUTIN_CASSE
      : p.evenement === 'descente_police'
        ? MULTIPLICATEUR_BUTIN_DESCENTE
        : 1;
  // Le butin ne compte que si l'annonce est réussie.
  const pointsButin = reussie ? p.butin.reduce((s, v) => s + v, 0) * multiplicateur : 0;
  const bonusActifs = reussie && !(DESCENTE_BLOQUE_BONUS && p.evenement === 'descente_police');
  const bonus = bonusActifs
    ? BONUS_BARON_HOMME_DE_MAIN * p.bonusBaron + BONUS_BRAQUAGE * p.braquages + (p.allianceReussie ? BONUS_ALLIANCE : 0)
    : 0;
  return { reussie, pointsAnnonce, pointsButin, bonus, total: pointsAnnonce + pointsButin + bonus };
}

/** Une alliance est réussie quand les deux alliés réussissent leur annonce. */
export function allianceReussiePour(
  joueurId: string,
  alliances: [string, string][],
  reussites: Record<string, boolean>,
): boolean {
  const paire = alliances.find(([a, b]) => a === joueurId || b === joueurId);
  return !!paire && reussites[paire[0]] && reussites[paire[1]];
}
