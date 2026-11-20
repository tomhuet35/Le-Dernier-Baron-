import { describe, expect, it } from 'vitest';
import {
  albumComplet,
  changerContrat,
  collerMorceau,
  CONTRATS_DU_JOUR,
  CONTRATS_PAR_JOUR,
  dollarsContrat,
  echelleNiveau,
  etatSalonVide,
  hasardGraine,
  modeleContrat,
  MORCEAUX_PAGE,
  normaliserEtatSalon,
  noterEvenement,
  pageComplete,
  PRIX_CHANGER_CONTRAT,
  rafraichirContrats,
  RUBIS_ALBUM,
  RUBIS_CONTRAT,
  RUBIS_GROS_COUP,
  RUBIS_PAGE,
  RUBIS_TOUS_CONTRATS,
  texteContrat,
  tirerContrats,
  type EtatSalonJoueur,
} from '../shared/contrats';
import { JEUX_CASINO } from '../shared/profilCasino';

const premier = () => 0;
/** Un état avec des contrats choisis à la main. */
function etatAvec(ids: string[], niveau = 1): EtatSalonJoueur {
  const e = etatSalonVide();
  rafraichirContrats(e, 'u1', '2026-11-18', '2026-S47', niveau);
  e.contrats.liste = ids.map((id) => ({ id, cible: modeleContrat(id)!.cible(niveau), progres: 0, fait: false }));
  return e;
}

describe('Contrats du salon : tirage', () => {
  it('tire 3 contrats différents, jamais deux sur le même jeu, les mêmes pour le même jour', () => {
    for (let k = 0; k < 200; k++) {
      const l = tirerContrats(hasardGraine(`u${k}|2026-11-18`), CONTRATS_PAR_JOUR, 1);
      expect(l.length).toBe(3);
      expect(new Set(l.map((c) => c.id)).size).toBe(3);
      const jeux = l.map((c) => modeleContrat(c.id)!.jeu).filter(Boolean);
      expect(new Set(jeux).size).toBe(jeux.length);
    }
    const a = etatSalonVide();
    const b = etatSalonVide();
    rafraichirContrats(a, 'u1', '2026-11-18', '2026-S47', 1);
    rafraichirContrats(b, 'u1', '2026-11-18', '2026-S47', 1);
    expect(a.contrats.liste).toEqual(b.contrats.liste);
  });

  it('change les contrats chaque jour et les gros coups chaque semaine, sans toucher aux rubis ni à l’album', () => {
    const e = etatSalonVide();
    expect(rafraichirContrats(e, 'u1', '2026-11-18', '2026-S47', 1)).toBe(true);
    expect(rafraichirContrats(e, 'u1', '2026-11-18', '2026-S47', 1)).toBe(false);
    e.rubis = 7;
    e.album = { machine: 3 };
    e.contrats.grosCoups[0].progres = 2;
    rafraichirContrats(e, 'u1', '2026-11-19', '2026-S47', 1);
    expect(e.contrats.jour).toBe('2026-11-19');
    expect(e.contrats.grosCoups[0].progres).toBe(2);
    rafraichirContrats(e, 'u1', '2026-11-23', '2026-S48', 1);
    expect(e.contrats.grosCoups.every((c) => c.progres === 0)).toBe(true);
    expect(e.rubis).toBe(7);
    expect(e.album).toEqual({ machine: 3 });
  });

  it('fait grandir les objectifs d’argent avec le niveau', () => {
    expect(echelleNiveau(1)).toBe(1);
    expect(echelleNiveau(10)).toBe(2);
    expect(echelleNiveau(100)).toBe(11);
    const m = modeleContrat('mise-totale')!;
    expect(m.cible(1)).toBe(2_000_000);
    expect(m.cible(55)).toBe(12_000_000);
    expect(dollarsContrat(1)).toBe(100_000);
    expect(dollarsContrat(40)).toBe(2_000_000);
  });

  it('écrit le texte avec l’objectif', () => {
    const f = (n: number, en: boolean) => (en ? `$${n}` : `${n} $`);
    expect(texteContrat({ id: 'bandit-tours', cible: 20 }, f)).toEqual(['Jouer 20 tours au Bandit du Baron', 'Play 20 spins on The Baron’s Bandit']);
    expect(texteContrat({ id: 'mise-totale', cible: 2_000_000 }, f)).toEqual(['Miser 2000000 $ dans le salon', 'Bet $2000000 in the lounge']);
  });
});

describe('Contrats du salon : progression et récompenses', () => {
  it('compte les tours, les mises et les jeux différents', () => {
    const e = etatAvec(['bandit-tours', 'mise-totale', 'trois-jeux']);
    for (let k = 0; k < 19; k++) noterEvenement(e, { type: 'mise', jeu: 'machine', montant: 50_000 }, 1);
    expect(e.contrats.liste[0].progres).toBe(19);
    expect(e.contrats.liste[1].progres).toBe(950_000);
    expect(e.contrats.liste[2].progres).toBe(1);
    const r = noterEvenement(e, { type: 'mise', jeu: 'machine', montant: 50_000 }, 1);
    expect(r.contrats).toEqual([{ id: 'bandit-tours', cible: 20, semaine: false }]);
    expect(r.rubis).toBe(RUBIS_CONTRAT);
    expect(r.dollars).toBe(dollarsContrat(1));
    expect(r.morceaux).toEqual(['machine']);
    // Un contrat rempli ne rapporte qu'une fois.
    expect(noterEvenement(e, { type: 'mise', jeu: 'machine', montant: 50_000 }, 1).contrats).toEqual([]);
    noterEvenement(e, { type: 'mise', jeu: 'roulette', montant: 1000 }, 1);
    expect(e.contrats.liste[2].progres).toBe(2);
  });

  it('ne compte une victoire que si le gain dépasse la mise (une égalité ne compte pas)', () => {
    const e = etatAvec(['blackjack-victoires']);
    noterEvenement(e, { type: 'mise', jeu: 'blackjack', montant: 10_000 }, 1);
    const egalite = noterEvenement(e, { type: 'gain', jeu: 'blackjack', montant: 10_000, derniereMise: 10_000 }, 1);
    expect(e.contrats.liste[0].progres).toBe(0);
    expect(egalite.morceaux).toEqual([]);
    const r = noterEvenement(e, { type: 'gain', jeu: 'blackjack', montant: 20_000, derniereMise: 10_000 }, 1);
    expect(e.contrats.liste[0].progres).toBe(1);
    // Première victoire du jour au blackjack : un morceau de sa page.
    expect(r.morceaux).toEqual(['blackjack']);
    expect(noterEvenement(e, { type: 'gain', jeu: 'blackjack', montant: 20_000, derniereMise: 10_000 }, 1).morceaux).toEqual([]);
  });

  it('reconnaît un gros gain (×5, ×10 la mise) et les événements nommés', () => {
    const e = etatAvec(['couronne-gros', 'gros-gain', 'bandit-bonus']);
    noterEvenement(e, { type: 'gain', jeu: 'couronne', montant: 40_000, derniereMise: 10_000 }, 1);
    expect(e.contrats.liste[0].fait).toBe(false);
    noterEvenement(e, { type: 'gain', jeu: 'couronne', montant: 50_000, derniereMise: 10_000 }, 1);
    expect(e.contrats.liste[0].fait).toBe(true);
    expect(e.contrats.liste[1].fait).toBe(false);
    noterEvenement(e, { type: 'gain', jeu: 'chute', montant: 100_000, derniereMise: 10_000 }, 1);
    expect(e.contrats.liste[1].fait).toBe(true);
    const r = noterEvenement(e, { type: 'evenement', nom: 'bonusMachine' }, 1);
    expect(e.contrats.liste[2].fait).toBe(true);
    // Les 3 contrats remplis : le bonus, une seule fois.
    expect(r.tous).toBe(true);
    expect(r.rubis).toBe(RUBIS_CONTRAT + RUBIS_TOUS_CONTRATS);
    expect(noterEvenement(e, { type: 'evenement', nom: 'bonusMachine' }, 1).tous).toBe(false);
  });

  it('paie les gros coups de la semaine en rubis', () => {
    const e = etatAvec([]);
    for (let k = 0; k < 2; k++) noterEvenement(e, { type: 'evenement', nom: 'defiGagne' }, 1);
    const r = noterEvenement(e, { type: 'evenement', nom: 'defiGagne' }, 1);
    expect(r.contrats).toEqual([{ id: 'defis-gagnes', cible: 3, semaine: true }]);
    expect(r.rubis).toBe(RUBIS_GROS_COUP);
    expect(r.dollars).toBe(0);
    const jeux = JEUX_CASINO.slice(0, 5);
    let fin = null;
    for (const j of jeux) fin = noterEvenement(e, { type: 'mise', jeu: j, montant: 1000 }, 1);
    expect(fin!.contrats).toEqual([{ id: 'cinq-jeux', cible: 5, semaine: true }]);
  });

  it('ne compte pas une mise rendue', () => {
    const e = etatAvec(['bandit-tours']);
    noterEvenement(e, { type: 'mise', jeu: 'machine', montant: -1000 }, 1);
    expect(e.contrats.liste[0].progres).toBe(0);
  });
});

describe('Changer un contrat', () => {
  it('coûte des rubis, une fois par jour, et pas pour un contrat rempli', () => {
    const e = etatAvec(['bandit-tours', 'nuits-tours', 'trois-jeux']);
    expect(changerContrat(e, 0, 1, premier)).toBe('rubis');
    e.rubis = 10;
    e.contrats.liste[2].fait = true;
    expect(changerContrat(e, 2, 1, premier)).toBe('fait');
    expect(changerContrat(e, 0, 1, premier)).toBe('ok');
    expect(e.rubis).toBe(10 - PRIX_CHANGER_CONTRAT);
    const nouveau = modeleContrat(e.contrats.liste[0].id)!;
    expect(['bandit-tours', 'nuits-tours', 'trois-jeux']).not.toContain(nouveau.id);
    expect(nouveau.jeu).not.toBe('nuits');
    expect(changerContrat(e, 1, 1, premier)).toBe('deja');
  });
});

describe('Album du Baron', () => {
  it('colle les morceaux sur la bonne page, puis ailleurs ; une page puis l’album rapportent des rubis', () => {
    const e = etatSalonVide();
    for (let k = 0; k < MORCEAUX_PAGE - 1; k++) expect(collerMorceau(e, 'machine', premier)!.page).toBe(false);
    const fin = collerMorceau(e, 'machine', premier)!;
    expect(fin.page).toBe(true);
    expect(pageComplete(e.album.machine)).toBe(true);
    expect(e.rubis).toBe(RUBIS_PAGE);
    // Page pleine : le morceau va sur une autre page.
    expect(collerMorceau(e, 'machine', premier)!.jeu).not.toBe('machine');
    let dernier = null;
    for (let k = 0; k < 200 && !albumComplet(e.album); k++) dernier = collerMorceau(e, null, (n) => (k * 7) % n);
    expect(albumComplet(e.album)).toBe(true);
    expect(dernier!.album).toBe(true);
    expect(e.rubis).toBe(RUBIS_PAGE * JEUX_CASINO.length + RUBIS_ALBUM);
    expect(collerMorceau(e, 'machine', premier)).toBeNull();
  });
});

describe('Relecture', () => {
  it('tolère un état abîmé ou absent', () => {
    expect(normaliserEtatSalon(undefined)).toEqual(etatSalonVide());
    const e = normaliserEtatSalon({ rubis: -4, contrats: { liste: [{ id: 'inconnu' }, { id: 'bandit-tours', cible: 20, progres: 99, fait: true }], jeux: ['machine', 'faux'] }, album: { machine: 255, faux: 3 } });
    expect(e.rubis).toBe(0);
    expect(e.contrats.liste).toEqual([{ id: 'bandit-tours', cible: 20, progres: 20, fait: true }]);
    expect(e.contrats.jeux).toEqual(['machine']);
    expect(e.album).toEqual({ machine: 63 });
    expect(CONTRATS_DU_JOUR.length).toBeGreaterThanOrEqual(CONTRATS_PAR_JOUR * 2);
  });
});

describe('contrats selon le niveau', () => {
  const barSeul = (j: string) => ['machine', 'nuits', 'coffres', 'tickets'].includes(j);
  it('au niveau 1, aucun contrat sur un jeu pas encore débloqué', () => {
    for (let k = 0; k < 200; k++) {
      const e = etatSalonVide();
      rafraichirContrats(e, `u${k}`, '2026-11-20', '2026-S47', 1, barSeul as never);
      for (const c of e.contrats.liste) {
        const j = modeleContrat(c.id)?.jeu;
        expect(!j || barSeul(j)).toBe(true);
      }
      const cinq = e.contrats.grosCoups.find((g) => g.id === 'cinq-jeux');
      expect(cinq!.cible <= 4).toBe(true);
    }
  });
  it('remplace un contrat déjà tiré sur un jeu fermé', () => {
    const e = etatSalonVide();
    rafraichirContrats(e, 'u1', '2026-11-20', '2026-S47', 1);
    e.contrats.liste[0] = { id: 'folle-nuit-tours', cible: 5, progres: 0, fait: false };
    expect(rafraichirContrats(e, 'u1', '2026-11-20', '2026-S47', 1, barSeul as never)).toBe(true);
    expect(e.contrats.liste.some((c) => c.id === 'folle-nuit-tours')).toBe(false);
  });
  it('les contrats diffèrent d’un joueur à l’autre', () => {
    const vus = new Set<string>();
    for (let k = 0; k < 30; k++) { const e = etatSalonVide(); rafraichirContrats(e, `j${k}`, '2026-11-20', '2026-S47', 30); vus.add(e.contrats.liste.map((c) => c.id).sort().join()); }
    expect(vus.size > 10).toBe(true);
  });
});
