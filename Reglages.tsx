import { useEffect, useState } from 'react';
import { activerNotifications, desactiverNotifications, estIos, useInstallation, useNotifications, type EtatNotifications } from './appli';
import { abonnerReglages, changerReglages, lireReglages, type Reglages, type TailleCartes, type Vitesse } from './reglages';
import { Fenetre, IconeMusique, jouerEffet, useMusique } from './ui';

export function useReglages(): Reglages {
  const [r, setR] = useState(lireReglages());
  useEffect(() => abonnerReglages(setR), []);
  return r;
}

const VITESSES: [Vitesse, string][] = [
  ['lente', 'Lente'],
  ['normale', 'Normale'],
  ['rapide', 'Rapide'],
];
const TAILLES: [TailleCartes, string][] = [
  ['normale', 'Normale'],
  ['grande', 'Grande'],
  ['tres_grande', 'Très grande'],
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
      <output htmlFor={id}>{valeur === 0 ? 'Coupé' : `${valeur} %`}</output>
    </div>
  );
}

/** Marche à suivre pour ajouter le jeu à l'écran d'accueil quand le navigateur ne le propose pas lui-même. */
export function AideInstallation({ etat }: { etat: ReturnType<typeof useInstallation>['etat'] }) {
  if (etat === 'ios') {
    return (
      <ol className="etapes-installation">
        <li>
          Touche le bouton <strong>Partager</strong> <IconePartager /> de Safari (en bas sur iPhone, en haut sur iPad).
        </li>
        <li>
          Choisis <strong>« Sur l’écran d’accueil »</strong> (fais défiler la liste si besoin), puis <strong>Ajouter</strong>.
        </li>
        <li>Ouvre ensuite le jeu avec sa nouvelle icône : il s’affiche en plein écran.</li>
      </ol>
    );
  }
  if (etat === 'mac') return <p className="discret">Dans Safari, menu <strong>Fichier → Ajouter au Dock</strong>.</p>;
  return <p className="discret">Ton navigateur ne propose pas l’installation. Ouvre le jeu dans Chrome, Edge ou Safari pour l’ajouter à ton écran d’accueil.</p>;
}

function IconePartager() {
  return (
    <svg className="icone-partager" viewBox="0 0 24 24" aria-label="(carré avec une flèche vers le haut)" role="img">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M8 10H6v10h12V10h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TEXTE_NOTIFS: Record<EtatNotifications, string> = {
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
  return (
    <>
      <section className="reglages-bloc reglages-app">
        <h3 className="profil-sous-titre">Application</h3>
        {etat === 'installe' ? (
          <p className="discret">✓ Le jeu est installé sur cet appareil : ouvre-le depuis son icône, en plein écran.</p>
        ) : (
          <>
            <p className="discret">Ajoute le jeu à ton écran d’accueil : il s’ouvre en plein écran, comme une application, et se lance plus vite.</p>
            {etat === 'proposer' ? (
              <button type="button" className="principal large" onClick={() => void installer()}>
                Installer le jeu
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
          <p className="discret">Connecte-toi à ton compte pour recevoir les invitations de tes amis.</p>
        )}
        {peutBasculer && (
          <button type="button" className={notifs === 'actives' ? 'large' : 'principal large'} disabled={occupe} onClick={() => void basculer()}>
            {occupe ? 'Un instant…' : notifs === 'actives' ? 'Désactiver les notifications' : 'Activer les notifications'}
          </button>
        )}
        {erreur && (
          <p className="message-erreur" role="alert">
            {erreur}
          </p>
        )}
        {notifs === 'installer' && estIos() && <p className="discret">Astuce : regarde la section « Application » juste au-dessus.</p>}
      </section>
    </>
  );
}

/** Réglages : son, vitesse des ordinateurs, taille des cartes, application et notifications. */
export function FenetreReglages({ onFermer, enPartie, avecCompte = false }: { onFermer: () => void; enPartie?: boolean; avecCompte?: boolean }) {
  const r = useReglages();
  const [sonActif, basculerSon] = useMusique();
  return (
    <Fenetre titre="Réglages" onFermer={onFermer} large>
      <section className="reglages-bloc">
        <h3 className="profil-sous-titre">Son</h3>
        <button type="button" className="large bouton-menu-musique" onClick={basculerSon} aria-pressed={sonActif}>
          <IconeMusique active={sonActif} />
          {sonActif ? 'Son activé' : 'Son coupé'}
        </button>
        <Curseur id="vol-musique" libelle="Musique" valeur={r.musique} desactive={!sonActif} onChange={(v) => changerReglages({ musique: v })} />
        <Curseur id="vol-effets" libelle="Effets sonores" valeur={r.effets} desactive={!sonActif} onChange={(v) => changerReglages({ effets: v })} onFin={() => jouerEffet('carte')} />
      </section>
      <section className="reglages-bloc">
        <h3 className="profil-sous-titre">Vitesse des ordinateurs</h3>
        <Segments libelle="Vitesse des ordinateurs" valeur={r.vitesse} options={VITESSES} onChoix={(v) => changerReglages({ vitesse: v })} />
        <p className="discret">Dans tes parties privées et le tutoriel. Les parties en ligne gardent la vitesse normale.</p>
      </section>
      <section className="reglages-bloc">
        <h3 className="profil-sous-titre">Taille des cartes</h3>
        <Segments libelle="Taille des cartes" valeur={r.cartes} options={TAILLES} onChoix={(v) => changerReglages({ cartes: v })} />
        <div className="apercu-taille" aria-hidden="true">
          <img src="/cartes/baron.webp" alt="" />
          <img src="/cartes/diamants_07.webp" alt="" />
          <img src="/cartes/chat_noir_05.webp" alt="" />
        </div>
        <p className="discret">
          {enPartie ? 'Ta main et les cartes du pli changent tout de suite.' : 'Pour ta main et les cartes du pli, pendant les parties.'} Sur un petit
          téléphone, la table défile un peu en « Grande » et « Très grande ».
        </p>
      </section>
      {!enPartie && <SectionAppli avecCompte={avecCompte} />}
      <p className="reglages-liens">
        <a href="/confidentialite" target="_blank" rel="noopener">
          Confidentialité et mentions légales
        </a>
      </p>
    </Fenetre>
  );
}
