/**
 * Sur les toits (Salon privé, au Bar) : chaque créateur joue sa propre partie, tenue par le serveur.
 *
 * - « Monter sur le toit » : la mise est débitée.
 * - Sauter : le serveur tire le saut (crypto.randomInt) ; réussi, le multiplicateur monte ; raté (tunnel, attelage), la
 *   partie est perdue. Au dernier saut (le fourgon), la partie s'encaisse d'elle-même.
 * - Encaisser (après au moins un saut réussi) : la mise × le multiplicateur est créditée.
 * - Une partie en cours attend le joueur s'il quitte l'écran ou perd le réseau : il la retrouve en revenant.
 */
import { randomInt } from 'node:crypto';
import type { Socket } from 'socket.io';
import { MULTIPLE_GROS_GAIN, type AnnonceCasino } from '../shared/casino';
import { gainToits, MISES_TOITS, multiplicateurToits, niveauValide, SAUTS_TOITS, sautReussi, type Hasard, type NiveauToits, type ObstacleToits, type VueToits } from '../shared/toits';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

interface Partie {
  mise: number;
  niveau: NiveauToits;
  sauts: number;
  etat: 'enCours' | 'perdu' | 'encaisse';
  obstacle: ObstacleToits | null;
  gain: number;
}

export interface OptionsToits {
  banque: BanqueCasino;
  /** Le hasard des sauts (tests, démonstration) ; crypto.randomInt sinon. */
  hasard?: Hasard;
  annoncer: (a: AnnonceCasino) => void;
}

export function creerToits(options: OptionsToits) {
  const { banque } = options;
  const hasard = options.hasard ?? ((n: number) => randomInt(n));
  const parties = new Map<string, Partie>();

  function vue(p: Partie): VueToits {
    const x = multiplicateurToits(p.niveau, p.sauts);
    return {
      mise: p.mise,
      niveau: p.niveau,
      sauts: p.sauts,
      etat: p.etat,
      x,
      suivant: p.etat === 'enCours' && p.sauts < SAUTS_TOITS ? multiplicateurToits(p.niveau, p.sauts + 1) : null,
      gain: p.etat === 'perdu' ? 0 : p.etat === 'encaisse' ? p.gain : p.sauts ? gainToits(p.mise, x) : 0,
      obstacle: p.obstacle,
    };
  }

  function encaisser(uid: string, p: Partie) {
    p.gain = gainToits(p.mise, multiplicateurToits(p.niveau, p.sauts));
    p.etat = 'encaisse';
    banque.crediter(uid, p.gain);
    if (p.gain >= MULTIPLE_GROS_GAIN * p.mise) options.annoncer({ nom: banque.joueur(uid)?.nom ?? '', jeu: 'toits', gain: p.gain });
  }

  function brancher(socket: Socket, ctx: { acces: (rappel: unknown) => Promise<Identite | null>; enSalon: (uid: string) => boolean; L: (fr: string, en: string) => string }) {
    const { L } = ctx;
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    const erreur = (rappel: unknown, fr: string, en: string) => repondre(rappel, { ok: false, erreur: L(fr, en) });
    /** Le joueur, s'il est bien au salon ; chaque geste se joue ensuite d'un bloc (un double appui ne joue pas deux fois). */
    const joueur = async (rappel: unknown) => {
      const id = await ctx.acces(rappel);
      if (!id) return null;
      if (!ctx.enSalon(id.uid)) return erreur(rappel, 'Entre d’abord dans le salon.', 'Enter the lounge first.'), null;
      return id;
    };
    const envoyer = (rappel: unknown, uid: string, p: Partie | undefined) => repondre(rappel, { ok: true, toits: p ? vue(p) : null, solde: banque.solde(uid) });

    socket.on('casino_toits_vue', async (_data: unknown, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      envoyer(rappel, id.uid, parties.get(id.uid));
    });

    socket.on('casino_toits_lancer', async (data: { mise?: unknown; niveau?: unknown } = {}, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      if (parties.get(id.uid)?.etat === 'enCours') return erreur(rappel, 'Termine d’abord ta partie en cours.', 'Finish your current game first.');
      const mise = Number(data?.mise);
      if (!MISES_TOITS.includes(mise)) return erreur(rappel, 'Mise impossible.', 'Invalid bet.');
      if (!niveauValide(data?.niveau)) return erreur(rappel, 'Choisis une difficulté.', 'Pick a difficulty.');
      if (!banque.debiter(id.uid, mise)) return erreur(rappel, 'Solde insuffisant pour cette mise.', 'Not enough money for this bet.');
      const p: Partie = { mise, niveau: data.niveau, sauts: 0, etat: 'enCours', obstacle: null, gain: 0 };
      parties.set(id.uid, p);
      envoyer(rappel, id.uid, p);
    });

    socket.on('casino_toits_sauter', async (_data: unknown, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      const p = parties.get(id.uid);
      if (!p || p.etat !== 'enCours') return erreur(rappel, 'Aucune partie en cours.', 'No game in progress.');
      if (sautReussi(hasard, p.niveau)) {
        p.sauts++;
        // Le fourgon blindé : la partie s'encaisse d'elle-même.
        if (p.sauts >= SAUTS_TOITS) encaisser(id.uid, p);
      } else {
        p.etat = 'perdu';
        p.obstacle = hasard(2) === 0 ? 'tunnel' : 'attelage';
      }
      envoyer(rappel, id.uid, p);
    });

    socket.on('casino_toits_encaisser', async (_data: unknown, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      const p = parties.get(id.uid);
      if (!p || p.etat !== 'enCours') return erreur(rappel, 'Aucune partie en cours.', 'No game in progress.');
      if (!p.sauts) return erreur(rappel, 'Saute au moins une fois avant d’encaisser.', 'Jump at least once before cashing out.');
      encaisser(id.uid, p);
      envoyer(rappel, id.uid, p);
    });
  }

  /** Une partie est-elle en cours pour ce joueur ? (le salon l'affiche sur la vignette) */
  const enCours = (uid: string) => parties.get(uid)?.etat === 'enCours';

  /** Arrêt du serveur : une partie pas finie est annulée et sa mise rendue. */
  const rendreMisesEnCours = () => {
    for (const [uid, p] of parties) {
      if (p.etat !== 'enCours') continue;
      banque.rembourser(uid, p.mise);
      parties.delete(uid);
    }
  };

  return { brancher, enCours, rendreMisesEnCours };
}
