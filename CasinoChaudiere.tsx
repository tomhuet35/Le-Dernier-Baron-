/**
 * La Chaudière (Le Baron Express) : la pression monte dans la chaudière de la locomotive, et le multiplicateur avec elle
 * (×10, ×100 au bout de 10 s, ×1 000 à pleine pression au bout de 20 s). Chacun tire le sifflet quand il veut pour
 * encaisser le multiplicateur du moment ; si la chaudière explose avant, il perd.
 *
 * Le serveur cache le point d'explosion (et la durée de la montée, qui le trahirait) : il envoie seulement depuis
 * combien de temps la pression monte. L'écran fait monter le manomètre à ce rythme, de plus en plus vite et de plus en
 * plus fort (vapeur, tremblement), et montre qui a sifflé et à combien. À l'explosion, tout vole en éclats ; à pleine
 * pression, le sifflet de la locomotive salue ceux qui ont tenu.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CHAUDIERE_BW, arrondiChaudiere, multiplicateurChaudiere, type VueBonusBW, type VueBW } from '../../shared/baronWheel';
import { dollars } from './casinoOutils';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './chaudiere.css';

/** Les images de la Chaudière (sans chemin ni extension), préchargées avant le bonus. */
export const IMAGES_CHAUDIERE_NOMS = ['bw-mano-cadran', 'bw-mano-aiguille', 'bw-vapeur-face', 'bw-ev-etincelles'];

const fmt = (x: number) => `×${x.toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: x < 100 ? 1 : 0, minimumFractionDigits: x < 100 ? 1 : 0 })}`;
/** La part de la montée (0 à 1) : l'échelle du manomètre est logarithmique, de ×10 à ×1 000. */
const part = (m: number) => Math.min(1, Math.max(0, Math.log10(m / CHAUDIERE_BW.depart) / Math.log10(CHAUDIERE_BW.max / CHAUDIERE_BW.depart)));

export function BonusChaudiere({ v, b, nom, onSiffler }: { v: VueBW; b: VueBonusBW; nom: string; onSiffler: () => Promise<boolean> }) {
  const c = b.chaudiere;
  const montee = nom === 'pression' && v.phase === 'bonus';
  const fin = nom === 'explosion' || nom === 'revele' || v.phase === 'resultat';
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
  const affiche = fin ? Math.min(explosion ?? CHAUDIERE_BW.max, CHAUDIERE_BW.max) : montee ? m : CHAUDIERE_BW.depart;
  useEffect(() => {
    if (!montee) return;
    let raf = 0;
    const pas = () => {
      setM(multiplicateurChaudiere(performance.now() - debut.current.t));
      raf = requestAnimationFrame(pas);
    };
    raf = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(raf);
  }, [montee, cle]);

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

  const p = part(affiche);
  const reduit = mouvementReduit();
  const style = { '--p': p, '--secousse': reduit || !montee ? 0 : p } as CSSProperties;
  const aiguille = -124 + 248 * p;
  const danger = p > 0.55;

  return (
    <div className={`ch ${nom} ${explosee && fin ? 'explosee' : ''} ${fin && !explosee ? 'pleine' : ''} ${danger && montee ? 'danger' : ''}`} style={style}>
      <div className="ch-lueur" aria-hidden="true" />
      <div className="ch-vapeurs" aria-hidden="true">
        {[0, 1, 2, 3].map((k) => (
          <img key={k} src="/cartes/bw-vapeur-face.webp" alt="" draggable={false} style={{ '--k': k } as CSSProperties} />
        ))}
      </div>

      <div className="ch-mano">
        <img className="ch-mano-cadran" src="/cartes/bw-mano-cadran.webp" alt="" draggable={false} />
        <img className="ch-mano-aiguille" src="/cartes/bw-mano-aiguille.webp" alt="" draggable={false} style={{ transform: `rotate(${aiguille}deg)` }} />
      </div>

      <div className="ch-compteur" role="status" aria-live="off">
        <strong>{fmt(arrondiChaudiere(affiche))}</strong>
        {M > 1 && <small>{tr(`× ${M} (roue)`, `× ${M} (wheel)`)}</small>}
      </div>

      {nom === 'intro' && <p className="ch-consigne">{tr('Tire le sifflet avant que la chaudière explose !', 'Pull the whistle before the boiler blows!')}</p>}

      {(montee || nom === 'intro') && b.mise > 0 && (
        <button type="button" className={`ch-sifflet ${monSifflet !== null ? 'fait' : ''}`} onClick={siffler} disabled={!peut}>
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
              <img className="ch-eclats" src="/cartes/bw-ev-etincelles.webp" alt="" draggable={false} />
              <img className="ch-nuage" src="/cartes/bw-vapeur-face.webp" alt="" draggable={false} />
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
