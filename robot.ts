import { CARTE } from './cartes';
import type { Action, Vue } from './types';

/**
 * Joueur automatique (mode test et remplacement d'un joueur parti) : il ne connaît que sa Vue
 * et joue un coup autorisé, avec une estimation sommaire pour ses annonces.
 */
export function actionRobot(v: Vue, alea: () => number = Math.random): Action | null {
  const moi = v.moi;
  if (!v.attente.includes(moi)) return null;
  const auHasard = <T>(t: T[]): T => t[Math.floor(alea() * t.length)];
  switch (v.phase) {
    case 'TRAHISON':
      return v.main.length ? { type: 'TRAHISON', joueurId: moi, carteId: auHasard(v.main).id } : null;
    case 'ANNONCES': {
      const fortes = v.main.filter(({ id }) => {
        const c = CARTE[id];
        if (c.speciale) return ['baron', 'homme_de_main', 'pickpocket'].includes(c.speciale);
        return c.type === 'atout' ? (c.valeur ?? 0) >= 6 : (c.valeur ?? 0) >= 9;
      }).length;
      const valeur = Math.max(0, Math.min(v.nuit, fortes + (alea() < 0.3 ? 1 : 0) - (alea() < 0.3 ? 1 : 0)));
      return { type: 'ANNONCE', joueurId: moi, valeur };
    }
    case 'ALLIANCE': {
      const autres = v.joueurs.filter((j) => j.id !== moi);
      return { type: 'ALLIANCE', joueurId: moi, allieId: alea() < 0.25 ? null : auHasard(autres).id };
    }
    case 'PLI': {
      const jouables = v.main.filter((c) => c.jouable);
      if (!jouables.length) return null;
      const c = auHasard(jouables);
      return CARTE[c.id].speciale === 'croupier'
        ? { type: 'JOUER', joueurId: moi, carteId: c.id, valeurCroupier: alea() < 0.5 ? 0 : 11 }
        : { type: 'JOUER', joueurId: moi, carteId: c.id };
    }
    case 'VOL': {
      const cibles = v.joueurs.filter((j) => j.id !== moi && j.butin.length > 0);
      if (!cibles.length) return { type: 'VOLER', joueurId: moi, cibleId: null };
      const cible = auHasard(cibles);
      const meilleure = cible.butin.reduce((m, id) => ((CARTE[id].valeur ?? 0) > (CARTE[m].valeur ?? 0) ? id : m));
      return { type: 'VOLER', joueurId: moi, cibleId: cible.id, carteId: meilleure };
    }
    case 'FIN_DE_NUIT':
      return { type: 'CONTINUER', joueurId: moi };
    default:
      return null;
  }
}
