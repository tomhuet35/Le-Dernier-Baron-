/**
 * Les Tickets du Baron (Salon privé) : chaque ticket se joue d'un bloc sur le serveur.
 *
 * - Le prix est débité, le ticket tiré (crypto), le gain crédité : rien en suspens, rien à rendre si le serveur s'arrête.
 * - Le téléphone reçoit le ticket et le laisse gratter ; un gros gain (×50 le prix au moins) est annoncé au salon
 *   quelques secondes plus tard (le temps de gratter).
 */
import { randomInt } from 'node:crypto';
import type { Socket } from 'socket.io';
import { MULTIPLE_GROS_GAIN, type AnnonceCasino } from '../shared/casino';
import { estModeleTicket, TICKETS, tirerTicket, type Ticket } from '../shared/tickets';
import type { Identite } from './comptes';
import type { BanqueCasino } from './tablesCasino';

type Reponse = { ok: true; [cle: string]: unknown } | { ok: false; erreur: string };
type Rappel = (r: Reponse) => void;

/** Tickets achetés par seconde et par joueur, au plus. */
const ACHATS_PAR_SECONDE = 4;

export interface OptionsTickets {
  banque: BanqueCasino;
  horloge?: () => number;
  /** Hasard remplaçable pour les tests : entier de 0 à n − 1, et réel de 0 à 1. */
  hasard?: (n: number) => number;
  reel?: () => number;
  annoncer: (a: AnnonceCasino) => void;
  delaiAnnonce?: number;
}

export function creerTickets(options: OptionsTickets) {
  const { banque } = options;
  const horloge = options.horloge ?? Date.now;
  const hasard = options.hasard ?? ((n: number) => randomInt(n));
  const reel = options.reel ?? (() => randomInt(2 ** 40) / 2 ** 40);
  const delaiAnnonce = options.delaiAnnonce ?? 6000;
  const recents = new Map<string, number[]>();
  const numeros = new Map<string, number>();
  const annonces = new Set<ReturnType<typeof setTimeout>>();

  function brancher(socket: Socket, ctx: { acces: (rappel: unknown) => Promise<Identite | null>; enSalon: (uid: string) => boolean; L: (fr: string, en: string) => string }) {
    const { L } = ctx;
    const repondre = (rappel: unknown, r: Reponse) => {
      if (typeof rappel === 'function') (rappel as Rappel)(r);
    };
    const erreur = (rappel: unknown, fr: string, en: string) => repondre(rappel, { ok: false, erreur: L(fr, en) });

    socket.on('casino_ticket_acheter', async (data: { modele?: unknown } = {}, rappel?: Rappel) => {
      const id = await ctx.acces(rappel);
      if (!id) return;
      if (!ctx.enSalon(id.uid)) return erreur(rappel, 'Entre d’abord dans le salon.', 'Enter the lounge first.');
      const modele = data?.modele;
      if (!estModeleTicket(modele)) return erreur(rappel, 'Ticket inconnu.', 'Unknown ticket.');
      const t = horloge();
      const liste = (recents.get(id.uid) ?? []).filter((x) => t - x < 1000);
      if (liste.length >= ACHATS_PAR_SECONDE) return erreur(rappel, 'Doucement : un ticket à la fois !', 'Easy: one ticket at a time!');
      const prix = TICKETS[modele].prix;
      if (!banque.debiter(id.uid, prix)) return erreur(rappel, 'Solde insuffisant pour ce ticket.', 'Not enough money for this ticket.');
      liste.push(t);
      recents.set(id.uid, liste);
      const avant = banque.solde(id.uid);
      const numero = (numeros.get(id.uid) ?? 0) + 1;
      numeros.set(id.uid, numero);
      const ticket: Ticket = tirerTicket(modele, numero, hasard, reel);
      if (ticket.gain > 0) banque.crediter(id.uid, ticket.gain);
      if (ticket.gain >= MULTIPLE_GROS_GAIN * prix) {
        const nom = banque.joueur(id.uid)?.nom ?? '';
        const m = setTimeout(() => {
          annonces.delete(m);
          options.annoncer({ nom, jeu: 'tickets', gain: ticket.gain });
        }, delaiAnnonce);
        annonces.add(m);
      }
      const solde = banque.solde(id.uid);
      repondre(rappel, { ok: true, ticket, solde, credite: Math.max(0, solde - avant) });
    });
  }

  function fermer() {
    for (const m of annonces) clearTimeout(m);
    annonces.clear();
  }

  return { brancher, fermer };
}
