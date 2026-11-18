import { describe, expect, it } from 'vitest';
import { etatSalonVide, normaliserEtatSalon } from '../shared/contrats';
import { CADRES_MARCHE, etal, normaliserMarche, rafraichirMarche, valeurObjetMarche } from '../shared/marche';
import { cadreSpecial } from '../shared/ventes';

describe('Marché noir', () => {
  it('propose chaque jour 2 cadres différents, un objet et une mallette, toujours les mêmes pour un même étal', () => {
    for (let k = 0; k < 200; k++) {
      const a = etal(`u${k}`, '2026-11-18', 0, 30);
      expect(a.map((x) => x.type)).toEqual(['cadre', 'cadre', 'objet', 'mallette']);
      expect(a[0].type === 'cadre' && a[1].type === 'cadre' && a[0].cadre !== a[1].cadre).toBe(true);
      expect(etal(`u${k}`, '2026-11-18', 0, 30)).toEqual(a);
    }
    // Une relance change l'étal.
    const diff = Array.from({ length: 50 }, (_, k) => JSON.stringify(etal(`v${k}`, 'j', 0, 1)) !== JSON.stringify(etal(`v${k}`, 'j', 1, 1))).filter(Boolean).length;
    expect(diff > 40).toBe(true);
    expect(valeurObjetMarche('voiture')).toBe(10_000_000_000);
  });

  it('remet l’étal à zéro chaque jour', () => {
    const e = etatSalonVide();
    expect(rafraichirMarche(e, 'j1')).toBe(true);
    e.marche.relances = 2;
    e.marche.achats = [0, 3];
    expect(rafraichirMarche(e, 'j1')).toBe(false);
    rafraichirMarche(e, 'j2');
    expect(e.marche).toEqual({ jour: 'j2', relances: 0, achats: [] });
    expect(normaliserMarche({ jour: 'j', relances: 9, achats: [1, 1, 7] })).toEqual({ jour: 'j', relances: 3, achats: [1] });
  });

  it('garde les cadres achetés et celui qu’on porte', () => {
    const e = etatSalonVide();
    e.cadres = ['mecene', CADRES_MARCHE[0]];
    expect(cadreSpecial(e.cadres, null)).toBe('mecene');
    e.cadreChoisi = CADRES_MARCHE[0];
    expect(cadreSpecial(e.cadres, e.cadreChoisi)).toBe(CADRES_MARCHE[0]);
    const relu = normaliserEtatSalon(JSON.parse(JSON.stringify({ ...e, cadres: [...e.cadres, 'faux'], cadreChoisi: 'faux2' })));
    expect(relu.cadres).toEqual(['mecene', CADRES_MARCHE[0]]);
    expect(relu.cadreChoisi).toBeNull();
    expect(cadreSpecial(['jazz'])).toBe('jazz');
  });
});
