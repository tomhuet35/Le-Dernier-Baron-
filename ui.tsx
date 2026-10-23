import { Children, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

/**
 * Liste qui ne montre qu'une rangée (3 éléments) pour garder de la place à l'écran :
 * la flèche fait défiler vers la suite, puis remonte au début. On peut aussi glisser du doigt.
 */
export function Defilant(props: { children: ReactNode; libelle: string; parRangee?: number; actif?: number; role?: string; className?: string }) {
  const { libelle, parRangee = 3, actif = -1, role = 'group', className = '' } = props;
  const elements = Children.toArray(props.children);
  const rangees: ReactNode[][] = [];
  for (let i = 0; i < elements.length; i += parRangee) rangees.push(elements.slice(i, i + parRangee));
  const zone = useRef<HTMLDivElement>(null);
  const [hauteur, setHauteur] = useState<number>();
  const [rangee, setRangee] = useState(0);
  const rangeeActuelle = useRef(0);
  rangeeActuelle.current = rangee;
  const place = useRef(false);

  // Hauteur de la plus haute rangée (un nom sur deux lignes, par exemple) : toutes les rangées prennent cette
  // hauteur et la zone n'en laisse voir qu'une.
  useLayoutEffect(() => {
    const grilles = Array.from(zone.current?.querySelectorAll<HTMLElement>('.defilant-grille') ?? []);
    if (!grilles.length) return;
    const mesurer = () => setHauteur(Math.max(...grilles.map((g) => g.offsetHeight)));
    mesurer();
    const obs = new ResizeObserver(mesurer);
    grilles.forEach((g) => obs.observe(g));
    return () => obs.disconnect();
  }, [rangees.length]);

  // Premier affichage : la rangée de l'élément choisi ; ensuite on reste sur la rangée en cours si la taille change.
  useLayoutEffect(() => {
    const z = zone.current;
    if (!z || !hauteur) return;
    let r = rangeeActuelle.current;
    if (!place.current) {
      place.current = true;
      r = actif >= 0 ? Math.min(Math.floor(actif / parRangee), rangees.length - 1) : 0;
      setRangee(r);
    }
    z.scrollTop = r * hauteur;
  }, [hauteur]); // eslint-disable-line react-hooks/exhaustive-deps

  const derniere = rangee >= rangees.length - 1;
  const aller = (r: number) => {
    setRangee(r);
    zone.current?.scrollTo({ top: r * (hauteur ?? 0), behavior: 'smooth' });
  };
  return (
    <div className={`defilant ${className}`}>
      <div
        ref={zone}
        className="defilant-zone"
        role={role}
        aria-label={libelle}
        style={hauteur ? { height: hauteur } : undefined}
        onScroll={(e) => {
          if (hauteur) setRangee(Math.min(rangees.length - 1, Math.round(e.currentTarget.scrollTop / hauteur)));
        }}
      >
        {rangees.map((r, i) => (
          <div key={i} className="defilant-rangee" style={hauteur ? { height: hauteur } : undefined}>
            <div className="defilant-grille" style={{ gridTemplateColumns: `repeat(${parRangee}, minmax(0, 1fr))` }}>
              {r}
            </div>
          </div>
        ))}
      </div>
      {rangees.length > 1 && (
        <button
          type="button"
          className={`defilant-fleche ${derniere ? 'retour' : ''}`}
          onClick={() => aller(derniere ? 0 : rangee + 1)}
          aria-label={derniere ? `${libelle} : revenir au début` : `${libelle} : voir la suite`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 9l7 7 7-7" />
          </svg>
        </button>
      )}
    </div>
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
        <img src="/cartes/icone-chat.webp" alt="" draggable={false} />
        {enLigne && <span className="libelle">Discussion</span>}
        {nonLus > 0 && <span className="chat-pastille">{nonLus}</span>}
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

/* ---------- Musique d'ambiance et effets sonores ---------- */
const CLE_MUSIQUE = 'ldb-musique';
const VOLUME_MUSIQUE = 0.3;
/** Pendant un effet important (lancement de partie), la musique baisse puis revient. */
const VOLUME_MUSIQUE_BAISSE = 0.08;

export type EffetSonore = 'jouer' | 'lancement' | 'carte' | 'evenement' | 'baron' | 'pickpocket' | 'homme_de_main' | 'croupier' | 'juge';
const EFFETS: Record<EffetSonore, { fichier: string; volume: number; baisserMusique: boolean }> = {
  jouer: { fichier: '/cartes/son-jouer.mp3', volume: 0.8, baisserMusique: false },
  lancement: { fichier: '/cartes/son-lancement.mp3', volume: 0.55, baisserMusique: true },
  carte: { fichier: '/cartes/son-carte.mp3', volume: 0.75, baisserMusique: false },
  // Carte d'événement qui tourne au centre de l'écran au début de la nuit.
  evenement: { fichier: '/cartes/son-evenement.mp3', volume: 0.8, baisserMusique: true },
  // Cartes spéciales posées sur le tapis (en plus du bruit de la carte).
  baron: { fichier: '/cartes/son-baron.mp3', volume: 0.7, baisserMusique: true },
  pickpocket: { fichier: '/cartes/son-pickpocket.mp3', volume: 0.75, baisserMusique: false },
  homme_de_main: { fichier: '/cartes/son-homme-de-main.mp3', volume: 0.75, baisserMusique: false },
  croupier: { fichier: '/cartes/son-croupier.mp3', volume: 0.8, baisserMusique: false },
  juge: { fichier: '/cartes/son-juge.mp3', volume: 0.7, baisserMusique: false },
};

/** Son propre à certaines cartes spéciales quand elles sont posées. */
export const SON_SPECIALE: Partial<Record<string, EffetSonore>> = {
  baron: 'baron',
  pickpocket: 'pickpocket',
  homme_de_main: 'homme_de_main',
  croupier: 'croupier',
  juge: 'juge',
};

/**
 * Musique jouée en boucle dans tout le jeu, et effets sonores. Les navigateurs (Safari surtout) interdisent le son
 * avant un premier geste : tout se débloque au premier toucher. Le bouton Son coupe la musique et les effets.
 */
const musique = (() => {
  let active = true;
  try {
    active = localStorage.getItem(CLE_MUSIQUE) !== 'off';
  } catch {
    /* préférence indisponible : son activé */
  }
  let audio: HTMLAudioElement | null = null;
  let contexte: AudioContext | null = null;
  let gainMusique: GainNode | null = null;
  const abonnes = new Set<() => void>();
  const prevenir = () => abonnes.forEach((f) => f());

  // Les effets sont téléchargés tout de suite (quelques Ko) puis décodés quand le son est débloqué.
  const donnees = new Map<EffetSonore, Promise<ArrayBuffer | null>>();
  const tampons = new Map<EffetSonore, Promise<AudioBuffer | null>>();
  const telecharger = (nom: EffetSonore) => {
    if (!donnees.has(nom)) {
      donnees.set(
        nom,
        fetch(EFFETS[nom].fichier)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null),
      );
    }
    return donnees.get(nom)!;
  };
  if (typeof window !== 'undefined') (Object.keys(EFFETS) as EffetSonore[]).forEach(telecharger);

  const ctx = (): AudioContext | null => {
    if (contexte) return contexte;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      contexte = AC ? new AC() : null;
    } catch {
      contexte = null;
    }
    return contexte;
  };
  const decoder = (nom: EffetSonore): Promise<AudioBuffer | null> => {
    const c = ctx();
    if (!c) return Promise.resolve(null);
    if (!tampons.has(nom)) {
      tampons.set(
        nom,
        telecharger(nom).then(
          (brut) =>
            brut
              ? new Promise<AudioBuffer | null>((ok) => {
                  // Forme « rappel » : la seule comprise par les anciennes versions de Safari.
                  c.decodeAudioData(brut.slice(0), ok, () => ok(null));
                })
              : null,
        ),
      );
    }
    return tampons.get(nom)!;
  };

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
    if (gainMusique) return;
    const c = ctx();
    if (!c) return;
    try {
      gainMusique = c.createGain();
      gainMusique.gain.value = VOLUME_MUSIQUE;
      c.createMediaElementSource(a).connect(gainMusique).connect(c.destination);
      a.volume = 1;
    } catch {
      gainMusique = null;
      a.volume = VOLUME_MUSIQUE;
    }
  };
  /** Au moindre geste : débloque le son, prépare les effets et lance la musique si elle est activée. */
  const debloquer = () => {
    if (document.hidden) return;
    const c = ctx();
    if (c?.state === 'suspended') void c.resume().catch(() => undefined);
    (Object.keys(EFFETS) as EffetSonore[]).forEach((n) => void decoder(n));
    if (!active) return;
    const a = element();
    if (!a.paused) return;
    brancherVolume(a);
    void a.play().catch(() => undefined);
  };
  if (typeof document !== 'undefined') {
    for (const evt of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(evt, debloquer, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) audio?.pause();
      else debloquer();
    });
  }

  const baisserMusique = (duree: number) => {
    const c = contexte;
    if (gainMusique && c) {
      const g = gainMusique.gain;
      const t = c.currentTime;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(VOLUME_MUSIQUE_BAISSE, t, 0.08);
      g.setTargetAtTime(VOLUME_MUSIQUE, t + Math.max(0.3, duree - 0.4), 0.35);
    } else if (audio) {
      const a = audio;
      a.volume = VOLUME_MUSIQUE_BAISSE;
      window.setTimeout(() => (a.volume = VOLUME_MUSIQUE), duree * 1000);
    }
  };

  const effet = async (nom: EffetSonore) => {
    if (!active || document.hidden) return;
    const reglage = EFFETS[nom];
    const c = ctx();
    if (c) {
      if (c.state === 'suspended') await c.resume().catch(() => undefined);
      const tampon = await decoder(nom);
      if (tampon && c.state === 'running') {
        const source = c.createBufferSource();
        const gain = c.createGain();
        gain.gain.value = reglage.volume;
        source.buffer = tampon;
        source.connect(gain).connect(c.destination);
        source.start();
        if (reglage.baisserMusique) baisserMusique(tampon.duration);
        return;
      }
    }
    // Navigateur sans Web Audio : simple lecture du fichier.
    const a = new Audio(reglage.fichier);
    a.volume = reglage.volume;
    void a.play().catch(() => undefined);
  };

  return {
    active: () => active,
    effet,
    basculer: () => {
      active = !active;
      try {
        localStorage.setItem(CLE_MUSIQUE, active ? 'on' : 'off');
      } catch {
        /* rien */
      }
      if (active) debloquer();
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

/** Joue un effet sonore (rien si le son est coupé). */
export function jouerEffet(nom: EffetSonore) {
  void musique.effet(nom);
}

export function useMusique(): [boolean, () => void] {
  const [active, setActive] = useState(musique.active());
  useEffect(() => musique.abonner(() => setActive(musique.active())), []);
  return [active, musique.basculer];
}

/** Bouton musique en bas de page (accueil et salon) : l'icône et l'état écrit à côté. */
export function BoutonMusique() {
  const [active, basculer] = useMusique();
  return (
    <button
      type="button"
      className="bouton-musique"
      onClick={basculer}
      aria-pressed={active}
      aria-label={active ? 'Couper la musique' : 'Remettre la musique'}
    >
      <IconeMusique active={active} />
      <span>{active ? 'Musique activée' : 'Musique coupée'}</span>
    </button>
  );
}

/** Icône du son : le haut-parleur doré, barré d'une croix quand le son est coupé. */
export function IconeMusique({ active }: { active: boolean }) {
  return <img className="icone-musique" src={active ? '/cartes/son-actif.webp' : '/cartes/son-coupe.webp'} alt="" draggable={false} />;
}

/**
 * Icône dessinée (fichier /cartes/icone-<nom>.webp) ; tant que l'image n'existe pas, un symbole de remplacement s'affiche.
 * Il suffit donc d'ajouter l'image pour qu'elle apparaisse, sans toucher au code.
 */
export function IconeImage({ nom, repli, className }: { nom: string; repli: string; className?: string }) {
  const [echec, setEchec] = useState(false);
  if (echec) {
    return (
      <span className={`icone-repli ${className ?? ''}`} aria-hidden="true">
        {repli}
      </span>
    );
  }
  return <img className={className} src={`/cartes/icone-${nom}.webp`} alt="" draggable={false} onError={() => setEchec(true)} />;
}
