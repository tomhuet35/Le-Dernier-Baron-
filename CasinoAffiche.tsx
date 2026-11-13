/**
 * Le jeu à l'affiche (Salon privé) : le bandeau du salon (le jeu du moment, ses atouts, le temps qui reste, le suivant)
 * et la puce dorée qu'on voit dans le jeu lui-même, avec le bonus déjà touché pendant le créneau.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BONUS_AFFICHE, PLAFOND_BONUS_AFFICHE, XP_AFFICHE, type VueAffiche } from '../../shared/afficheCasino';
import { NOMS_JEUX_CASINO, type JeuCasino } from '../../shared/profilCasino';
import { tr } from './traduction';

/** La vignette de chaque jeu (celle du salon). */
export const IMAGES_JEUX: Record<JeuCasino, string> = {
  machine: '/cartes/casino-machine.webp',
  nuits: '/cartes/casino-nuits.webp',
  blackjack: '/cartes/casino-blackjack.webp',
  roulette: '/cartes/casino-roulette.webp',
  folleNuit: '/cartes/casino-folle-nuit.webp',
  coffres: '/cartes/casino-festin.webp',
  couronne: '/cartes/casino-couronne.webp',
  chute: '/cartes/casino-chute.webp',
  course: '/cartes/casino-course.webp',
  baronWheel: '/cartes/casino-baron-wheel.webp',
};

const pourcent = Math.round(BONUS_AFFICHE * 100);

/** « 1 h 23 », « 12 min », « 40 s ». */
function duree(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  if (s >= 60) return `${Math.ceil(s / 60)} min`;
  return `${s} s`;
}
/** « 250 k $ », « 1 M $ ». */
function court(n: number): string {
  const f = (x: number, u: string) => `${x.toLocaleString(tr('fr-FR', 'en-US'), { maximumFractionDigits: x < 10 ? 1 : 0 })} ${u}`;
  return n >= 1e6 ? f(n / 1e6, 'M $') : n >= 1e3 ? f(n / 1e3, 'k $') : `${n} $`;
}

/** Le temps qui reste avant le prochain jeu ; `onFin` quand il est écoulé (le salon se met alors à jour). */
function useReste(affiche: VueAffiche, onFin: () => void): number {
  const fin = useMemo(() => Date.now() + affiche.reste, [affiche]);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const i = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, []);
  const reste = Math.max(0, fin - maintenant);
  const finRef = useRef(onFin);
  finRef.current = onFin;
  const fini = reste === 0;
  useEffect(() => {
    if (fini) finRef.current();
  }, [fini, fin]);
  return reste;
}

export function BandeauAffiche({ affiche, onOuvrir, onFin }: { affiche: VueAffiche; onOuvrir: (j: JeuCasino) => void; onFin: () => void }) {
  const reste = useReste(affiche, onFin);
  return (
    <button type="button" className="cas-affiche" onClick={() => onOuvrir(affiche.jeu)}>
      <img src={IMAGES_JEUX[affiche.jeu]} alt="" draggable={false} />
      <span className="cas-affiche-texte">
        <small>
          <b>★ {tr('À l’affiche', 'Featured game')}</b> · {tr(`encore ${duree(reste)}`, `${duree(reste)} left`)}
        </small>
        <strong>{tr(...NOMS_JEUX_CASINO[affiche.jeu])}</strong>
        <span className="cas-affiche-atouts">
          <b>{tr(`XP ×${XP_AFFICHE}`, `XP ×${XP_AFFICHE}`)}</b>
          <b>{tr(`+${pourcent} % sur les gains`, `+${pourcent}% on winnings`)}</b>
        </span>
        <em>
          {affiche.bonus > 0
            ? tr(`Bonus touché : ${court(affiche.bonus)} sur ${court(PLAFOND_BONUS_AFFICHE)}`, `Bonus collected: ${court(affiche.bonus)} of ${court(PLAFOND_BONUS_AFFICHE)}`)
            : tr(`Ensuite : ${NOMS_JEUX_CASINO[affiche.suivant][0]}`, `Next: ${NOMS_JEUX_CASINO[affiche.suivant][1]}`)}
        </em>
      </span>
      <span className="cas-affiche-jouer" aria-hidden="true">
        {tr('Jouer', 'Play')} ›
      </span>
    </button>
  );
}

/** Dans le jeu à l'affiche : la puce dorée (atouts, et bonus touché qui grandit). */
export function PuceAffiche({ affiche, defi, onFin }: { affiche: VueAffiche; defi: boolean; onFin: () => void }) {
  const reste = useReste(affiche, onFin);
  return (
    <div className={`cas-puce-affiche ${defi ? 'avec-defi' : ''}`} role="status" aria-label={tr('Jeu à l’affiche', 'Featured game')}>
      <b>★</b>
      <span>
        <small>
          {tr('À l’affiche', 'Featured')} · {duree(reste)}
        </small>
        <strong>
          XP ×{XP_AFFICHE} · +{pourcent} %
        </strong>
      </span>
      {affiche.bonus > 0 && (
        <i key={affiche.bonus} className={affiche.bonus >= PLAFOND_BONUS_AFFICHE ? 'plein' : ''}>
          +{court(affiche.bonus)}
        </i>
      )}
    </div>
  );
}
