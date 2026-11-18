import { describe, expect, it } from 'vitest';
import { creerCercles } from '../server/cerclesCasino';
import { messageValide, miseCercle, nomCercleValide, normaliserCercles, nouveauCercle, peutGerer, retirerMembre, tirerCagnotte, type Cercle } from '../shared/cercles';

const fondateur = { uid: 'a', nom: 'Alice', avatar: 1 };
function cercle(): Cercle {
  const c = nouveauCercle('c1', 'Les Corbeaux', 'loup', true, fondateur, 1000, '2026-S47');
  c.membres.push({ uid: 'b', nom: 'Bob', avatar: 2, role: 'membre', depuis: 2000, mise: 0 });
  c.membres.push({ uid: 'c', nom: 'Cléo', avatar: 3, role: 'croupier', depuis: 3000, mise: 0 });
  return c;
}

describe('Cercles', () => {
  it('vérifie le nom et nettoie les messages', () => {
    expect(nomCercleValide('  Les   Corbeaux ')).toBe('Les Corbeaux');
    expect(nomCercleValide('ab')).toBeNull();
    expect(nomCercleValide('<script>')).toBeNull();
    expect(nomCercleValide(42)).toBeNull();
    expect(messageValide('   ')).toBeNull();
    expect(messageValide('bonjour   à tous')).toBe('bonjour à tous');
  });

  it('donne les droits au président et au croupier, et passe la présidence au croupier', () => {
    const c = cercle();
    expect(peutGerer(c, 'a')).toBe(true);
    expect(peutGerer(c, 'c')).toBe(true);
    expect(peutGerer(c, 'b')).toBe(false);
    retirerMembre(c, 'a');
    expect(c.membres.find((m) => m.uid === 'c')!.role).toBe('president');
    retirerMembre(c, 'c');
    expect(c.membres[0]).toMatchObject({ uid: 'b', role: 'president' });
  });

  it('tire la cagnotte entre les membres qui ont misé, une fois par semaine', () => {
    const c = cercle();
    c.membres[1].mise = 5_000_000;
    c.cagnotte = 50_000;
    expect(miseCercle(c)).toBe(5_000_000);
    expect(tirerCagnotte(c, '2026-S47', () => 0)).toBeNull();
    const g = tirerCagnotte(c, '2026-S48', () => 0);
    expect(g).toEqual({ uid: 'b', nom: 'Bob', montant: 50_000 });
    expect(c.cagnotte).toBe(0);
    expect(miseCercle(c)).toBe(0);
    expect(c.dernierTirage).toEqual({ nom: 'Bob', montant: 50_000, semaine: '2026-S47' });
    // Personne n'a misé : la cagnotte reste pour la semaine suivante.
    c.cagnotte = 10;
    expect(tirerCagnotte(c, '2026-S49', () => 0)).toBeNull();
    expect(c.cagnotte).toBe(10);
  });

  it('relit les cercles gardés et écarte ce qui est abîmé', () => {
    const c = cercle();
    c.messages.push({ t: 1, uid: 'a', nom: 'Alice', avatar: 1, texte: 'salut' });
    const relus = normaliserCercles(JSON.parse(JSON.stringify([c, { id: 'vide', nom: 'x', membres: [] }, 'faux'])));
    expect(relus).toEqual([c]);
  });
});


describe('Cercles : le serveur', () => {
  it('fonde, fait entrer, gère les demandes, la cagnotte et la discussion', async () => {
    let t = Date.UTC(2026, 10, 18, 12);
    let semaine = '2026-S47';
    const rubis: Record<string, number> = { a: 60, b: 0, c: 0, d: 0 };
    const verses: [string, number][] = [];
    const recus: string[] = [];
    let garde: unknown = undefined;
    const c = creerCercles({
      horloge: () => t,
      semaine: () => ({ cle: semaine, fin: t + 1 }),
      lire: async () => undefined,
      ecrire: async (l) => void (garde = JSON.parse(JSON.stringify(l))),
      payerRubis: (uid, n) => (rubis[uid] >= n ? ((rubis[uid] -= n), true) : false),
      verser: (uid, m) => verses.push([uid, m]),
      notifier: (uid, ev) => recus.push(`${uid}:${ev}`),
      delaiEcriture: 0,
    });
    await c.chargement;
    const A = { uid: 'a', nom: 'Alice', avatar: 1 };
    const B = { uid: 'b', nom: 'Bob', avatar: 2 };
    const C = { uid: 'c', nom: 'Cléo', avatar: 3 };
    expect(c.fonder(B, 'Les Corbeaux', 'loup', true)).toBe('rubis');
    expect(c.fonder(A, 'Les Corbeaux', 'loup', true)).toBe('ok');
    expect(rubis.a).toBe(10);
    expect(c.fonder(A, 'Autre', 'lion', true)).toBe('deja_membre');
    const id = c.cercleDe('a')!;
    expect(c.rejoindre(B, id)).toBe('ok');
    expect(c.changerOuverture('b', false)).toBe('droits');
    expect(c.changerOuverture('a', false)).toBe('ok');
    expect(c.rejoindre(C, id)).toBe('demande_envoyee');
    expect(c.vue('a').mien!.demandes.length).toBe(1);
    expect(c.vue('b').mien!.demandes.length).toBe(0);
    expect(c.repondreDemande('b', 'c', true)).toBe('droits');
    expect(c.nommerCroupier('a', 'b')).toBe('ok');
    expect(c.repondreDemande('b', 'c', true)).toBe('ok');
    expect(c.vue('c').mien!.membres.length).toBe(3);
    expect(c.exclure('b', 'a')).toBe('droits');
    expect(c.message(C, '  bonsoir  ')).toBe('ok');
    expect(c.vue('a').mien!.messages[0].texte).toBe('bonsoir');
    c.noterMise('c', 10_000_000);
    expect(c.vue('a').mien!.cagnotte).toBe(100_000);
    expect(c.vue('a').classement[0].mise).toBe(10_000_000);
    semaine = '2026-S48';
    c.noterMise('a', 1);
    expect(verses).toEqual([['c', 100_000]]);
    expect(c.quitter('a')).toBe('ok');
    expect(c.vue('b').mien!.moi).toBe('president');
    await new Promise((ok) => setTimeout(ok, 5));
    expect(Array.isArray(garde)).toBe(true);
    await c.fermer();
  });
});
