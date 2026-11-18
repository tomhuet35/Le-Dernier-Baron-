/**
 * La Salle des ventes du Salon privé : les 3 lots du jour, les enchères, et la vente à minuit (heure de Paris).
 * L'argent et les objets passent par le salon (salonCasino.ts), qui fournit les fonctions ci-dessous. L'état des lots
 * est gardé avec les réglages du serveur (document « casino » de la collection « parametres »).
 */
import { encherir, lotsDuJour, normaliserEtatVentes, valeurEnDollars, vueVentes, type EnchereLot, type EtatVentes, type Lot, type Monnaie, type ResultatEnchere, type VueVentes } from '../shared/ventes';

export interface OptionsVentes {
  horloge: () => number;
  /** Le jour (heure de Paris) et le minuit suivant. */
  jour: (t: number) => string;
  fin: (t: number) => number;
  /** Prend la somme au joueur (false si elle manque) ; rend une somme ; donne l'objet au gagnant. */
  debiter: (uid: string, monnaie: Monnaie, montant: number) => boolean;
  rendre: (uid: string, monnaie: Monnaie, montant: number, lot: Lot, par: string) => void;
  attribuer: (uid: string, lot: Lot, valeur: number) => void;
  /** Les lots ont changé : à montrer à tout le salon, et à garder. */
  diffuser: (v: VueVentes) => void;
  sauver: () => void;
  /** Vérification de la fin des ventes (ms). */
  intervalle?: number;
}

export function creerVentes(o: OptionsVentes) {
  let etat: EtatVentes = { jour: '', lots: [] };
  let charge = false;

  /** Minuit est passé : les lots partent chez leur meilleur enchérisseur, et 3 nouveaux lots arrivent. */
  function verifier() {
    if (!charge) return;
    const t = o.horloge();
    const jour = o.jour(t);
    if (etat.jour === jour) return;
    const finis = etat.lots;
    etat = { jour, lots: lotsDuJour(jour) };
    for (const lot of finis) {
      if (!lot.meilleure) continue;
      try {
        o.attribuer(lot.meilleure.uid, lot, valeurEnDollars(lot, lot.meilleure.montant));
      } catch (e) {
        console.error('Salle des ventes : attribution impossible :', e);
      }
    }
    o.sauver();
    o.diffuser(vue());
  }

  const minuterie = setInterval(verifier, o.intervalle ?? 20_000);
  minuterie.unref?.();

  function vue(): VueVentes {
    return vueVentes(etat, o.fin(o.horloge()));
  }

  return {
    /** Les lots gardés (au démarrage du serveur) ; les ventes finies pendant l'arrêt se règlent aussitôt. */
    importer(brut: unknown) {
      etat = normaliserEtatVentes(brut);
      charge = true;
      verifier();
    },
    exporter: () => etat,
    vue() {
      verifier();
      return vue();
    },
    encherir(qui: Omit<EnchereLot, 'montant'>, index: number, montant: number): ResultatEnchere {
      verifier();
      if (!charge) return 'introuvable';
      const r = encherir(etat, index, qui, montant, (monnaie, m) => o.debiter(qui.uid, monnaie, m));
      if (r.resultat !== 'ok') return r.resultat;
      const lot = etat.lots[index];
      if (r.rendue) o.rendre(r.rendue.uid, lot.monnaie, r.rendue.montant, lot, qui.nom);
      o.sauver();
      o.diffuser(vue());
      return 'ok';
    },
    /** Le joueur a-t-il la meilleure enchère sur un lot ? (pour lui montrer « en tête ») */
    verifier,
    fermer() {
      clearInterval(minuterie);
    },
  };
}
