import { describe, expect, it } from 'vitest';
import { appliquerAction, attenteDe, creerPartie } from '../shared/moteur';
import { actionRobot, NIVEAUX_BOT, STYLES_BOT, type ProfilBot } from '../shared/robot';
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
        // Chaque place a son propre niveau et style de bot : tous doivent jouer des coups autorisés.
        const i = Number(qui.slice(1));
        const profil: ProfilBot = { niveau: NIVEAUX_BOT[(g + i) % 3], style: STYLES_BOT[(g + 2 * i) % 4] };
        const action = actionRobot(vuePourJoueur(e, qui), alea, profil);
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

  it('les bots experts marquent nettement plus que les débutants', () => {
    const expert: ProfilBot = { niveau: 'expert', style: 'equilibre' };
    const debutant: ProfilBot = { niveau: 'debutant', style: 'equilibre' };
    let sommeExpert = 0;
    let sommeDebutant = 0;
    for (let g = 0; g < 60; g++) {
      const profils = [0, 1, 2, 3].map((i) => ((i + g) % 2 === 0 ? expert : debutant));
      const joueurs = profils.map((_, i) => ({ id: `j${i}`, nom: `J${i}` }));
      let graine = 7000 + g;
      const alea = () => {
        const [x, s] = suivant(graine);
        graine = s;
        return x;
      };
      let e = creerPartie(joueurs, 300 + g);
      while (e.phase !== 'FIN_DE_PARTIE') {
        const qui = e.phase === 'FIN_DE_PLI' ? null : attenteDe(e)[0];
        const r = qui
          ? appliquerAction(e, actionRobot(vuePourJoueur(e, qui), alea, profils[Number(qui.slice(1))])!)
          : appliquerAction(e, { type: 'SUITE' });
        if (!r.ok) throw new Error(r.erreur);
        e = r.etat;
      }
      profils.forEach((p, i) => (p === expert ? (sommeExpert += e.scores[`j${i}`]) : (sommeDebutant += e.scores[`j${i}`])));
    }
    expect(sommeExpert / 120).toBeGreaterThan(sommeDebutant / 120 + 10);
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
