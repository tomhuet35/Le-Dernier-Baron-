import { describe, expect, it } from 'vitest';
import { COLONNES_BULLES, GAIN_MAX_BULLES, jouerBulles, LIGNES_BULLES, MISES_BULLES } from '../shared/bulles';

let graine = 12345;
const hasard = () => {
  graine = (graine + 0x6d2b79f5) | 0;
  let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('Les Bulles du Baron', () => {
  it('mises de 1 000 $ à 10 000 000 $', () => {
    expect(MISES_BULLES[0]).toBe(1_000);
    expect(MISES_BULLES.at(-1)).toBe(10_000_000);
  });
  it('grilles de 6 × 5, gains cohérents et plafonnés', () => {
    for (let k = 0; k < 3000; k++) {
      const r = jouerBulles(10_000, hasard);
      expect(r.tour.etapes[0].grille.length).toBe(COLONNES_BULLES);
      expect(r.tour.etapes[0].grille[0].length).toBe(LIGNES_BULLES);
      const somme = r.tour.gain + r.gratuits.reduce((s, t) => s + t.gain, 0);
      expect(r.gain).toBe(Math.min(somme, GAIN_MAX_BULLES * 10_000));
      expect(r.gain >= 0).toBe(true);
    }
  });
  it('rend en moyenne entre 85 % et 105 % des mises', () => {
    let mise = 0;
    let gain = 0;
    for (let k = 0; k < 200_000; k++) {
      const r = jouerBulles(1_000, hasard);
      mise += 1_000;
      gain += r.gain;
    }
    const rtp = gain / mise;
    expect(rtp > 0.85 && rtp < 1.05).toBe(true);
  });
});
