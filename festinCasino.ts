/**
 * Le Festin du Baron (Salon privé) : chaque créateur joue sa propre partie, tenue par le serveur.
 *
 * - « Servir » : la mise est débitée et les os sont placés (crypto.randomInt). Le téléphone ne les voit jamais tant
 *   que la partie n'est pas finie.
 * - Soulever une cloche : un poulet fait monter le multiplicateur ; un os, et la partie est perdue (tout se dévoile).
 * - Encaisser (après au moins un poulet) : la mise × le multiplicateur est créditée. Quand il ne reste plus que des os
 *   (ou que le plafond est atteint), la partie s'encaisse d'elle-même.
 * - Une partie en cours attend le joueur s'il quitte l'écran ou perd le réseau : il la retrouve en revenant.
 */
import { randomInt } from 'node:crypto';
import type { Socket } from 'socket.io';
import { MULTIPLE_GROS_GAIN, type AnnonceCasino } from '../shared/casino';
import {
  CASES_FESTIN,
  gainFestin,
  MISES_FESTIN,
  multiplicateurFestin,
  osValides,
  placerOs,
  X_MAX_FESTIN,
  type ContenuCloche,
  type Hasard,
  type VueFestin,
} from '../shared/festin';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

interface Partie {
  mise: number;
  os: number;
  /** Positions des os. */
  places: Set<number>;
  ouvertes: number[];
  etat: 'enCours' | 'perdu' | 'encaisse';
  perdante: number | null;
  gain: number;
}

export interface OptionsFestin {
  banque: BanqueCasino;
  hasard?: Hasard;
  /** Positions des os imposées (tests, démonstration) ; au hasard sinon. */
  placer?: (os: number) => number[] | undefined;
  annoncer: (a: AnnonceCasino) => void;
}

export function creerFestin(options: OptionsFestin) {
  const { banque } = options;
  const hasard = options.hasard ?? ((n: number) => randomInt(n));
  /** La partie de chaque joueur (la dernière, finie ou non). */
  const parties = new Map<string, Partie>();

  const poulets = (p: Partie) => p.ouvertes.filter((i) => !p.places.has(i)).length;

  function vue(p: Partie): VueFestin {
    const fini = p.etat !== 'enCours';
    const n = poulets(p);
    const x = multiplicateurFestin(p.os, n);
    const restePoulets = CASES_FESTIN - p.os - n;
    const cloches: (ContenuCloche | null)[] = Array.from({ length: CASES_FESTIN }, (_, i) =>
      fini || p.ouvertes.includes(i) ? (p.places.has(i) ? 'os' : 'poulet') : null,
    );
    return {
      mise: p.mise,
      os: p.os,
      cloches,
      ouvertes: [...p.ouvertes],
      etat: p.etat,
      poulets: n,
      x,
      suivant: p.etat === 'enCours' && restePoulets > 0 && x < X_MAX_FESTIN ? multiplicateurFestin(p.os, n + 1) : null,
      gain: p.etat === 'perdu' ? 0 : p.etat === 'encaisse' ? p.gain : n ? gainFestin(p.mise, x) : 0,
      perdante: p.perdante,
    };
  }

  function encaisser(uid: string, p: Partie) {
    p.gain = gainFestin(p.mise, multiplicateurFestin(p.os, poulets(p)));
    p.etat = 'encaisse';
    banque.crediter(uid, p.gain);
    if (p.gain >= MULTIPLE_GROS_GAIN * p.mise) options.annoncer({ nom: banque.joueur(uid)?.nom ?? '', jeu: 'festin', gain: p.gain });
  }

  function brancher(socket: Socket, ctx: { acces: (rappel: unknown) => Promise<Identite | null>; enSalon: (uid: string) => boolean; L: (fr: string, en: string) => string }) {
    const { L } = ctx;
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    const erreur = (rappel: unknown, fr: string, en: string) => repondre(rappel, { ok: false, erreur: L(fr, en) });
    /**
     * Le joueur, s'il est bien au salon ; sinon l'erreur est déjà envoyée. Après cette vérification, chaque geste se
     * joue d'un bloc (sans attente) : un double appui retombe sur « déjà soulevée » ou « aucun festin en cours ».
     */
    const joueur = async (rappel: unknown) => {
      const id = await ctx.acces(rappel);
      if (!id) return null;
      if (!ctx.enSalon(id.uid)) return erreur(rappel, 'Entre d’abord dans le salon.', 'Enter the lounge first.'), null;
      return id;
    };
    const envoyer = (rappel: unknown, uid: string, p: Partie | undefined) => repondre(rappel, { ok: true, festin: p ? vue(p) : null, solde: banque.solde(uid) });

    socket.on('casino_festin_vue', async (_data: unknown, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      envoyer(rappel, id.uid, parties.get(id.uid));
    });

    socket.on('casino_festin_servir', async (data: { mise?: unknown; os?: unknown } = {}, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      if (parties.get(id.uid)?.etat === 'enCours') return erreur(rappel, 'Termine d’abord ton festin en cours.', 'Finish your current feast first.');
      const mise = Number(data?.mise);
      const os = Number(data?.os);
      if (!MISES_FESTIN.includes(mise)) return erreur(rappel, 'Mise impossible.', 'Invalid bet.');
      if (!osValides(os)) return erreur(rappel, 'Choisis de 1 à 24 os.', 'Pick 1 to 24 bones.');
      if (!banque.debiter(id.uid, mise)) return erreur(rappel, 'Solde insuffisant pour cette mise.', 'Not enough money for this bet.');
      const imposees = options.placer?.(os);
      const places = imposees && imposees.length === os ? imposees : placerOs(hasard, os);
      const p: Partie = { mise, os, places: new Set(places), ouvertes: [], etat: 'enCours', perdante: null, gain: 0 };
      parties.set(id.uid, p);
      envoyer(rappel, id.uid, p);
    });

    socket.on('casino_festin_ouvrir', async (data: { index?: unknown } = {}, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      const p = parties.get(id.uid);
      if (!p || p.etat !== 'enCours') return erreur(rappel, 'Aucun festin en cours.', 'No feast in progress.');
      const i = Number(data?.index);
      if (!Number.isInteger(i) || i < 0 || i >= CASES_FESTIN) return erreur(rappel, 'Cloche introuvable.', 'Unknown cloche.');
      if (p.ouvertes.includes(i)) return erreur(rappel, 'Cette cloche est déjà soulevée.', 'This cloche is already lifted.');
      p.ouvertes.push(i);
      if (p.places.has(i)) {
        p.etat = 'perdu';
        p.perdante = i;
      } else {
        const n = poulets(p);
        // Plus aucun poulet sous les cloches, ou le plafond atteint : le festin s'encaisse de lui-même.
        if (n === CASES_FESTIN - p.os || multiplicateurFestin(p.os, n) >= X_MAX_FESTIN) encaisser(id.uid, p);
      }
      envoyer(rappel, id.uid, p);
    });

    socket.on('casino_festin_encaisser', async (_data: unknown, rappel?: Rappel) => {
      const id = await joueur(rappel);
      if (!id) return;
      const p = parties.get(id.uid);
      if (!p || p.etat !== 'enCours') return erreur(rappel, 'Aucun festin en cours.', 'No feast in progress.');
      if (!poulets(p)) return erreur(rappel, 'Soulève au moins une cloche avant d’encaisser.', 'Lift at least one cloche before cashing out.');
      encaisser(id.uid, p);
      envoyer(rappel, id.uid, p);
    });
  }

  /** Une partie est-elle en cours pour ce joueur ? (le salon l'affiche sur la vignette) */
  const enCours = (uid: string) => parties.get(uid)?.etat === 'enCours';

  return { brancher, enCours };
}
