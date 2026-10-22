import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { VueSalon } from '../../shared/types';
import type { Appel } from './App';
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

/** Portrait rond d'un joueur ; l'anneau doré se vide avec le temps qui lui reste. */
export function Avatar({ n, fraction, grand }: { n: number; fraction?: number | null; grand?: boolean }) {
  const minute = fraction !== null && fraction !== undefined;
  const classe = `avatar ${grand ? 'grand' : ''} ${minute ? 'minute' : ''} ${minute && fraction < 0.25 ? 'urgent' : ''}`;
  return (
    <div className={classe} style={{ '--p': minute ? fraction : 0 } as CSSProperties}>
      <img src={`/cartes/avatar-${n}.webp`} alt="" />
    </div>
  );
}

/** Fraction du temps restant (1 → 0), recalée à chaque message du serveur. */
export function useMinuteur(restant: number | null, duree: number): number | null {
  const [fin, setFin] = useState<number | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    setFin(restant === null ? null : Date.now() + restant);
    setMaintenant(Date.now());
  }, [restant]);
  useEffect(() => {
    if (fin === null) return;
    const t = window.setInterval(() => setMaintenant(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [fin]);
  if (fin === null || duree <= 0) return null;
  return Math.max(0, Math.min(1, (fin - maintenant) / duree));
}

/** Discussion entre les joueurs : bouton avec le nombre de messages non lus. */
export function Chat({ salon, appel, enLigne }: { salon: VueSalon; appel: Appel; enLigne?: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState('');
  const [vu, setVu] = useState(0);
  const fin = useRef<HTMLDivElement | null>(null);
  const messages = salon.messages ?? [];
  const dernier = messages.length ? messages[messages.length - 1].n : 0;
  const nonLus = ouvert ? 0 : messages.filter((m) => m.n > vu && m.auteurId !== salon.moi).length;
  useEffect(() => {
    if (ouvert) {
      setVu(dernier);
      fin.current?.scrollIntoView({ block: 'end' });
    }
  }, [ouvert, dernier]);
  const envoyer = async () => {
    if (!texte.trim()) return;
    const r = await appel('chat', { texte });
    if (r.ok) setTexte('');
  };
  return (
    <>
      <button
        type="button"
        className={`chat-bouton ${enLigne ? 'en-ligne' : ''}`}
        onClick={() => setOuvert(!ouvert)}
        aria-label={ouvert ? 'Fermer la discussion' : 'Ouvrir la discussion'}
      >
        💬{nonLus > 0 && <span className="chat-pastille">{nonLus}</span>}
      </button>
      {ouvert && (
        <div className={`chat-panneau ${enLigne ? 'haut' : ''}`} role="dialog" aria-label="Discussion">
          <div className="chat-tete">
            <strong>Discussion</strong>
            <button type="button" className="fermer" onClick={() => setOuvert(false)} aria-label="Fermer">
              ×
            </button>
          </div>
          <div className="chat-messages">
            {messages.length === 0 && <p className="discret">Pas encore de message. Dis bonjour à la table !</p>}
            {messages.map((m) => (
              <p key={m.n} className={m.auteurId === salon.moi ? 'moi' : ''}>
                <span className="chat-auteur">{m.auteurId === salon.moi ? 'Toi' : m.nom}</span>
                {m.texte}
              </p>
            ))}
            <div ref={fin} />
          </div>
          <form
            className="chat-saisie"
            onSubmit={(e) => {
              e.preventDefault();
              void envoyer();
            }}
          >
            <input id="chat-texte" value={texte} maxLength={200} placeholder="Écris un message…" autoComplete="off" onChange={(e) => setTexte(e.target.value)} />
            <button type="submit" className="principal" disabled={!texte.trim()}>
              Envoyer
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/* ---------- Musique d'ambiance ---------- */
const CLE_MUSIQUE = 'ldb-musique';
const VOLUME_MUSIQUE = 0.3;

/**
 * Musique jouée en boucle dans tout le jeu. Les navigateurs (Safari surtout) interdisent le son avant un premier geste :
 * elle démarre donc au premier toucher, puis se coupe quand l'onglet passe en arrière-plan.
 */
const musique = (() => {
  let active = true;
  try {
    active = localStorage.getItem(CLE_MUSIQUE) !== 'off';
  } catch {
    /* préférence indisponible : musique activée */
  }
  let audio: HTMLAudioElement | null = null;
  let contexte: AudioContext | null = null;
  const abonnes = new Set<() => void>();
  const prevenir = () => abonnes.forEach((f) => f());
  const element = () => {
    if (!audio) {
      audio = new Audio('/cartes/musique.mp3');
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = VOLUME_MUSIQUE;
    }
    return audio;
  };
  /** Sur iPhone et iPad, le volume d'un élément audio est imposé : on passe par Web Audio pour le baisser. */
  const brancherVolume = (a: HTMLAudioElement) => {
    if (contexte) return;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      contexte = new AC();
      const gain = contexte.createGain();
      gain.gain.value = VOLUME_MUSIQUE;
      contexte.createMediaElementSource(a).connect(gain).connect(contexte.destination);
      a.volume = 1;
    } catch {
      a.volume = VOLUME_MUSIQUE;
    }
  };
  const jouer = () => {
    if (!active || document.hidden) return;
    const a = element();
    if (!a.paused && contexte?.state !== 'suspended') return;
    brancherVolume(a);
    void contexte?.resume().catch(() => undefined);
    void a.play().catch(() => undefined);
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', jouer, true);
    document.addEventListener('keydown', jouer, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) audio?.pause();
      else jouer();
    });
  }
  return {
    active: () => active,
    basculer: () => {
      active = !active;
      try {
        localStorage.setItem(CLE_MUSIQUE, active ? 'on' : 'off');
      } catch {
        /* rien */
      }
      if (active) jouer();
      else audio?.pause();
      prevenir();
    },
    abonner: (f: () => void) => {
      abonnes.add(f);
      return () => {
        abonnes.delete(f);
      };
    },
  };
})();

export function useMusique(): [boolean, () => void] {
  const [active, setActive] = useState(musique.active());
  useEffect(() => musique.abonner(() => setActive(musique.active())), []);
  return [active, musique.basculer];
}

export function BoutonMusique({ flottant }: { flottant?: boolean }) {
  const [active, basculer] = useMusique();
  return (
    <button
      type="button"
      className={flottant ? 'bouton-musique' : 'petit icone'}
      onClick={basculer}
      aria-pressed={active}
      aria-label={active ? 'Couper la musique' : 'Remettre la musique'}
      title={active ? 'Couper la musique' : 'Remettre la musique'}
    >
      {active ? '🔊' : '🔇'}
    </button>
  );
}
