import { useRef, type ReactNode } from 'react';
import { CARTE } from '../../shared/cartes';
import { COULEUR_FAMILLE, infoCarte } from './textes';

/** Une carte : toucher pour sélectionner, appui long pour l'afficher en grand. */
export function CarteImg(props: {
  id: string;
  taille?: 'main' | 'pli' | 'mini';
  etat?: 'jouable' | 'grisee' | 'choisie' | 'gagnante';
  legende?: string;
  onToucher?: () => void;
  onZoom?: (id: string) => void;
}) {
  const info = infoCarte(props.id);
  const minuterie = useRef<number | null>(null);
  const long = useRef(false);
  const debut = () => {
    long.current = false;
    if (!props.onZoom) return;
    minuterie.current = window.setTimeout(() => {
      long.current = true;
      props.onZoom?.(props.id);
    }, 450);
  };
  const arreter = () => {
    if (minuterie.current) window.clearTimeout(minuterie.current);
    minuterie.current = null;
  };
  return (
    <figure className={`carte carte-${props.taille ?? 'main'} ${props.etat ?? ''}`}>
      <button
        type="button"
        className="carte-bouton"
        aria-label={info.nom}
        onPointerDown={debut}
        onPointerUp={arreter}
        onPointerLeave={arreter}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (long.current) return;
          if (props.onToucher) props.onToucher();
          else props.onZoom?.(props.id);
        }}
      >
        <img src={info.image} alt={info.nom} draggable={false} />
      </button>
      {props.legende && <figcaption>{props.legende}</figcaption>}
    </figure>
  );
}

export function Pastille({ id, onClick, choisie }: { id: string; onClick?: () => void; choisie?: boolean }) {
  const c = CARTE[id];
  const couleur = COULEUR_FAMILLE[c.famille ?? 'chat_noir'];
  const contenu = (
    <>
      <span className="pastille-valeur">{c.valeur}</span>
      <span className="pastille-nom">{c.famille === 'chat_noir' ? 'Chat' : c.nom.split(' ')[0]}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={`pastille ${choisie ? 'choisie' : ''}`} style={{ background: couleur }} onClick={onClick} aria-label={c.nom}>
      {contenu}
    </button>
  ) : (
    <span className="pastille" style={{ background: couleur }} title={c.nom}>
      {contenu}
    </span>
  );
}

export function Butin({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="vide">Aucun butin</span>;
  return (
    <span className="butin">
      {ids.map((id) => (
        <Pastille key={id} id={id} />
      ))}
    </span>
  );
}

export function Fenetre({ titre, onFermer, children, large }: { titre: string; onFermer?: () => void; children: ReactNode; large?: boolean }) {
  return (
    <div className="voile" role="dialog" aria-modal="true" aria-label={titre} onClick={onFermer}>
      <div className={`fenetre ${large ? 'large' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="fenetre-tete">
          <h2>{titre}</h2>
          {onFermer && (
            <button type="button" className="fermer" onClick={onFermer} aria-label="Fermer">
              ×
            </button>
          )}
        </div>
        <div className="fenetre-corps">{children}</div>
      </div>
    </div>
  );
}

export function Zoom({ id, onFermer }: { id: string; onFermer: () => void }) {
  const info = infoCarte(id);
  return (
    <div className="voile" role="dialog" aria-modal="true" aria-label={info.nom} onClick={onFermer}>
      <div className="zoom">
        <img src={info.image} alt={info.nom} />
        <h2>{info.nom}</h2>
        <p>{info.effet}</p>
        <p className="discret">Touche pour fermer</p>
      </div>
    </div>
  );
}
