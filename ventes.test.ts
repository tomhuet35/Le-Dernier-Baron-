import { describe, expect, it } from 'vitest';
import { etatSalonVide, normaliserEtatSalon, RUBIS_ALBUM } from '../shared/contrats';
import {
  ajouterObjet,
  arrondiHaut,
  cadreSpecial,
  enchereMinimale,
  encherir,
  IDS_OBJETS,
  LOT_EN_RUBIS,
  LOTS_PAR_JOUR,
  lotsDuJour,
  normaliserEtatVentes,
  OBJETS,
  objetsDifferents,
  PRIX_DOLLARS,
  PRIX_RUBIS,
  RUBIS_COLLECTION,
  valeurCollection,
  valeurEnDollars,
  type EtatVentes,
} from '../shared/ventes';
import { creerVentes } from '../server/ventesCasino';

describe('Salle des ventes : les lots', () => {
  it('tire 3 objets différents par jour, le troisième en rubis, toujours les mêmes pour un jour', () => {
    const vus = new Set<string>();
    for (let k = 1; k <= 300; k++) {
      const jour = `2026-${String(1 + (k % 12)).padStart(2, '0')}-${String(1 + (k % 28)).padStart(2, '0')}-${k}`;
      const l = lotsDuJour(jour);
      expect(l.length).toBe(LOTS_PAR_JOUR);
      expect(new Set(l.map((x) => x.objet)).size).toBe(LOTS_PAR_JOUR);
      expect(l.map((x) => x.monnaie)).toEqual(['dollars', 'dollars', 'rubis']);
      for (const x of l) {
        const r = OBJETS[x.objet].rarete;
        expect(x.prixDepart).toBe(x.monnaie === 'rubis' ? PRIX_RUBIS[r] : PRIX_DOLLARS[r]);
        vus.add(x.objet);
      }
      expect(lotsDuJour(jour)).toEqual(l);
    }
    // Sur 300 jours, tous les objets passent en vente (même les légendaires).
    expect(vus.size).toBe(IDS_OBJETS.length);
  });

  it('demande au moins 10 % de plus que la meilleure enchère, arrondi proprement', () => {
    expect(arrondiHaut(1_234_567)).toBe(1_240_000);
    expect(arrondiHaut(11_000_000)).toBe(11_000_000);
    const lot = { objet: 'montre' as const, monnaie: 'dollars' as const, prixDepart: 100_000_000, meilleure: null, encheres: 0 };
    expect(enchereMinimale(lot)).toBe(100_000_000);
    expect(enchereMinimale({ ...lot, meilleure: { uid: 'a', nom: 'A', avatar: 1, montant: 123_456_789 } })).toBe(136_000_000);
    const rubis = { ...lot, monnaie: 'rubis' as const, prixDepart: 40, meilleure: { uid: 'a', nom: 'A', avatar: 1, montant: 5 } };
    expect(enchereMinimale(rubis)).toBe(6);
    expect(enchereMinimale({ ...rubis, meilleure: { ...rubis.meilleure, montant: 40 } })).toBe(44);
  });

  it('compte un objet payé en rubis à la valeur de sa rareté', () => {
    expect(valeurEnDollars({ objet: 'montre', monnaie: 'dollars' }, 150_000_000)).toBe(150_000_000);
    expect(valeurEnDollars({ objet: 'montre', monnaie: 'rubis' }, 80)).toBe(200_000_000);
  });
});

describe('Salle des ventes : enchères', () => {
  const etat = (): EtatVentes => ({ jour: '2026-11-18', lots: lotsDuJour('2026-11-18') });

  it('bloque la somme, rend celle du précédent, refuse les enchères trop basses ou en double', () => {
    const e = etat();
    const soldes: Record<string, number> = { a: 50_000_000_000, b: 50_000_000_000 };
    const debit = (uid: string) => (_m: string, montant: number) => (soldes[uid] >= montant ? ((soldes[uid] -= montant), true) : false);
    const min = enchereMinimale(e.lots[0]);
    expect(encherir(e, 0, { uid: 'a', nom: 'A', avatar: 1 }, min - 1, debit('a')).resultat).toBe('minimum');
    expect(encherir(e, 0, { uid: 'a', nom: 'A', avatar: 1 }, min, debit('a')).resultat).toBe('ok');
    expect(soldes.a).toBe(50_000_000_000 - min);
    expect(encherir(e, 0, { uid: 'a', nom: 'A', avatar: 1 }, min * 2, debit('a')).resultat).toBe('deja');
    const min2 = enchereMinimale(e.lots[0]);
    const r = encherir(e, 0, { uid: 'b', nom: 'B', avatar: 2 }, min2, debit('b'));
    expect(r.resultat).toBe('ok');
    expect(r.rendue).toEqual({ uid: 'a', nom: 'A', avatar: 1, montant: min });
    expect(e.lots[0].encheres).toBe(2);
    expect(encherir(e, 0, { uid: 'a', nom: 'A', avatar: 1 }, enchereMinimale(e.lots[0]) * 1000, debit('a')).resultat).toBe('trop');
    expect(encherir(e, 9, { uid: 'a', nom: 'A', avatar: 1 }, 1, debit('a')).resultat).toBe('introuvable');
    const pauvre = () => false;
    expect(encherir(e, 1, { uid: 'c', nom: 'C', avatar: 3 }, enchereMinimale(e.lots[1]), pauvre).resultat).toBe('solde');
  });

  it('à minuit, donne les objets aux meilleurs enchérisseurs et ouvre de nouveaux lots ; rend les sommes dépassées', () => {
    let t = Date.UTC(2026, 10, 18, 12);
    const jour = (x: number) => new Date(x + 3_600_000).toISOString().slice(0, 10);
    const attribues: [string, string, number][] = [];
    const rendus: [string, number][] = [];
    const v = creerVentes({
      horloge: () => t,
      jour,
      fin: (x) => x + 1,
      debiter: () => true,
      rendre: (uid, _m, montant) => rendus.push([uid, montant]),
      attribuer: (uid, lot, valeur) => attribues.push([uid, lot.objet, valeur]),
      diffuser: () => undefined,
      sauver: () => undefined,
      intervalle: 60_000_000,
    });
    v.importer(undefined);
    const lots = v.vue().lots;
    expect(lots.length).toBe(3);
    expect(v.encherir({ uid: 'a', nom: 'A', avatar: 1 }, 0, lots[0].minimum)).toBe('ok');
    const min = v.vue().lots[0].minimum;
    expect(v.encherir({ uid: 'b', nom: 'B', avatar: 1 }, 0, min)).toBe('ok');
    expect(rendus).toEqual([['a', lots[0].minimum]]);
    expect(v.encherir({ uid: 'a', nom: 'A', avatar: 1 }, LOT_EN_RUBIS, lots[LOT_EN_RUBIS].minimum)).toBe('ok');
    t += 24 * 3_600_000;
    const nouveaux = v.vue().lots;
    expect(attribues.map(([u, o]) => [u, o])).toEqual([
      ['b', lots[0].objet],
      ['a', lots[LOT_EN_RUBIS].objet],
    ]);
    expect(attribues[0][2]).toBe(min);
    expect(nouveaux.every((l) => !l.meilleure)).toBe(true);
    // Ce qui est gardé se relit, et une vente finie pendant un arrêt du serveur se règle au redémarrage.
    v.encherir({ uid: 'c', nom: 'C', avatar: 1 }, 1, nouveaux[1].minimum);
    const garde = JSON.parse(JSON.stringify(v.exporter()));
    expect(normaliserEtatVentes(garde)).toEqual(v.exporter());
    v.fermer();
    const apres: string[] = [];
    t += 24 * 3_600_000;
    const w = creerVentes({ horloge: () => t, jour, fin: (x) => x, debiter: () => true, rendre: () => undefined, attribuer: (uid) => apres.push(uid), diffuser: () => undefined, sauver: () => undefined, intervalle: 60_000_000 });
    w.importer(garde);
    expect(apres).toEqual(['c']);
    w.fermer();
  });
});

describe('Bureau du Baron : la collection', () => {
  it('compte les objets et leur valeur ; la collection complète donne 100 rubis et le cadre Mécène, une seule fois', () => {
    const e = etatSalonVide();
    ajouterObjet(e, 'montre', 150_000_000);
    ajouterObjet(e, 'montre', 120_000_000);
    expect(e.collection.montre).toEqual({ n: 2, valeur: 270_000_000 });
    expect(objetsDifferents(e.collection)).toBe(1);
    let derniere = { complete: false };
    for (const o of IDS_OBJETS) if (o !== 'montre') derniere = ajouterObjet(e, o, 10);
    expect(derniere.complete).toBe(true);
    expect(e.rubis).toBe(RUBIS_COLLECTION);
    expect(cadreSpecial(e.cadres)).toBe('mecene');
    expect(ajouterObjet(e, 'globe', 10).complete).toBe(false);
    expect(e.rubis).toBe(RUBIS_COLLECTION);
    expect(valeurCollection(e.collection)).toBe(270_000_000 + 10 * 10);
    // Relue depuis le compte : rien ne se perd.
    expect(normaliserEtatSalon(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });

  it('l’album complet donne le cadre Collectionneur', () => {
    const e = normaliserEtatSalon({ albumComplet: true, rubis: RUBIS_ALBUM });
    expect(cadreSpecial(e.cadres)).toBe('collectionneur');
  });
});
