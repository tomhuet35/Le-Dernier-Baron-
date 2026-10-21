import { describe, expect, it } from 'vitest';
import { appliquerAction, attenteDe, creerPartie } from '../shared/moteur';
import { actionRobot } from '../shared/robot';
import { suivant } from '../shared/rng';
import { vuePourJoueur } from '../shared/vue';
import type { EtatPartie } from '../shared/types';

/** Joue des parties complètes entre robots et vérifie les invariants à chaque étape. */
describe('Parties simulées', () => {
  it('40 parties de 3 à 6 joueurs vont au bout, sans fuite d’information', () => {
    for (let g = 0; g < 40; g++) {
      const nb = 3 + (g % 4);
      const joueurs = Array.from({ length: nb }, (_, i) => ({ id: `j${i}`, nom: `Joueur ${i}` }));
      let graine = 1000 + g;
      const alea = () => {
        const [x, s] = suivant(graine);
        graine = s;
        return x;
      };
      let e: EtatPartie = creerPartie(joueurs, g + 1);
      let etapes = 0;
      while (e.phase !== 'FIN_DE_PARTIE') {
        expect(etapes++).toBeLessThan(4000);
        // Aucune carte en double entre mains, pli et butins.
        const toutes = [...Object.values(e.mains).flat(), ...e.pli.map((p) => p.carteId), ...Object.values(e.butins).flat()];
        expect(new Set(toutes).size).toBe(toutes.length);
        for (const j of joueurs) {
          const vue = vuePourJoueur(e, j.id);
          const texte = JSON.stringify(vue);
          for (const k of joueurs) {
            if (k.id === j.id) continue;
            for (const c of e.mains[k.id]) expect(texte.includes(`"${c}"`)).toBe(false);
            if (!e.annoncesRevelees) expect(vue.joueurs.find((x) => x.id === k.id)?.annonce).toBeNull();
          }
          if (e.phase === 'ALLIANCE') expect(texte).not.toContain('choixAlliance');
        }
        if (e.phase === 'FIN_DE_PLI') {
          const r = appliquerAction(e, { type: 'SUITE' });
          if (!r.ok) throw new Error(r.erreur);
          e = r.etat;
          continue;
        }
        const qui = attenteDe(e)[0];
        const action = actionRobot(vuePourJoueur(e, qui), alea);
        expect(action).not.toBeNull();
        const r = appliquerAction(e, action!);
        if (!r.ok) throw new Error(`${r.erreur} (${JSON.stringify(action)})`);
        e = r.etat;
      }
      expect(e.bilans).toHaveLength(8);
      for (const j of joueurs) {
        const somme = e.bilans.reduce((s, b) => s + (b.scores.find((x) => x.joueurId === j.id)?.total ?? 0), 0);
        expect(e.scores[j.id]).toBe(somme);
      }
      expect(e.bilans.every((b) => b.scores.reduce((s, x) => s + x.plis, 0) === b.nuit)).toBe(true);
    }
  });

  it('refuse les coups interdits', () => {
    const e = creerPartie(
      [
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
      ],
      42,
    );
    expect(appliquerAction(e, { type: 'ANNONCE', joueurId: 'a', valeur: 5 }).ok).toBe(false);
    expect(appliquerAction(e, { type: 'JOUER', joueurId: 'a', carteId: e.mains.a[0] }).ok).toBe(false);
    expect(appliquerAction(e, { type: 'SUITE' }).ok).toBe(false);
  });
});
