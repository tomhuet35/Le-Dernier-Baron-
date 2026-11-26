import { describe, expect, it } from 'vitest';

// Une horloge factice : setTimeout et l'heure sont pilotés par le test.
let maintenant = 0;
let file: { t: number; f: () => void; id: number }[] = [];
let n = 0;
(globalThis as any).setTimeout = (f: () => void, ms: number) => {
  const t = { t: maintenant + ms, f, id: ++n, unref: () => undefined };
  file.push(t);
  return t;
};
(globalThis as any).clearTimeout = (x: any) => (file = file.filter((t) => t !== x));
const vi = {
  useFakeTimers: () => ((maintenant = 0), (file = [])),
  advanceTimersByTimeAsync: async (ms: number) => {
    const fin = maintenant + ms;
    for (;;) {
      await Promise.resolve();
      file.sort((a, b) => a.t - b.t);
      const t = file[0];
      if (!t || t.t > fin) break;
      file.shift();
      maintenant = t.t;
      t.f();
    }
    maintenant = fin;
  },
  useRealTimers: () => undefined,
};
const afterEach = (_f: () => void) => undefined;
import { creerBalWheel } from '../server/balWheelCasino';
import { PETITE_BAL, ROUE_BAL, recompenseBal } from '../shared/balWheel';

function monde(arret: { case: number; cran: number }) {
  const vues: any[] = [];
  const io = { to: () => ({ emit: (_e: string, v: any) => vues.push(v) }) } as any;
  const soldes = new Map<string, number>([['a', 1_000_000]]);
  const banque = {
    solde: (u: string) => soldes.get(u) ?? 0,
    debiter: (u: string, m: number) => ((soldes.get(u) ?? 0) >= m ? (soldes.set(u, (soldes.get(u) ?? 0) - m), true) : false),
    crediter: (u: string, m: number) => soldes.set(u, (soldes.get(u) ?? 0) + m),
    rembourser: (u: string, m: number) => soldes.set(u, (soldes.get(u) ?? 0) + m),
    joueur: () => ({ nom: 'Alice', avatar: 1 }),
  } as any;
  const bal = creerBalWheel({ io, banque, arret: () => arret, horloge: () => maintenant });
  const h = new Map<string, Function>();
  const socket = { id: 's1', on: (e: string, f: Function) => h.set(e, f), join: () => undefined, leave: () => undefined } as any;
  bal.brancher(socket, { acces: async () => ({ uid: 'a', nom: 'Alice' }) as any, enSalon: () => true, L: (fr) => fr });
  const appel = (e: string, d?: unknown) => new Promise<any>((ok) => void h.get(e)!(d ?? {}, ok));
  return { vues, soldes, appel, derniere: () => vues[vues.length - 1] };
}

describe('Le Bal (serveur)', () => {
  afterEach(() => vi.useRealTimers());
  it('un chiffre paie sa valeur fois la petite roue', async () => {
    vi.useFakeTimers();
    const i = ROUE_BAL.indexOf('b4');
    const j = PETITE_BAL.indexOf(5);
    const w = monde({ case: i, cran: j });
    expect((await w.appel('casino_bal_entrer')).ok).toBe(true);
    expect((await w.appel('casino_bal_miser', { case: 'b4', montant: 1000 })).ok).toBe(true);
    expect((await w.appel('casino_bal_miser', { case: 'b1', montant: 1000 })).ok).toBe(true);
    expect(w.soldes.get('a')).toBe(998_000);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(w.derniere().phase).toBe('tour');
    expect(w.derniere().arret).toBe(i);
    await vi.advanceTimersByTimeAsync(8_400);
    const v = w.derniere();
    expect(v.phase).toBe('resultat');
    expect(v.bilan).toEqual({ mise: 2000, gain: 20_000 });
    expect(w.soldes.get('a')).toBe(1_018_000);
  });
  it('un bonus : choix, révélation, paiement (petite roue comprise)', async () => {
    vi.useFakeTimers();
    const i = ROUE_BAL.indexOf('chaises');
    const j = PETITE_BAL.indexOf(3);
    const w = monde({ case: i, cran: j });
    await w.appel('casino_bal_entrer');
    await w.appel('casino_bal_miser', { case: 'chaises', montant: 5000 });
    await vi.advanceTimersByTimeAsync(12_000 + 8_400);
    let v = w.derniere();
    expect(v.phase).toBe('bonus');
    expect(v.bonus.type).toBe('chaises');
    expect(v.bonus.chaises.ordre).toBe(null);
    await vi.advanceTimersByTimeAsync(9_000);
    v = w.derniere();
    expect(v.bonus.etapes[v.bonus.etape].nom).toBe('pari');
    expect((await w.appel('casino_bal_choisir', { etape: v.bonus.etape, choix: 2 })).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    v = w.derniere();
    expect(v.bonus.etapes[v.bonus.etape].nom).toBe('musique');
    const ordre = v.bonus.chaises.ordre;
    expect(ordre).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(18_000 + 5_500);
    v = w.derniere();
    expect(v.phase).toBe('resultat');
    const x = recompenseBal({ type: 'chaises', ordre }, 2) * 3;
    expect(v.bonus.resultat.x).toBe(x);
    expect(v.bilan.gain).toBe(5000 * x);
  });
});
