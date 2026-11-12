/**
 * Les Coffres du Baron (Salon privé, nom de code « festin ») : chaque créateur joue sa propre partie, tenue par le
 * serveur.
 *
 * - « Lancer le casse » : la mise est débitée et les badges de police sont placés (crypto.randomInt). Le téléphone ne
 *   les voit jamais tant que la partie n'est pas finie.
 * - Ouvrir un coffre : un butin fait monter le multiplicateur ; un badge, et la partie est perdue (tout se dévoile).
 * - Encaisser (après au moins un butin) : la mise × le multiplicateur est créditée. Quand il ne reste plus que des
 *   badges (ou que le plafond est atteint), la partie s'encaisse d'elle-même.
 * - Une partie en cours attend le joueur s'il quitte l'écran ou perd le réseau : il la retrouve en revenant.
 */
import { randomInt } from 'node:crypto';
import type { Socket } from 'socket.io';
import { MULTIPLE_GROS_GAIN, type AnnonceCasino } from '../shared/casino';
import {
  badgesValides,
  COFFRES,
  gainCoffres,
  MISES_COFFRES,
  multiplicateurCoffres,
  placerBadges,
  X_MAX_COFFRES,
  type ContenuCoffre,
  type Hasard,
  type VueCoffres,
} from '../shared/festin';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

interface Partie {
  mise: number;
  badges: number;
  /** Positions des badges de police. */
  places: Set<number>;
  ouverts: number[];
  etat: 'enCours' | 'perdu' | 'encaisse';
  perdant: number | null;
  gain: number;
}

export interface OptionsCoffres {
  banque: BanqueCasino;
  hasard?: Hasard;
  /** Positions des badges imposées (tests, démonstration) ; au hasard sinon. */
  placer?: (badges: number) => number[] | undefined;
  annoncer: (a: AnnonceCasino) => void;
}

export function creerCoffres(options: OptionsCoffres) {
  const { banque } = options;
  const hasard = options.hasard ?? ((n: number) => randomInt(n));
  /** La partie de chaque joueur (la dernière, finie ou non). */
  const parties = new Map<string, Partie>();

  const butins = (p: Partie) => p.ouverts.filter((i) => !p.places.has(i)).length;

  function vue(p: Partie): VueCoffres {
    const fini = p.etat !== 'enCours';
    const n = butins(p);
    const x = multiplicateurCoffres(p.badges, n);
    const resteButins = COFFRES - p.badges - n;
    const coffres: (ContenuCoffre | null)[] = Array.from({ length: COFFRES }, (_, i) => (fini || p.ouverts.includes(i) ? (p.places.has(i) ? 'police' : 'butin') : null));
    return {
      mise: p.mise,
      badges: p.badges,
      coffres,
      ouverts: [...p.ouverts],
      etat: p.etat,
      butins: n,
      x,
      suivant: p.etat === 'enCours' && resteButins > 0 && x < X_MAX_COFFRES ? multiplicateurCoffres(p.badges, n + 1) : null,
      gain: p.etat === 'perdu' ? 0 : p.etat === 'encaisse' ? p.gain : n ? gainCoffres(p.mise, x) : 0,
      perdant: p.perdant,
    };
  }

  function encaisser(uid: string, p: Partie) {
    p.gain = gainCoffres(p.mise, multiplicateurCoffres(p.badges, butins(p)));
    p.etat = 'encaisse';
    banque.crediter(uid, p.gain);
    if (p.gain >= MULTIPLE_GROS_GAIN * p.mise) options.annoncer({ nom: banque.joueur(uid)?.nom ?? '', jeu: 'coffres', gain: p.gain });
  }

  function brancher(socket: Socket, ctx: { acces: (rappel: unknown) => Promise<Identite | null>; enSalon: (uid: string) => boolean; L: (fr: string, en: string) => string }) {
    const { L } = ctx;
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    const erreur = (rappel: unknown, fr: string, en: string) => repondre(rappel, { ok: false, erreur: L(fr, en) });
    /**
     * Le joueur, s'il est bien au salon ; sinon l'erreur est déjà envoyée. Après cette vérification, chaque geste se
     * joue d'un bloc (sans attente) : un double appui retombe sur « déjà ouvert » ou « aucune partie en cours ».
     */
    const joueur = async (rappel: unknown) => {
      const id = await ctx.acces(rappel);
      if (!id) return null;
      if (!ctx.enSalon(id.uid)) return erreur(rappel, 'Entre d’abord dans le salon.', 'Enter the lounge first.'), null;
      return id;
    };
    const envoyer = (rappel: unknown, uid: string, p: Partie | undefined) => repondre(rappel, { ok: true, coffres: p ? vue(p) : null, solde: banque.solde(uid) });

    socket.on('casino_coffres_vue', async (_data: unknown, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      envoyer(rappel, id.uid, parties.get(id.uid));
    });

    socket.on('casino_coffres_lancer', async (data: { mise?: unknown; badges?: unknown } = {}, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      if (parties.get(id.uid)?.etat === 'enCours') return erreur(rappel, 'Termine d’abord ta partie en cours.', 'Finish your current game first.');
      const mise = Number(data?.mise);
      const badges = Number(data?.badges);
      if (!MISES_COFFRES.includes(mise)) return erreur(rappel, 'Mise impossible.', 'Invalid bet.');
      if (!badgesValides(badges)) return erreur(rappel, 'Choisis de 1 à 24 badges de police.', 'Pick 1 to 24 police badges.');
      if (!banque.debiter(id.uid, mise)) return erreur(rappel, 'Solde insuffisant pour cette mise.', 'Not enough money for this bet.');
      const imposees = options.placer?.(badges);
      const places = imposees && imposees.length === badges ? imposees : placerBadges(hasard, badges);
      const p: Partie = { mise, badges, places: new Set(places), ouverts: [], etat: 'enCours', perdant: null, gain: 0 };
      parties.set(id.uid, p);
      envoyer(rappel, id.uid, p);
    });

    socket.on('casino_coffres_ouvrir', async (data: { index?: unknown } = {}, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      const p = parties.get(id.uid);
      if (!p || p.etat !== 'enCours') return erreur(rappel, 'Aucune partie en cours.', 'No game in progress.');
      const i = Number(data?.index);
      if (!Number.isInteger(i) || i < 0 || i >= COFFRES) return erreur(rappel, 'Coffre introuvable.', 'Unknown safe.');
      if (p.ouverts.includes(i)) return erreur(rappel, 'Ce coffre est déjà ouvert.', 'This safe is already open.');
      p.ouverts.push(i);
      if (p.places.has(i)) {
        p.etat = 'perdu';
        p.perdant = i;
      } else {
        const n = butins(p);
        // Plus aucun butin dans les coffres, ou le plafond atteint : la partie s'encaisse d'elle-même.
        if (n === COFFRES - p.badges || multiplicateurCoffres(p.badges, n) >= X_MAX_COFFRES) encaisser(id.uid, p);
      }
      envoyer(rappel, id.uid, p);
    });

    socket.on('casino_coffres_encaisser', async (_data: unknown, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      const p = parties.get(id.uid);
      if (!p || p.etat !== 'enCours') return erreur(rappel, 'Aucune partie en cours.', 'No game in progress.');
      if (!butins(p)) return erreur(rappel, 'Ouvre au moins un coffre avant d’encaisser.', 'Open at least one safe before cashing out.');
      encaisser(id.uid, p);
      envoyer(rappel, id.uid, p);
    });
  }

  /** Une partie est-elle en cours pour ce joueur ? (le salon l'affiche sur la vignette) */
  const enCours = (uid: string) => parties.get(uid)?.etat === 'enCours';

  /** Arrêt du serveur : une partie pas finie est annulée et sa mise rendue (le joueur la rejouera). */
  const rendreMisesEnCours = () => {
    for (const [uid, p] of parties) {
      if (p.etat !== 'enCours') continue;
      banque.rembourser(uid, p.mise);
      parties.delete(uid);
    }
  };

  return { brancher, enCours, rendreMisesEnCours };
}
