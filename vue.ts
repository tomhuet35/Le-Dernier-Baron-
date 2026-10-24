import { NB_NUITS } from './config';
import { attenteDe } from './moteur';
import { cartesJouables, familleDemandee } from './regles';
import type { EtatPartie, Vue } from './types';

/**
 * Vue d'un joueur : sa propre main, et seulement les informations publiques des autres.
 * Les mains adverses, les annonces non révélées et les choix secrets n'en sortent jamais.
 */
export function vuePourJoueur(e: EtatPartie, joueurId: string): Vue {
  const attente = attenteDe(e);
  const monTour = e.phase === 'PLI' && e.joueurs[e.tour].id === joueurId;
  const main = e.mains[joueurId] ?? [];
  const jouables = monTour ? new Set(cartesJouables(main, e.pli)) : new Set<string>();
  return {
    moi: joueurId,
    nuit: e.nuit,
    nbNuits: e.nbNuits ?? NB_NUITS,
    phase: e.phase,
    evenement: e.evenement,
    evenementId: e.evenementId,
    joueurs: e.joueurs.map((j) => ({
      id: j.id,
      nom: j.nom,
      nbCartes: e.mains[j.id].length,
      annonce: e.annoncesRevelees || j.id === joueurId ? e.annonces[j.id] : null,
      aAnnonce: e.annonces[j.id] !== null,
      plis: e.plis[j.id],
      butin: [...e.butins[j.id]],
      score: e.scores[j.id],
      attendu: attente.includes(j.id),
    })),
    premierId: e.joueurs[e.premier].id,
    ouvreurId: e.joueurs[e.ouvreur].id,
    tourId: e.phase === 'PLI' ? e.joueurs[e.tour].id : null,
    main: main.map((id) => ({ id, jouable: jouables.has(id) })),
    familleDemandee: familleDemandee(e.pli),
    pli: e.pli.map((p) => ({ ...p })),
    dernierPli: e.dernierPli ? structuredClone(e.dernierPli) : null,
    vol: e.vol ? { ...e.vol } : null,
    aChoisiTrahison: joueurId in e.choixTrahison,
    maCarteTrahison: e.phase === 'TRAHISON' ? (e.choixTrahison[joueurId] ?? null) : null,
    monAnnonce: e.annonces[joueurId] ?? null,
    aChoisiAllie: joueurId in e.choixAlliance,
    monAllie: e.choixAlliance[joueurId] ?? null,
    alliances: e.alliances.map(([a, b]) => [a, b] as [string, string]),
    choixAllies: e.evenement === 'alliance' && e.phase !== 'ALLIANCE' && e.annoncesRevelees ? { ...e.choixAlliance } : null,
    attente,
    bilans: structuredClone(e.bilans),
    journal: e.journal.slice(-30),
    pret: !!e.prets[joueurId],
  };
}
