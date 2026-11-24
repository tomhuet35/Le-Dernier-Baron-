/**
 * La Chaudière (Le Baron Express) : la pression monte dans la chaudière de la locomotive, et le multiplicateur avec elle
 * (×10, ×100 au bout de 10 s, ×1 000 à pleine pression au bout de 20 s). Chacun tire le sifflet quand il veut pour
 * encaisser le multiplicateur du moment ; si la chaudière explose avant, il perd.
 *
 * L'intro : le Rapide entre en gare au fond du grand hall, freine le long du quai, siffle, puis la caméra plonge dans
 * la cabine de la locomotive, jusqu'à la chaudière.
 *
 * Le serveur cache le point d'explosion (et la durée de la montée, qui le trahirait) : il envoie seulement depuis
 * combien de temps la pression monte. L'écran fait monter le manomètre à ce rythme, de plus en plus vite et de plus en
 * plus fort (vapeur, tremblement), et montre qui a sifflé et à combien. À l'explosion, tout vole en éclats ; à pleine
 * pression, le sifflet de la locomotive salue ceux qui ont tenu.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CHAUDIERE_BW, arrondiChaudiere, multiplicateurChaudiere, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { dollars } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './chaudiere.css';

/** Les images de la Chaudière (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_CHAUDIERE_NOMS = ['bw-ex-gare-depart', 'ai-train-34', 'ch-logo', 'ch-cabine-vitres', 'ch-cabine-noire', 'ch-paysage', 'ch-jet', 'ch-mano-brise', 'ch-sifflet', 'ch-mecanicien', 'ch-explosion', 'bw-mano-cadran', 'bw-mano-aiguille', 'bw-vapeur-face'];

/** Les fuites de vapeur aux joints de la chaudière (position dans le décor, orientation), et la part de la montée où
 *  chacune lâche : la première à ×100, la dernière vers ×700. */
const FUITES: { x: number; y: number; sens: 1 | -1; r: number; seuil: number }[] = [
  { x: 29, y: 49.5, sens: -1, r: 0, seuil: 0.5 },
  { x: 73.8, y: 45.5, sens: 1, r: 0, seuil: 0.62 },
  { x: 32.2, y: 21, sens: -1, r: 22, seuil: 0.75 },
  { x: 68.2, y: 22, sens: 1, r: -22, seuil: 0.85 },
  { x: 37.5, y: 77, sens: -1, r: -18, seuil: 0.93 },
];
/** Les paliers du compteur : un éclat et une cloche à chacun. */
const PALIERS = [50, 100, 200, 500];
/** Largeur d'un motif du paysage, en hauteur de la bande des fenêtres. */
const MOTIF_PAYSAGE = 225 / 420;
/** Le rattrapage du compteur à l'explosion (ms). */
const RATTRAPAGE = 320;

const fmt = (x: number) => `×${x.toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: x < 100 ? 1 : 0, minimumFractionDigits: x < 100 ? 1 : 0 })}`;
/** La part de la montée (0 à 1) : l'échelle du manomètre est logarithmique, de ×10 à ×1 000. */
const part = (m: number) => Math.min(1, Math.max(0, Math.log10(m / CHAUDIERE_BW.depart) / Math.log10(CHAUDIERE_BW.max / CHAUDIERE_BW.depart)));

export function BonusChaudiere({ v, b, nom, onSiffler }: { v: VueBW; b: VueBonusBW; nom: string; onSiffler: () => Promise<boolean> }) {
  const c = b.chaudiere;
  const montee = nom === 'pression' && v.phase === 'bonus';
  const finBrut = nom === 'explosion' || nom === 'revele' || v.phase === 'resultat';
  const explosion = c?.explosion ?? null;
  const explosee = explosion !== null && explosion < CHAUDIERE_BW.max;
  const M = Math.max(1, b.multiplicateur);

  // L'horloge de la montée : recalée sur le serveur à chaque nouvelle vue (on garde l'estimation la plus ancienne).
  const debut = useRef<{ cle: string; t: number }>({ cle: '', t: 0 });
  const cle = `${v.numero}-${b.etape}`;
  if (montee && c?.ecoule !== null && c?.ecoule !== undefined) {
    const estime = performance.now() - c.ecoule;
    if (debut.current.cle !== cle) debut.current = { cle, t: estime };
    else debut.current.t = Math.min(debut.current.t, estime);
  }
  const [m, setM] = useState<number>(CHAUDIERE_BW.depart);
  // À l'explosion, le compteur (en léger retard) rattrape d'un trait la pression exacte, puis la chaudière saute.
  const derniereValeur = useRef({ numero: -1, m: CHAUDIERE_BW.depart });
  if (montee) derniereValeur.current = { numero: v.numero, m };
  const [rattrape, setRattrape] = useState<{ cle: string; de: number; t0: number } | null>(null);
  const [, setTic] = useState(0);
  useEffect(() => {
    if (nom !== 'explosion' || explosion === null || v.phase !== 'bonus' || rattrape?.cle === cle) return;
    // (seulement si on a vu la montée : en arrivant pendant l'explosion, pas de rattrapage)
    if (derniereValeur.current.numero !== v.numero) return;
    const de = Math.min(derniereValeur.current.m, explosion);
    if (de >= explosion || mouvementReduit()) return;
    setRattrape({ cle, de, t0: performance.now() });
    let raf = 0;
    const pas = () => {
      setTic((x) => x + 1);
      raf = requestAnimationFrame(pas);
    };
    raf = requestAnimationFrame(pas);
    const fini = window.setTimeout(() => cancelAnimationFrame(raf), RATTRAPAGE + 50);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fini);
    };
  }, [nom, cle]);
  const uR = rattrape && rattrape.cle === cle ? (performance.now() - rattrape.t0) / RATTRAPAGE : 1;
  const enRattrapage = uR < 1 && explosion !== null;
  const affiche = enRattrapage
    ? rattrape!.de * (Math.min(explosion!, CHAUDIERE_BW.max) / rattrape!.de) ** Math.max(0, uR)
    : finBrut
      ? Math.min(explosion ?? CHAUDIERE_BW.max, CHAUDIERE_BW.max)
      : montee
        ? m
        : CHAUDIERE_BW.depart;
  // Pendant le rattrapage, la chaudière tient encore (l'explosion se joue juste après).
  const fin = finBrut && !enRattrapage;
  const sousPression = montee || enRattrapage;
  const valeur = arrondiChaudiere(affiche);
  const p = part(affiche);
  const arret = fin && explosee;
  useEffect(() => {
    if (!montee) return;
    let raf = 0;
    const pas = () => {
      setM(multiplicateurChaudiere(Math.max(0, performance.now() - debut.current.t - CHAUDIERE_BW.retard)));
      raf = requestAnimationFrame(pas);
    };
    raf = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(raf);
  }, [montee, cle]);

  // Le paysage défile derrière les fenêtres, de plus en plus vite ; il s'arrête net à l'explosion.
  const cadre = useRef<HTMLDivElement>(null);
  const vitesse = useRef(0);
  vitesse.current = sousPression ? p : 0;
  useEffect(() => {
    if (arret || mouvementReduit()) return;
    let raf = 0;
    let x = 0;
    let avant = performance.now();
    const pas = (n: number) => {
      const el = cadre.current;
      if (el) {
        const h = el.offsetHeight * 0.45;
        const q = vitesse.current;
        x = (x + ((n - avant) / 1000) * h * (0.5 + 9 * q * q)) % Math.max(1, h * MOTIF_PAYSAGE);
        el.style.setProperty('--defile', `${x.toFixed(1)}px`);
      }
      avant = n;
      raf = requestAnimationFrame(pas);
    };
    raf = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(raf);
  }, [arret]);

  // Les paliers du compteur (×50, ×100, ×200, ×500) : la cloche sonne.
  const nPalier = PALIERS.filter((s) => valeur >= s).length;
  const palierVu = useRef({ cle: '', n: 0 });
  useEffect(() => {
    if (palierVu.current.cle !== cle) palierVu.current = { cle, n: nPalier };
    else if (montee && nPalier > palierVu.current.n) jouerEffet('bw_cloche', { volume: 0.55 });
    palierVu.current.n = nPalier;
  }, [nPalier, cle, montee]);
  const matiere = valeur >= 200 ? 'rouge' : valeur >= 50 ? 'or' : 'argent';

  // Les fuites de vapeur : un joint lâche de temps en temps quand la pression devient folle.
  const fuites = sousPression || (fin && !explosee) ? FUITES.filter((f) => p >= f.seuil) : [];
  const nFuites = useRef(0);
  useEffect(() => {
    if (montee && fuites.length > nFuites.current) jouerEffet('bw_vapeur', { volume: 0.55 });
    nFuites.current = fuites.length;
  }, [fuites.length, montee]);

  // Les autres qui sifflent : une bouffée de vapeur et leur portrait s'envolent, en direct.
  const siffles = c?.siffles ?? [];
  const [bulles, setBulles] = useState<{ id: number; avatar: number; nom: string; x: number; gx: number; gy: number }[]>([]);
  const vus = useRef({ cle: '', n: 0, id: 0, son: 0 });
  useEffect(() => {
    const vu = vus.current;
    if (vu.cle !== cle) {
      vu.cle = cle;
      vu.n = siffles.length;
      return;
    }
    const nouveaux = siffles.slice(vu.n).filter((s) => !s.moi);
    vu.n = Math.max(vu.n, siffles.length);
    if (!montee || !nouveaux.length) return;
    const ajout = nouveaux.slice(-3).map((s) => {
      const gauche = (vu.id += 1) % 2 === 0;
      return { id: vu.id, avatar: s.avatar, nom: s.nom, x: s.x, gx: (gauche ? 8 : 50) + Math.random() * 10, gy: 24 + Math.random() * 24 };
    });
    setBulles((l) => [...l, ...ajout].slice(-4));
    const n = performance.now();
    if (n - vu.son > 350) {
      vu.son = n;
      jouerEffet('bw_sifflet', { volume: 0.3 });
    }
    const ids = ajout.map((a) => a.id);
    window.setTimeout(() => setBulles((l) => l.filter((b2) => !ids.includes(b2.id))), 1900);
  }, [siffles.length, cle, montee]);

  // Les sons : le sifflement de la pression, de plus en plus aigu ; l'explosion ou le grand sifflet.
  const dernier = useRef(0);
  useEffect(() => {
    if (!montee) return;
    const n = performance.now();
    const p = part(m);
    if (n - dernier.current > 1600 - 1100 * p) {
      dernier.current = n;
      jouerEffet('bw_pression', { volume: 0.35 + 0.5 * p, vitesse: 0.8 + 0.7 * p });
    }
  }, [m, montee]);
  const joue = useRef('');
  useEffect(() => {
    if (!fin || joue.current === cle) return;
    if (nom !== 'explosion') return;
    joue.current = cle;
    if (explosee) {
      jouerEffet('ev_fracas', { volume: 1 });
      jouerEffet('bw_vapeur', { volume: 1 });
    } else jouerEffet('ex_sifflet', { volume: 1 });
  }, [fin, nom, cle, explosee]);

  // Mon sifflet.
  const [envoi, setEnvoi] = useState(false);
  const monSifflet = c?.monSifflet ?? null;
  const peut = montee && b.mise > 0 && monSifflet === null && !envoi;
  const siffler = () => {
    if (!peut) return;
    setEnvoi(true);
    jouerEffet('bw_sifflet', { volume: 1 });
    void onSiffler().finally(() => setEnvoi(false));
  };

  // L'intro : où en est-on (pour caler l'animation et les sons, même si l'on arrive en cours de route) ?
  const [t0] = useState(() => (nom === 'intro' && v.duree !== null && v.reste !== null ? Math.max(0, v.duree - v.reste) : 0));
  useEffect(() => {
    if (nom !== 'intro' || mouvementReduit()) return;
    const sons: [number, () => void][] = [
      [0, () => jouerEffet('bw_train_passe', { volume: 0.8 })],
      [2_600, () => jouerEffet('ex_freins', { volume: 0.9 })],
      [3_300, () => jouerEffet('ex_sifflet', { volume: 0.9 })],
      [3_500, () => jouerEffet('bw_vapeur', { volume: 0.7 })],
    ];
    const ids = sons.filter(([t]) => t >= t0).map(([t, f]) => window.setTimeout(f, t - t0));
    return () => ids.forEach((i) => window.clearTimeout(i));
  }, [nom, t0]);

  // Le bouton sifflet va sous le cadre du jeu (à la place du texte du bonus), s'il y a sa place.
  const [dehors, setDehors] = useState<HTMLElement | null>(null);
  useEffect(() => setDehors(document.getElementById('ch-commande')), [nom]);
  const sous = (n: ReactNode) => (dehors ? createPortal(n, dehors) : n);

  const reduit = mouvementReduit();
  const style = { '--p': p, '--secousse': reduit || !sousPression ? 0 : p, '--t0': `${-t0}ms` } as CSSProperties;
  const aiguille = -124 + 248 * p;
  const danger = p > 0.55;

  return (
    <div className={`ch ${nom} ${explosee && fin ? 'explosee' : ''} ${fin && !explosee ? 'pleine' : ''} ${danger && montee ? 'danger' : ''}`} style={style}>
      {nom === 'intro' && (
        <div className="ch-gare" aria-hidden="true">
          <div className="ch-gare-cadre">
            <img className="ch-gare-fond" src="/cartes/bw-ex-gare-depart.webp" alt="" draggable={false} />
            <span className="ch-gare-train">
              <img src="/cartes/ai-train-34.webp" alt="" draggable={false} />
              <img className="ch-gare-vapeur" src="/cartes/bw-vapeur-face.webp" alt="" draggable={false} />
            </span>
          </div>
          <i className="ch-gare-fondu" />
          <img className="ch-logo" src="/cartes/ch-logo.webp" alt={tr('La Chaudière', 'The Boiler')} draggable={false} />
        </div>
      )}
      {/* La cabine : le manomètre géant dans le hublot de la chaudière ; le cadre garde les proportions du décor. */}
      <div className="ch-cadre" ref={cadre}>
        {/* Le paysage de nuit, derrière les fenêtres (à gauche il file vers l'arrière, à droite aussi, dans l'autre sens). */}
        <i className="ch-defile g" aria-hidden="true" />
        <i className="ch-defile d" aria-hidden="true" />
        <img className="ch-cabine" src="/cartes/ch-cabine-vitres.webp" alt="" draggable={false} />
        {/* Le foyer, qui s'emballe avec la pression (orange, puis blanc). */}
        <img className="ch-foyer" src="/cartes/ch-cabine-vitres.webp" alt="" draggable={false} aria-hidden="true" />
        <i className="ch-foyer-lueur" aria-hidden="true" />
        {arret && <img className="ch-cabine-noire" src="/cartes/ch-cabine-noire.webp" alt="" draggable={false} />}
        {fuites.map((f, k) => (
          <img key={k} className="ch-fuite" src="/cartes/ch-jet.webp" alt="" draggable={false} style={{ '--x': `${f.x}%`, '--y': `${f.y}%`, '--sens': f.sens, '--r': `${f.r}deg` } as CSSProperties} />
        ))}
        {/* Mon coup de sifflet : deux jets de vapeur au sommet de la chaudière. */}
        {monSifflet !== null && !arret && (
          <span className="ch-jets-sifflet" key={`j-${cle}`} aria-hidden="true">
            <img src="/cartes/ch-jet.webp" alt="" draggable={false} style={{ '--x': '39%', '--y': '5%', '--sens': -1, '--r': '18deg' } as CSSProperties} />
            <img src="/cartes/ch-jet.webp" alt="" draggable={false} style={{ '--x': '61%', '--y': '5%', '--sens': 1, '--r': '-18deg' } as CSSProperties} />
          </span>
        )}
        <div className="ch-mano">
          {arret ? (
            <img className="ch-mano-brise" src="/cartes/ch-mano-brise.webp" alt="" draggable={false} />
          ) : (
            <>
              <img className="ch-mano-cadran" src="/cartes/bw-mano-cadran.webp" alt="" draggable={false} />
              <img className="ch-mano-aiguille" src="/cartes/bw-mano-aiguille.webp" alt="" draggable={false} style={{ transform: `rotate(${aiguille}deg)` }} />
            </>
          )}
        </div>
      </div>
      <div className="ch-lueur" aria-hidden="true" />
      <div className="ch-vapeurs" aria-hidden="true">
        {[0, 1, 2, 3].map((k) => (
          <img key={k} src="/cartes/bw-vapeur-face.webp" alt="" draggable={false} style={{ '--k': k } as CSSProperties} />
        ))}
      </div>

      <div className="ch-compteur" role="status" aria-live="off">
        {montee && nPalier > 0 && <i key={`f-${nPalier}`} className="ch-palier-flash" aria-hidden="true" />}
        <strong key={`p-${nPalier}`} className={`${matiere} ${montee && nPalier > 0 ? 'palier' : ''}`}>
          {fmt(valeur)}
        </strong>
        {M > 1 && <small>{tr(`× ${M} (roue)`, `× ${M} (wheel)`)}</small>}
        {monSifflet !== null && <em className="ch-encaisse">{tr(`Encaissé ${fmt(monSifflet)}`, `Cashed ${fmt(monSifflet)}`)}</em>}
      </div>

      {bulles.map((u) => (
        <div key={u.id} className="ch-bulle" style={{ '--x': `${u.gx}%`, '--y': `${u.gy}%` } as CSSProperties} aria-hidden="true">
          <img className="ch-bulle-vapeur" src="/cartes/bw-vapeur-face.webp" alt="" draggable={false} />
          <img className="ch-bulle-avatar" src={`/cartes/avatar-${u.avatar}.webp`} alt="" draggable={false} />
          <b>{fmt(u.x)}</b>
        </div>
      ))}

      {nom === 'intro' && <p className="ch-consigne">{tr('Tire le sifflet avant que la chaudière explose !', 'Pull the whistle before the boiler blows!')}</p>}

      {sous(
        <div className={`ch-commandes ${dehors ? 'dehors' : ''} ${nom}`}>
          {(montee || nom === 'intro') && b.mise > 0 && (
            <button type="button" className={`ch-sifflet ${monSifflet !== null ? 'fait' : ''}`} onClick={siffler} disabled={!peut}>
              <img className="ch-sifflet-img" src="/cartes/ch-sifflet.webp" alt="" draggable={false} />
              {monSifflet !== null ? (
                <>
                  <span>{tr('Sifflé à', 'Whistled at')}</span>
                  <b>{fmt(monSifflet)}</b>
                  <small>+{dollars(Math.floor(b.mise * monSifflet * M))}</small>
                </>
              ) : (
                <>
                  <span>{tr('Tirer le sifflet', 'Pull the whistle')}</span>
                  <b>{fmt(arrondiChaudiere(affiche))}</b>
                  <small>+{dollars(Math.floor(b.mise * arrondiChaudiere(affiche) * M))}</small>
                </>
              )}
            </button>
          )}
          {(montee || nom === 'intro') && b.mise > 0 && monSifflet === null && (
            <p className="ch-auto">{tr(`Sans sifflet : automatique à ${fmt(CHAUDIERE_BW.auto)}`, `No whistle: automatic at ${fmt(CHAUDIERE_BW.auto)}`)}</p>
          )}
          {(montee || nom === 'intro') && !b.mise && <p className="ch-auto">{tr('Tu regardes : tu n’as pas misé sur la Chaudière.', 'Watching: you did not bet on the Boiler.')}</p>}
        </div>,
      )}

      {/* Le mécanicien tire la chaîne du sifflet quand j'ai sifflé. */}
      {monSifflet !== null && !explosee && <img className="ch-mecanicien" src="/cartes/ch-mecanicien.webp" alt="" draggable={false} />}

      {c && c.siffles.length > 0 && (
        <ol className="ch-siffles" aria-label={tr('Ceux qui ont sifflé', 'Who whistled')}>
          {c.siffles.slice(-6).map((s, k) => (
            <li key={`${s.nom}-${k}`} className={s.moi ? 'moi' : ''}>
              <img src={`/cartes/avatar-${s.avatar}.webp`} alt="" draggable={false} />
              <span>{s.nom}</span>
              <b>{fmt(s.x)}</b>
            </li>
          ))}
        </ol>
      )}

      {fin && (
        <div className={`ch-fin ${explosee ? 'boum' : 'pleine'}`} role="status">
          {explosee ? (
            <>
              <img className="ch-nuage" src="/cartes/bw-vapeur-face.webp" alt="" draggable={false} />
              <img className="ch-eclats" src="/cartes/ch-explosion.webp" alt="" draggable={false} />
              <strong>{tr('BOUM !', 'BOOM!')}</strong>
              <span>{tr(`La chaudière a explosé à ${fmt(arrondiChaudiere(explosion ?? 0))}`, `The boiler blew up at ${fmt(arrondiChaudiere(explosion ?? 0))}`)}</span>
            </>
          ) : (
            <>
              <strong>{tr('Pleine pression !', 'Full pressure!')}</strong>
              <span>{tr(`Tous ceux qui ont tenu encaissent ${fmt(CHAUDIERE_BW.max)}`, `Everyone who held on cashes ${fmt(CHAUDIERE_BW.max)}`)}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
