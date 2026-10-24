import { CARTE } from './cartes';
import { resoudrePli } from './regles';
import type { Action, CartePosee, NiveauBot, ProfilBot, StyleBot, Vue } from './types';

export type { NiveauBot, ProfilBot, StyleBot };

/**
 * Joueurs automatiques (bots). Ils ne connaissent que leur Vue, exactement comme un joueur humain :
 * aucune triche possible. Chaque bot a un niveau (qualité de jeu) et un style (façon de jouer).
 */

export const NIVEAUX_BOT: NiveauBot[] = ['debutant', 'confirme', 'expert'];
export const STYLES_BOT: StyleBot[] = ['equilibre', 'prudent', 'audacieux', 'voleur'];
export const NOM_NIVEAU_BOT: Record<NiveauBot, string> = { debutant: 'Débutant', confirme: 'Confirmé', expert: 'Expert' };
export const NOM_STYLE_BOT: Record<StyleBot, string> = { equilibre: 'Équilibré', prudent: 'Prudent', audacieux: 'Audacieux', voleur: 'Voleur' };
export const DESCRIPTION_STYLE_BOT: Record<StyleBot, string> = {
  equilibre: 'Annonce ce que sa main vaut, ni plus ni moins.',
  prudent: 'Annonce peu et aime viser zéro pli quand sa main est faible.',
  audacieux: 'Annonce large et sort ses grosses cartes tôt.',
  voleur: 'Vise le butin : Pickpocket dès que possible et vole toujours la plus belle carte.',
};
export const DESCRIPTION_NIVEAU_BOT: Record<NiveauBot, string> = {
  debutant: 'Joue souvent au hasard et se trompe dans ses annonces.',
  confirme: 'Joue correctement, avec quelques erreurs.',
  expert: 'Compte les plis, garde ses atouts et joue au plus juste.',
};

/** Prénoms donnés aux bots (ils restent signalés comme joueurs ordinateur). */
export const PRENOMS_BOTS = [
  'Cyrielle', 'Greg', 'Malik', 'Inès', 'Hugo', 'Sofia', 'Kenji', 'Lucia', 'Bastien', 'Amara',
  'Yanis', 'Clara', 'Diego', 'Nora', 'Théo', 'Léa', 'Omar', 'Emma', 'Jonas', 'Maëlle',
  'Paolo', 'Aïcha', 'Lukas', 'Ravi', 'Elena', 'Samir', 'Zoé', 'Mateo', 'Jade', 'Hannah',
];

/** Profil utilisé quand l'ordinateur remplace un joueur absent ou trop lent. */
export const PROFIL_REMPLACANT: ProfilBot = { niveau: 'confirme', style: 'equilibre' };

/** Ordinateurs d'une table publique : plus forts aux tables de haut niveau. */
export function profilPourTranche(tranche: number, alea: () => number = Math.random): ProfilBot {
  const r = alea();
  const seuils: [number, number][] = [
    [0.55, 0.95], // débutants : surtout des ordinateurs débutants
    [0.2, 0.8],
    [0.05, 0.5],
    [0, 0.2], // barons : surtout des experts
  ];
  const [d, c] = seuils[Math.min(Math.max(tranche, 0), 3)];
  const niveau: NiveauBot = r < d ? 'debutant' : r < c ? 'confirme' : 'expert';
  return { niveau, style: STYLES_BOT[Math.floor(alea() * STYLES_BOT.length)] };
}

export function profilAleatoire(alea: () => number = Math.random): ProfilBot {
  const r = alea();
  const niveau: NiveauBot = r < 0.3 ? 'debutant' : r < 0.75 ? 'confirme' : 'expert';
  return { niveau, style: STYLES_BOT[Math.floor(alea() * STYLES_BOT.length)] };
}

const ERREUR: Record<NiveauBot, number> = { debutant: 0.45, confirme: 0.2, expert: 0 };

/** Chance qu'une carte remporte un pli, pour estimer l'annonce (mesurée sur des milliers de plis entre bots experts). */
function chanceEnMain(id: string): number {
  const c = CARTE[id];
  switch (c.speciale) {
    case 'baron':
      return 0.83;
    case 'homme_de_main':
      return 0.85;
    case 'croupier':
      return 0.21;
    case 'pickpocket':
      return 0.13;
    case 'juge':
    case 'alibi':
      return 0;
  }
  const v = c.valeur ?? 0;
  if (c.type === 'atout') return 0.44 + 0.01 * v;
  return 0.065 + 0.015 * v;
}

/** Résistance d'une carte gagnante face aux joueurs qui doivent encore jouer (0 à 1). */
function resistance(p: CartePosee, regle: string): number {
  const c = CARTE[p.carteId];
  if (regle === 'juge') return 0.55;
  if (c.speciale === 'baron') return 0.97;
  if (c.speciale === 'homme_de_main') return 0.9;
  if (c.speciale === 'pickpocket') return regle === 'braquage' ? 0.97 : 0.3;
  if (c.speciale === 'croupier') return (p.valeurCroupier ?? 0) === 11 ? 0.93 : 0.4;
  const v = c.valeur ?? 0;
  if (c.type === 'atout') return Math.min(0.97, 0.75 + 0.025 * v);
  return regle === 'ouvreur' ? 0.3 : 0.55 + 0.04 * v;
}

/** « Coût » d'une carte : plus elle est forte, plus on préfère la garder pour plus tard. */
function puissance(p: CartePosee): number {
  const c = CARTE[p.carteId];
  if (c.speciale === 'croupier') return 0.5;
  if (c.speciale === 'alibi') return 0.05;
  return chanceEnMain(p.carteId) + (c.valeur ?? 0) * 0.005;
}

interface Option {
  pose: CartePosee;
  gagne: number; // probabilité estimée de remporter le pli
  cout: number;
}

function options(v: Vue, ids: string[]): Option[] {
  const n = v.joueurs.length;
  const apresMoi = n - v.pli.length - 1;
  const res: Option[] = [];
  for (const id of ids) {
    const valeurs: (0 | 11 | undefined)[] = CARTE[id].speciale === 'croupier' ? [0, 11] : [undefined];
    for (const valeurCroupier of valeurs) {
      const pose: CartePosee = valeurCroupier === undefined ? { joueurId: v.moi, carteId: id } : { joueurId: v.moi, carteId: id, valeurCroupier };
      const pli = [...v.pli, pose];
      const r = resoudrePli(pli);
      const gagneMaintenant = pli[r.gagnant].joueurId === v.moi;
      const gagne = gagneMaintenant ? (apresMoi === 0 ? 1 : resistance(pose, r.regle) ** apresMoi) : 0;
      res.push({ pose, gagne, cout: puissance(pose) });
    }
  }
  return res;
}

function versAction(v: Vue, o: Option): Action {
  return o.pose.valeurCroupier === undefined
    ? { type: 'JOUER', joueurId: v.moi, carteId: o.pose.carteId }
    : { type: 'JOUER', joueurId: v.moi, carteId: o.pose.carteId, valeurCroupier: o.pose.valeurCroupier };
}

function choisirCarte(v: Vue, profil: ProfilBot, alea: () => number): Action | null {
  const jouables = v.main.filter((c) => c.jouable).map((c) => c.id);
  if (!jouables.length) return null;
  const opts = options(v, jouables);
  if (alea() < ERREUR[profil.niveau]) return versAction(v, opts[Math.floor(alea() * opts.length)]);

  const moi = v.joueurs.find((j) => j.id === v.moi);
  const besoin = (v.monAnnonce ?? 0) - (moi?.plis ?? 0);
  const veutGagner = besoin > 0;
  const toutGagner = besoin >= v.main.length; // il faut remporter tous les plis restants
  const butinAdverse = v.joueurs.some((j) => j.id !== v.moi && j.butin.length > 0);
  const garderAlibi = (moi?.butin.length ?? 0) > 0 && v.evenement !== 'couvre_feu';

  const note = (o: Option): number => {
    const c = CARTE[o.pose.carteId];
    let s: number;
    if (veutGagner) {
      // Gagner, mais avec la carte la moins précieuse possible (sauf s'il faut tout rafler).
      s = o.gagne - (toutGagner ? 0 : 0.18 * o.cout);
      if (profil.style === 'audacieux') s += 0.08 * o.cout;
      // Le voleur se bat davantage pour un pli riche en butin.
      if (profil.style === 'voleur' && o.gagne > 0) s += 0.02 * Math.max(0, ...v.pli.map((p) => (CARTE[p.carteId].type === 'gang' ? (CARTE[p.carteId].valeur ?? 0) : 0)));
    } else {
      // Perdre le pli en se débarrassant des cartes dangereuses.
      s = -o.gagne * 2 + (profil.niveau === 'expert' ? 0.25 : 0.1) * o.cout;
    }
    if (c.speciale === 'alibi' && garderAlibi) s -= 0.3;
    if (c.speciale === 'pickpocket' && butinAdverse && v.evenement !== 'descente_police') s += profil.style === 'voleur' ? 0.6 : 0.1;
    return s;
  };
  let meilleure = opts[0];
  for (const o of opts.slice(1)) if (note(o) > note(meilleure)) meilleure = o;
  return versAction(v, meilleure);
}

function annoncer(v: Vue, profil: ProfilBot, alea: () => number): number {
  const n = v.joueurs.length;
  // Une main moyenne vaut sa part des plis de la nuit (nuit / nombre de joueurs).
  const facteur = 1 / (0.235 * n);
  let attendu = v.main.reduce((s, c) => s + chanceEnMain(c.id), 0) * facteur;
  let seuilZero = 0.55;
  if (profil.style === 'prudent') {
    attendu *= 0.78;
    seuilZero = 0.75;
  } else if (profil.style === 'audacieux') {
    attendu = attendu * 1.05 + 0.1;
    seuilZero = 0.35;
  } else attendu *= 0.9;
  let valeur = attendu < seuilZero ? 0 : Math.max(1, Math.round(attendu));
  if (alea() < (profil.niveau === 'debutant' ? 0.5 : profil.niveau === 'confirme' ? 0.2 : 0)) valeur += alea() < 0.5 ? -1 : 1;
  return Math.max(0, Math.min(v.nuit, valeur));
}

export function actionRobot(v: Vue, alea: () => number = Math.random, profil: ProfilBot = PROFIL_REMPLACANT): Action | null {
  const moi = v.moi;
  if (!v.attente.includes(moi)) return null;
  const auHasard = <T>(t: T[]): T => t[Math.floor(alea() * t.length)];
  const hasard = alea() < ERREUR[profil.niveau];
  switch (v.phase) {
    case 'TRAHISON': {
      if (!v.main.length) return null;
      if (hasard) return { type: 'TRAHISON', joueurId: moi, carteId: auHasard(v.main).id };
      // On donne sa plus mauvaise carte si on veut des plis, sa plus forte sinon.
      const veutGagner = (v.monAnnonce ?? 0) > 0;
      const triees = [...v.main].sort((a, b) => chanceEnMain(a.id) - chanceEnMain(b.id));
      const carte = veutGagner ? triees[0] : triees[triees.length - 1];
      return { type: 'TRAHISON', joueurId: moi, carteId: carte.id };
    }
    case 'ANNONCES':
      return { type: 'ANNONCE', joueurId: moi, valeur: annoncer(v, profil, alea) };
    case 'ALLIANCE': {
      const autres = v.joueurs.filter((j) => j.id !== moi);
      if (hasard || alea() < (profil.style === 'prudent' ? 0.3 : 0.1)) return { type: 'ALLIANCE', joueurId: moi, allieId: alea() < 0.3 ? null : auHasard(autres).id };
      // Allié le plus « raisonnable » : son annonce est proche de la moyenne attendue.
      const moyenne = v.nuit / v.joueurs.length;
      const ecart = (a: number | null) => Math.abs((a ?? moyenne) - moyenne) + alea() * 0.3;
      const allie = [...autres].sort((a, b) => ecart(a.annonce) - ecart(b.annonce))[0];
      return { type: 'ALLIANCE', joueurId: moi, allieId: allie.id };
    }
    case 'PLI':
      return choisirCarte(v, profil, alea);
    case 'VOL': {
      const cibles = v.joueurs.filter((j) => j.id !== moi && j.butin.length > 0);
      if (!cibles.length) return { type: 'VOLER', joueurId: moi, cibleId: null };
      const plusBelle = (ids: string[]) => ids.reduce((m, id) => ((CARTE[id].valeur ?? 0) > (CARTE[m].valeur ?? 0) ? id : m));
      if (hasard) {
        const cible = auHasard(cibles);
        return { type: 'VOLER', joueurId: moi, cibleId: cible.id, carteId: plusBelle(cible.butin) };
      }
      // La plus belle carte de butin ; à égalité, chez le joueur qui mène.
      const cible = [...cibles].sort(
        (a, b) => (CARTE[plusBelle(b.butin)].valeur ?? 0) - (CARTE[plusBelle(a.butin)].valeur ?? 0) || b.score - a.score,
      )[0];
      return { type: 'VOLER', joueurId: moi, cibleId: cible.id, carteId: plusBelle(cible.butin) };
    }
    case 'FIN_DE_NUIT':
      return { type: 'CONTINUER', joueurId: moi };
    default:
      return null;
  }
}
