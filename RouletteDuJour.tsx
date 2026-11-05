/**
 * Roulette du jour : un tour gratuit par jour, pour gagner de l'XP ou un nouveau personnage (la Danseuse, puis la
 * Journaliste, puis le Barman). Le serveur tire la case ; la roue tourne ici jusqu'à elle.
 */
import { useEffect, useRef, useState } from 'react';
import { CASES_ROULETTE, gainDeCase, type GainRoulette } from '../../shared/roulette';
import type { ProfilCompte } from '../../shared/types';
import type { Appel } from './App';
import type { EtatCompte } from './Profil';
import { AVATARS } from './textes';
import { tr } from './traduction';
import { Fenetre, jouerEffet, mouvementReduit } from './ui';

const N = CASES_ROULETTE.length;
const ANGLE = 360 / N;
const DUREE_MS = 4800;

/** Temps avant la prochaine roulette, remis à jour chaque minute (« 5 h 12 »). */
function useAttente(fin: number | null | undefined): string | null {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (!fin) return;
    const t = window.setInterval(() => setMaintenant(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, [fin]);
  if (!fin || fin <= maintenant) return null;
  const reste = fin - maintenant;
  const h = Math.floor(reste / 3_600_000);
  const min = Math.max(1, Math.ceil((reste % 3_600_000) / 60_000));
  return h > 0 ? `${h} h ${String(min).padStart(2, '0')}` : `${min} min`;
}

/** La roue : 8 cases rouge sang et noir, filets dorés, le gain écrit dans chaque case (ou le personnage à gagner). */
function Roue({ cases, rotation, tourne }: { cases: GainRoulette[]; rotation: number; tourne: boolean }) {
  const R = 100;
  // Le clapet : un « tic » chaque fois qu'une case passe sous la flèche, en suivant la vraie vitesse de la roue.
  const disque = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!tourne) return;
    let precedent: number | null = null;
    let cumul = 0;
    let caseVue = 0;
    let dernierTic = 0;
    let id = 0;
    const angle = () => {
      const m = disque.current ? getComputedStyle(disque.current).transform.match(/matrix\(([^)]+)\)/) : null;
      if (!m) return null;
      const [a, b] = m[1].split(',').map(Number);
      return (Math.atan2(b, a) * 180) / Math.PI;
    };
    const boucle = (t: number) => {
      const a = angle();
      if (a !== null) {
        if (precedent !== null) {
          let d = a - precedent;
          if (d < -180) d += 360;
          if (d > 180) d -= 360;
          cumul += Math.max(0, d);
          const k = Math.floor(cumul / ANGLE);
          if (k !== caseVue && t - dernierTic > 35) {
            caseVue = k;
            dernierTic = t;
            jouerEffet('roulette_tic');
          }
        }
        precedent = a;
      }
      id = window.requestAnimationFrame(boucle);
    };
    id = window.requestAnimationFrame(boucle);
    return () => window.cancelAnimationFrame(id);
  }, [tourne]);
  const point = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [R + r * Math.cos(a), R + r * Math.sin(a)];
  };
  return (
    <div className="roue">
      <svg className="roue-fleche" viewBox="0 0 40 46" aria-hidden="true">
        <path d="M20 44 L4 8 Q20 -2 36 8 Z" />
        <circle cx="20" cy="13" r="4.5" />
      </svg>
      <svg
        ref={disque}
        className={`roue-disque ${tourne ? 'tourne' : ''}`}
        viewBox="0 0 200 200"
        style={{ transform: `rotate(${rotation}deg)`, transitionDuration: tourne ? `${DUREE_MS}ms` : '0ms' }}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="roue-or" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#f6dfa0" />
            <stop offset="60%" stopColor="#d2a85a" />
            <stop offset="100%" stopColor="#8a6424" />
          </radialGradient>
          {cases.map((c, i) =>
            c.type === 'personnage' ? (
              <clipPath key={i} id={`roue-perso-${i}`}>
                <circle cx={point(i * ANGLE + ANGLE / 2, 60)[0]} cy={point(i * ANGLE + ANGLE / 2, 60)[1]} r="17" />
              </clipPath>
            ) : null,
          )}
        </defs>
        <circle cx={R} cy={R} r="99" fill="url(#roue-or)" />
        <circle cx={R} cy={R} r="93" fill="#1b120c" />
        {cases.map((c, i) => {
          const debut = i * ANGLE;
          const [x1, y1] = point(debut, 92);
          const [x2, y2] = point(debut + ANGLE, 92);
          const milieu = debut + ANGLE / 2;
          const [tx, ty] = point(milieu, 64);
          const perso = c.type === 'personnage';
          const centre = point(milieu, 60);
          // La case du personnage (puis du gros lot) est verte, comme le zéro d'une roulette de casino.
          const fond = CASES_ROULETTE[i].type === 'personnage' ? '#0f6b3a' : i % 2 ? '#141010' : '#8e1c14';
          return (
            <g key={i}>
              <path d={`M${R} ${R} L${x1} ${y1} A92 92 0 0 1 ${x2} ${y2} Z`} fill={fond} stroke="#e7c27a" strokeWidth="1.2" />
              {perso ? (
                <>
                  <image
                    href={`/cartes/avatar-${c.avatar}.webp`}
                    x={centre[0] - 17}
                    y={centre[1] - 17}
                    width="34"
                    height="34"
                    clipPath={`url(#roue-perso-${i})`}
                    transform={`rotate(${milieu} ${centre[0]} ${centre[1]})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <circle cx={centre[0]} cy={centre[1]} r="17" fill="none" stroke="#f6dfa0" strokeWidth="1.6" />
                </>
              ) : (
                <text x={tx} y={ty} transform={`rotate(${milieu} ${tx} ${ty})`} className="roue-texte" textAnchor="middle" dominantBaseline="middle">
                  <tspan x={tx} dy="-4">
                    +{c.xp}
                  </tspan>
                  <tspan x={tx} dy="13" className="roue-xp">
                    XP
                  </tspan>
                </text>
              )}
            </g>
          );
        })}
        {/* Petits rivets dorés sur le bord, comme une vraie roue de casino */}
        {Array.from({ length: N }, (_, i) => {
          const [x, y] = point(i * ANGLE, 96);
          return <circle key={i} cx={x} cy={y} r="2.2" fill="#fff1c4" />;
        })}
        <circle cx={R} cy={R} r="22" fill="url(#roue-or)" stroke="#5a3d12" strokeWidth="1.5" />
        <circle cx={R} cy={R} r="15" fill="#1b120c" />
        <image href="/cartes/couronne.webp" x={R - 12} y={R - 9} width="24" height="17" />
      </svg>
    </div>
  );
}

export function FenetreRoulette({ compte, appel, onFermer }: { compte: EtatCompte; appel: Appel; onFermer: () => void }) {
  const p = compte.profil;
  const [rotation, setRotation] = useState(0);
  const [tourne, setTourne] = useState(false);
  const [resultat, setResultat] = useState<{ gain: GainRoulette; niveauAvant: number; niveau: number } | null>(null);
  // Les cases affichées pendant le tour : figées au départ (le personnage gagné ne doit pas changer sous la flèche).
  const [figees, setFigees] = useState<GainRoulette[] | null>(null);
  const minuterie = useRef(0);
  useEffect(() => () => window.clearTimeout(minuterie.current), []);
  const attente = useAttente(p?.rouletteProchaine);
  if (!p) return null;
  const perso = p.personnages ?? [];
  const cases = figees ?? CASES_ROULETTE.map((_, i) => gainDeCase(i, perso));
  const disponible = !attente && !tourne && !resultat;

  const tourner = async () => {
    if (!disponible) return;
    const avant = cases;
    const r = await appel('roulette');
    if (!r.ok || !r.roulette || !r.profil) return;
    const { case: i, gain, niveauAvant, niveau } = r.roulette;
    setFigees(avant);
    // La case tirée s'arrête sous la flèche (en haut), un peu décalée du milieu, après plusieurs tours.
    const decalage = (Math.random() - 0.5) * ANGLE * 0.6;
    const cible = 360 * 6 + (360 - (i * ANGLE + ANGLE / 2)) + decalage;
    const fin = () => {
      setTourne(false);
      setResultat({ gain, niveauAvant, niveau });
      compte.majProfil(r.profil as ProfilCompte);
      jouerEffet(gain.type === 'personnage' ? 'roulette_gros_lot' : 'roulette_gain');
      if (gain.type === 'xp' && niveau > niveauAvant) minuterie.current = window.setTimeout(() => jouerEffet('niveau'), 1100);
    };
    if (mouvementReduit()) {
      setRotation(cible % 360);
      fin();
      return;
    }
    jouerEffet('roulette_depart');
    setTourne(true);
    // Le navigateur part de l'angle actuel : on repart de 0 pour que chaque tour fasse le même spectacle.
    setRotation(0);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setRotation(cible)));
    minuterie.current = window.setTimeout(fin, DUREE_MS + 150);
  };

  const nomPerso = (n: number) => AVATARS[n - 1] ?? '';
  return (
    <Fenetre titre={tr('Roulette du jour', 'Daily wheel')} onFermer={tourne ? undefined : onFermer} large>
      <Roue cases={cases} rotation={rotation} tourne={tourne} />
      {resultat ? (
        <div className={`roulette-resultat ${resultat.gain.type === 'personnage' ? 'perso' : ''}`} role="status">
          {resultat.gain.type === 'personnage' ? (
            <>
              <img src={`/cartes/avatar-${resultat.gain.avatar}.webp`} alt="" />
              <div>
                <strong>{tr(`Nouveau personnage : ${nomPerso(resultat.gain.avatar)} !`, `New character: ${nomPerso(resultat.gain.avatar)}!`)}</strong>
                <span>{tr('Choisis ce personnage dans le salon avant ta prochaine partie.', 'Pick this character in the room before your next game.')}</span>
              </div>
            </>
          ) : (
            <div>
              <strong>+{resultat.gain.xp} XP</strong>
              <span>
                {resultat.niveau > resultat.niveauAvant
                  ? tr(`Niveau ${resultat.niveau} atteint !`, `Level ${resultat.niveau} reached!`)
                  : tr('Ajoutés à ton expérience.', 'Added to your experience.')}
              </span>
            </div>
          )}
        </div>
      ) : (
        <button type="button" className="principal large bouton-tourner" disabled={!disponible} onClick={() => void tourner()}>
          {tourne ? tr('La roue tourne…', 'Spinning…') : attente ? tr(`Prochain tour dans ${attente}`, `Next spin in ${attente}`) : tr('Tourner la roue', 'Spin the wheel')}
        </button>
      )}
    </Fenetre>
  );
}

/** Accueil : le bouton de la roulette du jour (avec une pastille quand un tour est disponible). */
export function BoutonRoulette({ compte, onOuvrir }: { compte: EtatCompte; onOuvrir: () => void }) {
  const attente = useAttente(compte.profil?.rouletteProchaine);
  if (!compte.actif) return null;
  const pret = !!compte.profil && !attente;
  return (
    <button type="button" className={`bouton-roulette ${pret ? 'prete' : ''}`} onClick={onOuvrir}>
      <svg className="bouton-roulette-icone" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="19.5" fill="#d2a85a" />
        <circle cx="20" cy="20" r="17" fill="#1b120c" />
        {CASES_ROULETTE.map((c, i) => {
          const a1 = ((i * 45 - 90) * Math.PI) / 180;
          const a2 = (((i + 1) * 45 - 90) * Math.PI) / 180;
          return (
            <path
              key={i}
              d={`M20 20 L${20 + 16.5 * Math.cos(a1)} ${20 + 16.5 * Math.sin(a1)} A16.5 16.5 0 0 1 ${20 + 16.5 * Math.cos(a2)} ${20 + 16.5 * Math.sin(a2)} Z`}
              fill={c.type === 'personnage' ? '#0f6b3a' : i % 2 ? '#141010' : '#8e1c14'}
              stroke="#e7c27a"
              strokeWidth="0.7"
            />
          );
        })}
        <circle cx="20" cy="20" r="5.5" fill="#d2a85a" stroke="#5a3d12" strokeWidth="0.8" />
        <circle cx="20" cy="20" r="2.4" fill="#1b120c" />
      </svg>
      <span className="bouton-roulette-texte">
        <strong>{tr('Roulette du jour', 'Daily wheel')}</strong>
        <small>
          {!compte.profil
            ? tr('Avec un compte : un tour gratuit par jour', 'With an account: one free spin a day')
            : attente
              ? tr(`Prochain tour dans ${attente}`, `Next spin in ${attente}`)
              : tr('Un tour gratuit t’attend !', 'A free spin is waiting!')}
        </small>
      </span>
      {pret && <span className="pastille-nombre">1</span>}
    </button>
  );
}
