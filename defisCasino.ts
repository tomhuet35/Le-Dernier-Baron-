/**
 * Défis 1 contre 1 entre amis du casino (Salon privé).
 *
 * - Un joueur invite un ami : jeu (ou tous les jeux), durée (5 à 30 min), mise du défi (0 : pour l'honneur). Sa mise
 *   est prise tout de suite (rendue si l'ami refuse, si l'invitation expire au bout de 10 min, ou s'il l'annule).
 * - L'ami accepte : sa mise est prise, le défi commence. Chacun joue de son côté ; le serveur compte, pour chacun, le
 *   bilan (gains − mises) au jeu choisi pendant la durée du défi.
 * - À la fin, le meilleur bilan remporte les deux mises ; égalité : chacun récupère la sienne.
 * - Les défis sont gardés avec les réglages du serveur : après un redémarrage, ils reprennent là où ils en étaient
 *   (une invitation expirée entre-temps est rendue, un défi fini entre-temps est réglé).
 */
import { randomBytes } from 'node:crypto';
import type { AnnonceCasino } from '../shared/casino';
import {
  DEFIS_ENVOYES_MAX,
  DUREES_DEFI,
  estJeuDefi,
  EXPIRATION_DEFI,
  MISES_DEFI,
  type EtatDefi,
  type JeuCasino,
  type JeuDefi,
  type JoueurDefi,
  type VueDefi,
} from '../shared/profilCasino';

interface Defi {
  id: string;
  de: JoueurDefi;
  vers: JoueurDefi;
  jeu: JeuDefi;
  duree: number;
  mise: number;
  etat: EtatDefi;
  creeLe: number;
  /** Fin de l'invitation. */
  expire: number;
  debut: number | null;
  fin: number | null;
  scores: { de: number; vers: number };
  gagnant: 'de' | 'vers' | 'nul' | null;
  /** Heure du dernier changement d'état (pour ne garder que les défis récents). */
  majLe: number;
}

export interface OptionsDefis {
  horloge: () => number;
  /** Prend une mise de défi (hors jeu) ; false si le solde manque. */
  prelever: (uid: string, montant: number) => boolean;
  /** Verse de l'argent (gain d'un défi, mise rendue), même si le joueur n'est pas au salon. */
  verser: (uid: string, montant: number) => void;
  /** Un défi fini, pour le journal et le bilan du joueur (montant : ce qu'il gagne, ou perd, en plus de sa mise). */
  resultat: (uid: string, adversaire: string, r: 'gagne' | 'perdu' | 'nul', montant: number) => void;
  sontAmis: (a: string, b: string) => boolean;
  /** Envoie un défi (nouvel état ou scores) aux téléphones d'un joueur. */
  notifier: (uid: string, d: VueDefi) => void;
  annoncer: (a: AnnonceCasino) => void;
  /** Un défi a changé : les réglages du serveur sont à réécrire. */
  sauver: () => void;
  /** Cadence d'envoi des scores pendant un défi (ms). */
  pasScores?: number;
  /** Accélère les durées (tests) : 0,001 fait durer un défi de 5 minutes 300 ms. */
  echelle?: number;
}

type Resultat = { ok: true; defi: VueDefi } | { ok: false; erreur: [string, string] };
const refus = (fr: string, en: string): Resultat => ({ ok: false, erreur: [fr, en] });

/** Défis finis gardés (historique). */
const FINIS_GARDES = 40;

export function creerDefis(o: OptionsDefis) {
  const defis = new Map<string, Defi>();
  const minuteries = new Map<string, ReturnType<typeof setTimeout>>();
  const envoiScores = new Map<string, ReturnType<typeof setTimeout>>();
  const pasScores = o.pasScores ?? 800;
  const echelle = o.echelle ?? 1;

  const actif = (d: Defi) => d.etat === 'attente' || d.etat === 'enCours';
  const avec = (d: Defi, uid: string) => d.de.uid === uid || d.vers.uid === uid;

  function vue(d: Defi): VueDefi {
    const t = o.horloge();
    return {
      id: d.id,
      de: { ...d.de },
      vers: { ...d.vers },
      jeu: d.jeu,
      duree: d.duree,
      mise: d.mise,
      etat: d.etat,
      creeLe: d.creeLe,
      scores: { ...d.scores },
      gagnant: d.gagnant,
      reste: d.etat === 'attente' ? Math.max(0, d.expire - t) : d.etat === 'enCours' && d.fin !== null ? Math.max(0, d.fin - t) : null,
      fin: d.fin,
    };
  }

  function prevenir(d: Defi) {
    const v = vue(d);
    o.notifier(d.de.uid, v);
    o.notifier(d.vers.uid, v);
  }

  function arreter(id: string) {
    const m = minuteries.get(id);
    if (m) clearTimeout(m);
    minuteries.delete(id);
    const s = envoiScores.get(id);
    if (s) clearTimeout(s);
    envoiScores.delete(id);
  }

  function armer(d: Defi) {
    arreter(d.id);
    const t = o.horloge();
    const quand = d.etat === 'attente' ? d.expire : d.etat === 'enCours' && d.fin !== null ? d.fin : null;
    if (quand === null) return;
    const m = setTimeout(() => (d.etat === 'attente' ? expirer(d) : regler(d)), Math.max(0, quand - t));
    m.unref?.();
    minuteries.set(d.id, m);
  }

  /** Ne garde que les défis en cours et les plus récents des défis finis. */
  function ranger() {
    const finis = [...defis.values()].filter((d) => !actif(d)).sort((a, b) => b.majLe - a.majLe);
    for (const d of finis.slice(FINIS_GARDES)) defis.delete(d.id);
  }

  function changer(d: Defi, etat: EtatDefi) {
    d.etat = etat;
    d.majLe = o.horloge();
    if (!actif(d)) arreter(d.id);
    ranger();
    o.sauver();
  }

  function expirer(d: Defi) {
    if (d.etat !== 'attente') return;
    changer(d, 'expire');
    if (d.mise) o.verser(d.de.uid, d.mise);
    prevenir(d);
  }

  function regler(d: Defi) {
    if (d.etat !== 'enCours') return;
    const { de, vers } = d.scores;
    d.gagnant = de === vers ? 'nul' : de > vers ? 'de' : 'vers';
    changer(d, 'fini');
    if (d.gagnant === 'nul') {
      if (d.mise) {
        o.verser(d.de.uid, d.mise);
        o.verser(d.vers.uid, d.mise);
      }
      o.resultat(d.de.uid, d.vers.nom, 'nul', 0);
      o.resultat(d.vers.uid, d.de.nom, 'nul', 0);
    } else {
      const g = d.gagnant === 'de' ? d.de : d.vers;
      const p = d.gagnant === 'de' ? d.vers : d.de;
      if (d.mise) o.verser(g.uid, 2 * d.mise);
      o.resultat(g.uid, p.nom, 'gagne', d.mise);
      o.resultat(p.uid, g.nom, 'perdu', d.mise);
      if (d.mise) o.annoncer({ nom: g.nom, jeu: 'defi', gain: 2 * d.mise, contre: p.nom });
    }
    prevenir(d);
  }

  function lancer(de: JoueurDefi, vers: JoueurDefi, jeu: unknown, duree: unknown, mise: unknown): Resultat {
    if (!estJeuDefi(jeu)) return refus('Jeu inconnu.', 'Unknown game.');
    if (typeof duree !== 'number' || !DUREES_DEFI.includes(duree)) return refus('Durée impossible.', 'Invalid duration.');
    if (typeof mise !== 'number' || !MISES_DEFI.includes(mise)) return refus('Mise impossible.', 'Invalid stake.');
    if (de.uid === vers.uid) return refus('Tu ne peux pas te défier toi-même.', 'You cannot challenge yourself.');
    if (!o.sontAmis(de.uid, vers.uid)) return refus('Tu ne peux défier que tes amis du casino.', 'You can only challenge your casino friends.');
    const ouverts = [...defis.values()].filter((d) => actif(d));
    if (ouverts.some((d) => d.etat === 'attente' && avec(d, de.uid) && avec(d, vers.uid))) return refus('Un défi vous attend déjà tous les deux.', 'A challenge is already waiting for you both.');
    if (ouverts.filter((d) => d.etat === 'attente' && d.de.uid === de.uid).length >= DEFIS_ENVOYES_MAX)
      return refus(`Au plus ${DEFIS_ENVOYES_MAX} défis envoyés en attente.`, `At most ${DEFIS_ENVOYES_MAX} pending challenges sent.`);
    if (mise > 0 && !o.prelever(de.uid, mise)) return refus('Solde insuffisant pour cette mise.', 'Not enough money for this stake.');
    const t = o.horloge();
    const d: Defi = {
      id: randomBytes(6).toString('hex'),
      de: { ...de },
      vers: { ...vers },
      jeu,
      duree,
      mise,
      etat: 'attente',
      creeLe: t,
      expire: t + EXPIRATION_DEFI * echelle,
      debut: null,
      fin: null,
      scores: { de: 0, vers: 0 },
      gagnant: null,
      majLe: t,
    };
    defis.set(d.id, d);
    armer(d);
    o.sauver();
    prevenir(d);
    return { ok: true, defi: vue(d) };
  }

  const enCoursDe = (uid: string) => [...defis.values()].find((d) => d.etat === 'enCours' && avec(d, uid)) ?? null;

  function repondre(uid: string, id: unknown, accepter: boolean): Resultat {
    const d = typeof id === 'string' ? defis.get(id) : undefined;
    if (!d || d.vers.uid !== uid) return refus('Défi introuvable.', 'Challenge not found.');
    if (d.etat !== 'attente') return refus('Ce défi n’attend plus de réponse.', 'This challenge no longer awaits an answer.');
    if (!accepter) {
      changer(d, 'refuse');
      if (d.mise) o.verser(d.de.uid, d.mise);
      prevenir(d);
      return { ok: true, defi: vue(d) };
    }
    if (enCoursDe(uid)) return refus('Tu as déjà un défi en cours.', 'You already have a challenge in progress.');
    if (enCoursDe(d.de.uid)) return refus(`${d.de.nom} est déjà en plein défi : réessaie plus tard.`, `${d.de.nom} is already in a challenge: try again later.`);
    if (d.mise > 0 && !o.prelever(uid, d.mise)) return refus('Solde insuffisant pour cette mise.', 'Not enough money for this stake.');
    const t = o.horloge();
    d.debut = t;
    d.fin = t + d.duree * echelle;
    changer(d, 'enCours');
    armer(d);
    prevenir(d);
    return { ok: true, defi: vue(d) };
  }

  function annuler(uid: string, id: unknown): Resultat {
    const d = typeof id === 'string' ? defis.get(id) : undefined;
    if (!d || d.de.uid !== uid) return refus('Défi introuvable.', 'Challenge not found.');
    if (d.etat !== 'attente') return refus('Ce défi a déjà commencé.', 'This challenge has already started.');
    changer(d, 'annule');
    if (d.mise) o.verser(d.de.uid, d.mise);
    prevenir(d);
    return { ok: true, defi: vue(d) };
  }

  /** Un mouvement d'argent dans un jeu (net : gain − mise), compté dans les défis en cours de ce joueur. */
  function noter(uid: string, jeu: JeuCasino, net: number) {
    if (!net) return;
    const t = o.horloge();
    for (const d of defis.values()) {
      if (d.etat !== 'enCours' || d.debut === null || d.fin === null || t < d.debut || t >= d.fin) continue;
      if (d.jeu !== 'tous' && d.jeu !== jeu) continue;
      if (d.de.uid === uid) d.scores.de += net;
      else if (d.vers.uid === uid) d.scores.vers += net;
      else continue;
      // Les scores partent aux deux joueurs au plus toutes les 800 ms.
      if (!envoiScores.has(d.id)) {
        const m = setTimeout(() => {
          envoiScores.delete(d.id);
          if (d.etat === 'enCours') prevenir(d);
        }, pasScores);
        m.unref?.();
        envoiScores.set(d.id, m);
      }
      o.sauver();
    }
  }

  /** Les défis d'un joueur : en attente et en cours d'abord, puis les derniers finis. */
  function vuesDe(uid: string): VueDefi[] {
    const miens = [...defis.values()].filter((d) => avec(d, uid));
    const ouverts = miens.filter(actif).sort((a, b) => b.creeLe - a.creeLe);
    const finis = miens.filter((d) => !actif(d)).sort((a, b) => b.majLe - a.majLe).slice(0, 10);
    return [...ouverts, ...finis].map(vue);
  }

  const enCours = (uid: string) => {
    const d = enCoursDe(uid);
    return d ? vue(d) : null;
  };
  /** Invitations reçues en attente. */
  const invitations = (uid: string) => [...defis.values()].filter((d) => d.etat === 'attente' && d.vers.uid === uid).length;

  /** Ce qui est gardé avec les réglages du serveur. */
  const exporter = () => [...defis.values()].map((d) => ({ ...d, de: { ...d.de }, vers: { ...d.vers }, scores: { ...d.scores } }));

  /** Reprise après un redémarrage : les défis reprennent, ceux qui ont expiré ou fini entre-temps sont réglés. */
  function importer(brut: unknown) {
    if (!Array.isArray(brut)) return;
    const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const joueur = (v: unknown): JoueurDefi | null => {
      const x = v as Record<string, unknown> | null;
      return x && typeof x.uid === 'string' ? { uid: x.uid, nom: typeof x.nom === 'string' ? x.nom : '', avatar: nombre(x.avatar) ?? 1 } : null;
    };
    const etats: EtatDefi[] = ['attente', 'enCours', 'fini', 'refuse', 'annule', 'expire'];
    for (const e of brut) {
      const x = (e ?? {}) as Record<string, unknown>;
      const de = joueur(x.de);
      const vers = joueur(x.vers);
      const etat = etats.find((s) => s === x.etat);
      if (typeof x.id !== 'string' || !de || !vers || !etat || !estJeuDefi(x.jeu) || defis.has(x.id)) continue;
      const sc = (x.scores ?? {}) as Record<string, unknown>;
      const d: Defi = {
        id: x.id,
        de,
        vers,
        jeu: x.jeu,
        duree: nombre(x.duree) ?? DUREES_DEFI[0],
        mise: Math.max(0, Math.floor(nombre(x.mise) ?? 0)),
        etat,
        creeLe: nombre(x.creeLe) ?? 0,
        expire: nombre(x.expire) ?? 0,
        debut: nombre(x.debut),
        fin: nombre(x.fin),
        scores: { de: nombre(sc.de) ?? 0, vers: nombre(sc.vers) ?? 0 },
        gagnant: x.gagnant === 'de' || x.gagnant === 'vers' || x.gagnant === 'nul' ? x.gagnant : null,
        majLe: nombre(x.majLe) ?? 0,
      };
      defis.set(d.id, d);
      if (d.etat === 'enCours' && (d.fin === null || d.debut === null)) d.fin = o.horloge(); // abîmé : réglé tout de suite
      if (actif(d)) armer(d); // les échéances passées se règlent au prochain tour de la boucle
    }
    ranger();
  }

  function fermer() {
    for (const id of [...minuteries.keys(), ...envoiScores.keys()]) arreter(id);
  }

  return { lancer, repondre, annuler, noter, vuesDe, enCours, invitations, exporter, importer, fermer };
}
