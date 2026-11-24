/**
 * Petits outils communs aux écrans du Salon privé (les deux machines à sous, le salon) : le solde qui défile, le
 * jeton de la mise, le gain qui défile, le palier d'un gain, la pluie de lingots et les tours automatiques.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatDollars, MULTIPLE_GROS_GAIN } from '../../shared/casino';
import { EN, tr } from './traduction';
import { lireReglages } from './reglages';
import { jouerEffet, mouvementReduit, useCompteur } from './ui';

export const dollars = (n: number) => formatDollars(n, EN);
/** Le solde en bref pour la barre du haut : 1,52 Md $, 48,3 M $ (en entier sous le million). */
export function dollarsCourt(n: number): string {
  const f = (x: number, u: string, uEn: string) => tr(`${x.toLocaleString('fr-FR', { maximumFractionDigits: x < 10 ? 2 : 1 })} ${u} $`, `$${x.toLocaleString('en-US', { maximumFractionDigits: x < 10 ? 2 : 1 })}${uEn}`);
  if (n >= 1e12) return f(n / 1e12, 'Bn', 'T');
  if (n >= 1e9) return f(n / 1e9, 'Md', 'B');
  if (n >= 1e6) return f(n / 1e6, 'M', 'M');
  return dollars(n);
}


/**
 * Le solde que montre le jeu en cours, pour la barre du haut : chaque jeu tient le sien à jour (dès la mise, et ses gains
 * au moment où il les révèle), alors que le solde du salon n'est rafraîchi que de temps en temps.
 */
const soldeJeu = { valeur: null as number | null, abonnes: new Set<() => void>(), jetons: 0 };
function publierSolde(n: number | null) {
  if (soldeJeu.valeur === n) return;
  soldeJeu.valeur = n;
  soldeJeu.abonnes.forEach((f) => f());
}
/** Le jeu affiché annonce son solde à la barre du haut (et le retire en partant). */
export function useSoldeJeu(solde: number | null | undefined) {
  useEffect(() => {
    if (solde === null || solde === undefined || !Number.isFinite(solde)) return;
    publierSolde(solde);
  }, [solde]);
  useEffect(() => {
    soldeJeu.jetons += 1;
    return () => {
      soldeJeu.jetons -= 1;
      if (!soldeJeu.jetons) publierSolde(null);
    };
  }, []);
}
/** La même chose, en composant (pour les jeux qui rendent leur écran après un retour anticipé). */
export function SoldeJeu({ solde }: { solde: number | null | undefined }) {
  useSoldeJeu(solde);
  return null;
}
/** Le solde du jeu en cours (null hors d'un jeu). */
export function useSoldeDuJeu(): number | null {
  const [v, setV] = useState(soldeJeu.valeur);
  useEffect(() => {
    const f = () => setV(soldeJeu.valeur);
    soldeJeu.abonnes.add(f);
    f();
    return () => void soldeJeu.abonnes.delete(f);
  }, []);
  return v;
}

/** Le solde défile jusqu'à sa nouvelle valeur. */
export function useSoldeDefilant(solde: number): number {
  const [depart, setDepart] = useState(solde);
  const precedent = useRef(solde);
  useEffect(() => {
    setDepart(precedent.current);
    precedent.current = solde;
  }, [solde]);
  return useCompteur(solde, depart, 0, 700);
}
/** Le solde d'un jeu, qui défile jusqu'à sa nouvelle valeur ; la barre du haut suit le même. */
export function useSoldeAnime(solde: number): number {
  useSoldeJeu(solde);
  return useSoldeDefilant(solde);
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
/** Ce qui peut tomber : les lingots des machines (par défaut), ou le butin des Coffres (billets, rubis, lingots). */
export type ObjetPluie = 'lingot' | 'billet' | 'rubis' | 'lingot-butin' | 'ecu';
const IMAGES_PLUIE: Record<ObjetPluie, string> = {
  lingot: '/cartes/machine-lingot.webp',
  billet: '/cartes/butin-billet.webp',
  rubis: '/cartes/butin-rubis.webp',
  'lingot-butin': '/cartes/butin-lingot.webp',
  ecu: '/cartes/chute-ecu.webp',
};
export const BUTIN_PLUIE: ObjetPluie[] = ['billet', 'rubis', 'lingot-butin'];

export function PluieLingots({ n, objets = ['lingot'] }: { n: number; objets?: ObjetPluie[] }) {
  const [lingots] = useState(() =>
    Array.from({ length: n }, (_, k) => {
      const objet = objets[(k + Math.floor(Math.random() * objets.length)) % objets.length];
      // Les billets tombent plus lentement, en virevoltant.
      const billet = objet === 'billet';
      return {
        objet,
        x: 3 + Math.random() * 94,
        delai: (k / n) * 0.9 + Math.random() * 0.35,
        duree: billet ? 2.3 + Math.random() * 1.1 : 1.5 + Math.random() * 0.9,
        taille: 0.7 + Math.random() * 0.6,
        tour: (Math.random() * 2 - 1) * (billet ? 160 : 520),
      };
    }),
  );
  // Paramètres du salon : une courte vibration à chaque gain fêté (Android), et la pluie seulement si on la veut.
  useEffect(() => {
    if (!lireReglages().vibration) return;
    try {
      navigator.vibrate?.([30, 40, 60]);
    } catch {
      /* vibration indisponible */
    }
  }, []);
  if (!lireReglages().celebrations || mouvementReduit()) return null;
  return (
    <div className="cas-pluie" aria-hidden="true">
      {lingots.map((l, k) => (
        <img
          key={k}
          className={l.objet}
          src={IMAGES_PLUIE[l.objet]}
          alt=""
          draggable={false}
          style={{ left: `${l.x}%`, animationDelay: `${l.delai}s`, animationDuration: `${l.duree}s`, '--t': l.taille, '--tour': `${l.tour}deg` } as CSSProperties}
        />
      ))}
    </div>
  );
}

// ---------- Tours automatiques des machines à sous ----------

/** Nombres de tours automatiques proposés (Infinity : jusqu'à ce qu'on arrête, ou que le solde manque). */
export const CHOIX_AUTO = [10, 25, 50, 100, Infinity];
export type EtatAuto = { actif: boolean; restants: number };

/**
 * Les tours automatiques : quand la machine est prête (rien ne tourne, aucune fête à l'écran), le tour suivant part
 * après `delai` ms. Les free games se jouent sans compter ; les tours payés décomptent `restants`. Pendant les tours
 * automatiques, les fêtes se ferment toutes seules au bout de quelques secondes.
 */
export function useToursAuto({ pret, gratuits, lancer, delai, fete, fermerFete }: { pret: boolean; gratuits: number; lancer: () => void; delai: () => number; fete: boolean; fermerFete: () => void }) {
  const [auto, setAuto] = useState<EtatAuto>({ actif: false, restants: 0 });
  const lancerRef = useRef(lancer);
  lancerRef.current = lancer;
  const delaiRef = useRef(delai);
  delaiRef.current = delai;
  useEffect(() => {
    if (!auto.actif || !pret) return;
    if (gratuits <= 0 && auto.restants <= 0) {
      setAuto({ actif: false, restants: 0 });
      return;
    }
    const t = window.setTimeout(() => {
      if (gratuits <= 0) setAuto((a) => ({ ...a, restants: a.restants - 1 }));
      lancerRef.current();
    }, delaiRef.current());
    return () => window.clearTimeout(t);
  }, [auto, pret, gratuits]);
  const fermerRef = useRef(fermerFete);
  fermerRef.current = fermerFete;
  useEffect(() => {
    if (!auto.actif || !fete) return;
    const t = window.setTimeout(() => fermerRef.current(), 3500);
    return () => window.clearTimeout(t);
  }, [auto.actif, fete]);
  return {
    auto,
    demarrer: (n: number) => setAuto({ actif: true, restants: n }),
    arreter: () => setAuto({ actif: false, restants: 0 }),
  };
}

/** Les boutons sous la machine : Auto (10 à 100, ou ∞), Tout jouer pendant les free games, Arrêter, et Gains. */
export function OptionsMachine({ auto, gratuits, peutJouer, onDemarrer, onArreter, onGains }: { auto: EtatAuto; gratuits: number; peutJouer: boolean; onDemarrer: (n: number) => void; onArreter: () => void; onGains: () => void }) {
  const [choix, setChoix] = useState(false);
  if (choix && !auto.actif)
    return (
      <div className="cas-options cas-auto-choix" role="group" aria-label={tr('Tours automatiques', 'Auto spins')}>
        {CHOIX_AUTO.map((n) => (
          <button
            key={n}
            type="button"
            className="cas-auto-nombre"
            disabled={!peutJouer}
            onClick={() => {
              jouerEffet('jeton');
              setChoix(false);
              onDemarrer(n);
            }}
          >
            {n === Infinity ? '∞' : n}
          </button>
        ))}
        <button type="button" className="cas-auto-fermer" onClick={() => setChoix(false)} aria-label={tr('Fermer', 'Close')}>
          ✕
        </button>
      </div>
    );
  const restants = auto.restants === Infinity ? '∞' : String(Math.max(0, auto.restants));
  return (
    <div className="cas-options">
      {auto.actif ? (
        <button type="button" className="actif" onClick={onArreter}>
          {gratuits > 0 && auto.restants <= 0 ? tr('Arrêter', 'Stop') : tr(`Arrêter (${restants})`, `Stop (${restants})`)}
        </button>
      ) : gratuits > 0 ? (
        <button type="button" disabled={!peutJouer} onClick={() => onDemarrer(0)}>
          {tr('Tout jouer', 'Play all')}
        </button>
      ) : (
        <button type="button" disabled={!peutJouer} onClick={() => setChoix(true)}>
          {tr('Auto ▾', 'Auto ▾')}
        </button>
      )}
      <button type="button" onClick={onGains}>
        {tr('Gains', 'Paytable')}
      </button>
    </div>
  );
}
