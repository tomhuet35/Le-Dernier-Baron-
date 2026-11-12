/**
 * La Chute des Écus (Salon privé) : chaque lâcher se joue d'un bloc sur le serveur.
 *
 * - La mise est débitée, le chemin de l'écu tiré (crypto.randomInt, un rebond par rangée), le gain crédité : rien ne
 *   reste en suspens, donc rien à rendre si le serveur s'arrête.
 * - Le téléphone reçoit le chemin et montre la chute (2 à 3 secondes) ; il peut lâcher d'autres écus pendant ce temps.
 * - Un gros gain (×50 la mise au moins) est annoncé au salon quand l'écu touche le fond, pas avant.
 */
import { randomInt } from 'node:crypto';
import type { Socket } from 'socket.io';
import { MULTIPLE_GROS_GAIN, type AnnonceCasino } from '../shared/casino';
import { caseDuChemin, estRisqueChute, gainChute, LACHERS_PAR_SECONDE, MISES_CHUTE, multiplicateursChute, rangeesValides, type ResultatChute } from '../shared/chute';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

export interface OptionsChute {
  banque: BanqueCasino;
  horloge?: () => number;
  /** Rebond : 0 ou 1 (remplaçable pour les tests ; au hasard sinon). */
  hasard?: () => number;
  /** Chemin imposé (tests, démonstration) ; au hasard sinon. */
  chemin?: (rangees: number) => number[] | undefined;
  annoncer: (a: AnnonceCasino) => void;
  /** Délai avant d'annoncer un gros gain : le temps que l'écu arrive en bas à l'écran. */
  delaiAnnonce?: number;
}

export function creerChute(options: OptionsChute) {
  const { banque } = options;
  const horloge = options.horloge ?? Date.now;
  const hasard = options.hasard ?? (() => randomInt(2));
  const delaiAnnonce = options.delaiAnnonce ?? 3200;
  /** Derniers lâchers de chaque joueur (limite par seconde) et numéro du suivant. */
  const recents = new Map<string, number[]>();
  const numeros = new Map<string, number>();
  const annonces = new Set<ReturnType<typeof setTimeout>>();

  function tirer(rangees: number): number[] {
    const impose = options.chemin?.(rangees);
    if (impose && impose.length === rangees && impose.every((d) => d === 0 || d === 1)) return [...impose];
    return Array.from({ length: rangees }, () => (hasard() ? 1 : 0));
  }

  function brancher(socket: Socket, ctx: { acces: (rappel: unknown) => Promise<Identite | null>; enSalon: (uid: string) => boolean; L: (fr: string, en: string) => string }) {
    const { L } = ctx;
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    const erreur = (rappel: unknown, fr: string, en: string) => repondre(rappel, { ok: false, erreur: L(fr, en) });

    socket.on('casino_chute_lacher', async (data: { mise?: unknown; rangees?: unknown; risque?: unknown } = {}, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return erreur(rappel, 'Entre d’abord dans le salon.', 'Enter the lounge first.');
      const mise = Number(data?.mise);
      const rangees = Number(data?.rangees);
      const risque = data?.risque;
      if (!MISES_CHUTE.includes(mise)) return erreur(rappel, 'Mise impossible.', 'Invalid bet.');
      if (!rangeesValides(rangees)) return erreur(rappel, 'Choisis de 8 à 16 rangées.', 'Pick 8 to 16 rows.');
      if (!estRisqueChute(risque)) return erreur(rappel, 'Risque inconnu.', 'Unknown risk.');
      // Pas plus de quelques lâchers par seconde (un doigt qui tapote vite passe, un script non).
      const t = horloge();
      const liste = (recents.get(id.uid) ?? []).filter((x) => t - x < 1000);
      if (liste.length >= LACHERS_PAR_SECONDE) return erreur(rappel, 'Doucement : un écu à la fois !', 'Easy: one coin at a time!');
      if (!banque.debiter(id.uid, mise)) return erreur(rappel, 'Solde insuffisant pour cette mise.', 'Not enough money for this bet.');
      liste.push(t);
      recents.set(id.uid, liste);
      const chemin = tirer(rangees);
      const k = caseDuChemin(chemin);
      const x = multiplicateursChute(rangees, risque)[k];
      const gain = gainChute(mise, x);
      if (gain > 0) banque.crediter(id.uid, gain);
      const numero = (numeros.get(id.uid) ?? 0) + 1;
      numeros.set(id.uid, numero);
      if (gain >= MULTIPLE_GROS_GAIN * mise) {
        const nom = banque.joueur(id.uid)?.nom ?? '';
        const m = setTimeout(() => {
          annonces.delete(m);
          options.annoncer({ nom, jeu: 'chute', gain });
        }, delaiAnnonce);
        annonces.add(m);
      }
      const resultat: ResultatChute = { id: numero, mise, rangees, risque, chemin, case: k, x, gain };
      repondre(rappel, { ok: true, chute: resultat, solde: banque.solde(id.uid) });
    });
  }

  /** Arrêt du serveur : les annonces pas encore parties sont abandonnées (les gains, eux, sont déjà crédités). */
  function fermer() {
    for (const m of annonces) clearTimeout(m);
    annonces.clear();
  }

  return { brancher, fermer };
}
