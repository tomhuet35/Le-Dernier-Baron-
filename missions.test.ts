import { describe, expect, it } from 'vitest';
import { avancerMissions, avatarGagne, normaliserMissions, type EtatMissions } from '../shared/missions';

const vide = (): EtatMissions => ({ missions: {}, trophees: [] });
const manche = { jeu: 'bal' as const, bonus: false, final: false, x: 1 };

describe('Missions des jeux', () => {
  it('compte les manches, les bonus, le grand final et les gros gains', () => {
    const e = vide();
    for (let k = 0; k < 49; k++) expect(avancerMissions(e, manche).finies).toEqual([]);
    expect(avancerMissions(e, manche).finies.map((m) => m.id)).toEqual(['bal.manches']);
    // Un ×100 sans avoir misé sur le bonus ne compte pas.
    avancerMissions(e, { ...manche, x: 200 });
    expect(e.missions['bal.x100'] ?? 0).toBe(0);
    expect(avancerMissions(e, { ...manche, bonus: true, final: true, x: 30 }).finies.map((m) => m.id)).toEqual(['bal.final']);
    const r = avancerMissions(e, { ...manche, bonus: true, x: 120 });
    expect(r.finies.map((m) => m.id)).toEqual(['bal.x100']);
    expect(r.trophee).toBe('horloge');
    expect(e.trophees).toEqual(['horloge']);
    // Trophée déjà gagné : plus rien ne bouge.
    expect(avancerMissions(e, { ...manche, bonus: true, x: 500 })).toEqual({ finies: [], trophee: null });
  });
  it('le Baron Express demande 5 bonus', () => {
    const e = vide();
    for (let k = 0; k < 4; k++) avancerMissions(e, { jeu: 'express', bonus: true, final: false, x: 10 });
    expect(e.missions['express.bonus']).toBe(4);
    expect(e.missions['express.manches']).toBe(4);
    expect(avancerMissions(e, { jeu: 'express', bonus: true, final: false, x: 150 }).finies.map((m) => m.id)).toEqual(['express.bonus', 'express.x100']);
    expect(e.trophees).toEqual([]);
  });
  it('relit un état gardé en bornant les valeurs', () => {
    expect(normaliserMissions({ 'bal.manches': 999, 'bal.inconnue': 3, 'express.bonus': -2 }, ['horloge', 'faux', 'horloge'])).toEqual({ missions: { 'bal.manches': 50, 'express.bonus': 0 }, trophees: ['horloge'] });
  });
  it('un ×1 000 donne le personnage du jeu, une seule fois', () => {
    expect(avatarGagne([], { jeu: 'express', bonus: false, final: false, x: 999 })).toBe(null);
    expect(avatarGagne([], { jeu: 'express', bonus: false, final: false, x: 1000 })).toBe(23);
    expect(avatarGagne([], { jeu: 'bal', bonus: true, final: true, x: 4000 })).toBe(22);
    expect(avatarGagne([22], { jeu: 'bal', bonus: true, final: true, x: 4000 })).toBe(null);
  });
});
