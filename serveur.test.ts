import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { demarrerServeur } from '../server/serveur';
import { actionRobot, PRENOMS_BOTS } from '../shared/robot';
import type { VueSalon } from '../shared/types';

let serveur: Awaited<ReturnType<typeof demarrerServeur>>;
const url = () => `http://localhost:${serveur.port}`;

beforeAll(async () => {
  serveur = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, servirClient: false });
});
afterAll(async () => {
  await serveur.fermer();
});

function emettre(s: Socket, evt: string, data?: unknown): Promise<any> {
  return new Promise((ok) => s.emit(evt, data, ok));
}

describe('Réactions rapides', () => {
  it('une réaction est envoyée à toute la table, une à la fois, et seulement parmi les émojis prévus', async () => {
    const [a, b] = [io(url(), { transports: ['websocket'], forceNew: true }), io(url(), { transports: ['websocket'], forceNew: true })];
    expect((await emettre(a, 'reaction', { emoji: '👏' })).ok).toBe(false); // hors salon
    const cree = await emettre(a, 'creer', { nom: 'Alice' });
    const rejoint = await emettre(b, 'rejoindre', { code: cree.code, nom: 'Bruno' });
    const recue = new Promise<any>((ok) => a.once('reaction', ok));
    expect((await emettre(b, 'reaction', { emoji: '🔥' })).ok).toBe(true);
    expect(await recue).toMatchObject({ joueurId: rejoint.joueurId, emoji: '🔥' });
    expect((await emettre(b, 'reaction', { emoji: '👏' })).ok).toBe(false); // trop rapproché
    expect((await emettre(a, 'reaction', { emoji: '💩' })).ok).toBe(false); // pas dans la liste
    a.close();
    b.close();
  });
});

describe('Tutoriel', () => {
  it('partie guidée de 3 nuits contre 2 ordinateurs, sans minuteur, avec la donne prévue', async () => {
    const s = io(url(), { transports: ['websocket'], forceNew: true });
    const vues: VueSalon[] = [];
    const fini = new Promise<VueSalon>((ok) => {
      let enCours = false;
      s.on('salon', async (v: VueSalon) => {
        vues.push(v);
        const p = v.partie;
        if (!p) return;
        if (p.phase === 'FIN_DE_PARTIE') return ok(v);
        if (enCours) return;
        enCours = true;
        const action = actionRobot(p);
        if (action) await emettre(s, 'action', action);
        enCours = false;
      });
    });
    const r = await emettre(s, 'tutoriel', { nom: 'Lucas' });
    expect(r.ok).toBe(true);
    const fin = await fini;
    const premiere = vues.find((v) => v.partie)!;
    expect(premiere.tutoriel).toBe(true);
    expect(premiere.tempsRestant).toBeNull();
    expect(premiere.joueurs.map((j) => j.nom)).toEqual(['Lucas', 'Greg', 'Cyrielle']);
    expect(premiere.partie!.nbNuits).toBe(3);
    expect(premiere.partie!.main.map((c) => c.id)).toEqual(['lames-08']);
    const nuit2 = vues.find((v) => v.partie?.nuit === 2 && v.partie.phase === 'ANNONCES')!.partie!;
    expect(nuit2.main.map((c) => c.id).sort()).toEqual(['chat-noir-05', 'lames-03']);
    expect(nuit2.evenement).toBe('casse_du_siecle');
    const nuit3 = vues.find((v) => v.partie?.nuit === 3 && v.partie.phase === 'ANNONCES')!.partie!;
    expect(nuit3.main.map((c) => c.id)).toContain('baron');
    expect(nuit3.evenement).toBeNull();
    expect(vues.every((v) => v.tempsRestant === null)).toBe(true);
    expect(fin.partie!.bilans).toHaveLength(3);
    s.close();
  }, 30_000);
});

describe('Serveur de bout en bout', () => {
  it('trois téléphones jouent une partie complète, chacun ne voyant que sa main', async () => {
    const noms = ['Alice', 'Bruno', 'Chloé'];
    const sockets = noms.map(() => io(url(), { transports: ['websocket'], forceNew: true }));
    const dernieres: (VueSalon | null)[] = [null, null, null];
    const fuites: string[] = [];
    const fin = sockets.map(
      (s, i) =>
        new Promise<VueSalon>((termine) => {
          let enCours = false;
          const agir = async () => {
            if (enCours) return;
            enCours = true;
            for (let k = 0; k < 20; k++) {
              const p = dernieres[i]?.partie;
              const action = p && p.phase !== 'FIN_DE_PARTIE' ? actionRobot(p) : null;
              if (!action) break;
              const r = await emettre(s, 'action', action);
              if (!r.ok && dernieres[i]?.partie === p) break;
            }
            enCours = false;
          };
          s.on('salon', (v: VueSalon) => {
            dernieres[i] = v;
            const p = v.partie;
            if (!p) return;
            if (JSON.stringify(p.joueurs).includes('"main"')) fuites.push(noms[i]);
            if (p.phase === 'FIN_DE_PARTIE') return termine(v);
            void agir();
          });
        }),
    );
    const cree = await emettre(sockets[0], 'creer', { nom: 'Alice' });
    expect(cree.ok).toBe(true);
    for (const s of sockets.slice(1)) expect((await emettre(s, 'rejoindre', { code: cree.code, nom: 'Ami' })).ok).toBe(true);
    // Un joueur qui n'est pas l'hôte ne peut pas lancer.
    expect((await emettre(sockets[1], 'lancer')).ok).toBe(false);
    expect((await emettre(sockets[0], 'lancer')).ok).toBe(true);
    const finales = await Promise.race([
      Promise.all(fin),
      new Promise<never>((_, ko) => setTimeout(() => ko(new Error('La partie ne se termine pas')), 50000)),
    ]);
    expect(fuites).toEqual([]);
    for (const v of finales) expect(v.partie?.bilans).toHaveLength(8);
    sockets.forEach((s) => s.close());
  });

  it('un joueur qui recharge la page retrouve sa place', async () => {
    const a = io(url(), { transports: ['websocket'], forceNew: true });
    const cree = await emettre(a, 'creer', { nom: 'Hôte', modeTest: true });
    await emettre(a, 'ajouter_bot');
    await emettre(a, 'ajouter_bot');
    expect((await emettre(a, 'lancer')).ok).toBe(true);
    a.close();
    const b = io(url(), { transports: ['websocket'], forceNew: true });
    const vue = new Promise<VueSalon>((ok) => b.once('salon', ok));
    const r = await emettre(b, 'reprendre', { code: cree.code, jeton: cree.jeton });
    expect(r.ok).toBe(true);
    const v = await vue;
    expect(v.moi).toBe(cree.joueurId);
    expect(v.partie?.main.length).toBeGreaterThan(0);
    b.close();
  });

  it('parties publiques : deux joueurs du monde entier se retrouvent, les bots complètent la table', async () => {
    const pub = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, dureeTour: 40, attentePublique: 400, servirClient: false });
    const url2 = `http://localhost:${pub.port}`;
    const [a, b] = [io(url2, { transports: ['websocket'], forceNew: true }), io(url2, { transports: ['websocket'], forceNew: true })];
    const premiere = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.partie && ok(v)));
    const ra = await emettre(a, 'jouer_public', { nom: 'Lucas' });
    const rb = await emettre(b, 'jouer_public', { nom: 'Kim' });
    expect(ra.ok && rb.ok).toBe(true);
    expect(rb.code).toBe(ra.code); // même table
    // Une partie publique ne se lance pas à la main.
    expect((await emettre(a, 'lancer')).ok).toBe(false);
    const v = await premiere;
    expect(v.publique).toBe(true);
    expect(v.joueurs).toHaveLength(6);
    const bots = v.joueurs.filter((j) => j.bot);
    expect(bots).toHaveLength(4);
    for (const j of bots) expect(PRENOMS_BOTS).toContain(j.nom);
    // Fiches des joueurs : bot avec niveau et style, invité sans statistiques.
    const fiche = await emettre(a, 'profil_joueur', { joueurId: bots[0].id });
    expect(fiche.profil).toMatchObject({ type: 'bot', nom: bots[0].nom, niveau: bots[0].bot?.niveau, style: bots[0].bot?.style });
    expect((await emettre(a, 'profil_joueur', { joueurId: rb.joueurId })).profil).toEqual({ type: 'invite', nom: 'Kim', avatar: expect.any(Number) });
    // Kim quitte : l'ordinateur reprend aussitôt sa place.
    const apres = new Promise<VueSalon>((ok) => a.on('salon', (x: VueSalon) => x.joueurs.find((j) => j.id === rb.joueurId)?.robot && ok(x)));
    await emettre(b, 'quitter');
    expect((await apres).joueurs.find((j) => j.id === rb.joueurId)?.connecte).toBe(false);
    // La partie va au bout (le minuteur joue pour Lucas qui ne fait rien).
    const fin = await new Promise<VueSalon>((ok) => a.on('salon', (x: VueSalon) => x.partie?.phase === 'FIN_DE_PARTIE' && ok(x)));
    expect(fin.partie?.bilans).toHaveLength(8);
    a.close();
    b.close();
    await pub.fermer();
  });

  it('un joueur seul en partie publique joue contre 5 bots ; une nouvelle table s’ouvre pour les suivants', async () => {
    const pub = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, attentePublique: 200, servirClient: false });
    const url2 = `http://localhost:${pub.port}`;
    const a = io(url2, { transports: ['websocket'], forceNew: true });
    const lancee = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.partie && ok(v)));
    const premiereVue = new Promise<VueSalon>((ok) => a.once('salon', ok));
    const ra = await emettre(a, 'jouer_public', { nom: 'Solo' });
    const attente = await premiereVue;
    expect(attente.partie).toBeNull();
    expect(attente.departDans).toBeGreaterThan(0);
    const v = await lancee;
    expect(v.joueurs.filter((j) => j.bot)).toHaveLength(5);
    const b = io(url2, { transports: ['websocket'], forceNew: true });
    const rb = await emettre(b, 'jouer_public', { nom: 'Retard' });
    expect(rb.code).not.toBe(ra.code);
    a.close();
    b.close();
    await pub.fermer();
  });

  it('partie privée : l’hôte ajoute des bots au niveau et au style choisis', async () => {
    const a = io(url(), { transports: ['websocket'], forceNew: true });
    const b = io(url(), { transports: ['websocket'], forceNew: true });
    const cree = await emettre(a, 'creer', { nom: 'Hôte' });
    await emettre(b, 'rejoindre', { code: cree.code, nom: 'Invité' });
    expect((await emettre(b, 'ajouter_bot', { niveau: 'expert' })).ok).toBe(false); // pas l'hôte
    const vue = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.joueurs.length === 4 && ok(v)));
    expect((await emettre(a, 'ajouter_bot', { niveau: 'expert', style: 'voleur' })).ok).toBe(true);
    expect((await emettre(a, 'ajouter_bot')).ok).toBe(true);
    const v = await vue;
    expect(v.publique).toBe(false);
    expect(v.joueurs[2].bot).toEqual({ niveau: 'expert', style: 'voleur' });
    expect(v.joueurs[3].bot).not.toBeNull();
    expect(new Set(v.joueurs.map((j) => j.nom)).size).toBe(4);
    a.close();
    b.close();
  });

  it("l'ordinateur joue à la place d'un joueur qui ne fait rien pendant le temps imparti", async () => {
    const rapide = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, dureeTour: 30, servirClient: false });
    const a = io(`http://localhost:${rapide.port}`, { transports: ['websocket'], forceNew: true });
    const fin = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.partie?.phase === 'FIN_DE_PARTIE' && ok(v)));
    await emettre(a, 'creer', { nom: 'Absent', modeTest: true });
    await emettre(a, 'ajouter_bot');
    await emettre(a, 'ajouter_bot');
    expect((await emettre(a, 'avatar', { avatar: 2 })).ok).toBe(false); // déjà pris par un robot
    await emettre(a, 'lancer');
    const v = await fin;
    expect(v.partie?.bilans).toHaveLength(8);
    expect(v.joueurs.map((j) => j.avatar).sort()).toEqual([1, 2, 3]);
    a.close();
    await rapide.fermer();
  });

  it('langue anglaise : les messages du serveur et le journal sont en anglais', async () => {
    const en = io(url(), { transports: ['websocket'], forceNew: true, auth: { langue: 'en' } });
    const fr = io(url(), { transports: ['websocket'], forceNew: true });
    expect((await emettre(en, 'rejoindre', { code: 'ZZZZ', nom: 'Sam' })).erreur).toBe('No game with this code.');
    expect((await emettre(fr, 'rejoindre', { code: 'ZZZZ', nom: 'Sam' })).erreur).toBe('Aucune partie avec ce code.');
    const cree = await emettre(en, 'creer', { nom: 'Sam' });
    await emettre(fr, 'rejoindre', { code: cree.code, nom: 'Léa' });
    await emettre(en, 'ajouter_bot');
    const lancee = new Promise<VueSalon>((ok) => en.on('salon', (v: VueSalon) => v.partie && ok(v)));
    await emettre(en, 'lancer');
    const v = await lancee;
    // Chaque ligne du journal existe dans les deux langues.
    expect(v.partie!.journal[0].texte).toMatch(/^La partie commence/);
    expect(v.partie!.journal[0].en).toMatch(/^The game begins/);
    expect(v.partie!.journal.some((e) => /^Night 1: 1 card each/.test(e.en ?? ''))).toBe(true);
    // Erreurs du moteur traduites.
    expect((await emettre(en, 'action', { type: 'ANNONCE', valeur: 9 })).erreur).toBe('Your bid must be between 0 and 1.');
    expect((await emettre(fr, 'action', { type: 'ANNONCE', valeur: 9 })).erreur).toBe("L'annonce doit être comprise entre 0 et 1.");
    en.close();
    fr.close();
  });

  it('revanche en fin de partie en ligne : on rejoue à la même table, un ordinateur remplace celui qui ne veut pas', async () => {
    const pub = await demarrerServeur({ port: 0, delaiFinDePli: 5, delaiRobot: 5, dureeTour: 30, attentePublique: 300, delaiRevanche: 1500, servirClient: false });
    const url2 = `http://localhost:${pub.port}`;
    const [a, b, c] = [0, 1, 2].map(() => io(url2, { transports: ['websocket'], forceNew: true }));
    const dernieres = new Map<Socket, VueSalon>();
    for (const s of [a, b, c]) s.on('salon', (v: VueSalon) => dernieres.set(s, v));
    const finPartie = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.partie?.phase === 'FIN_DE_PARTIE' && ok(v)));
    const ra = await emettre(a, 'jouer_public', { nom: 'Alma' });
    const rb = await emettre(b, 'jouer_public', { nom: 'Bao' });
    const rc = await emettre(c, 'jouer_public', { nom: 'Cyd' });
    expect(new Set([ra.code, rb.code, rc.code]).size).toBe(1);
    const fin = await finPartie;
    expect(fin.revanche ?? null).toBeNull();
    // Pas de revanche en pleine partie privée ou hors fin de partie.
    expect((await emettre(io(url2, { transports: ['websocket'], forceNew: true }), 'revanche')).ok).toBe(false);
    const sorti = new Promise<void>((ok) => c.once('sorti', () => ok()));
    const relancee = new Promise<VueSalon>((ok) => a.on('salon', (v: VueSalon) => v.partie && v.partie.phase !== 'FIN_DE_PARTIE' && ok(v)));
    expect((await emettre(a, 'revanche', { veut: true })).ok).toBe(true);
    expect((await emettre(b, 'revanche', { veut: true })).ok).toBe(true);
    await new Promise((ok) => setTimeout(ok, 100));
    expect(dernieres.get(a)!.revanche?.votants.sort()).toEqual([ra.joueurId, rb.joueurId].sort());
    // Cyd ne répond pas : au bout du délai, la revanche part sans lui.
    const v = await relancee;
    await sorti;
    expect(v.code).toBe(ra.code);
    expect(v.partie!.nuit).toBe(1);
    expect(v.joueurs).toHaveLength(6);
    expect(v.joueurs.map((j) => j.id)).toEqual(expect.arrayContaining([ra.joueurId, rb.joueurId]));
    expect(v.joueurs.some((j) => j.id === rc.joueurId)).toBe(false);
    expect(v.joueurs.filter((j) => j.bot)).toHaveLength(4);
    for (const s of [a, b, c]) s.close();
    await pub.fermer();
  }, 40_000);
});

