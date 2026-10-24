import { useEffect, useState } from 'react';
import { activerNotifications, desactiverNotifications, estIos, useInstallation, useNotifications, type EtatNotifications } from './appli';
import { abonnerReglages, changerReglages, lireReglages, type Reglages, type TailleCartes, type Vitesse } from './reglages';
import { Fenetre, IconeMusique, jouerEffet, useMusique } from './ui';
import { changerLangue, EN, LANGUE, tr, type Langue } from './traduction';

export function useReglages(): Reglages {
  const [r, setR] = useState(lireReglages());
  useEffect(() => abonnerReglages(setR), []);
  return r;
}

const VITESSES: [Vitesse, string][] = [
  ['lente', tr('Lente', 'Slow')],
  ['normale', tr('Normale', 'Normal')],
  ['rapide', tr('Rapide', 'Fast')],
];
const TAILLES: [TailleCartes, string][] = [
  ['normale', tr('Normale', 'Normal')],
  ['grande', tr('Grande', 'Large')],
  ['tres_grande', tr('Très grande', 'Extra large')],
];
const LANGUES: [Langue, string][] = [
  ['fr', 'Français'],
  ['en', 'English'],
];

function Segments<T extends string>({ valeur, options, onChoix, libelle }: { valeur: T; options: [T, string][]; onChoix: (v: T) => void; libelle: string }) {
  return (
    <div className="segments" role="radiogroup" aria-label={libelle}>
      {options.map(([v, texte]) => (
        <button key={v} type="button" role="radio" aria-checked={valeur === v} className={valeur === v ? 'choisi' : ''} onClick={() => onChoix(v)}>
          {texte}
        </button>
      ))}
    </div>
  );
}

function Curseur({ id, libelle, valeur, desactive, onChange, onFin }: { id: string; libelle: string; valeur: number; desactive?: boolean; onChange: (v: number) => void; onFin?: () => void }) {
  return (
    <div className={`curseur ${desactive ? 'desactive' : ''}`}>
      <label htmlFor={id}>{libelle}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={valeur}
        disabled={desactive}
        style={{ '--pct': `${valeur}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onFin}
        onKeyUp={onFin}
      />
      <output htmlFor={id}>{valeur === 0 ? tr('Coupé', 'Off') : `${valeur} %`}</output>
    </div>
  );
}

/** Marche à suivre pour ajouter le jeu à l'écran d'accueil quand le navigateur ne le propose pas lui-même. */
export function AideInstallation({ etat }: { etat: ReturnType<typeof useInstallation>['etat'] }) {
  if (etat === 'ios') {
    return (
      <ol className="etapes-installation">
        <li>
          {tr('Touche le bouton ', 'Tap the ')}
          <strong>{tr('Partager', 'Share')}</strong> <IconePartager /> {tr('de Safari (en bas sur iPhone, en haut sur iPad).', 'button in Safari (at the bottom on iPhone, at the top on iPad).')}
        </li>
        <li>
          {tr('Choisis ', 'Choose ')}
          <strong>{tr('« Sur l’écran d’accueil »', '“Add to Home Screen”')}</strong> {tr('(fais défiler la liste si besoin), puis ', '(scroll the list if needed), then ')}
          <strong>{tr('Ajouter', 'Add')}</strong>.
        </li>
        <li>{tr('Ouvre ensuite le jeu avec sa nouvelle icône : il s’affiche en plein écran.', 'Then open the game from its new icon: it runs full screen.')}</li>
      </ol>
    );
  }
  if (etat === 'mac') {
    return (
      <p className="discret">
        {tr('Dans Safari, menu ', 'In Safari, menu ')}
        <strong>{tr('Fichier → Ajouter au Dock', 'File → Add to Dock')}</strong>.
      </p>
    );
  }
  return (
    <p className="discret">
      {tr(
        'Ton navigateur ne propose pas l’installation. Ouvre le jeu dans Chrome, Edge ou Safari pour l’ajouter à ton écran d’accueil.',
        'Your browser does not offer installation. Open the game in Chrome, Edge or Safari to add it to your home screen.',
      )}
    </p>
  );
}

function IconePartager() {
  return (
    <svg className="icone-partager" viewBox="0 0 24 24" aria-label={tr('(carré avec une flèche vers le haut)', '(square with an up arrow)')} role="img">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M8 10H6v10h12V10h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TEXTE_NOTIFS_EN: Record<EtatNotifications, string> = {
  serveur: 'Notifications are not available right now.',
  indisponible: 'This browser cannot receive notifications.',
  installer: 'On iPhone and iPad, notifications only work once the game is installed on the home screen (iOS 16.4 or later). Install it first, then come back here from its icon.',
  refusees: 'Notifications are blocked for this game. Allow them in your phone (or browser) settings, then come back here.',
  actives: 'On for this device: when a friend invites you, you get a notification, even with the game closed.',
  inactives: 'Get a notification when a friend invites you to their table, even when the game is closed.',
};

const TEXTE_NOTIFS_FR: Record<EtatNotifications, string> = {
  serveur: 'Les notifications ne sont pas disponibles pour le moment.',
  indisponible: 'Ce navigateur ne sait pas recevoir de notifications.',
  installer: 'Sur iPhone et iPad, les notifications marchent seulement une fois le jeu installé sur l’écran d’accueil (iOS 16.4 ou plus récent). Installe-le d’abord, puis reviens ici depuis son icône.',
  refusees: 'Les notifications sont bloquées pour ce jeu. Autorise-les dans les réglages de ton téléphone (ou de ton navigateur), puis reviens ici.',
  actives: 'Activées sur cet appareil : quand un ami t’invite, tu reçois une notification, même jeu fermé.',
  inactives: 'Reçois une notification quand un ami t’invite à sa table, même quand le jeu est fermé.',
};

/** Installer le jeu comme une application, et recevoir les invitations par notification. */
function SectionAppli({ avecCompte }: { avecCompte: boolean }) {
  const { etat, installer } = useInstallation();
  const [notifs, setNotifs] = useNotifications();
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const basculer = async () => {
    setErreur(null);
    setOccupe(true);
    if (notifs === 'actives') setNotifs(await desactiverNotifications());
    else {
      const r = await activerNotifications();
      setNotifs(r.etat);
      if (r.erreur) setErreur(r.erreur);
    }
    setOccupe(false);
  };
  const peutBasculer = avecCompte && (notifs === 'actives' || notifs === 'inactives');
  const TEXTE_NOTIFS = EN ? TEXTE_NOTIFS_EN : TEXTE_NOTIFS_FR;
  return (
    <>
      <section className="reglages-bloc reglages-app">
        <h3 className="profil-sous-titre">{tr('Application', 'App')}</h3>
        {etat === 'installe' ? (
          <p className="discret">{tr('✓ Le jeu est installé sur cet appareil : ouvre-le depuis son icône, en plein écran.', '✓ The game is installed on this device: open it from its icon, full screen.')}</p>
        ) : (
          <>
            <p className="discret">
              {tr(
                'Ajoute le jeu à ton écran d’accueil : il s’ouvre en plein écran, comme une application, et se lance plus vite.',
                'Add the game to your home screen: it opens full screen, like an app, and launches faster.',
              )}
            </p>
            {etat === 'proposer' ? (
              <button type="button" className="principal large" onClick={() => void installer()}>
                {tr('Installer le jeu', 'Install the game')}
              </button>
            ) : (
              <AideInstallation etat={etat} />
            )}
          </>
        )}
      </section>
      <section className="reglages-bloc reglages-app">
        <h3 className="profil-sous-titre">Notifications</h3>
        <p className="discret">{notifs ? TEXTE_NOTIFS[notifs] : '…'}</p>
        {notifs && !avecCompte && notifs !== 'serveur' && notifs !== 'indisponible' && (
          <p className="discret">{tr('Connecte-toi à ton compte pour recevoir les invitations de tes amis.', 'Sign in to your account to receive invitations from your friends.')}</p>
        )}
        {peutBasculer && (
          <button type="button" className={notifs === 'actives' ? 'large' : 'principal large'} disabled={occupe} onClick={() => void basculer()}>
            {occupe ? tr('Un instant…', 'One moment…') : notifs === 'actives' ? tr('Désactiver les notifications', 'Turn off notifications') : tr('Activer les notifications', 'Turn on notifications')}
          </button>
        )}
        {erreur && (
          <p className="message-erreur" role="alert">
            {erreur}
          </p>
        )}
        {notifs === 'installer' && estIos() && <p className="discret">{tr('Astuce : regarde la section « Application » juste au-dessus.', 'Tip: see the “App” section just above.')}</p>}
      </section>
    </>
  );
}

/** Réglages : son, vitesse des ordinateurs, taille des cartes, application et notifications. */
export function FenetreReglages({ onFermer, enPartie, avecCompte = false }: { onFermer: () => void; enPartie?: boolean; avecCompte?: boolean }) {
  const r = useReglages();
  const [sonActif, basculerSon] = useMusique();
  return (
    <Fenetre titre={tr('Réglages', 'Settings')} onFermer={onFermer} large>
      <section className="reglages-bloc">
        <h3 className="profil-sous-titre">{tr('Langue', 'Language')}</h3>
        <Segments libelle={tr('Langue', 'Language')} valeur={LANGUE} options={LANGUES} onChoix={(l) => changerLangue(l)} />
      </section>
      <section className="reglages-bloc">
        <h3 className="profil-sous-titre">{tr('Son', 'Sound')}</h3>
        <button type="button" className="large bouton-menu-musique" onClick={basculerSon} aria-pressed={sonActif}>
          <IconeMusique active={sonActif} />
          {sonActif ? tr('Son activé', 'Sound on') : tr('Son coupé', 'Sound off')}
        </button>
        <Curseur id="vol-musique" libelle={tr('Musique', 'Music')} valeur={r.musique} desactive={!sonActif} onChange={(v) => changerReglages({ musique: v })} />
        <Curseur id="vol-effets" libelle={tr('Effets sonores', 'Sound effects')} valeur={r.effets} desactive={!sonActif} onChange={(v) => changerReglages({ effets: v })} onFin={() => jouerEffet('carte')} />
      </section>
      <section className="reglages-bloc">
        <h3 className="profil-sous-titre">{tr('Vitesse des ordinateurs', 'Computer speed')}</h3>
        <Segments libelle={tr('Vitesse des ordinateurs', 'Computer speed')} valeur={r.vitesse} options={VITESSES} onChoix={(v) => changerReglages({ vitesse: v })} />
        <p className="discret">{tr('Dans tes parties privées et le tutoriel. Les parties en ligne gardent la vitesse normale.', 'In your private games and the tutorial. Online games keep the normal speed.')}</p>
      </section>
      <section className="reglages-bloc">
        <h3 className="profil-sous-titre">{tr('Taille des cartes', 'Card size')}</h3>
        <Segments libelle={tr('Taille des cartes', 'Card size')} valeur={r.cartes} options={TAILLES} onChoix={(v) => changerReglages({ cartes: v })} />
        <div className="apercu-taille" aria-hidden="true">
          <img src="/cartes/baron.webp" alt="" />
          <img src="/cartes/diamants_07.webp" alt="" />
          <img src="/cartes/chat_noir_05.webp" alt="" />
        </div>
        <p className="discret">
          {enPartie
            ? tr('Ta main et les cartes du pli changent tout de suite.', 'Your hand and the trick cards change right away.')
            : tr('Pour ta main et les cartes du pli, pendant les parties.', 'For your hand and the trick cards, during games.')}{' '}
          {tr('Sur un petit téléphone, la table défile un peu en « Grande » et « Très grande ».', 'On a small phone, the table scrolls a little in “Large” and “Extra large”.')}
        </p>
      </section>
      {!enPartie && <SectionAppli avecCompte={avecCompte} />}
      <p className="reglages-liens">
        <a href="/confidentialite" target="_blank" rel="noopener">
          {tr('Confidentialité et mentions légales', 'Privacy and legal notice')}
        </a>
      </p>
    </Fenetre>
  );
}
