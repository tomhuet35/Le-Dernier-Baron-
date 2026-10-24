import type React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CARTE } from '../../shared/cartes';
import { TAPIS_PAR_DEFAUT, tapisGagnes, type IdTapis } from '../../shared/niveaux';
import { DELAI_REACTION_MS, REACTIONS } from '../../shared/config';
import type { Action, Reaction, Vue, VueJoueur, VueSalon } from '../../shared/types';
import { socket } from './socket';
import type { Appel } from './App';
import { BadgeNiveau, BarreXp, detailXp, FicheJoueur } from './Profil';
import { ReglesIllustrees } from './Regles';
import { FinTutoriel, Tutoriel } from './Tutoriel';
import { FenetreReglages, useReglages } from './Reglages';
import type { TailleCartes } from './reglages';
import { EFFET_EVENEMENT, NOM_EVENEMENT, NOM_FAMILLE, infoCarte, nomCarte, trierMain } from './textes';
import { EN, pluriel, titreNiveau, tr } from './traduction';
import { useMasques } from './Moderation';
import { nomTapis } from './Profil';
import { duelDuPli, type DuelPli } from '../../shared/regles';
import { Avatar, Butin, CarteImg, Chat, Duel, Fenetre, IconeImage, IconeMusique, Pastille, SON_EVENEMENT, Zoom, jouerEffet, sonDeCarte, useMinuteur, useMusique } from './ui';

type ActionSansJoueur = { [K in Action['type']]: Omit<Extract<Action, { type: K }>, 'joueurId'> }[Action['type']];

const PHASES_DEBUT = ['TRAHISON', 'ANNONCES', 'ALLIANCE'];

/** Places des adversaires autour de la table, dans l'ordre du jeu en partant de la gauche du joueur. */
const PLACES: Record<number, string[]> = {
  1: ['haut'],
  2: ['haut-gauche', 'haut-droite'],
  3: ['gauche', 'haut', 'droite'],
  4: ['gauche', 'haut-gauche', 'haut-droite', 'droite'],
  5: ['gauche', 'haut-gauche', 'haut', 'haut-droite', 'droite'],
};

/**
 * Disposition des cartes du pli sur le tapis : elles s'étalent côte à côte (chacune laisse voir sa valeur),
 * sur une ou deux rangées, aussi grandes que la place le permet. La taille dépend du nombre de joueurs,
 * pas du nombre de cartes posées : elle ne change pas pendant le pli.
 */
// Part visible de chaque carte recouverte par la suivante (plus serré sur un tapis étroit de téléphone).
/** Taille des cartes choisie dans les Réglages (même valeur que --zc dans styles.css). */
const ZOOM_CARTES: Record<TailleCartes, number> = { normale: 1, grande: 1.15, tres_grande: 1.3 };
const pasPli = (largeur: number) => (largeur < 280 ? 0.46 : 0.56);
const DECALAGE_RANGEE = 0.52; // la 2e rangée descend de 52 % de la hauteur d'une carte
const ETIQUETTE_PLI = 17; // place du nom au-dessus de la carte
function dispositionPli(nJoueurs: number, nCartes: number, t: { l: number; h: number } | null, zoom = 1) {
  if (!t || t.l < 60 || t.h < 60) return null;
  const n = Math.max(nJoueurs, nCartes, 1);
  const PAS_PLI = pasPli(t.l);
  const W = t.l - 10;
  const H = t.h - ETIQUETTE_PLI - 8;
  const uneRangee = Math.min(W / (1 + (n - 1) * PAS_PLI), H / 1.5);
  const k = Math.ceil(n / 2);
  const deuxRangees = n >= 4 ? Math.min(W / (1 + (k - 1) * PAS_PLI), H / (1.5 * (1 + DECALAGE_RANGEE))) : 0;
  const surDeux = deuxRangees > uneRangee * 1.1;
  const parRangee = surDeux ? k : n;
  const larg = Math.round(Math.max(48, Math.min(surDeux ? deuxRangees : uneRangee, Math.round(190 * zoom))));
  const haut = larg * 1.5;
  const rangees = surDeux && nCartes > parRangee ? 2 : 1;
  const total = ETIQUETTE_PLI + haut + (rangees - 1) * haut * DECALAGE_RANGEE;
  const y0 = Math.max(ETIQUETTE_PLI, (t.h - total) / 2 + ETIQUETTE_PLI);
  const positions = Array.from({ length: nCartes }, (_, i) => {
    const r = Math.floor(i / parRangee);
    const c = i % parRangee;
    const nb = r === 0 ? Math.min(nCartes, parRangee) : nCartes - parRangee;
    const largeurRangee = larg * (1 + (nb - 1) * PAS_PLI);
    return { x: Math.round((t.l - largeurRangee) / 2 + c * larg * PAS_PLI), y: Math.round(y0 + r * haut * DECALAGE_RANGEE) };
  });
  return { larg, positions };
}

/** Ordinateur (souris, grand écran) : le pli s'étale en grand sur le tapis. Téléphone et tablette gardent la pile. */
const REQUETE_ORDI = '(min-width: 900px) and (hover: hover) and (pointer: fine)';
function useOrdi() {
  const [ordi, setOrdi] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(REQUETE_ORDI).matches);
  useEffect(() => {
    const m = window.matchMedia?.(REQUETE_ORDI);
    if (!m) return;
    const maj = () => setOrdi(m.matches);
    maj();
    m.addEventListener?.('change', maj);
    return () => m.removeEventListener?.('change', maj);
  }, []);
  return ordi;
}

/** Réactions rapides reçues : la dernière de chaque joueur, affichée quelques secondes au-dessus de son avatar. */
function useReactions() {
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});
  useEffect(() => {
    const minuteurs = new Set<number>();
    const surReaction = (r: Reaction) => {
      jouerEffet('message');
      setReactions((x) => ({ ...x, [r.joueurId]: r }));
      const t = window.setTimeout(() => {
        minuteurs.delete(t);
        setReactions((x) => (x[r.joueurId]?.n === r.n ? Object.fromEntries(Object.entries(x).filter(([id]) => id !== r.joueurId)) : x));
      }, 2700);
      minuteurs.add(t);
    };
    socket.on('reaction', surReaction);
    return () => {
      socket.off('reaction', surReaction);
      minuteurs.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  return reactions;
}

function BulleReaction({ r }: { r?: Reaction }) {
  if (!r) return null;
  return (
    <span key={r.n} className="bulle-reaction" aria-label={tr(`Réaction ${r.emoji}`, `Reaction ${r.emoji}`)}>
      {r.emoji}
    </span>
  );
}

/** Bouton des réactions rapides : ouvre une petite palette d'émojis à envoyer à la table. */
function BoutonReactions({ appel }: { appel: Appel }) {
  const [ouvert, setOuvert] = useState(false);
  const [attente, setAttente] = useState(false);
  const envoyer = async (emoji: string) => {
    setOuvert(false);
    setAttente(true);
    window.setTimeout(() => setAttente(false), DELAI_REACTION_MS);
    await appel('reaction', { emoji });
  };
  return (
    <div className="reactions">
      <button type="button" className={`reactions-bouton ${ouvert ? 'ouvert' : ''}`} onClick={() => setOuvert(!ouvert)} disabled={attente} aria-expanded={ouvert} aria-label={tr('Envoyer une réaction', 'Send a reaction')}>
        <span aria-hidden="true">😊</span>
      </button>
      {ouvert && (
        <div className="reactions-palette" role="menu" aria-label={tr('Réactions', 'Reactions')}>
          {REACTIONS.map((e) => (
            <button key={e} type="button" role="menuitem" onClick={() => void envoyer(e)} aria-label={tr(`Réagir ${e}`, `React ${e}`)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Le pli en grand, par-dessus la table : toutes les cartes côte à côte avec le nom de chaque joueur. */
function VuePli(props: {
  cartes: { joueurId: string; carteId: string; valeurCroupier?: 0 | 11 }[];
  gagnantId: string | null;
  titre?: string;
  nom: (id: string) => string;
  onCarte: (id: string) => void;
  onFermer: () => void;
}) {
  const { cartes, gagnantId, nom, onCarte, onFermer } = props;
  const titre =
    props.titre ??
    (gagnantId
      ? tr(`${nom(gagnantId)} remporte le pli`, `${nom(gagnantId)} wins the trick`)
      : tr(`Pli en cours · ${pluriel(cartes.length, 'carte', 'card')}`, `Trick in progress · ${pluriel(cartes.length, 'carte', 'card')}`));
  return (
    <div className="voile vue-pli-voile" role="dialog" aria-modal="true" aria-label={titre} onClick={onFermer}>
      <div className="vue-pli" onClick={(e) => e.stopPropagation()}>
        <div className="vue-pli-tete">
          <strong>{titre}</strong>
          <button type="button" className="fermer" onClick={onFermer} aria-label={tr('Fermer', 'Close')}>
            ×
          </button>
        </div>
        <div className={`vue-pli-cartes n-${cartes.length}`}>
          {cartes.map((p, i) => (
            <button key={p.carteId} type="button" className={`vue-pli-carte ${p.joueurId === gagnantId ? 'gagnante' : ''}`} style={{ animationDelay: `${i * 0.05}s` }} onClick={() => onCarte(p.carteId)}>
              <span className="vue-pli-nom">
                {i + 1}. {nom(p.joueurId)}
                {p.valeurCroupier !== undefined ? ` · ${p.valeurCroupier}` : ''}
              </span>
              <img src={infoCarte(p.carteId).image} alt={infoCarte(p.carteId).nom} draggable={false} />
            </button>
          ))}
        </div>
        <p className="discret">{tr('Touche une carte pour lire son effet.', 'Tap a card to read its effect.')}</p>
      </div>
    </div>
  );
}

/** Particules dorées qui montent doucement derrière la table. */
const PARTICULES = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 53) % 100,
  taille: 3 + (i % 4) * 2,
  duree: 10 + (i % 7) * 2,
  delai: -(i * 1.9),
}));
function Particules() {
  return (
    <div className="particules" aria-hidden="true">
      {PARTICULES.map((p, i) => (
        <span key={i} style={{ left: `${p.x}%`, width: p.taille, height: p.taille, animationDuration: `${p.duree}s`, animationDelay: `${p.delai}s` }} />
      ))}
    </div>
  );
}

export function Table(props: { salon: VueSalon; appel: Appel; quitter: () => void; tapis?: IdTapis; poserTapis?: (id: IdTapis) => Promise<boolean> }) {
  const { salon, appel, quitter, tapis = TAPIS_PAR_DEFAUT, poserTapis } = props;
  const v = salon.partie as Vue;
  const moi = v.joueurs.find((j) => j.id === v.moi) as VueJoueur;
  const estHote = salon.hoteId === v.moi && !salon.publique;
  const [selection, setSelection] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [vuePli, setVuePli] = useState(false);
  const [vueDernier, setVueDernier] = useState(false);
  const reactionsRecues = useReactions();
  // Joueurs dont j'ai coupé le chat : leurs réactions n'apparaissent plus non plus.
  const coupes = useMasques(salon.code);
  const reactions = Object.fromEntries(Object.entries(reactionsRecues).filter(([id]) => !coupes.has(id)));
  const surOrdi = useOrdi();
  const reglages = useReglages();
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [tailleTable, setTailleTable] = useState<{ l: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const mesurer = () => setTailleTable((t) => (t && t.l === el.clientWidth && t.h === el.clientHeight ? t : { l: el.clientWidth, h: el.clientHeight }));
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const [fenetre, setFenetre] = useState<'scores' | 'regles' | 'menu' | 'journal' | 'quitter' | 'reglages' | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [fiche, setFiche] = useState<string | null>(null);
  const [musiqueActive, basculerMusique] = useMusique();
  const fraction = useMinuteur(salon.tempsRestant, salon.dureeTour);

  useEffect(() => setSelection(null), [v.phase, v.nuit, v.main.length, v.tourId]);

  // Révélation de l'événement : la carte tourbillonne au centre de l'écran pendant 5 secondes.
  const [revelation, setRevelation] = useState<string | null>(null);
  const dejaVu = useRef<string | null>(null);
  useEffect(() => {
    if (!v.evenementId || v.phase !== 'ANNONCES') return;
    const cle = `${v.nuit}-${v.evenementId}`;
    if (dejaVu.current === cle) return;
    dejaVu.current = cle;
    setRevelation(v.evenementId);
    jouerEffet('evenement');
    // Puis le son propre à l'événement, quand son nom apparaît.
    const sonEvenement = v.evenement ? SON_EVENEMENT[v.evenement] : undefined;
    const s = sonEvenement ? window.setTimeout(() => jouerEffet(sonEvenement), 1800) : 0;
    const t = window.setTimeout(() => setRevelation(null), 5000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(s);
    };
  }, [v.nuit, v.evenementId, v.phase]);

  const nom = (id: string | null | undefined) => v.joueurs.find((j) => j.id === id)?.nom ?? '?';
  const monCompte = salon.joueurs.find((j) => j.id === v.moi)?.compte ?? null;
  const avatarDe = (id: string) => salon.joueurs.find((j) => j.id === id)?.avatar ?? 1;
  const agir = async (action: ActionSansJoueur) => {
    if (envoi) return;
    setEnvoi(true);
    await appel('action', action);
    setEnvoi(false);
    setSelection(null);
  };

  const main = useMemo(() => trierMain(v.main), [v.main]);
  const siege = v.joueurs.findIndex((j) => j.id === v.moi);
  const autres = [...v.joueurs.slice(siege + 1), ...v.joueurs.slice(0, siege)];
  const voisinDroite = v.joueurs[(siege - 1 + v.joueurs.length) % v.joueurs.length];
  const places = PLACES[autres.length] ?? [];
  const parPlace: Record<string, VueJoueur> = Object.fromEntries(autres.map((j, i) => [places[i], j]));
  const haut = ['haut-gauche', 'haut', 'haut-droite'].filter((p) => parPlace[p]).map((p) => parPlace[p]);
  const gauche = parPlace.gauche;
  const droite = parPlace.droite;
  const attendus = v.attente.filter((id) => id !== v.moi).map(nom);
  const attenteTexte = attendus.length ? tr(`En attente de ${attendus.join(', ')}.`, `Waiting for ${attendus.join(', ')}.`) : '';
  const monTour = v.tourId === v.moi;
  const aMoi = v.attente.includes(v.moi) && v.phase !== 'FIN_DE_NUIT' && v.phase !== 'FIN_DE_PARTIE';
  const secondes = fraction === null ? null : Math.ceil((fraction * salon.dureeTour) / 1000);
  const pliAffiche =
    v.pli.length > 0 ? null : v.dernierPli && (v.phase === 'FIN_DE_PLI' || (v.phase === 'VOL' && v.vol?.source === 'baron')) ? v.dernierPli : null;
  const plisJoues = v.joueurs.reduce((s, j) => s + j.plis, 0);

  // Son de carte : chaque fois qu'une nouvelle carte arrive sur le tapis (la mienne ou celle d'un autre joueur),
  // plus le son de sa famille (Billets, Diamants, Lames, Lingots, Chat noir) ou de la carte spéciale.
  const cartesPli = pliAffiche ? pliAffiche.cartes : v.pli;
  const disposition = surOrdi ? dispositionPli(v.joueurs.length, cartesPli.length, tailleTable, ZOOM_CARTES[reglages.cartes]) : null;
  const cartesSurTapis = cartesPli.map((p) => p.carteId).join('|');
  // Le pli ramassé : la vue en grand se referme d'elle-même.
  useEffect(() => {
    if (!cartesPli.length) setVuePli(false);
  }, [cartesPli.length]);
  // « Dernier pli » : revoir les cartes qui viennent d'être ramassées (pour compter), tant que la nuit dure.
  const dernierRamasse = !pliAffiche && v.dernierPli && v.phase !== 'FIN_DE_NUIT' && v.phase !== 'FIN_DE_PARTIE' ? v.dernierPli : null;
  useEffect(() => {
    if (!dernierRamasse) setVueDernier(false);
  }, [dernierRamasse]);
  const tapisPrecedent = useRef<Set<string> | null>(null);
  useEffect(() => {
    const avant = tapisPrecedent.current;
    const maintenant = cartesSurTapis ? cartesSurTapis.split('|') : [];
    tapisPrecedent.current = new Set(maintenant);
    if (!avant) return;
    const nouvelles = maintenant.filter((id) => !avant.has(id));
    if (!nouvelles.length) return;
    jouerEffet('carte');
    for (const id of nouvelles) {
      const son = sonDeCarte(id);
      if (son) jouerEffet(son);
    }
  }, [cartesSurTapis]);

  // Distribution des cartes au début de chaque nuit (pas au chargement de la page).
  const nuitPrecedente = useRef<number | null>(null);
  useEffect(() => {
    const avant = nuitPrecedente.current;
    nuitPrecedente.current = v.nuit;
    if (avant !== null && v.nuit > avant) jouerEffet('distribution');
  }, [v.nuit]);

  // « À toi de jouer » : petit carillon quand vient mon tour de poser une carte.
  const tourPrecedent = useRef<boolean | null>(null);
  const aJouer = monTour && v.phase === 'PLI';
  useEffect(() => {
    const avant = tourPrecedent.current;
    tourPrecedent.current = aJouer;
    if (avant === false && aJouer) jouerEffet('tour');
  }, [aJouer]);

  // Les 5 dernières secondes de mon temps : tic-tac.
  useEffect(() => {
    if (aMoi && secondes !== null && secondes > 0 && secondes <= 5) jouerEffet('tic');
  }, [secondes, aMoi]);

  // Phases : vol terminé, fin de nuit (annonce réussie ou ratée).
  const phasePrecedente = useRef<string | null>(null);
  useEffect(() => {
    const avant = phasePrecedente.current;
    phasePrecedente.current = v.phase;
    if (avant === null || avant === v.phase) return;
    if (avant === 'VOL') jouerEffet('vol');
    if (v.phase === 'FIN_DE_NUIT') {
      const bilan = v.bilans[v.bilans.length - 1];
      const moiNuit = bilan?.scores.find((s) => s.joueurId === v.moi);
      if (moiNuit) jouerEffet(moiNuit.reussie ? 'reussite' : 'echec');
    }
  }, [v.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Son de fin de pli : chaque fois qu'un pli est remporté, juste après le bruit de la dernière carte posée.
  const cleDernierPli = v.dernierPli ? `${v.nuit}|${v.dernierPli.gagnantId}|${v.dernierPli.cartes.map((c) => c.carteId).join(',')}` : '';
  const pliPrecedent = useRef<string | null>(null);
  useEffect(() => {
    const avant = pliPrecedent.current;
    pliPrecedent.current = cleDernierPli;
    if (avant === null || !cleDernierPli || cleDernierPli === avant) return;
    const t = window.setTimeout(() => jouerEffet('fin_de_pli'), 350);
    return () => window.clearTimeout(t);
  }, [cleDernierPli]);

  // Grands moments : le Baron écrase un Homme de main, ou le Pickpocket braque le Baron (pas au rechargement).
  const [duel, setDuel] = useState<DuelPli | null>(null);
  const duelPrecedent = useRef<string | null>(null);
  useEffect(() => {
    const avant = duelPrecedent.current;
    duelPrecedent.current = cleDernierPli;
    if (avant === null || !cleDernierPli || cleDernierPli === avant || !v.dernierPli) return;
    const d = duelDuPli(v.dernierPli);
    if (!d) return;
    setDuel(d);
    const t = window.setTimeout(() => setDuel(null), 2500);
    return () => {
      window.clearTimeout(t);
      setDuel(null);
    };
  }, [cleDernierPli]); // eslint-disable-line react-hooks/exhaustive-deps

  const toucherCarte = (id: string, jouable: boolean) => {
    if (v.phase === 'TRAHISON' && !v.aChoisiTrahison) return setSelection(id);
    if (v.phase === 'PLI' && monTour && jouable) return setSelection(selection === id ? null : id);
    setZoom(id);
  };
  const siegeDe = (j: VueJoueur) => (
    <Siege key={j.id} j={j} v={v} salon={salon} estHote={estHote} appel={appel} nom={nom} fraction={fraction} avatar={avatarDe(j.id)} onProfil={setFiche} reaction={reactions[j.id]} />
  );
  // Cartes plus grandes (Réglages) : elles se recouvrent un peu plus, pour que la main tienne toujours dans la largeur de l'écran.
  const chevauchement = (main.length > 6 ? -0.56 : -0.42) - (ZOOM_CARTES[reglages.cartes] - 1) * 0.4;
  // Largeur de l'éventail en largeurs de carte, rotation comprise (les cartes tournent autour d'un point situé 1,4 hauteur
  // sous leur haut) : la main ne dépasse jamais de l'écran, même à 8 cartes ou en « très grande » taille.
  const angleMax = ((Math.max(0, main.length - 1) / 2) * 4 * Math.PI) / 180;
  const debord = 0.5 * Math.cos(angleMax) + 2.1 * Math.sin(angleMax) - 0.5; // ce que la carte du bord dépasse, de chaque côté
  const etendue = 1 + Math.max(0, main.length - 1) * (1 + chevauchement) + 2 * debord;
  // Les cartes du bord descendent (courbe de l'éventail et rotation) : place gardée sous la main pour qu'elles ne soient pas coupées.
  const dMax = Math.max(0, main.length - 1) / 2;
  const chute = { px: dMax * dMax * 2.2, k: 0.5 * Math.sin(angleMax) + 0.6 * (1 - Math.cos(angleMax)) };

  return (
    <div className="plateau">
      <Particules />
      <header className="barre">
        <div className="nuit">
          <span className="etiquette">{tr('Nuit', 'Night')}</span>
          <strong>
            {v.nuit}/{v.nbNuits}
          </strong>
        </div>
        {v.evenement && v.evenementId ? (
          <button type="button" className="evenement" onClick={() => setZoom(v.evenementId)}>
            <img src={infoCarte(v.evenementId).image} alt="" />
            <span>
              <strong>{NOM_EVENEMENT[v.evenement]}</strong>
              <small>{EFFET_EVENEMENT[v.evenement]}</small>
            </span>
          </button>
        ) : (
          <div className="evenement vide-evenement">{v.nuit === 1 || v.nuit === v.nbNuits ? tr('Pas d’événement cette nuit', 'No event tonight') : ''}</div>
        )}
        <div className="barre-boutons">
          <button type="button" className="bouton-icone" onClick={() => setFenetre('scores')} aria-label="Scores">
            <img src="/cartes/icone-scores.webp" alt="" draggable={false} />
            <span className="libelle">Scores</span>
          </button>
          <button type="button" className="bouton-icone" onClick={() => setFenetre('regles')} aria-label={tr('Règles', 'Rules')}>
            <img src="/cartes/icone-regles.webp" alt="" draggable={false} />
            <span className="libelle">{tr('Règles', 'Rules')}</span>
          </button>
          <Chat salon={salon} appel={appel} enLigne />
          <button type="button" className="bouton-icone bouton-icone-seule" onClick={() => setFenetre('menu')} aria-label="Menu">
            <IconeImage nom="menu" repli="⋯" />
          </button>
        </div>
      </header>

      {haut.length > 0 && <div className="rangee-haut">{haut.map(siegeDe)}</div>}

      <div className={`milieu ${gauche || droite ? '' : 'sans-cotes'}`}>
        {(gauche || droite) && <div className="cote">{gauche && siegeDe(gauche)}</div>}
        <section className={`centre tapis-${tapis}`} aria-label={tr('Pli en cours', 'Current trick')}>
          <div className="centre-tete">
            {pliAffiche ? (
              <span>
                <strong>{pliAffiche.gagnantId === v.moi ? tr('Tu remportes', 'You win') : tr(`${nom(pliAffiche.gagnantId)} remporte`, `${nom(pliAffiche.gagnantId)} wins`)}</strong>
                {tr(' le pli', ' the trick')}
                {pliAffiche.braquage ? tr(' : Braquage !', ': Stick-up!') : ''}
              </span>
            ) : v.pli.length > 0 ? (
              v.familleDemandee ? (
                <span>
                  {tr('Demandé : ', 'Led: ')}
                  <strong>{NOM_FAMILLE[v.familleDemandee]}</strong>
                </span>
              ) : (
                <span>{tr('Pas encore de famille demandée', 'No suit led yet')}</span>
              )
            ) : v.phase === 'PLI' ? (
              <span>{v.ouvreurId === v.moi ? tr('Tu ouvres le pli', 'You lead the trick') : tr(`${nom(v.ouvreurId)} ouvre le pli`, `${nom(v.ouvreurId)} leads the trick`)}</span>
            ) : PHASES_DEBUT.includes(v.phase) ? (
              <span>
                {pluriel(v.nuit, 'pli', 'trick')} · {v.premierId === v.moi ? tr('tu commences', 'you start') : tr(`${nom(v.premierId)} commence`, `${nom(v.premierId)} starts`)}
              </span>
            ) : (
              <span>
                {tr('Pli', 'Trick')} {Math.min(plisJoues + 1, v.nuit)}/{v.nuit}
              </span>
            )}
          </div>
          <div className="centre-table" ref={tableRef} style={disposition ? ({ '--lp': `${disposition.larg}px` } as React.CSSProperties) : undefined}>
            <svg className={`anneau ${v.phase === 'PLI' ? 'tourne' : ''}`} viewBox="0 0 200 200" aria-hidden="true">
              <defs>
                <marker id="pointe" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
                </marker>
              </defs>
              <path d="M143 25.5 A86 86 0 0 1 174.5 143" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" markerEnd="url(#pointe)" />
              <path d="M57 174.5 A86 86 0 0 1 25.5 57" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" markerEnd="url(#pointe)" />
            </svg>
            <div className={`pli-pile ${disposition ? 'disposee' : ''}`}>
              {cartesPli.map((p, i) => {
                // Cartes étalées côte à côte, légèrement de travers, comme sur une vraie table.
                const pos = disposition?.positions[i];
                const style = {
                  '--r': `${(i % 2 ? 1 : -1) * (1 + (i % 3) * 0.7)}deg`,
                  '--x': `${((i * 37) % 13) - 6}px`,
                  zIndex: i + 1,
                  ...(pos ? { left: pos.x, top: pos.y } : {}),
                } as React.CSSProperties;
                const gagnante = !!pliAffiche && p.joueurId === pliAffiche.gagnantId;
                return (
                  <div key={p.carteId} className={`pli-carte ${gagnante ? 'gagnante-pli' : ''}`} style={style}>
                    <CarteImg id={p.carteId} taille="pli" etat={gagnante ? 'gagnante' : undefined} onToucher={surOrdi ? () => setVuePli(true) : undefined} onZoom={setZoom} />
                    <span className="pli-nom" title={p.joueurId === v.moi ? tr('Toi', 'You') : nom(p.joueurId)}>
                      {p.joueurId === v.moi ? tr('Toi', 'You') : nom(p.joueurId)}
                      {p.valeurCroupier !== undefined ? ` · ${p.valeurCroupier}` : ''}
                    </span>
                  </div>
                );
              })}
              {!pliAffiche && v.pli.length === 0 && <div className="pli-vide">{tr('Le pli est vide', 'The trick is empty')}</div>}
            </div>
            {dernierRamasse && (
              <button type="button" className="bouton-dernier-pli" onClick={() => setVueDernier(true)} aria-label={tr('Revoir le dernier pli', 'See the last trick')}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12a8 8 0 1 0 2.4-5.7" />
                  <path d="M4 4v4.5h4.5" />
                </svg>
                {tr('Dernier pli', 'Last trick')}
              </button>
            )}
            {surOrdi && cartesPli.length > 0 && (
              <button type="button" className="pli-loupe" onClick={() => setVuePli(true)} aria-label={tr('Voir le pli en grand', 'See the trick in big')}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="M15.5 15.5 L21 21" />
                </svg>
              </button>
            )}
          </div>
          <ol className="centre-journal" aria-label={tr('Dernières actions', 'Latest actions')}>
            {v.journal
              .slice(-2)
              .reverse()
              .map((e, i) => (
                <li key={e.n} style={{ opacity: 1 - i * 0.35 }}>
                  {EN ? (e.en ?? e.texte) : e.texte}
                </li>
              ))}
          </ol>
        </section>
        {(gauche || droite) && <div className="cote">{droite && siegeDe(droite)}</div>}
      </div>

      <section className={`ma-zone ${aMoi ? 'a-moi' : ''}`} aria-label={tr('Ta place', 'Your seat')}>
        <div className={`consigne ${aMoi ? 'a-toi' : ''}`} aria-live="polite">
          <Consigne v={v} selection={selection} agir={agir} nom={nom} droiteNom={voisinDroite.nom} attenteTexte={attenteTexte} envoi={envoi} />
        </div>
        <div className="moi-bandeau">
          <button type="button" className="bouton-avatar" onClick={() => setFiche(v.moi)} aria-label={tr('Voir mon profil', 'View my profile')}>
            <Avatar n={avatarDe(v.moi)} grand fraction={aMoi ? fraction : null} />
            <BulleReaction r={reactions[v.moi]} />
          </button>
          <div className="moi-texte">
            <div className="moi-nom">
              <strong>{moi.nom}</strong>
              {monCompte && <BadgeNiveau niveau={monCompte.niveau} />}
              {aMoi && <span className="votre-tour">{tr('Votre tour', 'Your turn')}</span>}
              {v.premierId === v.moi && PHASES_DEBUT.includes(v.phase) && <span className="badge or">{tr('Tu commences', 'You start')}</span>}
            </div>
            {aMoi && fraction !== null && (
              <div className={`minuteur ${fraction < 0.25 ? 'urgent' : ''}`}>
                <div className="minuteur-barre" role="progressbar" aria-label={tr('Temps restant', 'Time left')} aria-valuemin={0} aria-valuemax={30} aria-valuenow={secondes ?? 0}>
                  <span style={{ width: `${fraction * 100}%` }} />
                </div>
                <small>{secondes} s</small>
              </div>
            )}
            <div className="moi-stats">
              {v.monAnnonce !== null ? tr(`Annonce ${v.monAnnonce}`, `Bid ${v.monAnnonce}`) : tr('Pas encore annoncé', 'No bid yet')} · {pluriel(moi.plis, 'pli', 'trick')} · {moi.score} pts
            </div>
            {v.choixAllies && <ChoixAllie v={v} id={v.moi} nom={nom} />}
            <Butin ids={moi.butin} />
          </div>
          {!salon.tutoriel && <BoutonReactions appel={appel} />}
        </div>
        <div className="eventail" style={{ '--chev': chevauchement, '--etendue': etendue.toFixed(3), '--debord': debord.toFixed(3), '--chute-px': `${chute.px.toFixed(1)}px`, '--chute-k': chute.k.toFixed(3) } as React.CSSProperties} aria-label={tr('Ta main', 'Your hand')}>
          {main.map((c, i) => {
            const d = i - (main.length - 1) / 2;
            const style = { '--r': `${d * 4}deg`, '--y': `${d * d * 2.2}px`, zIndex: i + 1 } as React.CSSProperties;
            return (
              <div key={c.id} className={`eventail-carte ${selection === c.id ? 'levee' : ''}`} style={style}>
                <CarteImg
                  id={c.id}
                  etat={selection === c.id ? 'choisie' : v.phase === 'PLI' && monTour ? (c.jouable ? 'jouable' : 'grisee') : undefined}
                  onToucher={() => toucherCarte(c.id, c.jouable)}
                  onZoom={setZoom}
                />
              </div>
            );
          })}
          {main.length === 0 && <p className="discret">{tr('Plus de carte en main.', 'No cards left in hand.')}</p>}
        </div>
      </section>

      {v.phase === 'FIN_DE_NUIT' && <RecapNuit v={v} nom={nom} estHote={estHote} agir={agir} secondes={secondes} />}
      {v.phase === 'FIN_DE_PARTIE' && <FinDePartie v={v} salon={salon} estHote={estHote} appel={appel} quitter={quitter} nom={nom} tapis={tapis} poserTapis={poserTapis} />}
      {fenetre === 'scores' && (
        <Fenetre titre="Scores" onFermer={() => setFenetre(null)} large>
          <TableauScores v={v} />
        </Fenetre>
      )}
      {fenetre === 'regles' && (
        <Fenetre titre={tr('Règles du jeu', 'Game rules')} onFermer={() => setFenetre(null)} large>
          <ReglesIllustrees ongletInitial="plis" />
        </Fenetre>
      )}
      {fenetre === 'menu' && (
        <Fenetre titre="Menu" onFermer={() => setFenetre(null)}>
          <button type="button" className="large" onClick={() => setFenetre('journal')}>
            {tr('Journal de la partie', 'Game log')}
          </button>
          <button type="button" className="large bouton-menu-musique" onClick={basculerMusique} aria-pressed={musiqueActive}>
            <IconeMusique active={musiqueActive} />
            {musiqueActive ? tr('Musique : activée', 'Music: on') : tr('Musique : coupée', 'Music: off')}
          </button>
          <button type="button" className="large" onClick={() => setFenetre('reglages')}>
            {tr('Réglages', 'Settings')}
          </button>
          <button type="button" className="large danger" onClick={() => setFenetre('quitter')}>
            {tr('Quitter la partie', 'Leave the game')}
          </button>
        </Fenetre>
      )}
      {fenetre === 'reglages' && <FenetreReglages onFermer={() => setFenetre(null)} enPartie />}
      {fenetre === 'journal' && (
        <Fenetre titre={tr('Journal de la partie', 'Game log')} onFermer={() => setFenetre(null)} large>
          <ol className="journal-complet">
            {v.journal
              .slice()
              .reverse()
              .map((e) => (
                <li key={e.n}>{EN ? (e.en ?? e.texte) : e.texte}</li>
              ))}
          </ol>
        </Fenetre>
      )}
      {fenetre === 'quitter' && (
        <Fenetre titre={tr('Quitter la partie ?', 'Leave the game?')} onFermer={() => setFenetre(null)}>
          <p>
            {salon.tutoriel
              ? tr('Tu pourras recommencer le tutoriel depuis l’accueil.', 'You can restart the tutorial from the home screen.')
              : tr(
                  'L’ordinateur finira la partie à ta place, et elle ne te rapportera aucune XP (abandon). Tu peux revenir avec le lien du salon tant qu’elle n’est pas finie.',
                  'The computer will finish the game for you, and it will earn you no XP (forfeit). You can come back with the room link until it ends.',
                )}
          </p>
          <div className="rangee">
            <button type="button" onClick={() => setFenetre(null)}>
              {tr('Rester', 'Stay')}
            </button>
            <button type="button" className="danger" onClick={quitter}>
              {tr('Quitter', 'Leave')}
            </button>
          </div>
        </Fenetre>
      )}
      {vuePli && cartesPli.length > 0 && (
        <VuePli cartes={cartesPli} gagnantId={pliAffiche?.gagnantId ?? null} nom={(id) => (id === v.moi ? tr('Toi', 'You') : nom(id))} onCarte={setZoom} onFermer={() => setVuePli(false)} />
      )}
      {vueDernier && dernierRamasse && (
        <VuePli
          cartes={dernierRamasse.cartes}
          gagnantId={dernierRamasse.gagnantId}
          titre={
            dernierRamasse.gagnantId === v.moi
              ? tr('Dernier pli · tu l’as remporté', 'Last trick · you won it')
              : tr(`Dernier pli · remporté par ${nom(dernierRamasse.gagnantId)}`, `Last trick · won by ${nom(dernierRamasse.gagnantId)}`)
          }
          nom={(id) => (id === v.moi ? tr('Toi', 'You') : nom(id))}
          onCarte={setZoom}
          onFermer={() => setVueDernier(false)}
        />
      )}
      {zoom && <Zoom id={zoom} onFermer={() => setZoom(null)} />}
      {fiche && <FicheJoueur joueurId={fiche} salonCode={salon.code} moi={fiche === v.moi} appel={appel} onFermer={() => setFiche(null)} />}
      {salon.tutoriel && <Tutoriel v={v} pliAffiche={pliAffiche} revelation={!!revelation} nom={nom} />}
      {duel && <Duel duel={duel} nom={nom} />}
      {revelation && v.evenement && (
        <div className="revelation" role="dialog" aria-label={tr(`Événement : ${NOM_EVENEMENT[v.evenement]}`, `Event: ${NOM_EVENEMENT[v.evenement]}`)} onClick={() => setRevelation(null)}>
          <span className="revelation-titre">{tr(`Événement de la nuit ${v.nuit}`, `Event of night ${v.nuit}`)}</span>
          <div className="tourbillon">
            <div className="tourbillon-carte">
              <img className="face recto" src={infoCarte(revelation).image} alt={NOM_EVENEMENT[v.evenement]} />
              <img className="face verso" src="/dos.webp" alt="" />
            </div>
          </div>
          <h2>{NOM_EVENEMENT[v.evenement]}</h2>
          <p>{EFFET_EVENEMENT[v.evenement]}</p>
          <span className="discret">{tr('Touche pour fermer', 'Tap to close')}</span>
        </div>
      )}
    </div>
  );
}

/** Un adversaire autour de la table : son personnage, ses cartes retournées, son annonce et son butin. */
function Siege(props: {
  j: VueJoueur;
  v: Vue;
  salon: VueSalon;
  estHote: boolean;
  appel: Appel;
  nom: (id: string | null | undefined) => string;
  fraction: number | null;
  avatar: number;
  onProfil: (id: string) => void;
  reaction?: Reaction;
}) {
  const { j, v, salon, estHote, appel, nom, fraction, avatar, onProfil, reaction } = props;
  const s = salon.joueurs.find((x) => x.id === j.id);
  const nb = Math.min(j.nbCartes, 8);
  const minute = j.attendu && v.phase !== 'FIN_DE_NUIT' && v.phase !== 'FIN_DE_PARTIE';
  return (
    <article className={`siege ${minute ? 'attendu' : ''} ${v.tourId === j.id ? 'son-tour' : ''}`}>
      <div className="siege-dos" aria-hidden="true">
        {Array.from({ length: nb }, (_, i) => (
          <img key={i} src="/dos.webp" alt="" style={{ '--r': `${(i - (nb - 1) / 2) * 8}deg` } as React.CSSProperties} />
        ))}
      </div>
      <button type="button" className="siege-avatar" onClick={() => onProfil(j.id)} aria-label={tr(`Voir le profil de ${j.nom}`, `View ${j.nom}’s profile`)}>
        <Avatar n={avatar} fraction={minute ? fraction : null} />
        <BulleReaction r={reaction} />
        <span className="siege-nb" title={tr('Cartes en main', 'Cards in hand')}>
          {j.nbCartes}
        </span>
      </button>
      <div className="siege-nom">
        <span className={`point ${s?.connecte || s?.robot ? 'en-ligne' : 'hors-ligne'}`} title={s?.connecte ? tr('En ligne', 'Online') : tr('Hors ligne', 'Offline')} />
        {j.id === salon.hoteId && (
          <span className="couronne-hote" title={tr('Hôte', 'Host')}>
            ♛
          </span>
        )}
        <span className="siege-nom-texte">{j.nom}</span>
        {s?.robot && (
          <span title={tr('Joué par l’ordinateur', 'Played by the computer')} aria-label={tr('Joué par l’ordinateur', 'Played by the computer')}>
            🤖
          </span>
        )}
      </div>
      <div className="siege-infos">{j.annonce !== null ? tr(`Annonce ${j.annonce}`, `Bid ${j.annonce}`) : j.aAnnonce ? tr('A annoncé', 'Has bid') : tr('Annonce…', 'Bidding…')}</div>
      <div className="siege-infos discret">
        {pluriel(j.plis, 'pli', 'trick')} · {j.score} pts
      </div>
      {((j.id === v.premierId && PHASES_DEBUT.includes(v.phase)) || (s && !s.connecte && !s.robot) || s?.abandon) && (
        <div className="badges">
          {j.id === v.premierId && PHASES_DEBUT.includes(v.phase) && <span className="badge or">{tr('Commence', 'Starts')}</span>}
          {s && !s.connecte && !s.robot && <span className="badge rouge">{tr('Hors ligne', 'Offline')}</span>}
          {s?.abandon && <span className="badge rouge">{tr('A quitté', 'Left')}</span>}
        </div>
      )}
      {v.choixAllies && <ChoixAllie v={v} id={j.id} nom={nom} />}
      {j.butin.length > 0 && <Butin ids={j.butin} />}
      {estHote && s && !s.connecte && (
        <button type="button" className="petit" onClick={() => appel('remplacer', { joueurId: j.id, actif: !s.robot })}>
          {s.robot ? tr('Rendre la main', 'Give back control') : tr('Faire jouer l’ordinateur', 'Let the computer play')}
        </button>
      )}
    </article>
  );
}

function Consigne(props: {
  v: Vue;
  selection: string | null;
  agir: (a: ActionSansJoueur) => void;
  nom: (id: string | null | undefined) => string;
  droiteNom: string;
  attenteTexte: string;
  envoi: boolean;
}) {
  const { v, selection, agir, nom, attenteTexte, envoi } = props;
  const nomSel = selection ? nomCarte(selection) : '';
  switch (v.phase) {
    case 'TRAHISON':
      if (v.aChoisiTrahison) return <p>{tr('Carte choisie.', 'Card chosen.')} {attenteTexte}</p>;
      return (
        <>
          <p>
            <strong>{tr('Trahison :', 'Betrayal:')}</strong>{' '}
            {tr(`choisis une carte de ta main à passer à ${props.droiteNom}, ton voisin de droite.`, `choose a card from your hand to pass to ${props.droiteNom}, on your right.`)}
          </p>
          {selection && (
            <button type="button" className="principal" disabled={envoi} onClick={() => agir({ type: 'TRAHISON', carteId: selection })}>
              {tr(`Passer ${nomSel}`, `Pass ${nomSel}`)}
            </button>
          )}
        </>
      );
    case 'ANNONCES':
      const commence = v.premierId === v.moi ? tr('Tu ouvres le premier pli.', 'You lead the first trick.') : tr(`${nom(v.premierId)} ouvre le premier pli.`, `${nom(v.premierId)} leads the first trick.`);
      if (v.monAnnonce !== null) return <p>{tr(`Ton annonce : ${v.monAnnonce}.`, `Your bid: ${v.monAnnonce}.`)} {commence} {attenteTexte}</p>;
      return (
        <>
          <p>
            <strong>{tr('Combien de plis vas-tu gagner ?', 'How many tricks will you win?')}</strong>{' '}
            {tr(`Tu as ${pluriel(v.main.length, 'carte', 'card')}.`, `You have ${pluriel(v.main.length, 'carte', 'card')}.`)} {commence}
            {v.evenement === 'trahison' &&
              tr(' Trahison : après les annonces, chacun passera une carte à son voisin de droite.', ' Betrayal: after the bids, everyone passes a card to the player on their right.')}
          </p>
          <div className="choix-annonce">
            {Array.from({ length: v.nuit + 1 }, (_, n) => (
              <button key={n} type="button" disabled={envoi} onClick={() => agir({ type: 'ANNONCE', valeur: n })}>
                {n}
              </button>
            ))}
          </div>
        </>
      );
    case 'ALLIANCE':
      if (v.aChoisiAllie) return <p>{tr(`Ton choix : ${v.monAllie ? nom(v.monAllie) : 'personne'}.`, `Your choice: ${v.monAllie ? nom(v.monAllie) : 'nobody'}.`)} {attenteTexte}</p>;
      return (
        <>
          <p>
            <strong>{tr('Alliance :', 'Alliance:')}</strong>{' '}
            {tr(
              'choisis en secret un allié. Si vous vous choisissez tous les deux et réussissez votre annonce : +20 chacun.',
              'secretly choose an ally. If you choose each other and both make your bids: +20 each.',
            )}
          </p>
          <div className="choix-joueurs">
            {v.joueurs
              .filter((j) => j.id !== v.moi)
              .map((j) => (
                <button key={j.id} type="button" className="petit" disabled={envoi} onClick={() => agir({ type: 'ALLIANCE', allieId: j.id })}>
                  <span>{j.nom}</span>
                  <small>{tr(`annonce ${j.annonce}`, `bid ${j.annonce}`)}</small>
                </button>
              ))}
            <button type="button" className="petit secondaire" disabled={envoi} onClick={() => agir({ type: 'ALLIANCE', allieId: null })}>
              {tr('Personne', 'Nobody')}
            </button>
          </div>
        </>
      );
    case 'PLI': {
      if (v.tourId !== v.moi) return <p>{tr(`Au tour de ${nom(v.tourId)}.`, `${nom(v.tourId)}’s turn.`)}</p>;
      if (!selection) {
        return (
          <p>
            <strong>{tr('À toi de jouer.', 'Your turn to play.')}</strong>{' '}
            {v.familleDemandee === 'chat_noir'
              ? tr('Chat noir demandé : fournis un Chat noir si tu peux, ou joue une carte spéciale.', 'Black Cat led: play a Black Cat if you can, or a special card.')
              : v.familleDemandee
                ? tr(
                    `Suis les ${NOM_FAMILLE[v.familleDemandee]} si tu peux, ou joue un Chat noir ou une carte spéciale.`,
                    `Follow ${NOM_FAMILLE[v.familleDemandee]} if you can, or play a Black Cat or a special card.`,
                  )
                : tr('Touche une carte pour la choisir.', 'Tap a card to choose it.')}
          </p>
        );
      }
      if (CARTE[selection].speciale === 'croupier') {
        return (
          <>
            <p>
              <strong>Croupier :</strong> {tr('choisis sa valeur.', 'choose its value.')}
            </p>
            <div className="rangee">
              <button type="button" className="principal" disabled={envoi} onClick={() => agir({ type: 'JOUER', carteId: selection, valeurCroupier: 11 })}>
                {tr('Jouer à 11', 'Play as 11')}
              </button>
              <button type="button" className="principal" disabled={envoi} onClick={() => agir({ type: 'JOUER', carteId: selection, valeurCroupier: 0 })}>
                {tr('Jouer à 0', 'Play as 0')}
              </button>
            </div>
          </>
        );
      }
      return (
        <button type="button" className="principal large" disabled={envoi} onClick={() => agir({ type: 'JOUER', carteId: selection })}>
          {tr(`Jouer ${nomSel}`, `Play ${nomSel}`)}
        </button>
      );
    }
    case 'VOL': {
      const source = v.vol?.source === 'baron' ? 'Baron' : 'Pickpocket';
      if (v.vol?.voleurId !== v.moi) return <p>{tr(`${nom(v.vol?.voleurId)} choisit un butin à voler (${source})…`, `${nom(v.vol?.voleurId)} is choosing loot to steal (${source})…`)}</p>;
      const cibles = v.joueurs.filter((j) => j.id !== v.moi && j.butin.length > 0);
      const sansButin = v.joueurs.filter((j) => j.id !== v.moi && j.butin.length === 0).map((j) => j.nom);
      return (
        <>
          <p>
            <strong>{source}{tr(' :', ':')}</strong>{' '}
            {tr('touche le butin que tu veux voler. Un adversaire qui garde un Alibi en main est protégé', 'tap the loot you want to steal. An opponent holding an Alibi is protected')}
            {v.evenement === 'couvre_feu' ? tr(', sauf pendant ce Couvre-feu.', ', except during this Curfew.') : '.'}
          </p>
          <div className="cibles">
            {cibles.map((j) => (
              <div key={j.id} className="cible">
                <span>{j.nom}</span>
                {j.butin.map((id) => (
                  <Pastille key={id} id={id} onClick={() => agir({ type: 'VOLER', cibleId: j.id, carteId: id })} />
                ))}
              </div>
            ))}
            {sansButin.length > 0 && <span className="vide">{tr(`Sans butin : ${sansButin.join(', ')}`, `No loot: ${sansButin.join(', ')}`)}</span>}
          </div>
          <button type="button" className="secondaire" disabled={envoi} onClick={() => agir({ type: 'VOLER', cibleId: null })}>
            {tr('Ne pas voler', 'Don’t steal')}
          </button>
        </>
      );
    }
    case 'FIN_DE_PLI':
      return <p>{tr('Fin du pli. Le pli suivant commence dans un instant…', 'End of the trick. The next trick starts in a moment…')}</p>;
    default:
      return <p>{attenteTexte}</p>;
  }
}

function RecapNuit({ v, nom, estHote, agir, secondes }: { v: Vue; nom: (id: string) => string; estHote: boolean; agir: (a: ActionSansJoueur) => void; secondes: number | null }) {
  const bilan = v.bilans[v.bilans.length - 1];
  const totaux = Object.fromEntries(v.joueurs.map((j) => [j.id, j.score]));
  const signe = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return (
    <Fenetre titre={tr(`Fin de la nuit ${bilan.nuit}`, `End of night ${bilan.nuit}`)} large>
      {bilan.evenement && <p className="discret">{tr(`Événement : ${NOM_EVENEMENT[bilan.evenement]}`, `Event: ${NOM_EVENEMENT[bilan.evenement]}`)}</p>}
      <div className="defile">
        <table className="tableau">
          <thead>
            <tr>
              <th>{tr('Joueur', 'Player')}</th>
              <th title={tr('Plis gagnés / plis annoncés', 'Tricks won / tricks bid')}>{tr('Plis', 'Tricks')}</th>
              <th>{tr('Annonce', 'Bid')}</th>
              <th>{tr('Butin', 'Loot')}</th>
              <th>Bonus</th>
              <th>{tr('Nuit', 'Night')}</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {bilan.scores.map((s) => (
              <tr key={s.joueurId} className={s.joueurId === v.moi ? 'ma-ligne' : ''}>
                <td className="nom-court">{nom(s.joueurId)}</td>
                <td className={s.reussie ? 'reussi' : 'rate'}>
                  {s.plis}/{s.annonce}
                </td>
                <td>{signe(s.pointsAnnonce)}</td>
                <td>{signe(s.pointsButin)}</td>
                <td>{signe(s.bonus)}</td>
                <td>
                  <strong>{signe(s.total)}</strong>
                </td>
                <td>{totaux[s.joueurId]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.pret ? (
        <p className="attente">{v.attente.length ? tr(`En attente de ${v.attente.map(nom).join(', ')}.`, `Waiting for ${v.attente.map(nom).join(', ')}.`) : ''}</p>
      ) : (
        <button type="button" className="principal large" onClick={() => agir({ type: 'CONTINUER' })}>
          {bilan.nuit === v.nbNuits ? tr('Voir le classement', 'See the ranking') : tr(`Passer à la nuit ${bilan.nuit + 1}`, `Go to night ${bilan.nuit + 1}`)}
        </button>
      )}
      {secondes !== null && <p className="discret">{tr(`Suite automatique dans ${secondes} s.`, `Continues automatically in ${secondes} s.`)}</p>}
      {estHote && v.pret && v.attente.length > 0 && (
        <button type="button" className="lien-discret" onClick={() => agir({ type: 'FORCER_SUITE' })}>
          {tr('Continuer sans attendre', 'Continue without waiting')}
        </button>
      )}
    </Fenetre>
  );
}

function FinDePartie(props: {
  v: Vue;
  salon: VueSalon;
  estHote: boolean;
  appel: Appel;
  quitter: () => void;
  nom: (id: string) => string;
  tapis: IdTapis;
  poserTapis?: (id: IdTapis) => Promise<boolean>;
}) {
  const { v, salon, estHote, appel, quitter, nom, tapis, poserTapis } = props;
  const classement = [...v.joueurs].sort((a, b) => b.score - a.score);
  const max = classement[0].score;
  const barons = classement.filter((j) => j.score === max);
  const jeSuisBaron = barons.some((j) => j.id === v.moi);
  const [voirScores, setVoirScores] = useState(false);
  const enr = salon.enregistrement;
  const compteDe = (id: string) => salon.joueurs.find((j) => j.id === id)?.compte ?? null;
  const avatarDe = (id: string) => salon.joueurs.find((j) => j.id === id)?.avatar ?? 1;
  const monBilan = enr?.bilans[v.moi];
  const rangDe = (j: VueJoueur) => classement.findIndex((x) => x.score === j.score) + 1;

  // Classement final animé : 3e, puis 2e, roulement de tambour et le Dernier Baron couronné. Un toucher passe l'animation.
  const [passe, setPasse] = useState(false);
  const minuteurs = useRef<number[]>([]);
  const revele = useRef(false);
  const reveler = () => {
    if (revele.current) return;
    revele.current = true;
    jouerEffet(jeSuisBaron ? 'victoire' : 'revelation');
  };
  useEffect(() => {
    const plus = (ms: number, f: () => void) => minuteurs.current.push(window.setTimeout(f, ms));
    if (classement.length >= 3) plus(300, () => jouerEffet('podium'));
    plus(900, () => jouerEffet('podium'));
    plus(1600, () => jouerEffet('roulement'));
    plus(2620, reveler);
    return () => minuteurs.current.forEach((t) => window.clearTimeout(t));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const passer = () => {
    if (passe) return;
    minuteurs.current.forEach((t) => window.clearTimeout(t));
    setPasse(true);
    reveler();
  };
  // Après le podium : niveau gagné, puis tapis débloqué.
  const debut = useRef(Date.now());
  const sonBilan = useRef(false);
  useEffect(() => {
    if (!monBilan || sonBilan.current || monBilan.niveau <= monBilan.niveauAvant) return;
    sonBilan.current = true;
    const attente = passe ? 300 : Math.max(300, 3700 - (Date.now() - debut.current));
    const a = window.setTimeout(() => jouerEffet('niveau'), attente);
    const b = tapisGagnes(monBilan.niveauAvant, monBilan.niveau).length ? window.setTimeout(() => jouerEffet('deblocage'), attente + 1100) : 0;
    minuteurs.current.push(a, b);
  }, [monBilan, passe]);
  return (
    <Fenetre titre={tr('Fin de la partie', 'Game over')} large>
      <div className={`fin-partie ${passe ? 'passe' : ''}`}>
        <Podium classement={classement} rangDe={rangDe} avatarDe={avatarDe} nom={nom} moi={v.moi} onPasser={passer} />
        <div className="fin-revelation">
          {jeSuisBaron && <p className="victoire-moi">{tr('Tu es le Dernier Baron !', 'You are the Last Baron!')}</p>}
          <p className="dernier-baron">
            {barons.map((j) => j.nom).join(tr(' et ', ' and '))} {barons.length > 1 ? tr('deviennent', 'become') : tr('devient', 'becomes')}
            <span>{tr('le Dernier Baron', 'the Last Baron')}</span>
          </p>
        </div>
        <div className="fin-suite">
          <ol className="classement">
            {classement.map((j) => {
              const rang = classement.findIndex((x) => x.score === j.score) + 1;
              const bilan = enr?.bilans[j.id];
              const compte = compteDe(j.id);
              const niveau = bilan?.niveau ?? compte?.niveau;
              return (
                <li key={j.id} className={j.id === v.moi ? 'ma-ligne' : ''}>
                  <span className="rang">{rang}</span>
                  <span className="fin-joueur">
                    <span className="fin-nom">
                      {nom(j.id)}
                      {niveau !== undefined && <BadgeNiveau niveau={niveau} />}
                      {salon.joueurs.find((x) => x.id === j.id)?.abandon && <span className="badge rouge">{tr('A quitté', 'Left')}</span>}
                    </span>
                    {bilan && (
                      <small className="fin-compte">
                        🏆 {tr(`${pluriel(bilan.victoires, 'victoire', 'win')} au total`, `${pluriel(bilan.victoires, 'victoire', 'win')} in total`)} · +{bilan.xpGagne} XP
                        {bilan.niveau > bilan.niveauAvant && <strong className="niveau-up">{tr(` · Niveau ${bilan.niveau} !`, ` · Level ${bilan.niveau}!`)}</strong>}
                      </small>
                    )}
                    {!bilan && compte && enr?.etat !== 'en_cours' && (
                      <small className="fin-compte">
                        🏆 {tr(`${pluriel(compte.victoires, 'victoire', 'win')} au total`, `${pluriel(compte.victoires, 'victoire', 'win')} in total`)}
                      </small>
                    )}
                  </span>
                  <strong>{j.score} pts</strong>
                </li>
              );
            })}
          </ol>
          {monBilan && (
            <div className={`mon-bilan ${monBilan.niveau > monBilan.niveauAvant ? 'monte' : ''}`}>
              <strong>
                {monBilan.niveau > monBilan.niveauAvant
                  ? tr(`Niveau ${monBilan.niveau} : ${titreNiveau(monBilan.niveau)} !`, `Level ${monBilan.niveau}: ${titreNiveau(monBilan.niveau)}!`)
                  : `+${monBilan.xpGagne} XP`}
              </strong>
              <small>{detailXp(monBilan)}</small>
              <BarreXp xp={monBilan.xp} />
              {tapisGagnes(monBilan.niveauAvant, monBilan.niveau).map((t) => (
                <div key={t.id} className="tapis-debloque">
                  <img src={`/cartes/miniature-tapis-${t.id}.webp`} alt="" />
                  <span>
                    <strong>{tr(`Nouveau tapis débloqué : ${nomTapis(t)}`, `New felt unlocked: ${nomTapis(t)}`)}</strong>
                    {tapis === t.id ? (
                      <small>{tr('Il est posé sur ta table.', 'It is on your table.')}</small>
                    ) : poserTapis ? (
                      <button type="button" className="petit" onClick={() => void poserTapis(t.id)}>
                        {tr('Poser ce tapis', 'Use this felt')}
                      </button>
                    ) : (
                      <small>{tr('Choisis-le dans ton profil.', 'Choose it in your profile.')}</small>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {enr?.etat === 'en_cours' && <p className="discret">{tr('Enregistrement des victoires…', 'Saving wins…')}</p>}
          {enr?.etat === 'test' && (
            <p className="discret">
              {salon.tutoriel
                ? tr('Partie d’apprentissage : elle ne compte pas dans les victoires.', 'Practice game: it does not count towards wins.')
                : tr('Partie de test avec des robots : elle ne compte pas dans les victoires.', 'Test game with robots: it does not count towards wins.')}
            </p>
          )}
          {enr?.etat === 'solo' && (
            <p className="discret">
              {tr('Partie contre l’ordinateur : elle ne compte dans les victoires qu’avec au moins 2 joueurs humains.', 'Game against the computer: it only counts towards wins with at least 2 human players.')}
            </p>
          )}
          {enr?.etat === 'erreur' && <p className="discret">{tr('Certaines victoires n’ont pas pu être enregistrées.', 'Some wins could not be saved.')}</p>}
          {salon.comptesActifs && !compteDe(v.moi) && enr?.etat !== 'test' && enr?.etat !== 'solo' && (
            <p className="discret">{tr('Crée un compte depuis l’accueil pour garder tes victoires et monter de niveau.', 'Create an account from the home screen to keep your wins and level up.')}</p>
          )}
          {voirScores ? (
            <TableauScores v={v} />
          ) : (
            <button type="button" className="lien-discret" onClick={() => setVoirScores(true)}>
              {tr('Voir le détail des nuits', 'See night-by-night scores')}
            </button>
          )}
          {salon.publique && !salon.tutoriel && <Revanche salon={salon} appel={appel} nom={nom} />}
          <div className="rangee">
            {salon.tutoriel ? (
              <>
                <FinTutoriel />
                <button type="button" className="principal" onClick={() => appel('jouer_public', { nom: nom(v.moi) })}>
                  {tr('Jouer en ligne', 'Play online')}
                </button>
                <button type="button" onClick={() => appel('rejouer')}>
                  {tr('Recommencer le tutoriel', 'Restart the tutorial')}
                </button>
              </>
            ) : salon.publique ? (
              <button type="button" onClick={() => appel('jouer_public', { nom: nom(v.moi) })}>
                {tr('🌍 Nouvelle table', '🌍 New table')}
              </button>
            ) : estHote ? (
              <button type="button" className="principal" onClick={() => appel('rejouer')}>
                {tr('Rejouer', 'Play again')}
              </button>
            ) : (
              <p className="attente">{tr("L'hôte peut relancer une partie.", 'The host can start a new game.')}</p>
            )}
            <button type="button" onClick={quitter}>
              {tr('Quitter', 'Leave')}
            </button>
          </div>
        </div>
      </div>
    </Fenetre>
  );
}

/** Podium du classement final (2e à gauche, 1er au centre, 3e à droite), qui monte marche par marche. */
function Podium(props: {
  classement: VueJoueur[];
  rangDe: (j: VueJoueur) => number;
  avatarDe: (id: string) => number;
  nom: (id: string) => string;
  moi: string;
  onPasser: () => void;
}) {
  const { classement, rangDe, avatarDe, nom, moi, onPasser } = props;
  const top = classement.slice(0, 3);
  const ordre = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  return (
    <div
      className={`podium podium-${top.length}`}
      onClick={onPasser}
      role="img"
      aria-label={tr('Classement final : ', 'Final ranking: ') + top.map((j) => `${rangDe(j)}. ${nom(j.id)}`).join(', ')}
    >
      <p className="podium-titre">{tr('Classement final', 'Final ranking')}</p>
      <div className="podium-marches">
        {ordre.map((j) => {
          const place = top.indexOf(j) + 1;
          const rang = rangDe(j);
          return (
            <div key={j.id} className={`podium-place place-${place} ${rang === 1 ? 'baron' : ''} ${j.id === moi ? 'moi' : ''}`}>
              <div className="podium-joueur">
                {rang === 1 && <span className="podium-couronne">♛</span>}
                <img src={`/cartes/avatar-${avatarDe(j.id)}.webp`} alt="" draggable={false} />
                <strong>{nom(j.id)}</strong>
                <small>{j.score} pts</small>
              </div>
              <div className="podium-marche">
                <span>{rang}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TableauScores({ v }: { v: Vue }) {
  if (!v.bilans.length) return <p>{tr('Les scores apparaîtront à la fin de la première nuit.', 'Scores will appear at the end of the first night.')}</p>;
  return (
    <div className="defile">
      <table className="tableau">
        <thead>
          <tr>
            <th>{tr('Nuit', 'Night')}</th>
            {v.joueurs.map((j) => (
              <th key={j.id}>{j.nom}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {v.bilans.map((b) => (
            <tr key={b.nuit}>
              <td>
                {b.nuit}
                {b.evenement && <small className="discret"> · {NOM_EVENEMENT[b.evenement]}</small>}
              </td>
              {v.joueurs.map((j) => {
                const s = b.scores.find((x) => x.joueurId === j.id);
                return (
                  <td key={j.id} className={s?.reussie ? 'reussi' : 'rate'} title={s ? tr(`Annonce ${s.annonce}, ${s.plis} pli(s)`, `Bid ${s.annonce}, ${s.plis} trick(s)`) : ''}>
                    {s ? (s.total > 0 ? `+${s.total}` : s.total) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            {v.joueurs.map((j) => (
              <th key={j.id}>{j.score}</th>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Après l'Alliance, montre à tous qui a choisi qui, et les alliances formées. */
function ChoixAllie({ v, id, nom }: { v: Vue; id: string; nom: (id: string | null | undefined) => string }) {
  const choix = v.choixAllies?.[id] ?? null;
  const allie = v.alliances.some(([a, b]) => (a === id || b === id) && (a === choix || b === choix));
  return (
    <div className={`choix-allie ${allie ? 'allie' : ''}`}>
      {allie ? tr('🤝 Allié avec ', '🤝 Allied with ') : tr('A choisi ', 'Chose ')}
      <strong>{choix ? (choix === v.moi ? tr('toi', 'you') : nom(choix)) : tr('personne', 'nobody')}</strong>
    </div>
  );
}

/** Fin de partie en ligne : la revanche avec les mêmes joueurs (elle part dès que tout le monde l'accepte). */
function Revanche({ salon, appel, nom }: { salon: VueSalon; appel: Appel; nom: (id: string) => string }) {
  const r = salon.revanche ?? null;
  const [fin, setFin] = useState<number | null>(null);
  const [, setTic] = useState(0);
  useEffect(() => setFin(r ? Date.now() + r.finDans : null), [r?.finDans]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (fin === null) return;
    const t = window.setInterval(() => setTic((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [fin]);
  const secondes = fin === null ? null : Math.max(0, Math.ceil((fin - Date.now()) / 1000));
  const humains = salon.joueurs.filter((j) => !j.bot && j.connecte && !j.abandon);
  const votants = new Set(r?.votants ?? []);
  const jAccepte = votants.has(salon.moi);
  return (
    <section className="revanche" aria-live="polite">
      {!jAccepte ? (
        <button type="button" className="principal large bouton-revanche" onClick={() => appel('revanche', { veut: true })}>
          {tr('⚔ Revanche', '⚔ Rematch')}
          <small>{r ? tr(`${votants.size} joueur${votants.size > 1 ? 's' : ''} partant${votants.size > 1 ? 's' : ''} · ${secondes ?? '…'} s`, `${votants.size} ready · ${secondes ?? '…'} s`) : tr('Rejouer à la même table', 'Play again at the same table')}</small>
        </button>
      ) : (
        <div className="revanche-attente">
          <strong>{tr('Revanche acceptée !', 'Rematch accepted!')}</strong>
          <span>
            {tr(`En attente des autres joueurs (${secondes ?? '…'} s) : ceux qui ne répondent pas seront remplacés par l’ordinateur.`, `Waiting for the other players (${secondes ?? '…'} s): those who don’t answer will be replaced by the computer.`)}
          </span>
          <button type="button" className="lien-discret" onClick={() => appel('revanche', { veut: false })}>
            {tr('Annuler', 'Cancel')}
          </button>
        </div>
      )}
      {r && (
        <ul className="revanche-joueurs">
          {humains.map((j) => (
            <li key={j.id} className={votants.has(j.id) ? 'oui' : ''}>
              {votants.has(j.id) ? '✓' : '…'} {j.id === salon.moi ? tr('Toi', 'You') : nom(j.id)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
