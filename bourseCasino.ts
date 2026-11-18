/**
 * La Bourse de 1929, côté serveur : les cours (gardés avec les réglages du serveur, document « bourse » de la collection
 * « parametres »), une séance toutes les 5 minutes, et les nouvelles diffusées à tout le salon. Les portefeuilles sont
 * gardés avec le casino de chaque joueur (salonCasino.ts).
 */
import { randomInt } from 'node:crypto';
import { etatBourseNeuf, jouerSeance, normaliserEtatBourse, SEANCE_MS, seancesEnRetard, type EtatBourse, type IdAction, type Nouvelle } from '../shared/bourse';

export interface OptionsBourse {
  horloge: () => number;
  jour: (t: number) => string;
  lire: () => Promise<unknown>;
  ecrire: (e: EtatBourse) => Promise<void>;
  /** Une séance vient d'être jouée : les cours (et la nouvelle) pour tout le salon. */
  diffuser: (cours: Record<IdAction, number>, nouvelle: Nouvelle | null, prochaine: number) => void;
  /** Hasard (remplaçable pour les tests). */
  alea?: () => number;
}

export function creerBourse(o: OptionsBourse) {
  const alea = o.alea ?? (() => randomInt(1_000_000_000) / 1_000_000_000);
  let etat: EtatBourse = etatBourseNeuf(o.horloge(), o.jour(o.horloge()));
  let charge = false;
  const chargement = o
    .lire()
    .then((brut) => {
      etat = normaliserEtatBourse(brut, o.horloge(), o.jour(o.horloge()));
    })
    .catch((e) => console.error('Bourse : lecture impossible :', e))
    .then(() => {
      charge = true;
      rattraper();
    });

  /** Joue les séances dues (au plus 12 d'un coup ; au-delà, la Bourse reprend simplement à l'heure). */
  function rattraper() {
    if (!charge) return;
    const t = o.horloge();
    const n = seancesEnRetard(etat, t);
    if (!n) return;
    let derniere: Nouvelle | null = null;
    for (let k = n - 1; k >= 0; k--) derniere = jouerSeance(etat, t - k * SEANCE_MS, o.jour(t - k * SEANCE_MS), alea) ?? derniere;
    etat.seance = t - (t % SEANCE_MS);
    void o.ecrire(etat).catch((e) => console.error('Bourse : écriture impossible :', e));
    o.diffuser(etat.cours, derniere, prochaine());
  }
  const prochaine = () => etat.seance + SEANCE_MS;

  const tic = setInterval(rattraper, 15_000);
  tic.unref?.();

  return {
    chargement,
    /** Les cours à jour (une séance due est jouée d'abord). */
    etat() {
      rattraper();
      return etat;
    },
    prochaine,
    fermer() {
      clearInterval(tic);
    },
  };
}
