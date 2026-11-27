import { describe, expect, it } from 'vitest';
import { casesFigurant, estFigurant, FIGURANTS, FIGURANTS_ACTIFS, miseFigurant, niveauFigurant, profilFigurant, soldeFigurant, spectateursAffiches } from '../server/figurants';
import { progressionCasino } from '../shared/profilCasino';

describe('Les figurants du salon', () => {
  it('ont des soldes qui ondulent sans jamais tomber trop bas', () => {
    const t0 = Date.UTC(2026, 10, 27);
    for (const f of FIGURANTS) {
      expect(estFigurant(f.uid)).toBe(true);
      for (let j = 0; j < 60; j++) {
        const s = soldeFigurant(f, t0 + j * 86_400_000);
        expect(s).toBeGreaterThan(f.base * 0.7);
        expect(s).toBeLessThan(f.base * 1.6);
      }
      expect(niveauFigurant(f)).toBeGreaterThanOrEqual(3);
    }
    expect(estFigurant('abc123')).toBe(false);
  });
  it('misent des jetons courants sur 1 à 3 cases', () => {
    let k = 0;
    const h = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
    for (let n = 0; n < 50; n++) {
      const c = casesFigurant(h, ['a', 'b', 'c'], ['x', 'y']);
      expect(c.length).toBeGreaterThanOrEqual(1);
      expect(c.length).toBeLessThanOrEqual(3);
      expect(new Set(c).size).toBe(c.length);
      expect(miseFigurant(FIGURANTS[0], h)).toBeGreaterThanOrEqual(500_000);
    }
  });
  it('ont un profil cohérent avec leur niveau', () => {
    const t = Date.UTC(2026, 10, 27, 20);
    for (const f of FIGURANTS) {
      const p = profilFigurant(f, t);
      expect(progressionCasino(p.mise).niveau).toBe(niveauFigurant(f));
      expect(p.gagne).toBeLessThanOrEqual(p.mise);
      expect(p.depuis).toBeLessThan(t);
    }
  });
  it('donnent un nombre de spectateurs qui bouge', () => {
    const t0 = Date.UTC(2026, 10, 27, 20);
    const vus = new Set(Array.from({ length: 30 }, (_, k) => spectateursAffiches(0, t0 + k * 5000, 'bw')));
    if (FIGURANTS_ACTIFS) expect(vus.size).toBeGreaterThan(2);
    else expect([...vus]).toEqual([0]);
  });
});
