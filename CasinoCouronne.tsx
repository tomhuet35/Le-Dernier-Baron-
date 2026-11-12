/**
 * Le Vol de la Couronne (Salon privé) : la couronne ailée du Baron s'envole au-dessus des toits ; le multiplicateur
 * monte avec elle. On récupère sa mise × le multiplicateur avant que la pie voleuse ne fonde dessus.
 *
 * Le serveur tient les manches (communes à tout le salon) et diffuse la vue (« casino_cv ») ; cet écran met en scène
 * le vol, calé sur l'horloge du serveur. Ce qui bouge à chaque image (le multiplicateur, la couronne, le ciel qui
 * défile, la traînée d'étincelles, la pie, les sommes des boutons) est écrit directement dans la page par une boucle
 * requestAnimationFrame, sans repasser par React.
 *
 * Visuels : couronne-vol.webp, couronne-pie.webp (détourées), couronne-ville.webp, couronne-nuages.webp et
 * couronne-etoiles.webp (le ciel, des toits jusqu'aux étoiles).
 */
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { MULTIPLE_GROS_GAIN, type VueCasino } from '../../shared/casino';
import {
  AUTO_MIN,
  gainCouronne,
  MISES_COURONNE,
  MISES_PAR_MANCHE,
  multiplicateurCouronne,
  PALIERS_AUTO,
  X_MAX_COURONNE,
  type MiseCouronne,
  type VueCouronne,
} from '../../shared/couronne';
import type { Appel } from './App';
import { BUTIN_PLUIE, dollars, Jeton, LINGOTS_PALIER, PluieLingots, useSoldeAnime } from './casinoOutils';
import { socket } from './socket';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit, useCompteur } from './ui';
import './couronne.css';

const x2 = (x: number) => `×${x.toLocaleString(tr('fr-FR', 'en-US'), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CLE_REGLAGES = 'ldb-couronne';

interface Reglage {
  mise: number;
  /** Récupération automatique, et à quel multiplicateur. */
  autoActif: boolean;
  auto: number;
  /** Rejouer cette mise à chaque envol. */
  rejouer: boolean;
}
const REGLAGES_DEFAUT: Reglage[] = [
  { mise: 10_000, autoActif: false, auto: 2, rejouer: false },
  { mise: 10_000, autoActif: true, auto: 1.5, rejouer: false },
];
function lireReglages(): Reglage[] {
  try {
    const r = JSON.parse(localStorage.getItem(CLE_REGLAGES) ?? '[]') as Partial<Reglage>[];
    return REGLAGES_DEFAUT.map((d, i) => {
      const x = r[i] ?? {};
      return {
        mise: MISES_COURONNE.includes(x.mise ?? 0) ? x.mise! : d.mise,
        autoActif: typeof x.autoActif === 'boolean' ? x.autoActif : d.autoActif,
        auto: typeof x.auto === 'number' && x.auto >= AUTO_MIN && x.auto <= X_MAX_COURONNE ? x.auto : d.auto,
        rejouer: false, // on ne rejoue jamais tout seul en arrivant
      };
    });
  } catch {
    return REGLAGES_DEFAUT.map((d) => ({ ...d }));
  }
}

/** Couleur d'un envol de l'historique, selon sa hauteur. */
const classeEnvol = (x: number) => (x < 2 ? 'bas' : x < 10 ? 'moyen' : x < 100 ? 'haut' : 'enorme');

// ---------------------------------------------------------------------------------------------------------------
// La mise en scène du vol (une boucle requestAnimationFrame)

/** Géométrie du vol, en fraction de la scène : départ sur les toits, puis la couronne plane en haut à droite. */
const DEPART = { x: 0.17, y: 0.8 };
const CROISIERE = { x: 0.64, y: 0.37 };
const MONTEE_MS = 5000;
/** Altitude du ciel (en hauteurs de scène) : 0 = les toits, 1,35 = les nuages, 2,35 = les étoiles. */
const ALT_NUAGES = 1.35;
const ALT_ETOILES = 2.35;
/** À ×100, on est dans les étoiles. */
const X_ETOILES = 100;
/** La pie : où sont ses serres dans son image (fraction), et la durée de son piqué puis de sa fuite. */
const SERRES = { x: 0.7, y: 0.86 };
const PIQUE_MS = 600;
const FUITE_MS = 1500;

const easeOut = (q: number) => 1 - (1 - q) ** 3;
const easeInOut = (q: number) => (q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2);
const easeIn = (q: number) => q * q;
const altitudeDe = (x: number) => ALT_ETOILES * Math.min(1, Math.log(Math.max(1, x)) / Math.log(X_ETOILES));

interface Etincelle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vie: number;
  duree: number;
  taille: number;
  blanc: boolean;
}

/** Ce que la boucle lit à chaque image (mis à jour à chaque vue reçue). */
interface Horloges {
  v: VueCouronne | null;
  /** Heure locale de l'envol et du passage de la pie (calées sur le serveur), et de la fin de l'étape. */
  envol: number | null;
  frappe: number | null;
  fin: number | null;
  manche: number;
}

function useSceneVol(h: MutableRefObject<Horloges>, refs: {
  scene: RefObject<HTMLDivElement>;
  decors: RefObject<HTMLDivElement>[];
  couronne: RefObject<HTMLImageElement>;
  pie: RefObject<HTMLImageElement>;
  trace: RefObject<HTMLCanvasElement>;
  x: RefObject<HTMLElement>;
  compte: RefObject<HTMLElement>;
  barre: RefObject<HTMLElement>;
  montants: RefObject<HTMLElement>[];
}) {
  useEffect(() => {
    const reduit = mouvementReduit();
    let id = 0;
    let L = 0;
    let H = 0;
    let dpr = 1;
    const ctx = refs.trace.current?.getContext('2d') ?? null;
    const mesurer = () => {
      const s = refs.scene.current;
      const c = refs.trace.current;
      if (!s || !c) return;
      L = s.clientWidth;
      H = s.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(L * dpr);
      c.height = Math.round(H * dpr);
    };
    mesurer();
    const obs = new ResizeObserver(mesurer);
    if (refs.scene.current) obs.observe(refs.scene.current);

    let altitude = 0;
    let dernier = performance.now();
    let dernierTic = -1;
    let etincelles: Etincelle[] = [];
    let gerbe = -1;
    /** Dernière position de la couronne (centre, en px) : la pie vient la chercher là. */
    let pos = { x: DEPART.x, y: DEPART.y };
    let texte = '';

    const ecrire = (el: HTMLElement | null, t: string) => {
      if (el && el.textContent !== t) el.textContent = t;
    };

    const image = () => {
      id = requestAnimationFrame(image);
      const maintenant = performance.now();
      const dt = Math.min(0.05, (maintenant - dernier) / 1000);
      dernier = maintenant;
      const t = Date.now();
      const { v, envol, frappe, fin } = h.current;
      const cou = refs.couronne.current;
      const pie = refs.pie.current;
      if (!v || !cou || !pie || !L) return;
      const wc = cou.offsetWidth;
      const hc = cou.offsetHeight;
      let cx = DEPART.x * L;
      let cy = DEPART.y * H;
      let rot = 0;
      let opacite = 1;
      let pieVisible = false;
      let px = 0;
      let py = 0;
      let pieRot = 0;
      let trace = 0;
      let x = 1;

      if (v.phase === 'mises') {
        // Le ciel redescend sur les toits ; la couronne attend, posée, en se balançant doucement.
        altitude += (0 - altitude) * Math.min(1, dt * 2.6);
        const b = t / 1000;
        cy += Math.sin(b * 2.2) * H * 0.008;
        rot = Math.sin(b * 1.6) * 2;
        const reste = Math.max(0, (fin ?? t) - t);
        ecrire(refs.compte.current, String(Math.ceil(reste / 1000)));
        if (refs.barre.current) refs.barre.current.style.transform = `scaleX(${v.duree ? Math.min(1, reste / v.duree) : 0})`;
        const s = Math.ceil(reste / 1000);
        if (s !== dernierTic && s <= 3 && s >= 1) jouerEffet('tic');
        dernierTic = s;
        pos = { x: cx, y: cy };
        texte = '';
      } else if (v.phase === 'vol' && envol !== null) {
        const e = t - envol;
        x = multiplicateurCouronne(e, v.k);
        const q = Math.min(1, e / MONTEE_MS);
        cx = (DEPART.x + (CROISIERE.x - DEPART.x) * easeInOut(q)) * L;
        cy = (DEPART.y + (CROISIERE.y - DEPART.y) * easeOut(q)) * H;
        const b = e / 1000;
        cx += Math.sin(b * 1.1) * L * 0.018 * q;
        cy += Math.sin(b * 1.7) * H * 0.028 * q;
        rot = -9 * (1 - q) + Math.sin(b * 1.4) * 3 * q;
        altitude = altitudeDe(x);
        pos = { x: cx, y: cy };
        trace = 1;
        texte = x2(x);
        // Étincelles laissées derrière la couronne.
        if (!reduit)
          for (let k = 0; k < 2; k++)
            etincelles.push({
              x: cx - wc * (0.18 + Math.random() * 0.2),
              y: cy + hc * (0.05 + Math.random() * 0.3),
              vx: -40 - Math.random() * 110,
              vy: 30 + Math.random() * 70,
              vie: 0,
              duree: 0.6 + Math.random() * 0.6,
              taille: 1.2 + Math.random() * 2.4,
              blanc: Math.random() < 0.3,
            });
        // Les sommes des boutons « Récupérer ».
        v.mesMises.forEach((m, i) => {
          if (m?.etat === 'enVol') ecrire(refs.montants[i].current, dollars(gainCouronne(m.mise, x)));
        });
      } else if (v.phase === 'volee' && frappe !== null) {
        x = v.x ?? 1;
        texte = x2(x);
        altitude = altitudeDe(x);
        const s = t - frappe;
        cx = pos.x;
        cy = pos.y;
        trace = Math.max(0, 1 - s / 500);
        if (x >= X_MAX_COURONNE) {
          // Les étoiles : la couronne s'échappe vers le haut.
          cy = pos.y - easeIn(Math.min(1, s / 1200)) * H * 1.2;
          rot = -6;
        } else if (reduit) {
          opacite = s < 300 ? 1 - s / 300 : 0;
        } else {
          // La pie fond sur la couronne, l'agrippe et l'emporte.
          const wp = pie.offsetWidth;
          const hp = pie.offsetHeight;
          const gx = pos.x - wp * SERRES.x;
          const gy = pos.y - hc * 0.2 - hp * SERRES.y;
          pieVisible = s < PIQUE_MS + FUITE_MS;
          if (s < PIQUE_MS) {
            const q = easeIn(s / PIQUE_MS);
            px = gx - L * 0.55 * (1 - q);
            py = gy - H * 0.6 * (1 - q);
            pieRot = 18 * (1 - q);
            cx += Math.sin(s / 25) * wc * 0.015 * q; // la couronne tremble
          } else {
            if (gerbe !== h.current.manche) {
              gerbe = h.current.manche;
              if (!reduit)
                for (let k = 0; k < 36; k++) {
                  const a = Math.random() * Math.PI * 2;
                  const vit = 60 + Math.random() * 220;
                  etincelles.push({ x: pos.x, y: pos.y - hc * 0.2, vx: Math.cos(a) * vit, vy: Math.sin(a) * vit, vie: 0, duree: 0.5 + Math.random() * 0.6, taille: 1.5 + Math.random() * 2.5, blanc: Math.random() < 0.4 });
                }
            }
            // Elle repart vers la droite en reprenant de la hauteur, la couronne dans les serres.
            const q = easeIn(Math.min(1, (s - PIQUE_MS) / FUITE_MS));
            const dx = L * 0.85 * q;
            const dy = -H * 0.5 * q;
            px = gx + dx;
            py = gy + dy;
            pieRot = -10 * q;
            cx = pos.x + dx;
            cy = pos.y + dy;
            rot = -12 * q;
          }
        }
      }

      // Le ciel : chaque décor glisse vers le bas à mesure que la couronne monte.
      const alts = [0, ALT_NUAGES, ALT_ETOILES];
      refs.decors.forEach((d, i) => {
        if (d.current) d.current.style.transform = `translate3d(0, ${((altitude - alts[i]) * H).toFixed(1)}px, 0)`;
      });

      cou.style.transform = `translate3d(${(cx - wc / 2).toFixed(1)}px, ${(cy - hc / 2).toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg)`;
      cou.style.opacity = String(opacite);
      pie.style.opacity = pieVisible ? '1' : '0';
      if (pieVisible) pie.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) rotate(${pieRot.toFixed(2)}deg)`;
      ecrire(refs.x.current, texte);

      // La traînée : la courbe dorée depuis le bas de la scène jusqu'à la couronne, et les étincelles.
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, L, H);
      if (trace > 0 && v.phase !== 'mises') {
        const ox = L * 0.02;
        const oy = H * 0.98;
        const ex = cx - wc * 0.22;
        const ey = cy + hc * 0.22;
        const kx = ex * 0.62 + ox * 0.38;
        // Un large halo doré, puis le trait.
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.quadraticCurveTo(kx, oy, ex, ey);
        ctx.lineCap = 'round';
        ctx.globalAlpha = trace * 0.22;
        ctx.lineWidth = Math.max(10, L * 0.018);
        ctx.strokeStyle = '#ffb84d';
        ctx.stroke();
        ctx.globalAlpha = trace;
        ctx.lineWidth = Math.max(2.5, L * 0.004);
        ctx.strokeStyle = '#ffd77a';
        ctx.shadowColor = 'rgba(255, 190, 80, 0.9)';
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
      if (etincelles.length) {
        ctx.globalCompositeOperation = 'lighter';
        // Pendant le vol, le ciel défile : les étincelles descendent avec lui.
        const chute = v.phase === 'vol' ? H * 0.05 : 0;
        etincelles = etincelles.filter((p) => {
          p.vie += dt;
          if (p.vie >= p.duree) return false;
          p.x += p.vx * dt;
          p.y += (p.vy + chute) * dt;
          const a = 1 - p.vie / p.duree;
          ctx.globalAlpha = a;
          ctx.fillStyle = p.blanc ? '#fff6dc' : '#ffc95c';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.taille * (0.6 + a * 0.4), 0, Math.PI * 2);
          ctx.fill();
          return true;
        });
        if (etincelles.length > 400) etincelles = etincelles.slice(-400);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    };
    id = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(id);
      obs.disconnect();
    };
    // Les refs ne changent pas : la boucle tourne tant que l'écran est ouvert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ---------------------------------------------------------------------------------------------------------------
// Une mise (il y en a deux)

function PanneauMise({
  i,
  v,
  reglage,
  attente,
  occupe,
  montantRef,
  onReglage,
  onMiser,
  onAnnuler,
  onRecuperer,
}: {
  i: number;
  v: VueCouronne;
  reglage: Reglage;
  attente: boolean;
  occupe: boolean;
  montantRef: RefObject<HTMLElement>;
  onReglage: (r: Partial<Reglage>) => void;
  onMiser: () => void;
  onAnnuler: () => void;
  onRecuperer: () => void;
}) {
  const m: MiseCouronne | null = v.mesMises[i] ?? null;
  const bloque = (!!m && v.phase !== 'volee') || attente;
  const indexMise = MISES_COURONNE.indexOf(reglage.mise);
  const autoPrecedent = [...PALIERS_AUTO].reverse().find((p) => p < reglage.auto - 1e-9);
  const autoSuivant = PALIERS_AUTO.find((p) => p > reglage.auto + 1e-9);

  let bouton: ReactNode;
  if (m && m.etat === 'enVol' && v.phase === 'vol')
    bouton = (
      <button type="button" className="cv-bouton recuperer" onClick={onRecuperer} disabled={occupe}>
        <span>{tr('Récupérer', 'Cash out')}</span>
        <strong ref={montantRef}>{dollars(m.mise)}</strong>
        {m.auto !== null && <small>{tr(`auto à ${x2(m.auto)}`, `auto at ${x2(m.auto)}`)}</small>}
      </button>
    );
  else if (m && v.phase === 'mises')
    bouton = (
      <button type="button" className="cv-bouton annuler" onClick={onAnnuler} disabled={occupe}>
        <span>{tr('Annuler', 'Cancel')}</span>
        <small>
          {tr('Mise placée', 'Bet placed')} : {dollars(m.mise)}
          {m.auto !== null ? ` · auto ${x2(m.auto)}` : ''}
        </small>
      </button>
    );
  else if (m && m.etat === 'recuperee')
    bouton = (
      <div className="cv-bouton gagne" role="status">
        <span>{tr(`Récupérée à ${x2(m.x ?? 1)}`, `Cashed out at ${x2(m.x ?? 1)}`)}</span>
        <strong>+{dollars(m.gain)}</strong>
      </div>
    );
  else if (m && m.etat === 'volee' && v.phase !== 'mises')
    bouton = (
      <div className="cv-bouton vole" role="status">
        <span>{tr('Volée par la pie', 'Stolen by the magpie')}</span>
        <strong>−{dollars(m.mise)}</strong>
      </div>
    );
  else if (attente)
    bouton = (
      <button type="button" className="cv-bouton annuler" onClick={onAnnuler}>
        <span>{tr('Annuler', 'Cancel')}</span>
        <small>{tr('Mise pour le prochain envol', 'Bet for the next flight')}</small>
      </button>
    );
  else
    bouton = (
      <button type="button" className="cv-bouton miser" onClick={onMiser} disabled={occupe}>
        <span>{v.phase === 'mises' ? tr('Miser', 'Bet') : tr('Miser au prochain envol', 'Bet on the next flight')}</span>
        <strong>{dollars(reglage.mise)}</strong>
      </button>
    );

  return (
    <section className={`cv-mise ${m?.etat ?? ''}`} aria-label={tr(`Mise ${i + 1}`, `Bet ${i + 1}`)}>
      <div className="cas-mise cv-montant">
        <button type="button" onClick={() => onReglage({ mise: MISES_COURONNE[indexMise - 1] })} disabled={bloque || indexMise <= 0} aria-label={tr('Baisser la mise', 'Lower the bet')}>
          −
        </button>
        <span className="cas-mise-valeur">
          <Jeton valeur={reglage.mise} />
          <span>
            <small>{tr(`Mise ${i + 1}`, `Bet ${i + 1}`)}</small>
            <strong>{dollars(reglage.mise)}</strong>
          </span>
        </span>
        <button type="button" onClick={() => onReglage({ mise: MISES_COURONNE[indexMise + 1] })} disabled={bloque || indexMise >= MISES_COURONNE.length - 1} aria-label={tr('Augmenter la mise', 'Raise the bet')}>
          +
        </button>
      </div>
      <div className="cv-options">
        <label className="cv-interrupteur">
          <input type="checkbox" checked={reglage.autoActif} disabled={bloque} onChange={(e) => onReglage({ autoActif: e.target.checked })} />
          <span>{tr('Auto', 'Auto')}</span>
        </label>
        <span className={`cv-auto ${reglage.autoActif ? '' : 'eteint'}`}>
          <button type="button" onClick={() => autoPrecedent && onReglage({ auto: autoPrecedent })} disabled={bloque || !reglage.autoActif || !autoPrecedent} aria-label={tr('Plus tôt', 'Earlier')}>
            −
          </button>
          <strong>{x2(reglage.auto)}</strong>
          <button type="button" onClick={() => autoSuivant && onReglage({ auto: autoSuivant })} disabled={bloque || !reglage.autoActif || !autoSuivant} aria-label={tr('Plus tard', 'Later')}>
            +
          </button>
        </span>
        <label className="cv-interrupteur">
          <input type="checkbox" checked={reglage.rejouer} onChange={(e) => onReglage({ rejouer: e.target.checked })} />
          <span>{tr('Rejouer', 'Repeat')}</span>
        </label>
      </div>
      {bouton}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La somme récupérée, en grand

function AnnonceCouronne({ montant, x, gros }: { montant: number; x: number; gros: boolean }) {
  const valeur = useCompteur(montant, Math.round(montant / 20), 0, gros ? 1600 : 900);
  return (
    <div className={`cv-gain ${gros ? 'gros' : ''}`} aria-live="polite">
      <span>{gros ? tr('Quel envol !', 'What a flight!') : tr('Récupéré !', 'Cashed out!')}</span>
      <em>{x2(x)}</em>
      <strong>+{dollars(valeur)}</strong>
      <small>{tr('ajoutés à ton solde', 'added to your balance')}</small>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran

export function JeuCouronne({ vue, appel, onVue, onRetour }: { vue: VueCasino; appel: Appel; onVue: (v: VueCasino) => void; onRetour: () => void }) {
  const [v, setV] = useState<VueCouronne | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reglages, setReglages] = useState<Reglage[]>(lireReglages);
  /** Mises demandées pendant un vol : posées dès les mises suivantes. */
  const [attentes, setAttentes] = useState<boolean[]>([false, false]);
  const [occupe, setOccupe] = useState<boolean[]>([false, false]);
  const [annonce, setAnnonce] = useState<{ montant: number; x: number; gros: boolean; id: number } | null>(null);
  const [pluie, setPluie] = useState<{ n: number; id: number } | null>(null);
  const [credit, setCredit] = useState<{ montant: number; id: number } | null>(null);
  const minuteries = useRef<number[]>([]);
  const plusTard = (f: () => void, ms: number) => minuteries.current.push(window.setTimeout(f, ms));
  useEffect(() => () => minuteries.current.forEach((m) => window.clearTimeout(m)), []);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const solde = useSoldeAnime(v?.solde ?? vue.solde);

  const horloges = useRef<Horloges>({ v: null, envol: null, frappe: null, fin: null, manche: -1 });
  const refs = {
    scene: useRef<HTMLDivElement>(null),
    decors: [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)],
    couronne: useRef<HTMLImageElement>(null),
    pie: useRef<HTMLImageElement>(null),
    trace: useRef<HTMLCanvasElement>(null),
    x: useRef<HTMLElement>(null),
    compte: useRef<HTMLElement>(null),
    barre: useRef<HTMLElement>(null),
    montants: [useRef<HTMLElement>(null), useRef<HTMLElement>(null)],
  };
  useSceneVol(horloges, refs);

  // On arrive du salon : l'écran s'ouvre en haut.
  useEffect(() => window.scrollTo(0, 0), []);

  useEffect(() => {
    try {
      localStorage.setItem(CLE_REGLAGES, JSON.stringify(reglages));
    } catch {
      /* préférence non gardée */
    }
  }, [reglages]);

  useEffect(() => {
    let vivant = true;
    // Après une coupure, le salon peut mettre quelques secondes à se rouvrir : on réessaie avant d'afficher l'erreur.
    const entrer = async (essai = 0): Promise<void> => {
      const r = (await appel('casino_cv_entrer')) as { ok: boolean; erreur?: string; couronne?: VueCouronne };
      if (!vivant) return;
      if (r.ok && r.couronne) {
        setErreur(null);
        return setV(r.couronne);
      }
      if (essai < 5) return void window.setTimeout(() => void entrer(essai + 1), 1200);
      setErreur(r.erreur ?? tr('La couronne est indisponible pour le moment.', 'The crown is unavailable right now.'));
    };
    void entrer();
    const surVue = (x: VueCouronne) => setV(x);
    // Après une coupure, le salon se rouvre d'abord (Casino.tsx), puis on revient à la couronne.
    const surConnexion = () => window.setTimeout(() => void entrer(), 2600);
    socket.on('casino_cv', surVue);
    socket.on('connect', surConnexion);
    return () => {
      vivant = false;
      socket.off('casino_cv', surVue);
      socket.off('connect', surConnexion);
      socket.emit('casino_cv_quitter');
    };
  }, [appel]);

  // Chaque vue recale les horloges de la scène sur celle du serveur (on garde l'estimation la plus tôt : la moins
  // retardée par le réseau).
  const precedente = useRef<VueCouronne | null>(null);
  useEffect(() => {
    if (!v) return;
    const h = horloges.current;
    const t = Date.now();
    const nouvelle = v.manche !== h.manche;
    if (nouvelle) Object.assign(h, { envol: null, frappe: null, manche: v.manche });
    if (v.phase === 'vol' && v.ecoule !== null) h.envol = h.envol === null ? t - v.ecoule : Math.min(h.envol, t - v.ecoule);
    if (v.phase === 'volee' && v.ecoule !== null) h.frappe = h.frappe === null ? t - v.ecoule : Math.min(h.frappe, t - v.ecoule);
    h.fin = v.reste === null ? null : t + v.reste;
    h.v = v;

    // Le solde du salon suit.
    if (v.solde !== vueRef.current.solde) onVue({ ...vueRef.current, solde: v.solde });

    const p = precedente.current;
    precedente.current = v;
    if (!p) return;
    if (v.phase === 'vol' && p.phase !== 'vol') jouerEffet('lancement');
    if (v.phase === 'volee' && p.phase !== 'volee') {
      if ((v.x ?? 0) < X_MAX_COURONNE) jouerEffet('pickpocket');
      if (v.mesMises.some((m, i) => m?.etat === 'volee' && p.mesMises[i]?.etat === 'enVol')) plusTard(() => jouerEffet('echec'), 650);
    }
    if (v.phase === 'mises' && p.phase !== 'mises') setErreur(null);
    // Mes récupérations : la somme en grand, et du butin qui tombe pour les beaux envols.
    v.mesMises.forEach((m, i) => {
      const avant = p.mesMises[i];
      if (m?.etat !== 'recuperee' || avant?.etat === 'recuperee' || p.manche !== v.manche) return;
      const x = m.x ?? 1;
      const gros = m.gain >= MULTIPLE_GROS_GAIN * m.mise || m.gain >= 1_000_000;
      jouerEffet(gros ? 'roulette_gros_lot' : 'roulette_gain');
      plusTard(() => jouerEffet('machine_pieces'), 200);
      setAnnonce({ montant: m.gain, x, gros, id: Date.now() + i });
      plusTard(() => setAnnonce(null), gros ? 3600 : 2200);
      setCredit({ montant: m.gain, id: Date.now() + i });
      plusTard(() => setCredit(null), 2600);
      if (x >= 3 && !mouvementReduit()) {
        setPluie({ n: gros ? LINGOTS_PALIER.enorme : x >= 10 ? LINGOTS_PALIER.gros : 16, id: Date.now() + i });
        if (gros) plusTard(() => jouerEffet('lingots_pluie'), 250);
        plusTard(() => setPluie(null), 4400);
      }
    });
    // onVue et plusTard ne changent rien à l'enchaînement : seule la vue compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const miser = async (i: number) => {
    const r0 = reglages[i];
    setOccupe((o) => o.map((x, k) => (k === i ? true : x)));
    const r = (await appel('casino_cv_miser', { emplacement: i, mise: r0.mise, auto: r0.autoActif ? r0.auto : null })) as { ok: boolean; erreur?: string; couronne?: VueCouronne };
    setOccupe((o) => o.map((x, k) => (k === i ? false : x)));
    if (!r.ok) {
      setErreur(r.erreur ?? tr('Mise impossible.', 'Invalid bet.'));
      // Plus d'argent : on arrête de rejouer.
      setReglages((rs) => rs.map((x, k) => (k === i ? { ...x, rejouer: false } : x)));
      return false;
    }
    jouerEffet('jeton');
    if (r.couronne) setV(r.couronne);
    return true;
  };

  // Les mises demandées pendant le vol, et celles à rejouer, partent dès que les mises s'ouvrent.
  const mancheJouee = useRef<number[]>([-1, -1]);
  useEffect(() => {
    if (!v || v.phase !== 'mises' || (v.reste ?? 0) < 600) return;
    for (let i = 0; i < MISES_PAR_MANCHE; i++) {
      if (mancheJouee.current[i] === v.manche || v.mesMises[i]) continue;
      if (!attentes[i] && !reglages[i].rejouer) continue;
      mancheJouee.current[i] = v.manche;
      setAttentes((a) => a.map((x, k) => (k === i ? false : x)));
      void miser(i);
    }
    // miser lit les réglages du moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, attentes, reglages]);

  const surMiser = (i: number) => {
    if (!v) return;
    setErreur(null);
    if (v.phase === 'mises' && (v.reste ?? 0) > 250) void miser(i);
    else {
      setAttentes((a) => a.map((x, k) => (k === i ? true : x)));
      jouerEffet('selection');
    }
  };
  const surAnnuler = async (i: number) => {
    if (attentes[i]) {
      setAttentes((a) => a.map((x, k) => (k === i ? false : x)));
      setReglages((rs) => rs.map((x, k) => (k === i ? { ...x, rejouer: false } : x)));
      return;
    }
    setOccupe((o) => o.map((x, k) => (k === i ? true : x)));
    const r = (await appel('casino_cv_annuler', { emplacement: i })) as { ok: boolean; erreur?: string; couronne?: VueCouronne };
    setOccupe((o) => o.map((x, k) => (k === i ? false : x)));
    if (!r.ok) return setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    // Annuler arrête aussi de rejouer cette mise.
    setReglages((rs) => rs.map((x, k) => (k === i ? { ...x, rejouer: false } : x)));
    if (r.couronne) setV(r.couronne);
  };
  const surRecuperer = async (i: number) => {
    const r = (await appel('casino_cv_recuperer', { emplacement: i })) as { ok: boolean; erreur?: string; couronne?: VueCouronne };
    if (!r.ok) return setErreur(r.erreur ?? tr('Action impossible.', 'Action not allowed.'));
    if (r.couronne) setV(r.couronne);
  };

  const phase = v?.phase ?? 'mises';
  const pointX = v?.phase === 'volee' ? (v.x ?? 1) : null;
  const etoiles = pointX !== null && pointX >= X_MAX_COURONNE;

  return (
    <div className={`cas-ecran cv-ecran`} data-phase={phase}>
      <header className="cas-barre">
        <button type="button" className="cas-retour" onClick={onRetour}>
          ‹ {tr('Salon', 'Lounge')}
        </button>
        <h1 className="cv-titre">
          <span>{tr('Le Vol', 'The Flight')}</span> <span>{tr('de la Couronne', 'of the Crown')}</span>
        </h1>
        <span className={`cas-solde-petit cv-solde ${credit ? 'credite' : ''}`}>
          {dollars(solde)}
          {credit && (
            <b key={credit.id} className="cv-credit">
              +{dollars(credit.montant)}
            </b>
          )}
        </span>
      </header>

      <ol className="cv-historique" aria-label={tr('Les derniers envols', 'Latest flights')}>
        {(v?.historique ?? []).map((x, k) => (
          <li key={`${v?.manche}-${k}`} className={classeEnvol(x)}>
            {x2(x)}
          </li>
        ))}
      </ol>

      <div className={`cv-scene ${phase} ${etoiles ? 'etoiles' : ''}`} ref={refs.scene}>
        <div className="cv-decor etoiles" ref={refs.decors[2]} />
        <div className="cv-decor nuages" ref={refs.decors[1]} />
        <div className="cv-decor ville" ref={refs.decors[0]} />
        <canvas className="cv-trace" ref={refs.trace} aria-hidden="true" />
        <img className="cv-couronne" ref={refs.couronne} src="/cartes/couronne-vol.webp" alt="" draggable={false} />
        <img className="cv-pie" ref={refs.pie} src="/cartes/couronne-pie.webp" alt="" draggable={false} />
        <span className="cv-direct">
          {tr('En direct', 'Live')}
          {v ? ` · ${v.spectateurs}` : ''}
        </span>
        <div className="cv-centre" aria-live="off">
          <div className="cv-attente">
            <small>{tr('Prochain envol', 'Next flight')}</small>
            <strong ref={refs.compte}>7</strong>
            <span className="cv-barre">
              <i ref={refs.barre} />
            </span>
          </div>
          <strong className="cv-x" ref={refs.x} />
          <span className="cv-legende">
            {etoiles ? tr('La couronne a atteint les étoiles !', 'The crown reached the stars!') : tr('La pie a volé la couronne !', 'The magpie stole the crown!')}
          </span>
        </div>
        {annonce && <AnnonceCouronne key={`annonce-${annonce.id}`} montant={annonce.montant} x={annonce.x} gros={annonce.gros} />}
      </div>

      <div className="cv-mises">
        {v &&
          reglages.map((r, i) => (
            <PanneauMise
              key={i}
              i={i}
              v={v}
              reglage={r}
              attente={attentes[i]}
              occupe={occupe[i]}
              montantRef={refs.montants[i]}
              onReglage={(x) => {
                jouerEffet('selection');
                setReglages((rs) => rs.map((y, k) => (k === i ? { ...y, ...x } : y)));
              }}
              onMiser={() => surMiser(i)}
              onAnnuler={() => void surAnnuler(i)}
              onRecuperer={() => void surRecuperer(i)}
            />
          ))}
      </div>
      {erreur && <p className="cas-erreur cv-erreur">{erreur}</p>}

      <aside className="cv-joueurs" aria-label={tr('Cette manche', 'This round')}>
        <h2>
          {tr('Cette manche', 'This round')}
          {v ? <small> · {tr(`envol n° ${v.manche}`, `flight #${v.manche}`)}</small> : null}
        </h2>
        {v?.joueurs.length ? (
          <ol>
            {v.joueurs.map((j, k) => (
              <li key={k} className={`${j.moi ? 'moi' : ''} ${j.x !== null ? 'gagne' : j.vole && phase === 'volee' ? 'vole' : ''}`}>
                <img src={`/cartes/avatar-${j.avatar}.webp`} alt="" />
                <span className="cv-nom">{j.nom}</span>
                <span className="cv-mise-joueur">{dollars(j.mise)}</span>
                <strong>
                  {j.x !== null ? (
                    <>
                      <span>{x2(j.x)}</span>
                      <span>+{dollars(j.gain)}</span>
                    </>
                  ) : j.vole && phase === 'volee' ? (
                    tr('volée', 'stolen')
                  ) : phase === 'vol' ? (
                    tr('en vol', 'flying')
                  ) : (
                    '—'
                  )}
                </strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="discret">{tr('Personne n’a encore misé sur cet envol.', 'Nobody has bet on this flight yet.')}</p>
        )}
        <p className="cas-mention">
          {tr(
            'La couronne s’envole, le multiplicateur monte : récupère ta mise avant que la pie ne la vole. Deux mises par envol, de 1 000 à 500 000 $, jusqu’à ×10 000. Le jeu rend 97 % des mises en moyenne.',
            'The crown takes off and the multiplier climbs: cash out before the magpie steals it. Two bets per flight, $1,000 to $500,000, up to ×10,000. The game returns 97% of bets on average.',
          )}
        </p>
      </aside>

      {pluie && <PluieLingots key={`pluie-${pluie.id}`} n={pluie.n} objets={BUTIN_PLUIE} />}
    </div>
  );
}
