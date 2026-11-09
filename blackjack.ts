/**
 * Blackjack du Salon privé : sabot de 6 jeux, croupier qui tire jusqu'à 16 et reste sur tous les 17 (même souples),
 * blackjack payé 3 pour 2, assurance payée 2 pour 1, doubler sur les deux premières cartes, séparer jusqu'à 3 mains.
 *
 * Fonctions pures sur l'état d'une donne : le serveur s'occupe des minuteurs, de l'argent et du sabot (tirage au
 * hasard avec crypto.randomInt), les tests rejouent une donne avec un sabot choisi.
 */

/** Une carte : 0 à 51. Rang 1 (As) à 13 (Roi), couleur 0 pique, 1 cœur, 2 carreau, 3 trèfle. */
export type CarteBJ = number;
export const rangCarte = (c: CarteBJ) => (c % 13) + 1;
export const couleurCarte = (c: CarteBJ) => Math.floor(c / 13) % 4;
/** Valeur au blackjack (l'As compte 1 ici ; totalMain le passe à 11 quand c'est possible). */
export const valeurCarte = (c: CarteBJ) => Math.min(10, rangCarte(c));

export const NB_JEUX_BJ = 6;
/** On remélange quand il reste moins de 25 % du sabot. */
export const PART_COUPE_BJ = 0.25;
export const MISE_MIN_BJ = 1_000;
export const MISE_MAX_BJ = 250_000;
export const MAINS_MAX_BJ = 3;
export const PLACES_BJ = 5;
/** Jetons proposés pour miser. */
export const JETONS_BJ = [1_000, 5_000, 25_000, 100_000];

export function totalMain(cartes: CarteBJ[]): { total: number; souple: boolean } {
  const t = cartes.reduce((s, c) => s + valeurCarte(c), 0);
  if (cartes.some((c) => rangCarte(c) === 1) && t + 10 <= 21) return { total: t + 10, souple: true };
  return { total: t, souple: false };
}

/** Sabot de 6 jeux mélangés ; hasard(n) renvoie un entier de 0 à n − 1. */
export function nouveauSabot(hasard: (n: number) => number): CarteBJ[] {
  const s: CarteBJ[] = [];
  for (let j = 0; j < NB_JEUX_BJ; j++) for (let c = 0; c < 52; c++) s.push(c);
  for (let i = s.length - 1; i > 0; i--) {
    const k = hasard(i + 1);
    [s[i], s[k]] = [s[k], s[i]];
  }
  return s;
}
export const sabotAMelanger = (sabot: CarteBJ[]) => sabot.length < NB_JEUX_BJ * 52 * PART_COUPE_BJ;

export type IssueBJ = 'blackjack' | 'gagne' | 'egalite' | 'perdu' | 'saute';
export interface MainBJ {
  cartes: CarteBJ[];
  mise: number;
  doublee: boolean;
  /** Main issue d'une séparation (21 en deux cartes n'est alors pas un blackjack). */
  separee: boolean;
  finie: boolean;
  issue: IssueBJ | null;
  /** Ce qui revient au joueur à la fin (mise comprise), en dollars. */
  gain: number;
}
export interface PlaceBJ {
  id: string;
  mains: MainBJ[];
  /** Assurance prise (moitié de la mise de départ), ou 0. */
  assurance: number;
  /** A répondu à la question de l'assurance. */
  assuranceRepondue: boolean;
  gainAssurance: number;
}
export type PhaseDonneBJ = 'assurance' | 'joueurs' | 'croupier' | 'fin';
export interface DonneBJ {
  places: PlaceBJ[];
  croupier: CarteBJ[];
  /** La carte cachée du croupier est retournée. */
  revele: boolean;
  phase: PhaseDonneBJ;
  /** Main qui doit jouer (place, main), en phase « joueurs ». */
  tour: { place: number; main: number } | null;
}

export const estBlackjack = (m: MainBJ) => !m.separee && m.cartes.length === 2 && totalMain(m.cartes).total === 21;
const croupierBJ = (d: DonneBJ) => d.croupier.length === 2 && totalMain(d.croupier).total === 21;
const tirer = (sabot: CarteBJ[]) => {
  const c = sabot.pop();
  if (c === undefined) throw new Error('Sabot vide');
  return c;
};

/** Distribue : une carte à chacun, une au croupier (visible), une deuxième à chacun, puis la carte cachée. */
export function commencerDonne(sabot: CarteBJ[], mises: { id: string; mise: number }[]): DonneBJ {
  const places: PlaceBJ[] = mises.map(({ id, mise }) => ({
    id,
    mains: [{ cartes: [], mise, doublee: false, separee: false, finie: false, issue: null, gain: 0 }],
    assurance: 0,
    assuranceRepondue: false,
    gainAssurance: 0,
  }));
  const d: DonneBJ = { places, croupier: [], revele: false, phase: 'joueurs', tour: null };
  for (const p of places) p.mains[0].cartes.push(tirer(sabot));
  d.croupier.push(tirer(sabot));
  for (const p of places) p.mains[0].cartes.push(tirer(sabot));
  d.croupier.push(tirer(sabot));
  for (const p of places) if (estBlackjack(p.mains[0])) p.mains[0].finie = true;
  if (rangCarte(d.croupier[0]) === 1) {
    d.phase = 'assurance';
    return d;
  }
  return apresAssurance(d);
}

/** Le croupier regarde sa carte cachée s'il montre un As ou une carte à 10 : blackjack, la donne s'arrête. */
function apresAssurance(d: DonneBJ): DonneBJ {
  if (croupierBJ(d)) {
    d.revele = true;
    regler(d);
    return d;
  }
  d.phase = 'joueurs';
  d.tour = null;
  return avancer(d);
}

export function repondreAssurance(d: DonneBJ, id: string, oui: boolean): { ok: boolean; cout: number } {
  const p = d.places.find((x) => x.id === id);
  if (d.phase !== 'assurance' || !p || p.assuranceRepondue) return { ok: false, cout: 0 };
  p.assuranceRepondue = true;
  // Un joueur qui a déjà blackjack ne prend pas d'assurance ici (on reste simple : pas d'« argent égal »).
  if (oui && !estBlackjack(p.mains[0])) p.assurance = Math.floor(p.mains[0].mise / 2);
  return { ok: true, cout: p.assurance };
}
/** Fin du temps de l'assurance (ou tout le monde a répondu) : le croupier regarde sa carte. */
export function finirAssurance(d: DonneBJ): DonneBJ {
  if (d.phase !== 'assurance') return d;
  for (const p of d.places) p.assuranceRepondue = true;
  return apresAssurance(d);
}
export const assuranceComplete = (d: DonneBJ) => d.places.every((p) => p.assuranceRepondue);

/** Passe à la prochaine main qui doit jouer, ou au croupier. */
function avancer(d: DonneBJ): DonneBJ {
  for (let i = 0; i < d.places.length; i++) {
    for (let k = 0; k < d.places[i].mains.length; k++) {
      if (!d.places[i].mains[k].finie) {
        d.tour = { place: i, main: k };
        return d;
      }
    }
  }
  d.tour = null;
  d.phase = 'croupier';
  return d;
}

export type ActionBJ = 'tirer' | 'rester' | 'doubler' | 'separer';

export function mainEnCours(d: DonneBJ): { place: PlaceBJ; main: MainBJ } | null {
  if (d.phase !== 'joueurs' || !d.tour) return null;
  const place = d.places[d.tour.place];
  return { place, main: place.mains[d.tour.main] };
}

/** Actions permises pour la main qui joue. */
export function actionsPossibles(d: DonneBJ): ActionBJ[] {
  const en = mainEnCours(d);
  if (!en) return [];
  const { place, main } = en;
  const actions: ActionBJ[] = ['tirer', 'rester'];
  const asSepares = main.separee && rangCarte(main.cartes[0]) === 1;
  if (main.cartes.length === 2 && !asSepares) actions.push('doubler');
  if (main.cartes.length === 2 && valeurCarte(main.cartes[0]) === valeurCarte(main.cartes[1]) && place.mains.length < MAINS_MAX_BJ && !asSepares) actions.push('separer');
  return actions;
}

/** Coût supplémentaire d'une action (doubler ou séparer : une mise de plus). */
export function coutAction(d: DonneBJ, action: ActionBJ): number {
  const en = mainEnCours(d);
  return en && (action === 'doubler' || action === 'separer') ? en.main.mise : 0;
}

/** Joue une action pour la main en cours (le serveur a déjà vérifié le joueur et l'argent). */
export function jouerBJ(d: DonneBJ, sabot: CarteBJ[], action: ActionBJ): boolean {
  const en = mainEnCours(d);
  if (!en || !actionsPossibles(d).includes(action)) return false;
  const { place, main } = en;
  const finir = () => {
    const t = totalMain(main.cartes).total;
    if (t > 21) {
      main.finie = true;
      main.issue = 'saute';
    } else if (t === 21) main.finie = true;
  };
  if (action === 'tirer') {
    main.cartes.push(tirer(sabot));
    finir();
  } else if (action === 'rester') {
    main.finie = true;
  } else if (action === 'doubler') {
    main.mise *= 2;
    main.doublee = true;
    main.cartes.push(tirer(sabot));
    finir();
    main.finie = true;
  } else {
    const deuxieme = main.cartes.pop()!;
    const nouvelle: MainBJ = { cartes: [deuxieme], mise: main.mise, doublee: false, separee: true, finie: false, issue: null, gain: 0 };
    main.separee = true;
    place.mains.splice(d.tour!.main + 1, 0, nouvelle);
    const as = rangCarte(deuxieme) === 1;
    for (const m of [main, nouvelle]) {
      m.cartes.push(tirer(sabot));
      if (as || totalMain(m.cartes).total === 21) m.finie = true;
    }
  }
  avancer(d);
  return true;
}

/** Le croupier a-t-il besoin de jouer (au moins une main encore en jeu, hors blackjack) ? */
const croupierDoitTirer = (d: DonneBJ) => d.places.some((p) => p.mains.some((m) => m.issue !== 'saute' && !estBlackjack(m)));

/**
 * Une étape du croupier : retourner sa carte, puis tirer une carte à la fois jusqu'à 17. Renvoie false quand il a
 * fini (la donne est alors réglée).
 */
export function etapeCroupier(d: DonneBJ, sabot: CarteBJ[]): boolean {
  if (d.phase !== 'croupier') return false;
  if (!d.revele) {
    d.revele = true;
    return true;
  }
  if (croupierDoitTirer(d) && totalMain(d.croupier).total < 17) {
    d.croupier.push(tirer(sabot));
    return true;
  }
  regler(d);
  return false;
}

/** Règle toutes les mains : ce qui revient à chacun (mise comprise) et l'issue de chaque main. */
export function regler(d: DonneBJ): DonneBJ {
  const bjCroupier = croupierBJ(d);
  const tc = totalMain(d.croupier).total;
  for (const p of d.places) {
    p.gainAssurance = bjCroupier ? p.assurance * 3 : 0;
    for (const m of p.mains) {
      m.finie = true;
      const t = totalMain(m.cartes).total;
      const bj = estBlackjack(m);
      if (t > 21) m.issue = 'saute';
      else if (bj && bjCroupier) m.issue = 'egalite';
      else if (bj) m.issue = 'blackjack';
      else if (bjCroupier) m.issue = 'perdu';
      else if (tc > 21 || t > tc) m.issue = 'gagne';
      else if (t === tc) m.issue = 'egalite';
      else m.issue = 'perdu';
      m.gain = m.issue === 'blackjack' ? Math.floor(m.mise * 2.5) : m.issue === 'gagne' ? m.mise * 2 : m.issue === 'egalite' ? m.mise : 0;
    }
  }
  d.revele = true;
  d.tour = null;
  d.phase = 'fin';
  return d;
}

/** Ce qui revient à une place à la fin de la donne (mains + assurance). */
export const gainPlace = (p: PlaceBJ) => p.mains.reduce((s, m) => s + m.gain, 0) + p.gainAssurance;

/**
 * Stratégie de base (6 jeux, croupier qui reste sur 17 souple, doubler après séparation permis) : ce que font les
 * bots. haut : la carte visible du croupier.
 */
export function strategieDeBase(main: MainBJ, haut: CarteBJ, possibles: ActionBJ[]): ActionBJ {
  const v = valeurCarte(haut) === 1 ? 11 : valeurCarte(haut);
  const peut = (a: ActionBJ) => possibles.includes(a);
  const { total, souple } = totalMain(main.cartes);
  const doubleOu = (sinon: ActionBJ): ActionBJ => (peut('doubler') ? 'doubler' : sinon);
  if (peut('separer') && main.cartes.length === 2 && valeurCarte(main.cartes[0]) === valeurCarte(main.cartes[1])) {
    const r = valeurCarte(main.cartes[0]);
    const separer =
      r === 1 || r === 8 || (r === 9 && ![7, 10, 11].includes(v)) || ((r === 7 || r === 2 || r === 3) && v <= 7) || (r === 6 && v <= 6) || (r === 4 && (v === 5 || v === 6));
    if (separer) return 'separer';
  }
  if (souple) {
    if (total >= 20) return 'rester';
    if (total === 19) return v === 6 ? doubleOu('rester') : 'rester';
    if (total === 18) return v >= 3 && v <= 6 ? doubleOu('rester') : v <= 8 ? 'rester' : 'tirer';
    if (total === 17) return v >= 3 && v <= 6 ? doubleOu('tirer') : 'tirer';
    if (total >= 15) return v >= 4 && v <= 6 ? doubleOu('tirer') : 'tirer';
    return v >= 5 && v <= 6 ? doubleOu('tirer') : 'tirer';
  }
  if (total >= 17) return 'rester';
  if (total >= 13) return v <= 6 ? 'rester' : 'tirer';
  if (total === 12) return v >= 4 && v <= 6 ? 'rester' : 'tirer';
  if (total === 11) return v <= 10 ? doubleOu('tirer') : 'tirer';
  if (total === 10) return v <= 9 ? doubleOu('tirer') : 'tirer';
  if (total === 9) return v >= 3 && v <= 6 ? doubleOu('tirer') : 'tirer';
  return 'tirer';
}

// ----- Ce que reçoit le téléphone d'un joueur assis à une table -----

export interface MainVueBJ {
  cartes: CarteBJ[];
  mise: number;
  doublee: boolean;
  issue: IssueBJ | null;
  gain: number;
}
export interface PlaceVueBJ {
  id: string;
  nom: string;
  avatar: number;
  bot: boolean;
  moi?: true;
  hote?: true;
  /** Parti ou déconnecté : sa main se joue toute seule (il reste). */
  absent?: true;
  /** Mise annoncée pour la prochaine donne, et confirmée ou non. */
  mise: number;
  pret: boolean;
  mains: MainVueBJ[];
  assurance: number;
  /** Fin de donne : ce qui lui revient (mises comprises), sinon null. */
  gainTotal: number | null;
}
export type PhaseTableBJ = 'mises' | PhaseDonneBJ;
export interface VueTableBJ {
  code: string;
  numero: number;
  phase: PhaseTableBJ;
  /** Temps restant pour l'étape en cours (mises, assurance, décision), en millisecondes. */
  reste: number | null;
  duree: number | null;
  places: PlaceVueBJ[];
  /** Cartes du croupier ; null pour la carte cachée. */
  croupier: (CarteBJ | null)[];
  tour: { place: string; main: number } | null;
  /** Mes actions possibles (c'est à moi de jouer). */
  actions: ActionBJ[];
  /** Je dois répondre à l'assurance. */
  assurance: boolean;
  sabot: number;
  /** Le sabot vient d'être remélangé. */
  melange: boolean;
  hote: boolean;
  solde: number;
  messages: { nom: string; texte: string }[];
}
export interface ResumeTableBJ {
  code: string;
  joueurs: { nom: string; avatar: number; bot: boolean }[];
  max: number;
}
