/**
 * L'entrée d'un jeu, juste après son chargement (une fois à chaque ouverture de la page) :
 * - le Bal du Grand Hôtel : les trois coups du brigadier sur le rideau fermé, puis le rideau de velours s'ouvre sur la
 *   roue (le lambrequin remonte à la fin) ;
 * - le Baron Express : les portes blindées ; le volant tourne, les verrous claquent, et les battants coulissent dans la
 *   vapeur.
 * Les images fermées sont coupées en deux moitiés exactes (en-bal-*, en-bw-*, paysage et portrait). Animations réduites :
 * pas d'entrée.
 */
import { useEffect, useState } from 'react';
import { jouerEffet, mouvementReduit } from './ui';
import './entreeJeu.css';

export const IMAGES_ENTREE: Record<'bal' | 'express', string[]> = {
  bal: ['en-bal-paysage-g', 'en-bal-paysage-d', 'en-bal-portrait-g', 'en-bal-portrait-d', 'en-bal-lambrequin', 'bal-logo'],
  express: ['en-bw-paysage-g', 'en-bw-paysage-d', 'en-bw-portrait-g', 'en-bw-portrait-d', 'en-bw-volant', 'bw-logo', 'exi-vapeur'],
};
const DUREE = { bal: 2_700, express: 2_900 };

export function EntreeJeu({ jeu }: { jeu: 'bal' | 'express' }) {
  const [la, setLa] = useState(() => !mouvementReduit());
  useEffect(() => {
    if (!la) return;
    jouerEffet(jeu === 'bal' ? 'entree_rideau' : 'entree_portes');
    const t = window.setTimeout(() => setLa(false), DUREE[jeu]);
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!la) return null;
  return (
    <div className={`en-entree ${jeu}`} aria-hidden="true">
      <div className="en-moitie g" />
      <div className="en-moitie d" />
      {jeu === 'bal' ? (
        <>
          <img className="en-lambrequin" src="/cartes/en-bal-lambrequin.webp" alt="" />
          <img className="en-logo" src="/cartes/bal-logo.webp" alt="" />
        </>
      ) : (
        <>
          <img className="en-volant" src="/cartes/en-bw-volant.webp" alt="" />
          <img className="en-logo" src="/cartes/bw-logo.webp" alt="" />
          <img className="en-vapeur" src="/cartes/exi-vapeur.webp" alt="" />
        </>
      )}
    </div>
  );
}
