/**
 * Petits outils communs aux écrans du Salon privé (les deux machines à sous, le salon) : le solde qui défile, le
 * jeton de la mise, le gain qui défile, le palier d'un gain et la pluie de lingots.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatDollars, MULTIPLE_GROS_GAIN } from '../../shared/casino';
import { EN } from './traduction';
import { useCompteur } from './ui';

export const dollars = (n: number) => formatDollars(n, EN);

/** Le solde défile jusqu'à sa nouvelle valeur. */
export function useSoldeAnime(solde: number): number {
  const [depart, setDepart] = useState(solde);
  const precedent = useRef(solde);
  useEffect(() => {
    setDepart(precedent.current);
    precedent.current = solde;
  }, [solde]);
  return useCompteur(solde, depart, 0, 700);
}

/** Jeton de la couleur de la mise (ivoire, rouge, vert, noir, violet). */
const JETONS: [number, string][] = [
  [100_000, 'violet'],
  [50_000, 'noir'],
  [10_000, 'vert'],
  [5_000, 'rouge'],
  [0, 'ivoire'],
];
export function Jeton({ valeur, className }: { valeur: number; className?: string }) {
  const couleur = JETONS.find(([v]) => valeur >= v)?.[1] ?? 'ivoire';
  return <img className={`cas-jeton ${className ?? ''}`} src={`/cartes/jeton-${couleur}.webp`} alt="" draggable={false} />;
}

export function GainDefilant({ gain, delai = 120, duree = 900 }: { gain: number; delai?: number; duree?: number }) {
  const v = useCompteur(gain, 0, delai, duree);
  return <strong className="roulette-xp-gagne">+{dollars(v)}</strong>;
}

/** Palier du gain, en multiples de la mise : l'animation grandit avec la rareté. */
export type Palier = 'aucun' | 'petit' | 'joli' | 'gros' | 'enorme' | 'colossal';
export function palierDe(gain: number, mise: number): Palier {
  if (gain <= 0) return 'aucun';
  const x = gain / mise;
  return x < 2 ? 'petit' : x < 10 ? 'joli' : x < MULTIPLE_GROS_GAIN ? 'gros' : x < 200 ? 'enorme' : 'colossal';
}
/** Lingots qui tombent, selon le palier. */
export const LINGOTS_PALIER: Record<Palier, number> = { aucun: 0, petit: 0, joli: 10, gros: 26, enorme: 42, colossal: 64 };

/** Pluie de lingots d'or : quelques-uns sur la machine pour un joli gain, tout l'écran pour un gros. */
export function PluieLingots({ n }: { n: number }) {
  const [lingots] = useState(() =>
    Array.from({ length: n }, (_, k) => ({
      x: 3 + Math.random() * 94,
      delai: (k / n) * 0.9 + Math.random() * 0.35,
      duree: 1.5 + Math.random() * 0.9,
      taille: 0.7 + Math.random() * 0.6,
      tour: (Math.random() * 2 - 1) * 520,
    })),
  );
  return (
    <div className="cas-pluie" aria-hidden="true">
      {lingots.map((l, k) => (
        <img
          key={k}
          src="/cartes/machine-lingot.webp"
          alt=""
          draggable={false}
          style={{ left: `${l.x}%`, animationDelay: `${l.delai}s`, animationDuration: `${l.duree}s`, '--t': l.taille, '--tour': `${l.tour}deg` } as CSSProperties}
        />
      ))}
    </div>
  );
}
