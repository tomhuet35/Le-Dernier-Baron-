/**
 * La Bourse de 1929 (Grand Hôtel du Baron) : six sociétés fictives d'époque, dont les cours bougent toutes les 5 minutes,
 * au gré des nouvelles du « Petit Baron ». Parfois la Bourse s'envole, parfois c'est le krach.
 *
 * - Chaque séance (5 minutes), chaque titre bouge un peu au hasard (selon sa nervosité) ; de temps en temps, une
 *   nouvelle fait bondir ou chuter un titre, ou tout le marché (krach : de −25 % à −45 % ; envolée : de +15 % à +30 %).
 * - Les cours restent entre un plancher et un plafond (sur le long terme, ils reviennent doucement vers leur cours de
 *   référence) : la Bourse ne fabrique pas d'argent à l'infini.
 * - On achète et on vend avec ses dollars, à 1 % de frais (courtage) : la Bourse absorbe un peu des fortunes du salon.
 *
 * Tout ce fichier est pur : le serveur (server/bourseCasino.ts) tient les cours et les portefeuilles.
 */

export type IdAction = 'wagons' | 'champagne' | 'petroles' | 'radio' | 'acier' | 'diamants';
export const IDS_ACTIONS: IdAction[] = ['wagons', 'champagne', 'petroles', 'radio', 'acier', 'diamants'];
export const estAction = (x: unknown): x is IdAction => IDS_ACTIONS.includes(x as IdAction);

export const ACTIONS: Record<IdAction, { nom: string; court: string; reference: number; nervosite: number }> = {
  wagons: { nom: 'Wagons-Lits du Baron', court: 'WLB', reference: 1_000_000, nervosite: 0.012 },
  champagne: { nom: 'Champagne Maison Baron', court: 'CMB', reference: 500_000, nervosite: 0.016 },
  petroles: { nom: 'Pétroles d’Orient & Cie', court: 'POC', reference: 2_000_000, nervosite: 0.028 },
  radio: { nom: 'Radio Lumière', court: 'RLU', reference: 250_000, nervosite: 0.035 },
  acier: { nom: 'Aciéries Lambert', court: 'ACL', reference: 800_000, nervosite: 0.014 },
  diamants: { nom: 'Diamants du Cap', court: 'DDC', reference: 5_000_000, nervosite: 0.022 },
};

export const SEANCE_MS = 5 * 60_000;
export const HISTORIQUE_MAX = 96; // 8 heures de séances
export const NOUVELLES_MAX = 12;
export const FRAIS = 0.01;
/** Plancher et plafond d'un cours, en part de son cours de référence. */
export const PLANCHER = 0.1;
export const PLAFOND = 8;
/** Montants proposés à l'achat. */
export const MONTANTS_ACHAT = [1_000_000, 10_000_000, 100_000_000, 1_000_000_000];
/** Un portefeuille ne dépasse pas 100 000 actions d'un même titre. */
export const ACTIONS_MAX = 100_000;

export type TypeNouvelle = 'hausse' | 'baisse' | 'krach' | 'envolee';
export interface Nouvelle {
  t: number;
  type: TypeNouvelle;
  /** Le titre concerné (null : tout le marché). */
  action: IdAction | null;
  titre: [string, string];
  /** La variation appliquée (0,12 = +12 %). */
  variation: number;
}

export interface EtatBourse {
  /** Début de la dernière séance jouée. */
  seance: number;
  cours: Record<IdAction, number>;
  /** Les cours des dernières séances (le plus récent en dernier). */
  historique: Record<IdAction, number[]>;
  /** Cours à l'ouverture du jour (variation du jour). */
  ouverture: Record<IdAction, number>;
  jour: string;
  nouvelles: Nouvelle[];
}

export function etatBourseNeuf(t: number, jour: string): EtatBourse {
  const cours = Object.fromEntries(IDS_ACTIONS.map((a) => [a, ACTIONS[a].reference])) as Record<IdAction, number>;
  return { seance: t - (t % SEANCE_MS), cours, historique: Object.fromEntries(IDS_ACTIONS.map((a) => [a, [cours[a]]])) as Record<IdAction, number[]>, ouverture: { ...cours }, jour, nouvelles: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Les nouvelles du « Petit Baron »

const NOUVELLES_HAUSSE: Record<IdAction, [string, string][]> = {
  wagons: [['Nouvelle ligne Paris – Istanbul : les Wagons-Lits affichent complet !', 'New Paris – Istanbul line: the sleeping cars are fully booked!'], ['Le Train Bleu bat son record de vitesse', 'The Blue Train breaks its speed record']],
  champagne: [['La haute société ne boit plus que du Maison Baron', 'High society drinks nothing but Maison Baron'], ['Vendanges exceptionnelles en Champagne', 'Exceptional harvest in Champagne']],
  petroles: [['Un nouveau puits jaillit dans le désert !', 'A new well gushes in the desert!'], ['Les automobiles se multiplient : le pétrole flambe', 'Cars everywhere: oil prices soar']],
  radio: [['Chaque foyer veut son poste : Radio Lumière triomphe', 'Every home wants a set: Radio Lumière triumphs'], ['Radio Lumière diffuse le premier match en direct', 'Radio Lumière broadcasts the first live match']],
  acier: [['Gratte-ciel en chantier : les Aciéries Lambert tournent à plein', 'Skyscrapers rising: Lambert Steel at full capacity'], ['Grosse commande de rails pour les Aciéries Lambert', 'Huge rail order for Lambert Steel']],
  diamants: [['Une pierre géante découverte au Cap !', 'A giant stone discovered at the Cape!'], ['Les diamants, cadeau préféré des héritières', 'Diamonds, the heiresses’ favourite gift']],
};
const NOUVELLES_BAISSE: Record<IdAction, [string, string][]> = {
  wagons: [['Déraillement près de Venise : les Wagons-Lits trébuchent', 'Derailment near Venice: sleeping cars stumble'], ['Grève des cheminots !', 'Railway strike!']],
  champagne: [['La grêle ravage les vignes', 'Hail ravages the vineyards'], ['Des bouteilles frelatées sur le marché', 'Counterfeit bottles on the market']],
  petroles: [['Un puits s’assèche', 'A well runs dry'], ['Tempête sur les pétroliers', 'Storm hits the tankers']],
  radio: [['Panne géante : Radio Lumière muette toute la soirée', 'Huge outage: Radio Lumière silent all evening'], ['Un concurrent américain débarque', 'An American rival arrives']],
  acier: [['Accident à la fonderie Lambert', 'Accident at the Lambert foundry'], ['Les chantiers s’arrêtent faute de crédit', 'Building sites stall for lack of credit']],
  diamants: [['Un célèbre diamant se révèle faux', 'A famous diamond turns out to be fake'], ['La mine du Cap inondée', 'The Cape mine is flooded']],
};
const KRACHS: [string, string][] = [
  ['KRACH À LA BOURSE ! Panique dans la corbeille', 'MARKET CRASH! Panic on the trading floor'],
  ['Jeudi noir : tout s’effondre', 'Black Thursday: everything collapses'],
];
const ENVOLEES: [string, string][] = [
  ['LA BOURSE S’ENVOLE ! Les financiers jettent leur chapeau', 'THE MARKET SOARS! Financiers throw their hats'],
  ['Prospérité : les cours battent tous les records', 'Prosperity: prices break every record'],
];

const borne = (a: IdAction, v: number) => Math.round(Math.min(ACTIONS[a].reference * PLAFOND, Math.max(ACTIONS[a].reference * PLANCHER, v)));

/** Hasard réel entre 0 et 1 (fourni par le serveur). */
export type Alea = () => number;
const entre = (h: Alea, a: number, b: number) => a + (b - a) * h();
const choisir = <T,>(h: Alea, l: T[]) => l[Math.min(l.length - 1, Math.floor(h() * l.length))];

/**
 * Joue une séance : chaque titre bouge, et parfois une nouvelle tombe (12 % par séance : un titre ; 0,6 % : krach ;
 * 0,8 % : envolée). Le cours tend doucement vers sa référence (2 % de l'écart par séance).
 */
export function jouerSeance(e: EtatBourse, t: number, jour: string, h: Alea): Nouvelle | null {
  if (e.jour !== jour) {
    e.jour = jour;
    e.ouverture = { ...e.cours };
  }
  let nouvelle: Nouvelle | null = null;
  const x = h();
  if (x < 0.006) {
    const v = -entre(h, 0.25, 0.45);
    nouvelle = { t, type: 'krach', action: null, titre: choisir(h, KRACHS), variation: v };
  } else if (x < 0.014) {
    const v = entre(h, 0.15, 0.3);
    nouvelle = { t, type: 'envolee', action: null, titre: choisir(h, ENVOLEES), variation: v };
  } else if (x < 0.134) {
    const a = choisir(h, IDS_ACTIONS);
    const hausse = h() < 0.52;
    const v = (hausse ? 1 : -1) * entre(h, 0.06, 0.18);
    nouvelle = { t, type: hausse ? 'hausse' : 'baisse', action: a, titre: choisir(h, (hausse ? NOUVELLES_HAUSSE : NOUVELLES_BAISSE)[a]), variation: v };
  }
  for (const a of IDS_ACTIONS) {
    const c = e.cours[a];
    const ref = ACTIONS[a].reference;
    // Bruit (somme de deux tirages : plus souvent petit), rappel vers la référence, nouvelle éventuelle.
    const bruit = (h() + h() - 1) * ACTIONS[a].nervosite * 1.6;
    let v = c * (1 + bruit) + (ref - c) * 0.02;
    if (nouvelle && (nouvelle.action === null || nouvelle.action === a)) v *= 1 + nouvelle.variation * (nouvelle.action === null ? entre(h, 0.8, 1.15) : 1);
    e.cours[a] = borne(a, v);
    e.historique[a] = [...e.historique[a], e.cours[a]].slice(-HISTORIQUE_MAX);
  }
  e.seance = t - (t % SEANCE_MS);
  if (nouvelle) e.nouvelles = [nouvelle, ...e.nouvelles].slice(0, NOUVELLES_MAX);
  return nouvelle;
}

/** Les séances manquées (serveur endormi) : au plus 12 rattrapées, les autres ignorées. */
export function seancesEnRetard(e: EtatBourse, t: number): number {
  return Math.max(0, Math.min(12, Math.floor((t - e.seance) / SEANCE_MS)));
}

// ---------------------------------------------------------------------------------------------------------------
// Le portefeuille (gardé avec l'état du salon du joueur)

export interface Ligne {
  /** Nombre d'actions, et prix de revient total (frais compris). */
  n: number;
  cout: number;
}
export type Portefeuille = Partial<Record<IdAction, Ligne>>;

export const valeurPortefeuille = (p: Portefeuille | undefined, cours: Record<IdAction, number>) => IDS_ACTIONS.reduce((s, a) => s + (p?.[a]?.n ?? 0) * cours[a], 0);
export const coutPortefeuille = (p: Portefeuille | undefined) => IDS_ACTIONS.reduce((s, a) => s + (p?.[a]?.cout ?? 0), 0);

/** Un achat pour un montant donné : combien d'actions, et le prix total frais compris. */
export function devisAchat(cours: number, montant: number): { n: number; total: number } {
  const n = Math.floor(montant / (cours * (1 + FRAIS)));
  return { n, total: Math.ceil(n * cours * (1 + FRAIS)) };
}
/** Une vente : ce que rapportent n actions, frais déduits. */
export const produitVente = (cours: number, n: number) => Math.floor(n * cours * (1 - FRAIS));

export function acheter(p: Portefeuille, a: IdAction, n: number, total: number): Portefeuille {
  const l = p[a] ?? { n: 0, cout: 0 };
  return { ...p, [a]: { n: l.n + n, cout: l.cout + total } };
}
export function vendre(p: Portefeuille, a: IdAction, n: number): Portefeuille {
  const l = p[a];
  if (!l) return p;
  const reste = l.n - n;
  if (reste <= 0) {
    const q = { ...p };
    delete q[a];
    return q;
  }
  return { ...p, [a]: { n: reste, cout: Math.round((l.cout * reste) / l.n) } };
}

export function normaliserPortefeuille(v: unknown): Portefeuille {
  const p: Portefeuille = {};
  if (!v || typeof v !== 'object') return p;
  for (const [a, l] of Object.entries(v as Record<string, unknown>)) {
    if (!estAction(a) || !l || typeof l !== 'object') continue;
    const x = l as Record<string, unknown>;
    const n = typeof x.n === 'number' && Number.isFinite(x.n) ? Math.min(ACTIONS_MAX, Math.max(0, Math.floor(x.n))) : 0;
    const cout = typeof x.cout === 'number' && Number.isFinite(x.cout) ? Math.max(0, Math.floor(x.cout)) : 0;
    if (n > 0) p[a] = { n, cout };
  }
  return p;
}

export function normaliserEtatBourse(brut: unknown, t: number, jour: string): EtatBourse {
  const e = etatBourseNeuf(t, jour);
  if (!brut || typeof brut !== 'object') return e;
  const b = brut as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (num(b.seance)) e.seance = num(b.seance)!;
  if (typeof b.jour === 'string') e.jour = b.jour;
  for (const a of IDS_ACTIONS) {
    const c = num((b.cours as Record<string, unknown> | undefined)?.[a]);
    if (c) e.cours[a] = borne(a, c);
    const o = num((b.ouverture as Record<string, unknown> | undefined)?.[a]);
    e.ouverture[a] = o ? borne(a, o) : e.cours[a];
    const hist = (b.historique as Record<string, unknown> | undefined)?.[a];
    e.historique[a] = Array.isArray(hist) ? hist.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(-HISTORIQUE_MAX) : [e.cours[a]];
    if (!e.historique[a].length) e.historique[a] = [e.cours[a]];
  }
  if (Array.isArray(b.nouvelles))
    e.nouvelles = b.nouvelles
      .filter((n): n is Nouvelle => !!n && typeof n === 'object' && Array.isArray((n as Nouvelle).titre) && typeof (n as Nouvelle).type === 'string')
      .slice(0, NOUVELLES_MAX);
  return e;
}

// ---------------------------------------------------------------------------------------------------------------
// Vue (téléphone)

export interface VueBourse {
  cours: Record<IdAction, number>;
  ouverture: Record<IdAction, number>;
  historique: Record<IdAction, number[]>;
  nouvelles: Nouvelle[];
  /** Prochaine séance (ms). */
  prochaine: number;
  portefeuille: Portefeuille;
}
