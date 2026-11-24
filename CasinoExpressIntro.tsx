/**
 * L'intro de l'Express (le Rapide de Minuit) : « Minuit sonne », en trois plans, sur 10 s.
 *
 * 1. La roue devient l'horloge (0 → 5,3 s) : la roue, arrêtée sur l'Express (en haut, à midi), tourne une dernière fois et
 *    se change en cadran ; les aiguilles sortent du moyeu, filent, ralentissent… tac : minuit pile. Les douze coups (l'image
 *    tremble, une onde dorée part du cadran à chaque coup), et la caméra recule : c'est l'horloge de la gare, de nuit.
 * 2. Le tableau des départs (5,3 → 7,4 s) : ses palettes claquent jusqu'à « RAPIDE DE MINUIT · PARIS → ISTANBUL ».
 * 3. Le quai (7,4 → 10 s) : les lanternes du train s'allument d'un bout à l'autre, la vapeur envahit le quai, le Baron
 *    surgit et lève sa canne : « En voiture ! ».
 *
 * Tout est calé sur le temps déjà écoulé de l'étape (--t0), pour qui arrive en cours de route.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { tr } from './traduction';
import { jouerEffet, mouvementReduit } from './ui';
import './expressIntro.css';

/** Les images de l'intro (sans chemin ni extension), préchargées avec celles de l'Express. */
export const IMAGES_INTRO_EXPRESS = ['exi-facade', 'exi-horloge', 'exi-minute', 'exi-heure', 'exi-tableau', 'exi-quai', 'exi-quai-allume', 'exi-baron', 'exi-vapeur'];
const IMG = (n: string) => `/cartes/${n}.webp`;

/** Les douze coups : le premier, puis un toutes les 240 ms. */
const COUPS = { debut: 2_350, pas: 240 };
/** Le tableau : les palettes s'affolent, puis se posent colonne après colonne, ligne après ligne. */
const TABLEAU = { debut: 5_450, pose: 5_650, parColonne: 45, parLigne: 220, cadence: 55 };
const COLONNES = 18;
const LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const centrer = (s: string) => {
  const c = [...s];
  const g = Math.floor((COLONNES - c.length) / 2);
  return [...Array(Math.max(0, g)).fill(' '), ...c, ...Array(Math.max(0, COLONNES - c.length - g)).fill(' ')].slice(0, COLONNES);
};
/** Les trois lignes du tableau ; la dernière annonce le multiplicateur de la roue, s'il y en a un. */
const LIGNES = (m: number) => {
  const gauche = m > 1 ? tr(`GAINS ×${m}`, `WINS ×${m}`) : tr("À L'HEURE", 'ON TIME');
  return [
    centrer(tr('RAPIDE DE MINUIT', 'MIDNIGHT EXPRESS')),
    centrer('PARIS → ISTANBUL'),
    [...gauche.padEnd(COLONNES - 5, ' '), ...'00:00'].slice(0, COLONNES),
  ];
};

/** La lettre d'une palette à l'instant t (ms depuis le début de l'intro). */
function palette(cible: string, ligne: number, col: number, t: number): string {
  if (t < TABLEAU.debut) return ' ';
  const pose = TABLEAU.pose + col * TABLEAU.parColonne + ligne * TABLEAU.parLigne;
  if (t >= pose) return cible;
  const n = Math.floor((t - TABLEAU.debut) / TABLEAU.cadence);
  return LETTRES[(ligne * 7 + col * 13 + n * 5 + ((col * 31) % 11)) % LETTRES.length];
}

export function IntroExpress({ t0: t0Recu, roue, multiplicateur = 1 }: { t0: number; roue?: ReactNode; multiplicateur?: number }) {
  // (le temps écoulé à l'arrivée, figé : tout le reste en découle)
  const [t0] = useState(() => Math.max(0, t0Recu));
  const [debut] = useState(() => performance.now() - t0);
  const [t, setT] = useState(t0);
  const reduit = mouvementReduit();

  // L'horloge du tableau (les palettes se dessinent en code).
  useEffect(() => {
    if (reduit) return;
    const id = window.setInterval(() => {
      const x = performance.now() - debut;
      if (x > TABLEAU.debut - 200 && x < 7_600) setT(x);
    }, 40);
    return () => window.clearInterval(id);
  }, [debut, reduit]);

  // Les sons.
  useEffect(() => {
    if (reduit) return;
    const sons: [number, () => void][] = [
      [300, () => jouerEffet('bw_tic', { volume: 0.6 })],
      [1_100, () => jouerEffet('gd_eclat', { volume: 0.7 })],
      [2_050, () => jouerEffet('bw_tic', { volume: 1 })],
      ...Array.from({ length: 12 }, (_, k): [number, () => void] => [COUPS.debut + k * COUPS.pas, () => jouerEffet('exi_minuit', { volume: k === 11 ? 1 : 0.55 + k * 0.02 })]),
      [COUPS.debut + 11 * COUPS.pas + 40, () => jouerEffet('gd_eclat', { volume: 0.8 })],
      [TABLEAU.debut, () => jouerEffet('exi_palettes', { volume: 0.9 })],
      [7_350, () => jouerEffet('ex_vapeur', { volume: 0.9 })],
      [8_650, () => jouerEffet('ex_sifflet', { volume: 1 })],
    ];
    const ids = sons.filter(([x]) => x >= t0).map(([x, f]) => window.setTimeout(f, x - t0));
    return () => ids.forEach((i) => window.clearTimeout(i));
    // (une seule fois : le début de l'intro ne bouge pas)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lignes = LIGNES(multiplicateur);
  const style = { '--t0': `${-t0}ms` } as CSSProperties;

  return (
    <div className={`exi ${reduit ? 'fige' : ''}`} style={style} aria-hidden="true">
      {/* 1. La roue devient l'horloge de la gare. */}
      <div className="exi-plan exi-p1">
        <div className="exi-cadre exi-secoue">
          <div className="exi-vue">
            <img className="exi-facade" src={IMG('exi-facade')} alt="" draggable={false} />
            <div className="exi-centre">
              <i className="exi-lueur" />
              {Array.from({ length: 12 }, (_, k) => (
                <i key={k} className="exi-onde" style={{ '--k': k } as CSSProperties} />
              ))}
              <span className="exi-horloge-zone">
                <img className="exi-horloge" src={IMG('exi-horloge')} alt="" draggable={false} />
              </span>
              {roue && <div className="exi-roue">{roue}</div>}
              <img className="exi-aiguille heure" src={IMG('exi-heure')} alt="" draggable={false} />
              <img className="exi-aiguille minute" src={IMG('exi-minute')} alt="" draggable={false} />
            </div>
          </div>
        </div>
      </div>

      {/* 2. Le tableau des départs. */}
      <div className="exi-plan exi-p2">
        <div className="exi-cadre exi-approche">
          <img className="exi-fond" src={IMG('exi-tableau')} alt="" draggable={false} />
          <div className="exi-panneau">
            {lignes.map((l, r) => (
              <div key={r} className="exi-ligne">
                {l.map((c, k) => {
                  const ch = reduit ? c : palette(c, r, k, t);
                  return (
                    <span key={k} className={`exi-case ${r === 2 && multiplicateur > 1 && k < 13 && c !== ' ' ? 'multi' : ''}`}>
                      <b key={ch} className={ch === c && !reduit && t >= TABLEAU.pose ? 'pose' : ''}>
                        {ch === ' ' ? ' ' : ch}
                      </b>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Le quai : les lanternes s'allument, la vapeur, le Baron. */}
      <div className="exi-plan exi-p3">
        <div className="exi-cadre">
          <img className="exi-fond" src={IMG('exi-quai')} alt="" draggable={false} />
          <img className="exi-fond exi-allume" src={IMG('exi-quai-allume')} alt="" draggable={false} />
          <img className="exi-vapeur a" src={IMG('exi-vapeur')} alt="" draggable={false} />
          <span className="exi-baron">
            <img src={IMG('exi-baron')} alt="" draggable={false} />
            <i className="exi-etoile" />
          </span>
          <img className="exi-vapeur b" src={IMG('exi-vapeur')} alt="" draggable={false} />
        </div>
        <p className="exi-cri">{tr('En voiture !', 'All aboard!')}</p>
      </div>

      <i className="exi-eclair" />
    </div>
  );
}
