/**
 * Paramètres du Salon privé : le son, les animations et les célébrations des gains, la vibration, le rappel de pause,
 * la langue, l'aide, l'application et les notifications, le compte (déconnexion, suppression), les mentions.
 * Les réglages sont gardés sur cet appareil (reglages.ts) ; ceux du jeu de cartes y sont aussi (ils sont communs).
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { Appel } from './App';
import { EVT_REVOIR_ACCUEIL } from './CasinoHotel';
import type { EtatCompte } from './Profil';
import { changerReglages, Curseur, PAUSES, Segments, SectionAppli, useReglages, type Animations, type Pause } from './Reglages';
import { changerLangue, LANGUE, tr, type Langue } from './traduction';
import { Fenetre, IconeMusique, jouerEffet, useMusique } from './ui';

/** Le compte et la liaison au serveur, pour les Paramètres ouverts depuis n'importe quel menu du salon. */
export const ContexteSalon = createContext(null as { compte: EtatCompte; appel: Appel } | null);

const OUI_NON: ['oui' | 'non', string][] = [
  ['oui', tr('Activé', 'On')],
  ['non', tr('Désactivé', 'Off')],
];
const ANIMATIONS: [Animations, string][] = [
  ['auto', tr('Auto', 'Auto')],
  ['completes', tr('Complètes', 'Full')],
  ['reduites', tr('Réduites', 'Reduced')],
];
const nomPause = (p: Pause) => (p === 0 ? tr('Jamais', 'Never') : p < 60 ? `${p} min` : `${p / 60} h`);
const LANGUES: [Langue, string][] = [
  ['fr', 'Français'],
  ['en', 'English'],
];

/** L'icône des Paramètres : un engrenage doré dans un médaillon bordeaux. */
export function IconeParametres() {
  return (
    <svg className="icone-parametres" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id="pm-fond" cx="40%" cy="32%" r="70%">
          <stop offset="0" stopColor="#a3242b" />
          <stop offset="1" stopColor="#3c070c" />
        </radialGradient>
        <linearGradient id="pm-or" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="0.5" stopColor="#e3ac4f" />
          <stop offset="1" stopColor="#9c6a22" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22.5" fill="url(#pm-fond)" stroke="url(#pm-or)" strokeWidth="2.5" />
      <g transform="translate(24 24)" fill="url(#pm-or)">
        {Array.from({ length: 8 }, (_, k) => (
          <rect key={k} x="-3.2" y="-15" width="6.4" height="7" rx="1.2" transform={`rotate(${k * 45})`} />
        ))}
        <circle r="10.5" />
      </g>
      <circle cx="24" cy="24" r="4.6" fill="#3c070c" stroke="#ffe9a8" strokeWidth="1" />
    </svg>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="reglages-bloc pm-bloc">
      <h3 className="profil-sous-titre">{titre}</h3>
      {children}
    </section>
  );
}

/** La partie « Compte » : qui est connecté, se déconnecter, supprimer le compte (avec confirmation). */
function SectionCompte({ onFermer, onQuitter }: { onFermer: () => void; onQuitter: () => void }) {
  const ctx = useContext(ContexteSalon);
  const [confirmer, setConfirmer] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  if (!ctx) return null;
  const { compte, appel } = ctx;
  if (compte.invite || !compte.profil) {
    return (
      <Section titre={tr('Compte', 'Account')}>
        <p className="discret">
          {tr(
            'Tu joues en invité : ta progression est gardée sur cet appareil seulement. Crée un compte (gratuit) depuis l’accueil pour la retrouver partout.',
            'You are playing as a guest: your progress is kept on this device only. Create a free account from the home screen to find it everywhere.',
          )}
        </p>
      </Section>
    );
  }
  const p = compte.profil;
  const deconnecter = async () => {
    onFermer();
    await compte.module?.deconnecter();
    onQuitter();
  };
  const supprimer = async () => {
    setOccupe(true);
    setErreur(null);
    const r = await appel('supprimer_compte');
    setOccupe(false);
    if (!r.ok) return setErreur(r.erreur ?? tr('La suppression a échoué, réessaie plus tard.', 'Deletion failed, try again later.'));
    onFermer();
    await compte.module?.deconnecter();
    onQuitter();
  };
  return (
    <Section titre={tr('Compte', 'Account')}>
      <p className="pm-compte">
        <strong>{p.nom}</strong>
        {p.email && <small className="discret">{p.email}</small>}
      </p>
      <div className="rangee pm-actions">
        <button type="button" onClick={() => void deconnecter()}>
          {tr('Se déconnecter', 'Sign out')}
        </button>
        <button type="button" className="lien-discret" onClick={() => setConfirmer(true)}>
          {tr('Supprimer mon compte', 'Delete my account')}
        </button>
      </div>
      {confirmer && (
        <div className="confirmation" role="alertdialog" aria-label={tr('Supprimer le compte', 'Delete the account')}>
          <p>
            {tr(
              'Supprimer définitivement ton compte, ta fortune du salon, tes objets, ton album et ton historique ? C’est irréversible.',
              'Permanently delete your account, your lounge fortune, items, album and history? This cannot be undone.',
            )}
          </p>
          <div className="rangee">
            <button type="button" className="danger" disabled={occupe} onClick={() => void supprimer()}>
              {occupe ? tr('Un instant…', 'One moment…') : tr('Oui, supprimer', 'Yes, delete')}
            </button>
            <button type="button" disabled={occupe} onClick={() => setConfirmer(false)}>
              {tr('Annuler', 'Cancel')}
            </button>
          </div>
          {erreur && (
            <p className="message-erreur" role="alert">
              {erreur}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

export function FenetreParametres({ onFermer, onQuitter }: { onFermer: () => void; onQuitter: () => void }) {
  const r = useReglages();
  const [sonActif, basculerSon] = useMusique();
  const ctx = useContext(ContexteSalon);
  const avecCompte = !!ctx && !ctx.compte.invite && !!ctx.compte.profil;
  return (
    <Fenetre titre={tr('Paramètres', 'Settings')} onFermer={onFermer} large>
      <div className="pm">
        <Section titre={tr('Son', 'Sound')}>
          <button type="button" className="large bouton-menu-musique" onClick={basculerSon} aria-pressed={sonActif}>
            <IconeMusique active={sonActif} />
            {sonActif ? tr('Son activé', 'Sound on') : tr('Son coupé', 'Sound off')}
          </button>
          <Curseur id="pm-musique" libelle={tr('Musique', 'Music')} valeur={r.musique} desactive={!sonActif} onChange={(v) => changerReglages({ musique: v })} />
          <Curseur id="pm-effets" libelle={tr('Effets sonores', 'Sound effects')} valeur={r.effets} desactive={!sonActif} onChange={(v) => changerReglages({ effets: v })} onFin={() => jouerEffet('jeton')} />
        </Section>

        <Section titre={tr('Animations', 'Animations')}>
          <Segments libelle={tr('Animations', 'Animations')} valeur={r.animations} options={ANIMATIONS} onChoix={(v) => changerReglages({ animations: v })} />
          <p className="discret">
            {tr(
              'Auto suit le réglage « Réduire les animations » de ton téléphone. Réduites : les rouleaux, roues et scènes vont droit au résultat, sans mouvements.',
              'Auto follows your phone’s “Reduce motion” setting. Reduced: reels, wheels and scenes go straight to the result, without motion.',
            )}
          </p>
        </Section>

        <Section titre={tr('Célébrations des gains', 'Win celebrations')}>
          <Segments libelle={tr('Célébrations des gains', 'Win celebrations')} valeur={r.celebrations ? 'oui' : 'non'} options={OUI_NON} onChoix={(v) => changerReglages({ celebrations: v === 'oui' })} />
          <p className="discret">{tr('Les pluies de billets et de lingots quand tu gagnes gros.', 'The showers of banknotes and gold bars when you win big.')}</p>
        </Section>

        <Section titre={tr('Vibrations', 'Vibration')}>
          <Segments
            libelle={tr('Vibrations', 'Vibration')}
            valeur={r.vibration ? 'oui' : 'non'}
            options={OUI_NON}
            onChoix={(v) => {
              changerReglages({ vibration: v === 'oui' });
              if (v === 'oui') navigator.vibrate?.([40, 50, 40]);
            }}
          />
          <p className="discret">
            {tr(
              'Le téléphone vibre à tes gains et quand c’est à toi de jouer (sur Android : l’iPhone et l’iPad ne permettent pas aux sites de vibrer).',
              'Your phone vibrates on wins and when it’s your turn (on Android: iPhone and iPad don’t let websites vibrate).',
            )}
          </p>
        </Section>

        <Section titre={tr('Rappel de pause', 'Break reminder')}>
          <Segments libelle={tr('Rappel de pause', 'Break reminder')} valeur={String(r.pause)} options={PAUSES.map((p) => [String(p), nomPause(p)] as [string, string])} onChoix={(v) => changerReglages({ pause: Number(v) as Pause })} />
          <p className="discret">{tr('Un petit mot du Baron quand tu joues depuis ce temps-là sans t’arrêter.', 'A short note from the Baron once you’ve played this long without a break.')}</p>
        </Section>

        <Section titre={tr('Langue', 'Language')}>
          <Segments libelle={tr('Langue', 'Language')} valeur={LANGUE} options={LANGUES} onChoix={(l) => changerLangue(l)} />
        </Section>

        <Section titre={tr('Aide', 'Help')}>
          <button
            type="button"
            className="large"
            onClick={() => {
              onFermer();
              window.dispatchEvent(new Event(EVT_REVOIR_ACCUEIL));
            }}
          >
            {tr('Revoir l’accueil du Groom', 'See the Bellboy’s welcome again')}
          </button>
        </Section>

        <SectionAppli avecCompte={avecCompte} />
        <SectionCompte onFermer={onFermer} onQuitter={onQuitter} />

        <p className="reglages-liens">
          <a href="/confidentialite" target="_blank" rel="noopener">
            {tr('Confidentialité et mentions légales', 'Privacy and legal notice')}
          </a>
        </p>
        <p className="cas-mention">{tr('Argent fictif, sans aucune valeur réelle : rien ne s’achète ni ne se retire en argent réel.', 'Play money, with no real value: nothing can be bought or withdrawn for real money.')}</p>
      </div>
    </Fenetre>
  );
}

const CLE_DEBUT = 'bf-session-debut';
const debutSession = () => {
  try {
    const d = Number(sessionStorage.getItem(CLE_DEBUT));
    if (d > 0) return d;
    const n = Date.now();
    sessionStorage.setItem(CLE_DEBUT, String(n));
    return n;
  } catch {
    return Date.now();
  }
};
const repartir = () => {
  try {
    sessionStorage.setItem(CLE_DEBUT, String(Date.now()));
  } catch {
    /* le rappel repartira de l'ouverture de la page */
  }
};

/** Le rappel de pause : après le temps choisi dans les Paramètres, le Baron propose une pause. */
export function RappelPause({ onQuitter }: { onQuitter: () => void }) {
  const { pause } = useReglages();
  const [debut, setDebut] = useState(debutSession);
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    if (!pause) return;
    const verifier = () => {
      if (Date.now() - debut >= pause * 60_000) setOuvert(true);
    };
    verifier();
    const id = window.setInterval(verifier, 20_000);
    return () => window.clearInterval(id);
  }, [pause, debut]);
  if (!ouvert || !pause) return null;
  const minutes = Math.round((Date.now() - debut) / 60_000);
  const duree = minutes >= 60 ? tr(`${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`, `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`) : `${minutes} min`;
  const continuer = () => {
    repartir();
    setDebut(Date.now());
    setOuvert(false);
  };
  return (
    <Fenetre titre={tr('Une petite pause ?', 'Time for a break?')} onFermer={continuer}>
      <div className="pm-pause">
        <p>
          {tr(`Tu joues depuis ${duree}. Le Baron te conseille de te dégourdir les jambes : le salon t’attendra.`, `You’ve been playing for ${duree}. The Baron suggests stretching your legs: the lounge will wait for you.`)}
        </p>
        <div className="rangee">
          <button type="button" className="principal" onClick={continuer}>
            {tr('Continuer à jouer', 'Keep playing')}
          </button>
          <button
            type="button"
            onClick={() => {
              repartir();
              onQuitter();
            }}
          >
            {tr('Quitter le salon', 'Leave the lounge')}
          </button>
        </div>
        <p className="discret">{tr('Tu peux changer ce rappel dans les Paramètres.', 'You can change this reminder in Settings.')}</p>
      </div>
    </Fenetre>
  );
}
