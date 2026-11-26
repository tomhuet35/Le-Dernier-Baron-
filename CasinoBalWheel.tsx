/**
 * Le Bal du Grand Hôtel : la roue géante du bal, en direct. Deux roues valsent : la grande (54 cases) et la petite
 * (30 crans) qui tourne dans l'autre sens, s'arrête un peu après et multiplie le résultat. Ses cinq bonus ont chacun
 * leur écran : CasinoPickpocket.tsx, CasinoDonne.tsx, CasinoFontaine.tsx, CasinoChaises.tsx et CasinoMinuit.tsx.
 *
 * Le serveur tient les manches et diffuse la vue (« casino_bal ») ; il a déjà tiré la case et le cran d'arrêt quand
 * les roues partent, et tout le tirage d'un bonus quand il commence. Cet écran ne fait que montrer.
 *
 * Visuels : bal-*.webp (décor, jante, anneau, moyeu, éventail, lustre, matières des cases et des crans).
 */
import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import type { VueBonusBW, VueBW } from '../../shared/baronWheel';
import {
  CASES_BAL,
  DEGRES_CASE_BAL,
  DEGRES_CRAN_BAL,
  DUREES_BAL,
  estBonusBal,
  JETONS_BW,
  MAX_CASE_BW,
  PETITE_BAL,
  ROUE_BAL,
  VALEUR_CHIFFRE_BAL,
  type BonusBal,
  type CaseBal,
  type VueBal,
} from '../../shared/balWheel';
import type { VueCasino } from '../../shared/casino';
import type { Appel } from './App';
import { BUTIN_PLUIE, dollars, PluieLingots, useSoldeAnime } from './casinoOutils';
import { socket } from './socket';
import { EN, tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import { DECOR_BAL, LUMIERES_JANTE_BAL } from './balDecor';
import { BonusPickpocket, IMAGES_PICKPOCKET_NOMS } from './CasinoPickpocket';
import { BonusDonne, IMAGES_DONNE_NOMS } from './CasinoDonne';
import { BonusFontaine, IMAGES_FONTAINE_NOMS } from './CasinoFontaine';
import { BonusChaises, IMAGES_CHAISES_NOMS } from './CasinoChaises';
import { BonusMinuit, IMAGES_MINUIT_NOMS } from './CasinoMinuit';
import './baronWheel.css';
import './balWheel.css';

const CLE_JETON = 'ldb-bal-jeton';
const court = (n: number) => (n >= 1_000_000_000 ? `${+(n / 1_000_000_000).toFixed(1)}${tr('Md', 'B')}` : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n));
const imageJeton = (v: number) => (v >= 10_000_000 ? 'or' : v >= 5_000_000 ? 'argent' : v >= 1_000_000 ? 'bleu' : v >= 500_000 ? 'violet' : v >= 100_000 ? 'noir' : v >= 25_000 ? 'vert' : v >= 5_000 ? 'rouge' : 'ivoire');
const fx = (x: number) => `×${x.toLocaleString(EN ? 'en-US' : 'fr-FR', { maximumFractionDigits: 2 })}`;

export const NOMS_BONUS_BAL: Record<BonusBal, [string, string]> = {
  pickpocket: ['Le Pickpocket', 'The Pickpocket'],
  donne: ['Le Choix du Baron', 'The Baron’s Pick'],
  fontaine: ['La Fontaine de champagne', 'The Champagne Fountain'],
  chaises: ['Les Chaises musicales', 'Musical Chairs'],
  minuit: ['Le Bal masqué', 'The Masked Ball'],
};
/** L'objet de chaque bonus (sur la roue, le tapis, l'historique et le titre du bonus). */
export const SYMBOLES_BAL: Record<BonusBal, string> = {
  pickpocket: '/cartes/bal-obj-pickpocket.webp',
  donne: '/cartes/bal-obj-donne.webp',
  fontaine: '/cartes/bal-obj-fontaine.webp',
  chaises: '/cartes/bal-obj-chaises.webp',
  minuit: '/cartes/bal-obj-minuit.webp',
};
const MATIERE: Record<CaseBal, string> = {
  b1: 'nacre',
  b2: 'nacre',
  b4: 'nacre',
  b12: 'nacre',
  b24: 'champagne',
  pickpocket: 'champagne',
  donne: 'champagne',
  fontaine: 'champagne',
  chaises: 'champagne',
  minuit: 'velours',
};
/** Le nom court de chaque bonus, sur le tapis. */
const COURTS_BAL: Record<BonusBal, [string, string]> = {
  pickpocket: ['Pickpocket', 'Pickpocket'],
  donne: ['Choix du Baron', 'Baron’s Pick'],
  fontaine: ['Fontaine', 'Fountain'],
  chaises: ['Chaises', 'Chairs'],
  minuit: ['Bal masqué', 'Masked Ball'],
};
/** Le nom d'une case, dans son cadre (même règle que le Baron Express : --n lettres sur la plus longue ligne). */
function NomCase({ texte }: { texte: string }) {
  const long = texte.length > 9 && texte.includes(' ');
  const n = long ? Math.max(...texte.split(' ').map((m) => m.length)) : texte.length;
  return (
    <span className={`bw-case-nom ${long ? 'long' : ''}`} style={{ '--n': n } as CSSProperties}>
      {texte}
    </span>
  );
}
const nbCases = (x: CaseBal) => {
  const n = ROUE_BAL.filter((y) => y === x).length;
  return n > 1 ? tr(`${n} cases`, `${n} spots`) : tr('1 case', '1 spot');
};
const IMAGES_BONUS_BAL: Record<BonusBal, string[]> = {
  pickpocket: IMAGES_PICKPOCKET_NOMS,
  donne: IMAGES_DONNE_NOMS,
  fontaine: IMAGES_FONTAINE_NOMS,
  chaises: IMAGES_CHAISES_NOMS,
  minuit: IMAGES_MINUIT_NOMS,
};
let prechargementLance = false;
/** Les images des mini-jeux se chargent en fond pendant qu'on mise : chaque bonus s'affiche ensuite sans attendre. */
function prechargerLesBonus() {
  if (prechargementLance) return;
  prechargementLance = true;
  const file = [...new Set(Object.values(IMAGES_BONUS_BAL).flat())].map((n) => `/cartes/${n}.webp`);
  let i = 0;
  const suivante = (): Promise<void> =>
    i < file.length
      ? new Promise<void>((ok) => {
          const im = new Image();
          im.onload = im.onerror = () => ok();
          im.src = file[i++];
        }).then(suivante)
      : Promise.resolve();
  void suivante();
  void suivante();
}

// ---------------------------------------------------------------------------------------------------------------
// Les deux roues (SVG de 740 unités : la grande de 236 à 362 de rayon, la petite de 120 à 218)

function secteur(r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)} ${(-r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`;
  return `M${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

function GrandeRoue({ refRoue }: { refRoue: MutableRefObject<SVGSVGElement | null> }) {
  const A = DEGRES_CASE_BAL;
  return (
    <svg className="grande" ref={refRoue} viewBox="-370 -370 740 740" aria-hidden="true">
      <circle r="366" fill="#1a0e08" />
      {ROUE_BAL.map((c, i) => {
        const a = i * A;
        const mat = MATIERE[c];
        const fond = mat === 'velours' ? '#3a0d22' : mat === 'champagne' ? '#d8b26a' : '#efe2d6';
        return (
          <g key={i}>
            <path d={secteur(236, 362, a - A / 2, a + A / 2)} fill={fond} />
            <image href={`/cartes/bal-cs-${mat}.webp`} x="-23" y="-363" width="46" height="129" transform={`rotate(${a.toFixed(3)})`} preserveAspectRatio="none" />
            {estBonusBal(c) ? (
              <image href={SYMBOLES_BAL[c]} x="-22" y="-326" width="44" height="44" transform={`rotate(${a.toFixed(3)})`} />
            ) : (
              <text transform={`rotate(${a.toFixed(3)}) translate(0 -300) rotate(-90)`} className={`ch ${VALEUR_CHIFFRE_BAL[c] >= 12 ? 'gros' : ''}`} textAnchor="middle" dominantBaseline="central">
                ×{VALEUR_CHIFFRE_BAL[c]}
              </text>
            )}
          </g>
        );
      })}
      {ROUE_BAL.map((_, i) => (
        <line key={`f${i}`} x1="0" y1="-236" x2="0" y2="-363" transform={`rotate(${(i * A + A / 2).toFixed(3)})`} className="filet" />
      ))}
    </svg>
  );
}

function PetiteRoue({ refRoue }: { refRoue: MutableRefObject<SVGSVGElement | null> }) {
  const A = DEGRES_CRAN_BAL;
  return (
    <svg className="petite" ref={refRoue} viewBox="-370 -370 740 740" aria-hidden="true">
      <circle r="219" fill="#0d0805" />
      {PETITE_BAL.map((m, j) => {
        const a = j * A;
        const mat = m === 1 ? 'laque' : m === 20 ? 'champagne' : 'rubis';
        const fond = mat === 'laque' ? '#0d0805' : mat === 'rubis' ? '#7a0a14' : '#d8b26a';
        return (
          <g key={j}>
            <path d={secteur(120, 218, a - A / 2, a + A / 2)} fill={fond} />
            <image href={`/cartes/bal-cr-${mat}.webp`} x="-24" y="-219" width="48" height="101" transform={`rotate(${a})`} preserveAspectRatio="none" />
            <text transform={`rotate(${a}) translate(0 -163) rotate(-90)`} className={`cr ${mat}`} textAnchor="middle" dominantBaseline="central">
              ×{m}
            </text>
          </g>
        );
      })}
      {PETITE_BAL.map((_, j) => (
        <line key={`f${j}`} x1="0" y1="-120" x2="0" y2="-219" transform={`rotate(${j * A + A / 2})`} className="filet fin" />
      ))}
    </svg>
  );
}

/** Le ralenti des roues : lancées fort, elles freinent longuement (proche des courbes de la maquette). */
const freine = (u: number, k: number) => 1 - (1 - Math.min(1, Math.max(0, u))) ** k;

/** La scène du bal : le décor, le lustre (qui annonce le résultat) et les deux roues. */
function SceneBal({ v, fige }: { v: VueBal; fige?: boolean }) {
  const grande = useRef<SVGSVGElement | null>(null);
  const petite = useRef<SVGSVGElement | null>(null);
  const horloge = useRef<{ numero: number; debut: number | null }>({ numero: -1, debut: null });
  const [etat, setEtat] = useState<'repos' | 'tour' | 'arret'>('repos');
  const [arretP, setArretP] = useState(false);
  const vRef = useRef(v);
  vRef.current = v;

  // Le départ du tour, calé sur le serveur (on garde l'estimation la plus tôt).
  if (v.tour && !fige) {
    const estime = performance.now() - v.tour.ecoule;
    const h = horloge.current;
    if (h.numero !== v.numero || h.debut === null) horloge.current = { numero: v.numero, debut: estime };
    else h.debut = Math.min(h.debut, estime);
  }

  useEffect(() => {
    let raf = 0;
    const image = () => {
      raf = requestAnimationFrame(image);
      const x = vRef.current;
      let ag = x.angle;
      let ap = x.angleP;
      let e: 'repos' | 'tour' | 'arret' = x.phase === 'mises' ? 'repos' : 'arret';
      let p = true;
      if (x.tour && !fige && horloge.current.debut !== null) {
        const t = performance.now() - horloge.current.debut;
        ag = x.tour.depart + (x.tour.arrivee - x.tour.depart) * freine(t / DUREES_BAL.tourGrande, 3.4);
        ap = x.tour.departP + (x.tour.arriveeP - x.tour.departP) * freine(t / DUREES_BAL.tourPetite, 3.8);
        e = t < DUREES_BAL.tourGrande ? 'tour' : 'arret';
        p = t >= DUREES_BAL.tourPetite;
      }
      if (grande.current) grande.current.style.rotate = `${ag}deg`;
      if (petite.current) petite.current.style.rotate = `${ap}deg`;
      setEtat((avant) => (avant === e ? avant : e));
      setArretP((avant) => (avant === p ? avant : p));
    };
    raf = requestAnimationFrame(image);
    return () => cancelAnimationFrame(raf);
  }, [fige]);

  // Le lustre : « Faites vos jeux », puis la case et la petite roue, puis le total.
  const c = v.arret !== null ? ROUE_BAL[v.arret] : null;
  const m = v.arretP !== null ? PETITE_BAL[v.arretP] : 1;
  let gauche: ReactNode = tr('Faites vos jeux', 'Place your bets');
  let droite = '×?';
  let total = false;
  if (etat === 'tour' || (v.phase === 'tour' && !c)) {
    gauche = tr('Les roues valsent…', 'The wheels waltz…');
    droite = '…';
  } else if (c && etat === 'arret' && v.phase !== 'mises') {
    const base = estBonusBal(c) ? tr(NOMS_BONUS_BAL[c][0].replace(/^(Le|La|Les) /, ''), NOMS_BONUS_BAL[c][1].replace(/^The /, '')) : fx(VALEUR_CHIFFRE_BAL[c]);
    gauche = arretP ? `${base} × ${m}` : base;
    droite = arretP ? (estBonusBal(c) ? fx(m) : fx(VALEUR_CHIFFRE_BAL[c] * m)) : '…';
    total = arretP;
  }

  return (
    <div className={`bal-scene ${etat === 'tour' ? 'tour' : etat === 'arret' && v.phase !== 'mises' ? 'arret' : ''}`}>
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: DECOR_BAL }} />
      <div className="lustre-t">
        <span>{gauche}</span>
        <b className={total ? 'total' : undefined}>{droite}</b>
      </div>
      <div className="roue">
        <div className="bal-disque">
          <GrandeRoue refRoue={grande} />
          <PetiteRoue refRoue={petite} />
          <svg className="gagne" viewBox="-370 -370 740 740" aria-hidden="true">
            <path className="g-case" d={secteur(236, 362, -DEGRES_CASE_BAL / 2, DEGRES_CASE_BAL / 2)} />
            <path className="g-cran" d={secteur(120, 218, -DEGRES_CRAN_BAL / 2, DEGRES_CRAN_BAL / 2)} />
          </svg>
          <img className="anneau-or" src="/cartes/bal-anneau.webp" alt="" draggable={false} />
          <img className="pointeur" src="/cartes/bal-pointeur.webp" alt="" draggable={false} />
        </div>
        <img className="jante" src="/cartes/bal-jante.webp" alt="" draggable={false} />
        <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: LUMIERES_JANTE_BAL }} />
        <img className="moyeu" src="/cartes/bal-moyeu.webp" alt="" draggable={false} />
        <img className="eventail" src="/cartes/bal-eventail.webp" alt="" draggable={false} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les bonus

function Barre({ v, cle }: { v: VueBal; cle: string }) {
  const calage = useRef<{ cle: string; part: number; reste: number } | null>(null);
  if (v.reste === null || !v.duree) return null;
  if (calage.current?.cle !== cle) calage.current = { cle, part: Math.min(1, v.reste / v.duree), reste: v.reste };
  const { part, reste } = calage.current;
  return (
    <span className="bw-barre" aria-hidden="true">
      <i key={cle} style={{ '--part': part, animationDuration: `${reste}ms` } as CSSProperties} />
    </span>
  );
}

const CONSIGNES: Record<string, [string, string]> = {
  mallettes: ['Sous quel chapeau est le butin ?', 'Which hat hides the loot?'],
  cartes: ['Choisis ta carte', 'Pick your card'],
  pari: ['Choisis ton invité', 'Pick your guest'],
  masques: ['Choisis ton masque', 'Pick your mask'],
};

function SceneBonusBal({ v, appel, onErreur }: { v: VueBal; appel: Appel; onErreur: (e: string | null) => void }) {
  const b = v.bonus!;
  const e = b.etapes[b.etape];
  const nom = v.phase === 'resultat' ? 'revele' : e.nom;
  const ouvert = v.phase === 'bonus' && e.choix > 0 && b.mise > 0 && b.mesChoix[0] === null;
  const choisir = (o: number) => {
    if (!ouvert) return;
    jouerEffet('jeton');
    void appel('casino_bal_choisir', { etape: b.etape, choix: o }).then((r) => onErreur(r.ok ? null : (r.erreur ?? tr('Choix impossible.', 'Choice not allowed.'))));
  };
  // Les écrans des mini-jeux lisent la vue au format du Baron Express (mêmes champs).
  const vb = v as unknown as VueBW;
  const bb = b as unknown as VueBonusBW;
  const roue = <SceneBal v={v} fige />;
  const r = b.resultat;
  const consigne = CONSIGNES[nom];
  return (
    <div className={`bw-bonus ${b.type}`}>
      {b.type === 'pickpocket' && <BonusPickpocket v={vb} b={bb} nom={nom} ouvert={ouvert} choisir={choisir} />}
      {b.type === 'donne' && <BonusDonne v={vb} b={bb} nom={nom} ouvert={ouvert} choisir={choisir} />}
      {b.type === 'fontaine' && <BonusFontaine v={vb} b={bb} nom={nom} roue={roue} />}
      {b.type === 'chaises' && <BonusChaises v={vb} b={bb} nom={nom} ouvert={ouvert} choisir={choisir} roue={roue} />}
      {b.type === 'minuit' && <BonusMinuit v={vb} b={bb} nom={nom} ouvert={ouvert} choisir={choisir} roue={roue} />}
      {nom !== 'intro' && (
        <div className="bw-bonus-titre">
          <img src={SYMBOLES_BAL[b.type]} alt="" />
          <strong>{tr(...NOMS_BONUS_BAL[b.type])}</strong>
          {b.multiplicateur > 1 && <em className="bw-bonus-multi">×{b.multiplicateur}</em>}
        </div>
      )}
      {/* (les Chaises et le Bal masqué ont leur propre consigne dans la scène) */}
      {consigne && e.choix > 0 && v.phase === 'bonus' && b.type !== 'chaises' && b.type !== 'minuit' && (
        <div className="bw-bonus-consigne">
          <span>{tr(...consigne)}</span>
          {b.mise > 0 ? b.mesChoix[0] !== null ? <small>{tr('Choix fait : on attend les autres…', 'Done: waiting for the others…')}</small> : <small>{tr(`Ta mise : ${dollars(b.mise)}`, `Your bet: ${dollars(b.mise)}`)}</small> : <small>{tr('Tu regardes : tu n’as pas misé sur ce bonus.', 'Watching: you did not bet on this bonus.')}</small>}
          <Barre v={v} cle={`${v.numero}-${b.etape}`} />
        </div>
      )}
      {nom === 'revele' && b.mise > 0 && r && (
        <div className={`bw-bonus-resultat ${r.gain > 0 ? 'gagne' : 'perdu'}`} role="status">
          <small>{tr('Ta récompense', 'Your reward')}</small>
          <strong>{r.gain > 0 ? `${fx(r.x)} · +${dollars(r.gain)}` : tr('Pas de gain cette fois', 'No win this time')}</strong>
          {r.gain > 0 && b.multiplicateur > 1 && <em>{tr(`${fx(r.x / b.multiplicateur)} × ${b.multiplicateur} (petite roue)`, `${fx(r.x / b.multiplicateur)} × ${b.multiplicateur} (small wheel)`)}</em>}
        </div>
      )}
      {nom === 'revele' && !b.mise && <div className="bw-bonus-resultat spectateur">{tr('Mise sur ce bonus à la prochaine manche pour jouer !', 'Bet on this bonus next round to play!')}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

function useSecondes(fin: number | null) {
  const [, setTic] = useState(0);
  useEffect(() => {
    if (fin === null) return;
    const id = window.setInterval(() => setTic((x) => x + 1), 250);
    return () => window.clearInterval(id);
  }, [fin]);
  return fin === null ? 0 : Math.max(0, Math.ceil((fin - Date.now()) / 1000));
}

export function JeuBalWheel({ vue, appel, onRetour }: { vue: VueCasino; appel: Appel; onRetour: () => void }) {
  const [v, setV] = useState<VueBal | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [jeton, setJeton] = useState<number>(() => {
    try {
      const x = Number(localStorage.getItem(CLE_JETON));
      return JETONS_BW.includes(x) ? x : JETONS_BW[1];
    } catch {
      return JETONS_BW[1];
    }
  });
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  const [credit, setCredit] = useState<{ montant: number; id: number } | null>(null);
  const minuteries = useRef<number[]>([]);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  useEffect(() => () => minuteries.current.forEach((m) => window.clearTimeout(m)), []);
  const solde = useSoldeAnime(v?.solde ?? vue.solde);
  const [finPhase, setFinPhase] = useState<number | null>(null);
  const clePhase = useRef('');

  useEffect(() => window.scrollTo(0, 0), []);
  useEffect(() => {
    const t = window.setTimeout(prechargerLesBonus, 1500);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(CLE_JETON, String(jeton));
    } catch {
      /* préférence non gardée */
    }
  }, [jeton]);

  useEffect(() => {
    let vivant = true;
    const entrer = async (essai = 0): Promise<void> => {
      const r = (await appel('casino_bal_entrer')) as { ok: boolean; erreur?: string; roue?: VueBal };
      if (!vivant) return;
      if (r.ok && r.roue) {
        setErreur(null);
        return setV(r.roue);
      }
      if (essai < 5) return void window.setTimeout(() => void entrer(essai + 1), 1200);
      setErreur(r.erreur ?? tr('La roue est indisponible pour le moment.', 'The wheel is unavailable right now.'));
    };
    void entrer();
    const surVue = (x: VueBal) => setV(x);
    const surConnexion = () => window.setTimeout(() => void entrer(), 2600);
    socket.on('casino_bal', surVue);
    socket.on('connect', surConnexion);
    return () => {
      vivant = false;
      socket.off('casino_bal', surVue);
      socket.off('connect', surConnexion);
      socket.emit('casino_bal_quitter');
    };
  }, [appel]);

  // Les changements de phase : la fin de phase (pour le compte à rebours), les sons et les fêtes.
  const precedente = useRef<VueBal | null>(null);
  useEffect(() => {
    if (!v) return;
    const cle = `${v.numero}-${v.phase}-${v.bonus?.etape ?? ''}`;
    const fin = v.reste === null ? null : Date.now() + v.reste;
    const change = clePhase.current !== cle;
    clePhase.current = cle;
    setFinPhase((avant) => (fin === null ? null : change || avant === null ? fin : Math.min(avant, fin)));
    const avant = precedente.current;
    precedente.current = v;
    if (!avant || (avant.numero === v.numero && avant.phase === v.phase)) return;
    if (v.phase === 'tour' && v.tour) {
      jouerEffet('bw_lancer');
      plusTard(() => jouerEffet('bw_arret'), Math.max(0, DUREES_BAL.tourGrande - v.tour.ecoule));
      if (v.arretP !== null && PETITE_BAL[v.arretP] > 1) plusTard(() => jouerEffet('rm_double'), Math.max(0, DUREES_BAL.tourPetite - v.tour.ecoule));
    }
    if (v.phase === 'resultat' && avant.phase !== 'resultat' && v.bilan && v.bilan.mise > 0) {
      const { mise, gain } = v.bilan;
      if (gain > 0) {
        setCredit({ montant: gain, id: Date.now() });
        plusTard(() => setCredit(null), 2700);
      }
      jouerEffet(gain >= 10 * mise ? 'bw_gros' : gain > 0 ? 'bw_gain' : 'bw_perdu');
      if (gain >= 10 * mise && gain > 0 && !mouvementReduit()) {
        setPluie({ n: gain >= 100 * mise ? 64 : 34, id: Date.now() });
        plusTard(() => setPluie(null), 3800);
      }
    }
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const secondes = useSecondes(v?.phase === 'mises' ? finPhase : null);
  const ouvertes = !!v && v.phase === 'mises' && (v.reste ?? 0) > 0;
  const maMise = v ? Object.values(v.mesMises).reduce((s: number, x) => s + (x ?? 0), 0) : 0;
  const envoyer = async (evt: string, data?: unknown) => {
    setErreur(null);
    const r = await appel(evt, data);
    if (!r.ok) setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    return r.ok;
  };
  const miser = async (c: CaseBal) => {
    if (!v || !ouvertes) return;
    if (jeton > v.solde) return setErreur(tr('Solde insuffisant pour ce jeton.', 'Not enough money for this chip.'));
    if (await envoyer('casino_bal_miser', { case: c, montant: jeton })) jouerEffet('jeton');
  };

  const enBonus = !!v?.bonus && (v.phase === 'bonus' || v.phase === 'resultat');
  const c = v && v.arret !== null ? ROUE_BAL[v.arret] : null;
  const m = v && v.arretP !== null ? PETITE_BAL[v.arretP] : 1;
  let statut: ReactNode = tr('La roue se prépare…', 'The wheel is getting ready…');
  if (v) {
    if (v.phase === 'mises') statut = <strong>{tr(`Faites vos jeux · ${secondes} s`, `Place your bets · ${secondes} s`)}</strong>;
    else if (v.phase === 'tour') statut = <strong>{tr('Les roues valsent…', 'The wheels waltz…')}</strong>;
    else if (c && v.phase === 'bonus' && estBonusBal(c)) statut = <strong>{tr(`Bonus : ${tr(...NOMS_BONUS_BAL[c])} !`, `Bonus: ${tr(...NOMS_BONUS_BAL[c])}!`)}</strong>;
    else if (c)
      statut = (
        <strong className="bw-statut-resultat">
          {estBonusBal(c) ? tr(...NOMS_BONUS_BAL[c]) : tr(`La case ${fx(VALEUR_CHIFFRE_BAL[c])} paie ${fx(VALEUR_CHIFFRE_BAL[c] * m)}`, `The ${fx(VALEUR_CHIFFRE_BAL[c])} spot pays ${fx(VALEUR_CHIFFRE_BAL[c] * m)}`)}
          {m > 1 ? <em>{tr(`Petite roue ×${m} !`, `Small wheel ×${m}!`)}</em> : null}
        </strong>
      );
  }
  const gagnante = v && v.phase === 'resultat' ? c : null;

  return (
    <div className={`cas-ecran bw-ecran bal-ecran ${enBonus ? 'en-bonus' : ''}`} data-phase={v?.phase ?? 'mises'}>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="bal-titre">
          <img src="/cartes/bal-logo.webp" alt={tr('Le Bal du Grand Hôtel', 'The Grand Hotel Ball')} draggable={false} />
        </h1>
        <span className={`cas-solde-petit bw-solde ${credit ? 'credite' : ''}`}>
          {dollars(solde)}
          {credit && (
            <b key={credit.id} className="bw-credit">
              +{dollars(credit.montant)}
            </b>
          )}
        </span>
      </header>

      <div className="bw-droite">
        <div className="bal-historique" aria-label={tr('Derniers résultats', 'Last results')}>
          {(v?.historique ?? []).slice(0, 12).map((h, k) => (
            <span key={k} className={`bal-pastille ${h.c}`}>
              {estBonusBal(h.c) ? <img src={SYMBOLES_BAL[h.c]} alt={tr(...NOMS_BONUS_BAL[h.c])} /> : fx(VALEUR_CHIFFRE_BAL[h.c])}
              {h.x > 1 && <i>×{h.x}</i>}
            </span>
          ))}
        </div>
      </div>

      <div className="bw-gauche">
        <div className="bw-plateau bal-plateau">
          {v && (enBonus ? <SceneBonusBal v={v} appel={appel} onErreur={setErreur} /> : <SceneBal v={v} />)}
          {!v && <div className="chargement">{erreur ?? tr('Le bal commence…', 'The ball is starting…')}</div>}
          <span className="bw-direct">
            {tr('En direct', 'Live')}
            {v ? ` · ${v.spectateurs}` : ''}
          </span>
        </div>
        <div className="bw-statut" role="status">
          {statut}
          {v?.phase === 'mises' && <Barre v={v} cle={`m${v.numero}`} />}
        </div>
        {v?.bilan && v.bilan.mise > 0 && (
          <div className={`bw-bilan ${v.bilan.gain > v.bilan.mise ? 'gagne' : v.bilan.gain > 0 ? 'rendu' : 'perdu'}`}>
            <span>
              <small>{tr('Mises', 'Bets')}</small>
              {dollars(v.bilan.mise)}
            </span>
            <span>
              <small>{tr('Gains', 'Winnings')}</small>
              {dollars(v.bilan.gain)}
            </span>
            <span>
              <small>{tr('Résultat', 'Net')}</small>
              {v.bilan.gain - v.bilan.mise >= 0 ? '+' : '−'}
              {dollars(Math.abs(v.bilan.gain - v.bilan.mise))}
            </span>
            <span>
              <small>{tr('Solde', 'Balance')}</small>
              {dollars(v.solde)}
            </span>
          </div>
        )}
      </div>

      <div className="bw-droite bas">
        <section className="bw-commandes" role="group" aria-label={tr('Tes mises', 'Your bets')}>
          <div className="bw-tapis bal-tapis">
            {CASES_BAL.map((x) => {
              const mise = v?.mesMises[x] ?? 0;
              const mat = MATIERE[x];
              return (
                <button key={x} type="button" className={`bw-case bal-case ${x} ${mise ? 'misee' : ''} ${gagnante === x ? 'gagnante' : ''}`} style={{ '--fond': mat === 'nacre' ? '#efe2d6' : mat === 'velours' ? '#5a1030' : '#d8b26a', '--texte': mat === 'velours' ? '#ffe7a6' : '#4a0c18', '--matiere': `url(/cartes/bal-matiere-${mat}.webp)` } as CSSProperties} onClick={() => void miser(x)} disabled={!ouvertes} aria-label={estBonusBal(x) ? tr(...NOMS_BONUS_BAL[x]) : fx(VALEUR_CHIFFRE_BAL[x])}>
                  {estBonusBal(x) ? <img src={SYMBOLES_BAL[x]} alt="" draggable={false} /> : <strong>{fx(VALEUR_CHIFFRE_BAL[x])}</strong>}
                  <NomCase texte={estBonusBal(x) ? tr(...COURTS_BAL[x]) : nbCases(x)} />
                  {mise > 0 && (
                    <span className="bw-case-mise">
                      <img src={`/cartes/jeton-${imageJeton(mise)}.webp`} alt="" />
                      {court(mise)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="bj-jetons">
            {JETONS_BW.map((j) => (
              <button key={j} type="button" className={`bj-jeton ${j === jeton ? 'choisi' : ''}`} onClick={() => (setJeton(j), jouerEffet('jeton'))} disabled={!!v && j > v.solde && j !== jeton} aria-pressed={j === jeton} aria-label={dollars(j)}>
                <img src={`/cartes/jeton-${imageJeton(j)}.webp`} alt="" />
                <span>{court(j)}</span>
              </button>
            ))}
          </div>
          <p className="bj-mise-encours bw-mise">
            {tr('Ta mise', 'Your bet')} <strong>{dollars(maMise)}</strong>
            <small>{tr(`Au plus ${court(MAX_CASE_BW)} par case et par manche`, `At most ${court(MAX_CASE_BW)} per spot and per round`)}</small>
          </p>
          <div className="bj-boutons">
            <button type="button" onClick={() => void envoyer('casino_bal_annuler')} disabled={!ouvertes || !maMise}>
              {tr('Annuler', 'Undo')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_bal_annuler', { tout: true })} disabled={!ouvertes || !maMise}>
              {tr('Effacer', 'Clear')}
            </button>
            <button type="button" onClick={() => void envoyer('casino_bal_doubler').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !maMise}>
              {tr('Doubler', 'Double')}
            </button>
            <button type="button" className="bj-principal" onClick={() => void envoyer('casino_bal_refaire').then((ok) => ok && jouerEffet('jeton'))} disabled={!ouvertes || !!maMise || !v?.peutRefaire}>
              {tr('Répéter', 'Repeat')}
            </button>
          </div>
          {erreur && v && <p className="cas-erreur">{erreur}</p>}
        </section>

        <aside className="bw-joueurs" aria-label={tr('Cette manche', 'This round')}>
          <h2>
            {tr('Cette manche', 'This round')}
            {v ? <small> · {tr(`manche n° ${v.numero}`, `round #${v.numero}`)}</small> : null}
          </h2>
          {v?.joueurs.length ? (
            <ol>
              {v.joueurs.map((j, k) => (
                <li key={k} className={`${j.moi ? 'moi' : ''} ${j.gain ? 'gagne' : ''}`}>
                  <img src={`/cartes/avatar-${j.avatar}.webp`} alt="" />
                  <span className="bw-joueur-nom">{j.nom}</span>
                  <span className="bw-joueur-mise">{dollars(j.mise)}</span>
                  <strong>{j.gain === null ? '—' : j.gain > 0 ? `+${dollars(j.gain)}` : tr('perdu', 'lost')}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="discret">{tr('Personne n’a encore misé sur cette manche.', 'Nobody has bet on this round yet.')}</p>
          )}
          <details className="bw-regles">
            <summary>{tr('Règles et probabilités', 'Rules and odds')}</summary>
            <p className="cas-mention">
              {tr(
                'Deux roues valsent. La grande a 54 cases, toutes avec la même chance : ×1 (24 cases), ×2 (12), ×4 (6), ×12 (2), ×24 (1), et 9 bonus : le Pickpocket (2), le Choix du Baron (2), la Fontaine de champagne (2), les Chaises musicales (2) et le Bal masqué (1, le grand final au penthouse). La petite roue, au centre, tourne dans l’autre sens et multiplie le résultat, bonus compris : ×1 sur 24 crans, ×2 sur 2, ×3, ×5, ×10 et ×20. Une case de chiffre paie sa valeur fois la petite roue, mise comprise. Au Pickpocket, choisis l’un des trois chapeaux : l’un cache le butin (×15 à ×500), les autres ×2 à ×8. Au Choix du Baron, retourne l’une des neuf cartes (×5 à ×500). À la Fontaine de champagne, le champagne dévale la pyramide jusqu’à l’une des huit coupes (×6 à ×200) ; une coupe Double double tout et fait reverser. Aux Chaises musicales, choisis ton invité : ×2, ×6 ou ×10 selon le moment où il sort, ×30 s’il est le dernier assis. Au Bal masqué, choisis l’un des trois masques de la Roue de Minuit (×3 à ×200) ; Double et Triple multiplient tes cases et la roue repart. Jetons de 1 000 à 10 000 000 $. Chaque case rend en moyenne environ 97 % de ce qu’on y mise.',
                'Two wheels waltz. The big one has 54 spots, all equally likely: ×1 (24 spots), ×2 (12), ×4 (6), ×12 (2), ×24 (1), and 9 bonuses: the Pickpocket (2), the Baron’s Pick (2), the Champagne Fountain (2), Musical Chairs (2) and the Masked Ball (1, the grand finale in the penthouse). The small wheel in the middle spins the other way and multiplies the result, bonuses included: ×1 on 24 notches, ×2 on 2, ×3, ×5, ×10 and ×20. A number spot pays its value times the small wheel, stake included. In the Pickpocket, pick one of three hats: one hides the loot (×15 to ×500), the others ×2 to ×8. In the Baron’s Pick, turn one of nine cards (×5 to ×500). In the Champagne Fountain, the champagne runs down the pyramid into one of eight glasses (×6 to ×200); a Double glass doubles everything and pours again. In Musical Chairs, pick your guest: ×2, ×6 or ×10 depending on when they go out, ×30 if they are the last one seated. In the Masked Ball, pick one of the three masks of the Midnight Wheel (×3 to ×200); Double and Triple multiply your spots and the wheel spins again. Chips from $1,000 to $10,000,000. Every spot returns about 97% of what is bet on it, on average.',
              )}
            </p>
          </details>
        </aside>
      </div>
      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} objets={BUTIN_PLUIE} />}
    </div>
  );
}
