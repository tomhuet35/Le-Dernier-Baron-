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

export type EffetSonore = 'jouer' | 'lancement' | 'carte';
const EFFETS: Record<EffetSonore, { fichier: string; volume: number; baisserMusique: boolean }> = {
  jouer: { fichier: '/cartes/son-jouer.mp3', volume: 0.8, baisserMusique: false },
  lancement: { fichier: '/cartes/son-lancement.mp3', volume: 0.55, baisserMusique: true },
  carte: { fichier: '/cartes/son-carte.mp3', volume: 0.75, baisserMusique: false },
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

/* ---------- Victoire : pluie des 4 gangs et couronne qui tombe ---------- */
type ObjetPluie = 'billets' | 'diamants' | 'lames' | 'lingots';
const OBJETS_PLUIE: ObjetPluie[] = ['billets', 'diamants', 'lames', 'lingots'];
const LARGEUR_OBJET: Record<ObjetPluie, number> = { billets: 64, diamants: 42, lames: 24, lingots: 58 };

/** Dessins de remplacement ; une image /cartes/pluie-<objet>.webp, si elle existe, les remplace automatiquement. */
function DessinObjet({ type }: { type: ObjetPluie | 'couronne' }) {
  switch (type) {
    case 'billets':
      return (
        <svg viewBox="0 0 100 50">
          <rect x="1.5" y="1.5" width="97" height="47" rx="4" fill="#2f7d4f" stroke="#173f28" strokeWidth="3" />
          <rect x="8" y="7" width="84" height="36" rx="2" fill="none" stroke="#a8d5b0" strokeOpacity="0.55" strokeWidth="1.5" />
          <ellipse cx="50" cy="25" rx="13" ry="15" fill="#e9dfbf" stroke="#173f28" strokeWidth="2" />
          <text x="50" y="31" fontSize="17" textAnchor="middle" fill="#2f7d4f" fontFamily="Georgia, serif" fontWeight="700">
            B
          </text>
          <circle cx="17" cy="25" r="5" fill="#a8d5b0" fillOpacity="0.5" />
          <circle cx="83" cy="25" r="5" fill="#a8d5b0" fillOpacity="0.5" />
        </svg>
      );
    case 'diamants':
      return (
        <svg viewBox="0 0 60 52">
          <defs>
            <linearGradient id="pluie-diamant" x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0" stopColor="#ffb3cb" />
              <stop offset="0.5" stopColor="#c2456b" />
              <stop offset="1" stopColor="#6e1533" />
            </linearGradient>
          </defs>
          <polygon points="12,2 48,2 59,16 30,51 1,16" fill="url(#pluie-diamant)" stroke="#5a0f29" strokeWidth="2" strokeLinejoin="round" />
          <path d="M1 16 H59 M12 2 L20 16 L30 2 L40 16 L48 2 M20 16 L30 51 L40 16" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.4" />
        </svg>
      );
    case 'lames':
      return (
        <svg viewBox="0 0 30 100">
          <defs>
            <linearGradient id="pluie-lame" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#f3f6fb" />
              <stop offset="1" stopColor="#8195b0" />
            </linearGradient>
          </defs>
          <polygon points="15,1 22,60 8,60" fill="url(#pluie-lame)" stroke="#3a4a60" strokeWidth="1.5" strokeLinejoin="round" />
          <line x1="15" y1="6" x2="15" y2="57" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.2" />
          <rect x="2" y="59" width="26" height="6" rx="2" fill="#d2a85a" stroke="#6b4718" strokeWidth="1.2" />
          <rect x="10" y="65" width="10" height="27" rx="3" fill="#3d6a96" stroke="#1f2f45" strokeWidth="1.2" />
          <circle cx="15" cy="95" r="4.5" fill="#d2a85a" stroke="#6b4718" strokeWidth="1.2" />
        </svg>
      );
    case 'lingots':
      return (
        <svg viewBox="0 0 100 50">
          <defs>
            <linearGradient id="pluie-or" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff0b0" />
              <stop offset="0.45" stopColor="#e7c27a" />
              <stop offset="1" stopColor="#8a5d1f" />
            </linearGradient>
          </defs>
          <polygon points="18,4 82,4 97,46 3,46" fill="url(#pluie-or)" stroke="#6b4718" strokeWidth="2.5" strokeLinejoin="round" />
          <polygon points="18,4 82,4 75,15 25,15" fill="#fff6d2" fillOpacity="0.55" />
        </svg>
      );
    case 'couronne':
      return (
        <svg viewBox="0 0 120 92">
          <defs>
            <linearGradient id="pluie-couronne" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff2b8" />
              <stop offset="0.5" stopColor="#e7c27a" />
              <stop offset="1" stopColor="#9a6a22" />
            </linearGradient>
          </defs>
          <polygon points="8,66 8,24 34,46 60,8 86,46 112,24 112,66" fill="url(#pluie-couronne)" stroke="#6b4718" strokeWidth="2.5" strokeLinejoin="round" />
          <rect x="6" y="64" width="108" height="22" rx="4" fill="url(#pluie-couronne)" stroke="#6b4718" strokeWidth="2.5" />
          <circle cx="8" cy="21" r="6" fill="#fff2b8" stroke="#6b4718" strokeWidth="2" />
          <circle cx="60" cy="6" r="6" fill="#fff2b8" stroke="#6b4718" strokeWidth="2" />
          <circle cx="112" cy="21" r="6" fill="#fff2b8" stroke="#6b4718" strokeWidth="2" />
          <circle cx="60" cy="75" r="6.5" fill="#b8281d" stroke="#5a0e09" strokeWidth="1.5" />
          <rect x="31" y="70" width="10" height="10" transform="rotate(45 36 75)" fill="#b8281d" stroke="#5a0e09" strokeWidth="1.5" />
          <rect x="79" y="70" width="10" height="10" transform="rotate(45 84 75)" fill="#b8281d" stroke="#5a0e09" strokeWidth="1.5" />
        </svg>
      );
  }
}

/** Utilise l'image dessinée si elle existe, sinon le dessin en code. */
function useImagesPluie() {
  const [ok, setOk] = useState<Record<string, boolean>>({});
  useEffect(() => {
    for (const nom of [...OBJETS_PLUIE, 'couronne']) {
      const i = new Image();
      i.onload = () => setOk((m) => ({ ...m, [nom]: true }));
      i.src = `/cartes/pluie-${nom}.webp`;
    }
  }, []);
  return ok;
}

/** Célébration du Dernier Baron : la couronne tombe au centre de l'écran, puis pleuvent billets, diamants, lames et lingots. */
export function PluieVictoire() {
  const images = useImagesPluie();
  const [fini, setFini] = useState(false);
  const objets = useState(() =>
    Array.from({ length: 52 }, (_, i) => {
      const type = OBJETS_PLUIE[i % 4];
      return {
        type,
        x: Math.random() * 100,
        delai: 0.5 + Math.random() * 3.4,
        duree: 2.4 + Math.random() * 2.2,
        largeur: LARGEUR_OBJET[type] * (0.8 + Math.random() * 0.5),
        rot: (Math.random() * 2 - 1) * 540,
        derive: (Math.random() * 2 - 1) * 70,
      };
    }),
  )[0];
  useEffect(() => {
    const t = window.setTimeout(() => setFini(true), 8000);
    return () => window.clearTimeout(t);
  }, []);
  if (fini) return null;
  const dessin = (type: ObjetPluie | 'couronne') =>
    images[type] ? <img src={`/cartes/pluie-${type}.webp`} alt="" draggable={false} /> : <DessinObjet type={type} />;
  return (
    <div className="pluie" aria-hidden="true">
      <div className="pluie-couronne">{dessin('couronne')}</div>
      {objets.map((o, i) => (
        <span
          key={i}
          className="pluie-objet"
          style={
            {
              left: `${o.x}%`,
              width: o.largeur,
              '--delai': `${o.delai}s`,
              '--duree': `${o.duree}s`,
              '--rot': `${o.rot}deg`,
              '--derive': `${o.derive}px`,
            } as CSSProperties
          }
        >
          {dessin(o.type)}
        </span>
      ))}
    </div>
  );
}
