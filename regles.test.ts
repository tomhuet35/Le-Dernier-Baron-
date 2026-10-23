import { describe, expect, it } from 'vitest';
import { appliquerAction, creerPartie } from '../shared/moteur';
import { allianceReussiePour, calculerScore, cartesJouables, duelDuPli, resoudrePli } from '../shared/regles';
import type { CartePosee, EtatPartie } from '../shared/types';

/** Traduit « Lames 5 », « Chat noir 2 », « Croupier (11) »… en carte posée. */
const compteurs: Record<string, number> = {};
function id(nom: string): string {
  const m = nom.match(/^(Billets|Lingots|Lames|Diamants|Chat noir) (\d+)$/);
  if (m) return `${m[1].toLowerCase().replace(' ', '-')}-${m[2].padStart(2, '0')}`;
  const base = nom.replace(/ \(\d+\)$/, '').toLowerCase().replace(/ /g, '-');
  if (base === 'homme-de-main' || base === 'alibi') {
    compteurs[base] = ((compteurs[base] ?? 0) % (base === 'alibi' ? 5 : 3)) + 1;
    return `${base}-${compteurs[base]}`;
  }
  return base;
}
function pli(...cartes: [string, string][]): CartePosee[] {
  return cartes.map(([joueurId, nom]) => {
    const v = nom.match(/\((\d+)\)$/);
    return v ? { joueurId, carteId: id(nom), valeurCroupier: Number(v[1]) as 0 | 11 } : { joueurId, carteId: id(nom) };
  });
}

describe('Gagnant du pli et butin', () => {
  const cas: [number, [string, string][], string, string | null][] = [
    [1, [['A', 'Lames 5'], ['B', 'Lames 9'], ['C', 'Billets 10']], 'B', 'billets-10'],
    [2, [['A', 'Billets 3'], ['B', 'Chat noir 2'], ['C', 'Billets 10']], 'B', 'billets-10'],
    [3, [['A', 'Baron'], ['B', 'Chat noir 10'], ['C', 'Homme de main']], 'A', null],
    [4, [['A', 'Baron'], ['B', 'Pickpocket'], ['C', 'Lames 4']], 'B', 'lames-04'],
    [5, [['A', 'Homme de main'], ['B', 'Homme de main'], ['C', 'Chat noir 9']], 'A', null],
    [6, [['A', 'Alibi'], ['B', 'Lingots 2'], ['C', 'Lingots 6'], ['D', 'Lames 10']], 'C', 'lames-10'],
    [7, [['A', 'Croupier (11)'], ['B', 'Diamants 10'], ['C', 'Diamants 4']], 'A', 'diamants-10'],
    [8, [['A', 'Croupier (0)'], ['B', 'Diamants 1'], ['C', 'Billets 9']], 'B', 'billets-09'],
    [9, [['A', 'Juge'], ['B', 'Chat noir 3'], ['C', 'Lames 8'], ['D', 'Baron']], 'B', 'lames-08'],
    [10, [['A', 'Juge'], ['B', 'Croupier (11)'], ['C', 'Chat noir 10']], 'C', null],
    [15, [['A', 'Juge'], ['B', 'Lames 2'], ['C', 'Croupier (0)']], 'C', 'lames-02'],
    [11, [['A', 'Juge'], ['B', 'Baron'], ['C', 'Alibi']], 'B', null],
    [12, [['A', 'Alibi'], ['B', 'Alibi'], ['C', 'Juge']], 'A', null],
    [13, [['A', 'Pickpocket'], ['B', 'Alibi'], ['C', 'Alibi']], 'A', null],
    [14, [['A', 'Juge'], ['B', 'Billets 7'], ['C', 'Chat noir 7'], ['D', 'Lames 7']], 'C', 'billets-07'],
  ];
  for (const [n, cartes, gagnant, butin] of cas) {
    it(`cas ${n}`, () => {
      const p = pli(...cartes);
      const r = resoudrePli(p);
      expect(p[r.gagnant].joueurId).toBe(gagnant);
      expect(r.butin === null ? null : p[r.butin].carteId).toBe(butin);
    });
  }
  it('cas 3 : bonus Baron + Homme de main ; cas 4 : Braquage', () => {
    expect(resoudrePli(pli(['A', 'Baron'], ['B', 'Chat noir 10'], ['C', 'Homme de main'])).hommesDeMainCaptures).toBe(1);
    expect(resoudrePli(pli(['A', 'Baron'], ['B', 'Pickpocket'], ['C', 'Lames 4'])).braquage).toBe(true);
    expect(resoudrePli(pli(['A', 'Pickpocket'], ['B', 'Alibi'], ['C', 'Alibi'])).braquage).toBe(false);
  });
});

describe('Cartes jouables', () => {
  const demande = pli(['A', 'Lames 7']);
  it('doit suivre la famille, ou jouer un Chat noir ou une spéciale', () => {
    expect(cartesJouables(['lames-02', 'chat-noir-08', 'alibi-1', 'billets-05'], demande).sort()).toEqual(['alibi-1', 'chat-noir-08', 'lames-02']);
  });
  it('sans carte de la famille, tout est jouable', () => {
    expect(cartesJouables(['chat-noir-08', 'billets-05', 'baron'], demande)).toHaveLength(3);
  });
  it('un Chat noir en tête impose le Chat noir', () => {
    expect(cartesJouables(['lames-02', 'chat-noir-01', 'juge'], pli(['A', 'Chat noir 4'])).sort()).toEqual(['chat-noir-01', 'juge']);
    expect(cartesJouables(['lames-02', 'billets-03'], pli(['A', 'Chat noir 4']))).toHaveLength(2);
  });
  it('après un Alibi, le Chat noir posé fixe la famille', () => {
    expect(cartesJouables(['lames-02', 'chat-noir-01'], pli(['A', 'Alibi'], ['B', 'Chat noir 4']))).toEqual(['chat-noir-01']);
  });
});

describe("Score d'une nuit", () => {
  const base = { evenement: null, bonusBaron: 0, braquages: 0, allianceReussie: false, butin: [] as number[] };
  const total = (p: Partial<Parameters<typeof calculerScore>[0]> & { nuit?: number; annonce: number; plis: number }) =>
    calculerScore({ ...base, nuit: 3, ...p }).total;
  it('S1 à S7', () => {
    expect(total({ nuit: 3, annonce: 2, plis: 2, butin: [10, 4] })).toBe(34);
    expect(total({ nuit: 5, annonce: 0, plis: 0 })).toBe(50);
    expect(total({ annonce: 3, plis: 1, butin: [6] })).toBe(-20);
    expect(total({ nuit: 5, annonce: 0, plis: 2 })).toBe(-50);
    expect(total({ annonce: 1, plis: 1, butin: [9], evenement: 'casse_du_siecle' })).toBe(28);
    expect(total({ annonce: 1, plis: 1, butin: [9], evenement: 'descente_police' })).toBe(10);
    expect(total({ annonce: 1, plis: 1, butin: [4], braquages: 1 })).toBe(54);
    expect(total({ annonce: 2, plis: 1, butin: [4], braquages: 1 })).toBe(-10);
  });
  it('S8 et S9 : alliance', () => {
    const alliances: [string, string][] = [['A', 'B']];
    const ok = allianceReussiePour('A', alliances, { A: true, B: true });
    expect(total({ annonce: 2, plis: 2, allianceReussie: ok })).toBe(40);
    expect(total({ annonce: 1, plis: 1, allianceReussie: allianceReussiePour('B', alliances, { A: true, B: true }) })).toBe(30);
    const rate = allianceReussiePour('A', alliances, { A: true, B: false });
    expect(total({ annonce: 2, plis: 2, allianceReussie: rate })).toBe(20);
    expect(total({ annonce: 1, plis: 0, allianceReussie: rate })).toBe(-10);
  });
});

describe('Vols et Trahison', () => {
  const joueurs = [
    { id: 'A', nom: 'Alice' },
    { id: 'B', nom: 'Bruno' },
    { id: 'C', nom: 'Chloé' },
  ];
  /** Le Pickpocket de A vient d'être posé ; B a un butin Lames 7. */
  function situationVol(evenement: EtatPartie['evenement'], mainB: string[], butinB: string[]): EtatPartie {
    const e = creerPartie(joueurs, 7);
    Object.assign(e, { nuit: 3, evenement, phase: 'VOL', tour: 0, pli: [{ joueurId: 'A', carteId: 'pickpocket' }] });
    e.vol = { voleurId: 'A', source: 'pickpocket' };
    e.mains = { A: ['billets-01', 'billets-02'], B: mainB, C: ['diamants-01', 'diamants-02', 'diamants-03'] };
    e.butins = { A: [], B: butinB, C: [] };
    return e;
  }
  const voler = (e: EtatPartie) => {
    const r = appliquerAction(e, { type: 'VOLER', joueurId: 'A', cibleId: 'B', carteId: 'lames-07' });
    if (!r.ok) throw new Error(r.erreur);
    return r.etat;
  };
  it('Couvre-feu : le vol réussit malgré l’Alibi', () => {
    const e = voler(situationVol('couvre_feu', ['alibi-1', 'lingots-01'], ['lames-07']));
    expect(e.butins.A).toEqual(['lames-07']);
    expect(e.butins.B).toEqual([]);
  });
  it('Alibi en main : protégé, et l’Alibi reste en main', () => {
    const e = voler(situationVol(null, ['alibi-1', 'lingots-01'], ['lames-07']));
    expect(e.butins.B).toEqual(['lames-07']);
    expect(e.mains.B).toContain('alibi-1');
  });
  it('Descente de police : aucun vol', () => {
    const e = voler(situationVol('descente_police', ['lingots-01'], ['lames-07']));
    expect(e.butins.B).toEqual(['lames-07']);
  });
  it('Cible sans butin : rien ne se passe', () => {
    const e = voler(situationVol(null, ['lingots-01'], []));
    expect(e.butins.A).toEqual([]);
    expect(e.phase).toBe('PLI');
    expect(e.tour).toBe(1);
  });
  it('Trahison : après les annonces, chacun passe une carte au joueur de droite', () => {
    let e = creerPartie(joueurs, 3);
    Object.assign(e, { phase: 'TRAHISON', choixTrahison: {} });
    e.mains = { A: ['lames-01', 'lames-02'], B: ['billets-01', 'billets-02'], C: ['diamants-01', 'diamants-02'] };
    for (const [j, c] of [['A', 'lames-01'], ['B', 'billets-01'], ['C', 'diamants-01']]) {
      const r = appliquerAction(e, { type: 'TRAHISON', joueurId: j, carteId: c });
      if (!r.ok) throw new Error(r.erreur);
      e = r.etat;
    }
    expect(e.mains.A).toContain('billets-01');
    expect(e.mains.B).toContain('diamants-01');
    expect(e.mains.C).toContain('lames-01');
    expect(e.phase).toBe('PLI');
  });
});

describe('Grands moments d’un pli', () => {
  const pli = (cartes: [string, string][], gagnantId: string, braquage = false) => ({
    cartes: cartes.map(([joueurId, carteId]) => ({ joueurId, carteId })),
    gagnantId,
    braquage,
  });
  it('le Baron qui gagne avec des Hommes de main dans le pli', () => {
    const d = duelDuPli(pli([['a', 'homme-de-main-1'], ['b', 'baron'], ['c', 'homme-de-main-3']], 'b'));
    expect(d).toMatchObject({ type: 'baron', gagnante: { carteId: 'baron' }, perdante: { carteId: 'homme-de-main-1' }, nombre: 2 });
  });
  it('le Pickpocket qui braque le Baron', () => {
    const d = duelDuPli(pli([['a', 'baron'], ['b', 'pickpocket'], ['c', 'billets-05']], 'b', true));
    expect(d).toMatchObject({ type: 'braquage', gagnante: { carteId: 'pickpocket' }, perdante: { carteId: 'baron' } });
  });
  it('rien pour un pli ordinaire ou un Baron seul', () => {
    expect(duelDuPli(pli([['a', 'baron'], ['b', 'billets-05']], 'a'))).toBeNull();
    expect(duelDuPli(pli([['a', 'homme-de-main-1'], ['b', 'billets-05']], 'a'))).toBeNull();
  });
  it('les vrais plis du moteur donnent bien ces deux moments', () => {
    for (const [cartes, attendu] of [
      [['baron', 'homme-de-main-2'], 'baron'],
      [['pickpocket', 'baron', 'homme-de-main-1'], 'braquage'],
    ] as const) {
      const posees = cartes.map((carteId, i) => ({ joueurId: `j${i}`, carteId }));
      const r = resoudrePli(posees);
      expect(duelDuPli({ cartes: posees, gagnantId: posees[r.gagnant].joueurId, braquage: r.braquage })?.type).toBe(attendu);
    }
  });
});
