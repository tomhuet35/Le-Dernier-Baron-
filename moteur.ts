import { CARTES, EVENEMENT, EVENEMENTS } from './cartes';
import {
  BONUS_BARON_PAR_HOMME_DE_MAIN,
  MAX_JOUEURS,
  MIN_JOUEURS,
  NB_NUITS,
  NUITS_AVEC_EVENEMENT,
  TAILLE_JOURNAL,
} from './config';
import { allianceReussiePour, calculerScore, carte, cartesJouables, resoudrePli } from './regles';
import { melanger, suivant } from './rng';
import type { Action, BilanNuit, EtatPartie, JoueurPartie, Resultat } from './types';

const NOMS_EVENEMENTS: Record<string, string> = {
  descente_police: 'Descente de police',
  trahison: 'Trahison',
  casse_du_siecle: 'Casse du siècle',
  couvre_feu: 'Couvre-feu',
  alliance: 'Alliance',
};

function nom(e: EtatPartie, id: string): string {
  return e.joueurs.find((j) => j.id === id)?.nom ?? '?';
}

function siege(e: EtatPartie, id: string): number {
  return e.joueurs.findIndex((j) => j.id === id);
}

function noter(e: EtatPartie, texte: string) {
  e.compteurJournal += 1;
  e.journal.push({ n: e.compteurJournal, texte });
  if (e.journal.length > TAILLE_JOURNAL) e.journal.splice(0, e.journal.length - TAILLE_JOURNAL);
}

function nomCarte(id: string, valeurCroupier?: 0 | 11): string {
  const c = carte(id);
  return c.speciale === 'croupier' && valeurCroupier !== undefined ? `${c.nom} (${valeurCroupier})` : c.nom;
}

/** Crée une partie et distribue la première nuit. La graine rend la partie rejouable (tests). */
export function creerPartie(joueurs: JoueurPartie[], graine: number): EtatPartie {
  if (joueurs.length < MIN_JOUEURS || joueurs.length > MAX_JOUEURS) {
    throw new Error(`Il faut entre ${MIN_JOUEURS} et ${MAX_JOUEURS} joueurs.`);
  }
  let rng = graine >>> 0 || 1;
  const [pioche, r1] = melanger(
    EVENEMENTS.map((ev) => ev.id),
    rng,
  );
  const [x, r2] = suivant(r1);
  rng = r2;
  const premier = Math.floor(x * joueurs.length);
  const vide = <T>(v: T) => Object.fromEntries(joueurs.map((j) => [j.id, v])) as Record<string, T>;
  const e: EtatPartie = {
    joueurs: joueurs.map((j) => ({ id: j.id, nom: j.nom })),
    nuit: 1,
    premier,
    phase: 'ANNONCES',
    rng,
    mains: vide<string[]>([]),
    piocheEvenements: pioche,
    evenement: null,
    evenementId: null,
    annonces: vide<number | null>(null),
    annoncesRevelees: false,
    choixTrahison: {},
    choixAlliance: {},
    alliances: [],
    pli: [],
    ouvreur: premier,
    tour: premier,
    plis: vide(0),
    butins: vide<string[]>([]),
    bonusBaron: vide(0),
    braquages: vide(0),
    vol: null,
    dernierPli: null,
    nbPlisJoues: 0,
    scores: vide(0),
    bilans: [],
    prets: {},
    journal: [],
    compteurJournal: 0,
  };
  noter(e, `La partie commence. ${nom(e, joueurs[premier].id)} est le premier joueur.`);
  demarrerNuit(e);
  return e;
}

function demarrerNuit(e: EtatPartie) {
  const n = e.nuit;
  const [paquet, r] = melanger(
    CARTES.map((c) => c.id),
    e.rng,
  );
  e.rng = r;
  const nb = e.joueurs.length;
  for (let k = 0; k < nb; k++) {
    const j = e.joueurs[(e.premier + k) % nb];
    e.mains[j.id] = paquet.slice(k * n, (k + 1) * n);
    e.annonces[j.id] = null;
    e.plis[j.id] = 0;
    e.butins[j.id] = [];
    e.bonusBaron[j.id] = 0;
    e.braquages[j.id] = 0;
  }
  e.annoncesRevelees = false;
  e.choixTrahison = {};
  e.choixAlliance = {};
  e.alliances = [];
  e.pli = [];
  e.ouvreur = e.premier;
  e.tour = e.premier;
  e.vol = null;
  e.dernierPli = null;
  e.nbPlisJoues = 0;
  e.prets = {};
  e.evenement = null;
  e.evenementId = null;
  const premierNom = nom(e, e.joueurs[e.premier].id);
  if (NUITS_AVEC_EVENEMENT.includes(n) && e.piocheEvenements.length) {
    const id = e.piocheEvenements.shift() as string;
    e.evenementId = id;
    e.evenement = EVENEMENT[id].evenement;
    noter(e, `Nuit ${n} : ${n} cartes chacun. Événement : ${NOMS_EVENEMENTS[e.evenement]}. ${premierNom} ouvre la nuit.`);
  } else {
    noter(e, `Nuit ${n} : ${n} carte${n > 1 ? 's' : ''} chacun, pas d'événement. ${premierNom} ouvre la nuit.`);
  }
  e.phase = 'ANNONCES';
}

/** Joueurs dont la partie attend une action. */
export function attenteDe(e: EtatPartie): string[] {
  const ids = e.joueurs.map((j) => j.id);
  switch (e.phase) {
    case 'TRAHISON':
      return ids.filter((id) => !(id in e.choixTrahison));
    case 'ANNONCES':
      return ids.filter((id) => e.annonces[id] === null);
    case 'ALLIANCE':
      return ids.filter((id) => !(id in e.choixAlliance));
    case 'PLI':
      return [e.joueurs[e.tour].id];
    case 'VOL':
      return e.vol ? [e.vol.voleurId] : [];
    case 'FIN_DE_NUIT':
      return ids.filter((id) => !e.prets[id]);
    default:
      return [];
  }
}

/** Un vol a-t-il un intérêt ? (pas de Descente de police et au moins un adversaire avec du butin) */
export function volPossible(e: EtatPartie, voleurId: string): boolean {
  if (e.evenement === 'descente_police') return false;
  return e.joueurs.some((j) => j.id !== voleurId && e.butins[j.id].length > 0);
}

/** Applique une action. L'état reçu n'est jamais modifié. */
export function appliquerAction(etat: EtatPartie, action: Action): Resultat {
  const e = structuredClone(etat);
  try {
    const erreur = traiter(e, action);
    return erreur ? { ok: false, erreur } : { ok: true, etat: e };
  } catch (x) {
    return { ok: false, erreur: x instanceof Error ? x.message : String(x) };
  }
}

function estJoueur(e: EtatPartie, id: unknown): id is string {
  return typeof id === 'string' && e.joueurs.some((j) => j.id === id);
}

function traiter(e: EtatPartie, a: Action): string | null {
  switch (a.type) {
    case 'TRAHISON': {
      if (e.phase !== 'TRAHISON') return "Ce n'est pas le moment de passer une carte.";
      if (!estJoueur(e, a.joueurId)) return 'Joueur inconnu.';
      if (a.joueurId in e.choixTrahison) return 'Tu as déjà choisi ta carte.';
      if (!e.mains[a.joueurId].includes(a.carteId)) return "Cette carte n'est pas dans ta main.";
      e.choixTrahison[a.joueurId] = a.carteId;
      if (attenteDe(e).length === 0) {
        const nb = e.joueurs.length;
        for (const j of e.joueurs) e.mains[j.id] = e.mains[j.id].filter((c) => c !== e.choixTrahison[j.id]);
        // Chacun donne sa carte au joueur de droite, c'est-à-dire au joueur précédent dans l'ordre du tour.
        e.joueurs.forEach((j, i) => e.mains[e.joueurs[(i - 1 + nb) % nb].id].push(e.choixTrahison[j.id]));
        noter(e, 'Trahison : chacun a passé une carte au joueur de droite.');
        commencerPlis(e);
      }
      return null;
    }
    case 'ANNONCE': {
      if (e.phase !== 'ANNONCES') return "Ce n'est pas le moment d'annoncer.";
      if (!estJoueur(e, a.joueurId)) return 'Joueur inconnu.';
      if (e.annonces[a.joueurId] !== null) return 'Tu as déjà annoncé.';
      if (!Number.isInteger(a.valeur) || a.valeur < 0 || a.valeur > e.nuit) {
        return `L'annonce doit être comprise entre 0 et ${e.nuit}.`;
      }
      e.annonces[a.joueurId] = a.valeur;
      if (attenteDe(e).length === 0) {
        e.annoncesRevelees = true;
        const total = e.joueurs.reduce((s, j) => s + (e.annonces[j.id] ?? 0), 0);
        const liste = e.joueurs.map((j) => `${j.nom} ${e.annonces[j.id]}`).join(', ');
        noter(e, `Annonces : ${liste} (total ${total} pour ${e.nuit} pli${e.nuit > 1 ? 's' : ''}).`);
        if (e.evenement === 'alliance') e.phase = 'ALLIANCE';
        else if (e.evenement === 'trahison') e.phase = 'TRAHISON';
        else commencerPlis(e);
      }
      return null;
    }
    case 'ALLIANCE': {
      if (e.phase !== 'ALLIANCE') return "Ce n'est pas le moment de choisir un allié.";
      if (!estJoueur(e, a.joueurId)) return 'Joueur inconnu.';
      if (a.joueurId in e.choixAlliance) return 'Tu as déjà choisi.';
      if (a.allieId !== null && (!estJoueur(e, a.allieId) || a.allieId === a.joueurId)) return 'Allié invalide.';
      e.choixAlliance[a.joueurId] = a.allieId;
      if (attenteDe(e).length === 0) {
        const ids = e.joueurs.map((j) => j.id);
        for (let i = 0; i < ids.length; i++) {
          for (let k = i + 1; k < ids.length; k++) {
            if (e.choixAlliance[ids[i]] === ids[k] && e.choixAlliance[ids[k]] === ids[i]) e.alliances.push([ids[i], ids[k]]);
          }
        }
        noter(
          e,
          e.alliances.length
            ? `Alliance : ${e.alliances.map(([x, y]) => `${nom(e, x)} et ${nom(e, y)}`).join(' ; ')}.`
            : 'Alliance : aucun choix réciproque, personne n’est allié.',
        );
        commencerPlis(e);
      }
      return null;
    }
    case 'JOUER': {
      if (e.phase !== 'PLI') return "Ce n'est pas le moment de jouer une carte.";
      if (e.joueurs[e.tour].id !== a.joueurId) return "Ce n'est pas ton tour.";
      const main = e.mains[a.joueurId];
      if (!main.includes(a.carteId)) return "Cette carte n'est pas dans ta main.";
      if (!cartesJouables(main, e.pli).includes(a.carteId)) return 'Tu dois suivre la famille demandée.';
      const c = carte(a.carteId);
      let valeurCroupier: 0 | 11 | undefined;
      if (c.speciale === 'croupier') {
        if (a.valeurCroupier !== 0 && a.valeurCroupier !== 11) return 'Choisis la valeur du Croupier : 0 ou 11.';
        valeurCroupier = a.valeurCroupier;
      }
      e.mains[a.joueurId] = main.filter((x) => x !== a.carteId);
      e.pli.push(valeurCroupier === undefined ? { joueurId: a.joueurId, carteId: a.carteId } : { joueurId: a.joueurId, carteId: a.carteId, valeurCroupier });
      noter(e, `${nom(e, a.joueurId)} joue ${nomCarte(a.carteId, valeurCroupier)}.`);
      if (c.speciale === 'pickpocket') {
        if (volPossible(e, a.joueurId)) {
          e.vol = { voleurId: a.joueurId, source: 'pickpocket' };
          e.phase = 'VOL';
          return null;
        }
        noter(e, e.evenement === 'descente_police' ? 'Descente de police : le Pickpocket ne peut rien voler.' : 'Pickpocket : aucun butin à voler pour le moment.');
      }
      apresPose(e);
      return null;
    }
    case 'VOLER': {
      if (e.phase !== 'VOL' || !e.vol) return "Ce n'est pas le moment de voler.";
      if (e.vol.voleurId !== a.joueurId) return "Ce n'est pas à toi de voler.";
      if (a.cibleId === null) noter(e, `${nom(e, a.joueurId)} renonce à voler.`);
      else {
        if (!estJoueur(e, a.cibleId) || a.cibleId === a.joueurId) return 'Cible invalide.';
        resoudreVol(e, a.joueurId, a.cibleId, a.carteId);
      }
      const source = e.vol.source;
      e.vol = null;
      if (source === 'pickpocket') {
        e.phase = 'PLI';
        apresPose(e);
      } else e.phase = 'FIN_DE_PLI';
      return null;
    }
    case 'SUITE': {
      if (e.phase !== 'FIN_DE_PLI') return 'Rien à poursuivre.';
      if (e.nbPlisJoues >= e.nuit) finNuit(e);
      else {
        e.phase = 'PLI';
        e.tour = e.ouvreur;
      }
      return null;
    }
    case 'CONTINUER': {
      if (e.phase !== 'FIN_DE_NUIT') return 'Rien à poursuivre.';
      if (!estJoueur(e, a.joueurId)) return 'Joueur inconnu.';
      e.prets[a.joueurId] = true;
      if (attenteDe(e).length === 0) nuitSuivante(e);
      return null;
    }
    case 'FORCER_SUITE': {
      if (e.phase !== 'FIN_DE_NUIT') return 'Rien à poursuivre.';
      nuitSuivante(e);
      return null;
    }
    default:
      return 'Action inconnue.';
  }
}

function commencerPlis(e: EtatPartie) {
  e.phase = 'PLI';
  e.ouvreur = e.premier;
  e.tour = e.premier;
}

function apresPose(e: EtatPartie) {
  if (e.pli.length === e.joueurs.length) terminerPli(e);
  else {
    e.tour = (e.tour + 1) % e.joueurs.length;
    e.phase = 'PLI';
  }
}

function terminerPli(e: EtatPartie) {
  const r = resoudrePli(e.pli);
  const gagnantId = e.pli[r.gagnant].joueurId;
  const butinId = r.butin !== null ? e.pli[r.butin].carteId : null;
  e.plis[gagnantId] += 1;
  e.nbPlisJoues += 1;
  if (butinId) e.butins[gagnantId].push(butinId);
  if (r.braquage) e.braquages[gagnantId] += 1;
  if (r.hommesDeMainCaptures > 0) e.bonusBaron[gagnantId] += BONUS_BARON_PAR_HOMME_DE_MAIN ? r.hommesDeMainCaptures : 1;
  e.dernierPli = { cartes: e.pli, gagnantId, butinId, braquage: r.braquage };
  noter(
    e,
    `${nom(e, gagnantId)} remporte le pli${r.braquage ? ' : Braquage !' : ''}${butinId ? ` et garde ${nomCarte(butinId)} en butin.` : '.'}`,
  );
  e.pli = [];
  e.ouvreur = siege(e, gagnantId);
  const baronGagne = r.regle === 'baron';
  if (baronGagne && volPossible(e, gagnantId)) {
    e.vol = { voleurId: gagnantId, source: 'baron' };
    e.phase = 'VOL';
  } else e.phase = 'FIN_DE_PLI';
}

function resoudreVol(e: EtatPartie, voleurId: string, cibleId: string, carteId?: string) {
  const voleur = nom(e, voleurId);
  const cible = nom(e, cibleId);
  if (e.evenement === 'descente_police') {
    noter(e, 'Descente de police : aucun vol cette nuit.');
    return;
  }
  const butin = e.butins[cibleId];
  if (butin.length === 0) {
    noter(e, `${voleur} tente de voler ${cible}, qui n'a pas de butin.`);
    return;
  }
  const alibi = e.mains[cibleId].some((id) => carte(id).speciale === 'alibi');
  if (alibi && e.evenement !== 'couvre_feu') {
    noter(e, `${voleur} tente de voler ${cible} : protégé par un Alibi !`);
    return;
  }
  const prise =
    carteId && butin.includes(carteId)
      ? carteId
      : butin.reduce((m, id) => ((carte(id).valeur ?? 0) > (carte(m).valeur ?? 0) ? id : m), butin[0]);
  e.butins[cibleId] = butin.filter((id) => id !== prise);
  e.butins[voleurId].push(prise);
  noter(e, `${voleur} vole ${nomCarte(prise)} à ${cible}.`);
}

function finNuit(e: EtatPartie) {
  const reussites = Object.fromEntries(e.joueurs.map((j) => [j.id, e.plis[j.id] === e.annonces[j.id]]));
  const bilan: BilanNuit = { nuit: e.nuit, evenement: e.evenement, scores: [] };
  for (const j of e.joueurs) {
    const s = calculerScore({
      nuit: e.nuit,
      annonce: e.annonces[j.id] ?? 0,
      plis: e.plis[j.id],
      butin: e.butins[j.id].map((id) => carte(id).valeur ?? 0),
      evenement: e.evenement,
      bonusBaron: e.bonusBaron[j.id],
      braquages: e.braquages[j.id],
      allianceReussie: allianceReussiePour(j.id, e.alliances, reussites),
    });
    e.scores[j.id] += s.total;
    bilan.scores.push({ joueurId: j.id, annonce: e.annonces[j.id] ?? 0, plis: e.plis[j.id], ...s });
  }
  e.bilans.push(bilan);
  e.prets = {};
  e.phase = 'FIN_DE_NUIT';
  noter(e, `Fin de la nuit ${e.nuit}.`);
}

function nuitSuivante(e: EtatPartie) {
  if (e.nuit >= NB_NUITS) {
    e.phase = 'FIN_DE_PARTIE';
    const max = Math.max(...e.joueurs.map((j) => e.scores[j.id]));
    const gagnants = e.joueurs.filter((j) => e.scores[j.id] === max).map((j) => j.nom);
    noter(e, `Fin de la partie. ${gagnants.join(' et ')} ${gagnants.length > 1 ? 'deviennent' : 'devient'} le Dernier Baron avec ${max} points.`);
    return;
  }
  e.nuit += 1;
  e.premier = (e.premier + 1) % e.joueurs.length;
  demarrerNuit(e);
}
