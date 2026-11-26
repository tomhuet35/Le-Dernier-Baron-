import { describe, expect, it } from 'vitest';
import { esperanceChaises, esperanceFontaine, esperanceMinuit } from '../shared/baronWheel';
import { BONUS_BAL, CHIFFRES_BAL, ESPERANCE_PETITE_BAL, NB_CASES_BAL, NB_CRANS_BAL, ROUE_BAL, VALEUR_CHIFFRE_BAL, esperanceDonneBal, esperancePickpocketBal, recompenseBal, tirerBonusBal } from '../shared/balWheel';

describe('La roue du Bal', () => {
  it('54 cases, 30 crans, petite roue ×2,2', () => {
    expect(NB_CASES_BAL).toBe(54);
    expect(NB_CRANS_BAL).toBe(30);
    expect(ESPERANCE_PETITE_BAL).toBeCloseTo(2.2, 9);
    const n = (c: string) => ROUE_BAL.filter((x) => x === c).length;
    expect([n('b1'), n('b2'), n('b4'), n('b12'), n('b24')]).toEqual([24, 12, 6, 2, 1]);
    expect(BONUS_BAL.map(n)).toEqual([2, 2, 2, 2, 1]);
  });
  it('chaque case rend ≈ 97 %', () => {
    const rtp = (cases: number, x: number) => (cases / NB_CASES_BAL) * x * ESPERANCE_PETITE_BAL;
    for (const c of CHIFFRES_BAL) expect(rtp(ROUE_BAL.filter((x) => x === c).length, VALEUR_CHIFFRE_BAL[c])).toBeCloseTo(0.978, 3);
    const bonus: [number, number][] = [
      [2, esperancePickpocketBal()],
      [2, esperanceDonneBal()],
      [2, esperanceFontaine()],
      [2, esperanceChaises()],
      [1, esperanceMinuit()],
    ];
    for (const [n, e] of bonus) {
      expect(rtp(n, e)).toBeGreaterThan(0.955);
      expect(rtp(n, e)).toBeLessThan(0.985);
    }
  });
  it('les tirages des bonus donnent bien leur espérance', () => {
    let g = 11;
    const h = () => {
      g = (g * 16807) % 2147483647;
      return g / 2147483647;
    };
    const n = 100_000;
    let pp = 0;
    let gd = 0;
    for (let i = 0; i < n; i++) {
      pp += recompenseBal(tirerBonusBal('pickpocket', h), Math.floor(h() * 3));
      gd += recompenseBal(tirerBonusBal('donne', h), Math.floor(h() * 9));
    }
    expect(Math.abs(pp / n - esperancePickpocketBal())).toBeLessThan(0.4);
    expect(Math.abs(gd / n - esperanceDonneBal())).toBeLessThan(0.4);
  });
});
