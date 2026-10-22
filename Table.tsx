import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CARTE } from '../../shared/cartes';
import type { Action, Vue, VueJoueur, VueSalon } from '../../shared/types';
import type { Appel } from './App';
import { BadgeNiveau, BarreXp, detailXp } from './Profil';
import { EFFET_EVENEMENT, NOM_EVENEMENT, NOM_FAMILLE, REGLES, infoCarte, trierMain } from './textes';
import { Avatar, Butin, CarteImg, Chat, Fenetre, Pastille, Zoom, useMinuteur } from './ui';

type ActionSansJoueur = { [K in Action['type']]: Omit<Extract<Action, { type: K }>, 'joueurId'> }[Action['type']];

const PHASES_DEBUT = ['TRAHISON', 'ANNONCES', 'ALLIANCE'];

/** Places des adversaires autour de la table, dans l'ordre du jeu en partant de la gauche du joueur. */
const PLACES: Record<number, string[]> = {
  1: ['haut'],
  2: ['haut-gauche', 'haut-droite'],
  3: ['gauche', 'haut', 'droite'],
  4: ['gauche', 'haut-gauche', 'haut-droite', 'droite'],
  5: ['gauche', 'haut-gauche', 'haut', 'haut-droite', 'droite'],
};

/** Particules dorées qui montent doucement derrière la table. */
const PARTICULES = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 53) % 100,
  taille: 3 + (i % 4) * 2,
  duree: 10 + (i % 7) * 2,
  delai: -(i * 1.9),
}));
function Particules() {
  return (
    <div className="particules" aria-hidden="true">
      {PARTICULES.map((p, i) => (
        <span key={i} style={{ left: `${p.x}%`, width: p.taille, height: p.taille, animationDuration: `${p.duree}s`, animationDelay: `${p.delai}s` }} />
      ))}
    </div>
  );
}

export function Table({ salon, appel, quitter }: { salon: VueSalon; appel: Appel; quitter: () => void }) {
  const v = salon.partie as Vue;
  const moi = v.joueurs.find((j) => j.id === v.moi) as VueJoueur;
  const estHote = salon.hoteId === v.moi;
  const [selection, setSelection] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [fenetre, setFenetre] = useState<'scores' | 'regles' | 'menu' | 'journal' | 'quitter' | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const fraction = useMinuteur(salon.tempsRestant, salon.dureeTour);

  useEffect(() => setSelection(null), [v.phase, v.nuit, v.main.length, v.tourId]);

  // Révélation de l'événement : la carte tourbillonne au centre de l'écran pendant 5 secondes.
  const [revelation, setRevelation] = useState<string | null>(null);
  const dejaVu = useRef<string | null>(null);
  useEffect(() => {
    if (!v.evenementId || v.phase !== 'ANNONCES') return;
    const cle = `${v.nuit}-${v.evenementId}`;
    if (dejaVu.current === cle) return;
    dejaVu.current = cle;
    setRevelation(v.evenementId);
    const t = window.setTimeout(() => setRevelation(null), 5000);
    return () => window.clearTimeout(t);
  }, [v.nuit, v.evenementId, v.phase]);

  const nom = (id: string | null | undefined) => v.joueurs.find((j) => j.id === id)?.nom ?? '?';
  const monCompte = salon.joueurs.find((j) => j.id === v.moi)?.compte ?? null;
  const avatarDe = (id: string) => salon.joueurs.find((j) => j.id === id)?.avatar ?? 1;
  const agir = async (action: ActionSansJoueur) => {
    if (envoi) return;
    setEnvoi(true);
    await appel('action', action);
    setEnvoi(false);
    setSelection(null);
  };

  const main = useMemo(() => trierMain(v.main), [v.main]);
  const siege = v.joueurs.findIndex((j) => j.id === v.moi);
  const autres = [...v.joueurs.slice(siege + 1), ...v.joueurs.slice(0, siege)];
  const voisinDroite = v.joueurs[(siege - 1 + v.joueurs.length) % v.joueurs.length];
  const places = PLACES[autres.length] ?? [];
  const parPlace: Record<string, VueJoueur> = Object.fromEntries(autres.map((j, i) => [places[i], j]));
  const haut = ['haut-gauche', 'haut', 'haut-droite'].filter((p) => parPlace[p]).map((p) => parPlace[p]);
  const gauche = parPlace.gauche;
  const droite = parPlace.droite;
  const attendus = v.attente.filter((id) => id !== v.moi).map(nom);
  const attenteTexte = attendus.length ? `En attente de ${attendus.join(', ')}.` : '';
  const monTour = v.tourId === v.moi;
  const aMoi = v.attente.includes(v.moi) && v.phase !== 'FIN_DE_NUIT' && v.phase !== 'FIN_DE_PARTIE';
  const secondes = fraction === null ? null : Math.ceil((fraction * salon.dureeTour) / 1000);
  const pliAffiche =
    v.pli.length > 0 ? null : v.dernierPli && (v.phase === 'FIN_DE_PLI' || (v.phase === 'VOL' && v.vol?.source === 'baron')) ? v.dernierPli : null;
  const plisJoues = v.joueurs.reduce((s, j) => s + j.plis, 0);

  const toucherCarte = (id: string, jouable: boolean) => {
    if (v.phase === 'TRAHISON' && !v.aChoisiTrahison) return setSelection(id);
    if (v.phase === 'PLI' && monTour && jouable) return setSelection(selection === id ? null : id);
    setZoom(id);
  };
  const siegeDe = (j: VueJoueur) => (
    <Siege key={j.id} j={j} v={v} salon={salon} estHote={estHote} appel={appel} nom={nom} fraction={fraction} avatar={avatarDe(j.id)} />
  );
  const chevauchement = main.length > 6 ? -0.56 : -0.42;

  return (
    <div className="plateau">
      <Particules />
      <header className="barre">
        <div className="nuit">
          <span className="etiquette">Nuit</span>
          <strong>
            {v.nuit}/{v.nbNuits}
          </strong>
        </div>
        {v.evenement && v.evenementId ? (
          <button type="button" className="evenement" onClick={() => setZoom(v.evenementId)}>
            <img src={infoCarte(v.evenementId).image} alt="" />
            <span>
              <strong>{NOM_EVENEMENT[v.evenement]}</strong>
              <small>{EFFET_EVENEMENT[v.evenement]}</small>
            </span>
          </button>
        ) : (
          <div className="evenement vide-evenement">{v.nuit === 1 || v.nuit === v.nbNuits ? 'Pas d’événement cette nuit' : ''}</div>
        )}
        <div className="barre-boutons">
          <button type="button" className="petit icone" onClick={() => setFenetre('scores')} aria-label="Scores">
            🏆<span className="libelle"> Scores</span>
          </button>
          <button type="button" className="petit icone" onClick={() => setFenetre('regles')} aria-label="Règles">
            📜<span className="libelle"> Règles</span>
          </button>
          <Chat salon={salon} appel={appel} enLigne />
          <button type="button" className="petit icone" onClick={() => setFenetre('menu')} aria-label="Menu">
            ⋯
          </button>
        </div>
      </header>

      {haut.length > 0 && <div className="rangee-haut">{haut.map(siegeDe)}</div>}

      <div className={`milieu ${gauche || droite ? '' : 'sans-cotes'}`}>
        {(gauche || droite) && <div className="cote">{gauche && siegeDe(gauche)}</div>}
        <section className="centre" aria-label="Pli en cours">
          <div className="centre-tete">
            {pliAffiche ? (
              <span>
                <strong>{pliAffiche.gagnantId === v.moi ? 'Tu remportes' : `${nom(pliAffiche.gagnantId)} remporte`}</strong> le pli
                {pliAffiche.braquage ? ' : Braquage !' : ''}
              </span>
            ) : v.pli.length > 0 ? (
              v.familleDemandee ? (
                <span>
                  Demandé : <strong>{NOM_FAMILLE[v.familleDemandee]}</strong>
                </span>
              ) : (
                <span>Pas encore de famille demandée</span>
              )
            ) : v.phase === 'PLI' ? (
              <span>{v.ouvreurId === v.moi ? 'Tu ouvres le pli' : `${nom(v.ouvreurId)} ouvre le pli`}</span>
            ) : PHASES_DEBUT.includes(v.phase) ? (
              <span>
                {v.nuit} pli{v.nuit > 1 ? 's' : ''} · {v.premierId === v.moi ? 'tu commences' : `${nom(v.premierId)} commence`}
              </span>
            ) : (
              <span>
                Pli {Math.min(plisJoues + 1, v.nuit)}/{v.nuit}
              </span>
            )}
          </div>
          <div className="centre-table">
            <svg className={`anneau ${v.phase === 'PLI' ? 'tourne' : ''}`} viewBox="0 0 200 200" aria-hidden="true">
              <defs>
                <marker id="pointe" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
                </marker>
              </defs>
              <path d="M143 25.5 A86 86 0 0 1 174.5 143" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" markerEnd="url(#pointe)" />
              <path d="M57 174.5 A86 86 0 0 1 25.5 57" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" markerEnd="url(#pointe)" />
            </svg>
            <div className="pli-pile">
              {(pliAffiche ? pliAffiche.cartes : v.pli).map((p, i) => {
                // Pile verticale : chaque carte se pose un peu plus bas, légèrement de travers, comme sur une vraie table.
                const style = { '--r': `${(i % 2 ? 1 : -1) * (1.5 + (i % 3))}deg`, '--x': `${((i * 37) % 13) - 6}px`, zIndex: i + 1 } as React.CSSProperties;
                const gagnante = !!pliAffiche && p.joueurId === pliAffiche.gagnantId;
                return (
                  <div key={p.carteId} className={`pli-carte ${gagnante ? 'gagnante-pli' : ''}`} style={style}>
                    <CarteImg id={p.carteId} taille="pli" etat={gagnante ? 'gagnante' : undefined} onZoom={setZoom} />
                    <span className="pli-nom" title={p.joueurId === v.moi ? 'Toi' : nom(p.joueurId)}>
                      {p.joueurId === v.moi ? 'Toi' : nom(p.joueurId)}
                      {p.valeurCroupier !== undefined ? ` · ${p.valeurCroupier}` : ''}
                    </span>
                  </div>
                );
              })}
              {!pliAffiche && v.pli.length === 0 && <div className="pli-vide">Le pli est vide</div>}
            </div>
          </div>
          <ol className="centre-journal" aria-label="Dernières actions">
            {v.journal
              .slice(-2)
              .reverse()
              .map((e, i) => (
                <li key={e.n} style={{ opacity: 1 - i * 0.35 }}>
                  {e.texte}
                </li>
              ))}
          </ol>
        </section>
        {(gauche || droite) && <div className="cote">{droite && siegeDe(droite)}</div>}
      </div>

      <section className={`ma-zone ${aMoi ? 'a-moi' : ''}`} aria-label="Ta place">
        <div className={`consigne ${aMoi ? 'a-toi' : ''}`} aria-live="polite">
          <Consigne v={v} selection={selection} agir={agir} nom={nom} droiteNom={voisinDroite.nom} attenteTexte={attenteTexte} envoi={envoi} />
        </div>
        <div className="moi-bandeau">
          <Avatar n={avatarDe(v.moi)} grand fraction={aMoi ? fraction : null} />
          <div className="moi-texte">
            <div className="moi-nom">
              <strong>{moi.nom}</strong>
              {monCompte && <BadgeNiveau niveau={monCompte.niveau} titre={monCompte.titre} />}
              {aMoi && <span className="votre-tour">Votre tour</span>}
              {v.premierId === v.moi && PHASES_DEBUT.includes(v.phase) && <span className="badge or">Tu commences</span>}
            </div>
            {aMoi && fraction !== null && (
              <div className={`minuteur ${fraction < 0.25 ? 'urgent' : ''}`}>
                <div className="minuteur-barre" role="progressbar" aria-label="Temps restant" aria-valuemin={0} aria-valuemax={30} aria-valuenow={secondes ?? 0}>
                  <span style={{ width: `${fraction * 100}%` }} />
                </div>
                <small>{secondes} s</small>
              </div>
            )}
            <div className="moi-stats">
              {v.monAnnonce !== null ? `Annonce ${v.monAnnonce}` : 'Pas encore annoncé'} · {moi.plis} pli{moi.plis > 1 ? 's' : ''} · {moi.score} pts
            </div>
            {v.choixAllies && <ChoixAllie v={v} id={v.moi} nom={nom} />}
            <Butin ids={moi.butin} />
          </div>
        </div>
        <div className="eventail" style={{ '--chev': chevauchement } as React.CSSProperties} aria-label="Ta main">
          {main.map((c, i) => {
            const d = i - (main.length - 1) / 2;
            const style = { '--r': `${d * 4}deg`, '--y': `${d * d * 2.2}px`, zIndex: i + 1 } as React.CSSProperties;
            return (
              <div key={c.id} className={`eventail-carte ${selection === c.id ? 'levee' : ''}`} style={style}>
                <CarteImg
                  id={c.id}
                  etat={selection === c.id ? 'choisie' : v.phase === 'PLI' && monTour ? (c.jouable ? 'jouable' : 'grisee') : undefined}
                  onToucher={() => toucherCarte(c.id, c.jouable)}
                  onZoom={setZoom}
                />
              </div>
            );
          })}
          {main.length === 0 && <p className="discret">Plus de carte en main.</p>}
        </div>
      </section>

      {v.phase === 'FIN_DE_NUIT' && <RecapNuit v={v} nom={nom} estHote={estHote} agir={agir} secondes={secondes} />}
      {v.phase === 'FIN_DE_PARTIE' && <FinDePartie v={v} salon={salon} estHote={estHote} appel={appel} quitter={quitter} nom={nom} />}
      {fenetre === 'scores' && (
        <Fenetre titre="Scores" onFermer={() => setFenetre(null)} large>
          <TableauScores v={v} />
        </Fenetre>
      )}
      {fenetre === 'regles' && (
        <Fenetre titre="Règles" onFermer={() => setFenetre(null)} large>
          {REGLES.map((r) => (
            <section key={r.titre} className="regle">
              <h3>{r.titre}</h3>
              {r.texte.map((t) => (
                <p key={t}>{t}</p>
              ))}
            </section>
          ))}
          <p className="discret">Astuce : un appui long sur une carte l’affiche en grand avec son effet. Chaque joueur a 30 secondes pour agir.</p>
        </Fenetre>
      )}
      {fenetre === 'menu' && (
        <Fenetre titre="Menu" onFermer={() => setFenetre(null)}>
          <button type="button" className="large" onClick={() => setFenetre('journal')}>
            Journal de la partie
          </button>
          <button type="button" className="large danger" onClick={() => setFenetre('quitter')}>
            Quitter la partie
          </button>
        </Fenetre>
      )}
      {fenetre === 'journal' && (
        <Fenetre titre="Journal de la partie" onFermer={() => setFenetre(null)} large>
          <ol className="journal-complet">
            {v.journal
              .slice()
              .reverse()
              .map((e) => (
                <li key={e.n}>{e.texte}</li>
              ))}
          </ol>
        </Fenetre>
      )}
      {fenetre === 'quitter' && (
        <Fenetre titre="Quitter la partie ?" onFermer={() => setFenetre(null)}>
          <p>Tu pourras revenir avec le lien du salon tant que la partie existe. En ton absence, l’ordinateur jouera pour toi au bout de 30 secondes.</p>
          <div className="rangee">
            <button type="button" onClick={() => setFenetre(null)}>
              Rester
            </button>
            <button type="button" className="danger" onClick={quitter}>
              Quitter
            </button>
          </div>
        </Fenetre>
      )}
      {zoom && <Zoom id={zoom} onFermer={() => setZoom(null)} />}
      {revelation && v.evenement && (
        <div className="revelation" role="dialog" aria-label={`Événement : ${NOM_EVENEMENT[v.evenement]}`} onClick={() => setRevelation(null)}>
          <span className="revelation-titre">Événement de la nuit {v.nuit}</span>
          <div className="tourbillon">
            <div className="tourbillon-carte">
              <img className="face recto" src={infoCarte(revelation).image} alt={NOM_EVENEMENT[v.evenement]} />
              <img className="face verso" src="/dos.webp" alt="" />
            </div>
          </div>
          <h2>{NOM_EVENEMENT[v.evenement]}</h2>
          <p>{EFFET_EVENEMENT[v.evenement]}</p>
          <span className="discret">Touche pour fermer</span>
        </div>
      )}
    </div>
  );
}

/** Un adversaire autour de la table : son personnage, ses cartes retournées, son annonce et son butin. */
function Siege(props: {
  j: VueJoueur;
  v: Vue;
  salon: VueSalon;
  estHote: boolean;
  appel: Appel;
  nom: (id: string | null | undefined) => string;
  fraction: number | null;
  avatar: number;
}) {
  const { j, v, salon, estHote, appel, nom, fraction, avatar } = props;
  const s = salon.joueurs.find((x) => x.id === j.id);
  const nb = Math.min(j.nbCartes, 8);
  const minute = j.attendu && v.phase !== 'FIN_DE_NUIT' && v.phase !== 'FIN_DE_PARTIE';
  return (
    <article className={`siege ${minute ? 'attendu' : ''} ${v.tourId === j.id ? 'son-tour' : ''}`}>
      <div className="siege-dos" aria-hidden="true">
        {Array.from({ length: nb }, (_, i) => (
          <img key={i} src="/dos.webp" alt="" style={{ '--r': `${(i - (nb - 1) / 2) * 8}deg` } as React.CSSProperties} />
        ))}
      </div>
      <div className="siege-avatar">
        <Avatar n={avatar} fraction={minute ? fraction : null} />
        <span className="siege-nb" title="Cartes en main">
          {j.nbCartes}
        </span>
      </div>
      <div className="siege-nom">
        <span className={`point ${s?.connecte || s?.robot ? 'en-ligne' : 'hors-ligne'}`} title={s?.connecte ? 'En ligne' : 'Hors ligne'} />
        {j.id === salon.hoteId && (
          <span className="couronne-hote" title="Hôte">
            ♛
          </span>
        )}
        <span className="siege-nom-texte">{j.nom}</span>
        {s?.robot && (
          <span title="Joué par l’ordinateur" aria-label="Joué par l’ordinateur">
            🤖
          </span>
        )}
      </div>
      <div className="siege-infos">{j.annonce !== null ? `Annonce ${j.annonce}` : j.aAnnonce ? 'A annoncé' : 'Annonce…'}</div>
      <div className="siege-infos discret">
        {j.plis} pli{j.plis > 1 ? 's' : ''} · {j.score} pts
      </div>
      {((j.id === v.premierId && PHASES_DEBUT.includes(v.phase)) || (s && !s.connecte && !s.robot)) && (
        <div className="badges">
          {j.id === v.premierId && PHASES_DEBUT.includes(v.phase) && <span className="badge or">Commence</span>}
          {s && !s.connecte && !s.robot && <span className="badge rouge">Hors ligne</span>}
        </div>
      )}
      {v.choixAllies && <ChoixAllie v={v} id={j.id} nom={nom} />}
      {j.butin.length > 0 && <Butin ids={j.butin} />}
      {estHote && s && !s.connecte && (
        <button type="button" className="petit" onClick={() => appel('remplacer', { joueurId: j.id, actif: !s.robot })}>
          {s.robot ? 'Rendre la main' : 'Faire jouer l’ordinateur'}
        </button>
      )}
    </article>
  );
}

function Consigne(props: {
  v: Vue;
  selection: string | null;
  agir: (a: ActionSansJoueur) => void;
  nom: (id: string | null | undefined) => string;
  droiteNom: string;
  attenteTexte: string;
  envoi: boolean;
}) {
  const { v, selection, agir, nom, attenteTexte, envoi } = props;
  const nomSel = selection ? CARTE[selection]?.nom : '';
  switch (v.phase) {
    case 'TRAHISON':
      if (v.aChoisiTrahison) return <p>Carte choisie. {attenteTexte}</p>;
      return (
        <>
          <p>
            <strong>Trahison :</strong> choisis une carte de ta main à passer à {props.droiteNom}, ton voisin de droite.
          </p>
          {selection && (
            <button type="button" className="principal" disabled={envoi} onClick={() => agir({ type: 'TRAHISON', carteId: selection })}>
              Passer {nomSel}
            </button>
          )}
        </>
      );
    case 'ANNONCES':
      const commence = v.premierId === v.moi ? 'Tu ouvres' : `${nom(v.premierId)} ouvre`;
      if (v.monAnnonce !== null) return <p>Ton annonce : {v.monAnnonce}. {commence} le premier pli. {attenteTexte}</p>;
      return (
        <>
          <p>
            <strong>Combien de plis vas-tu gagner ?</strong> Tu as {v.main.length} carte{v.main.length > 1 ? 's' : ''}. {commence} le premier pli.
            {v.evenement === 'trahison' && ' Trahison : après les annonces, chacun passera une carte à son voisin de droite.'}
          </p>
          <div className="choix-annonce">
            {Array.from({ length: v.nuit + 1 }, (_, n) => (
              <button key={n} type="button" disabled={envoi} onClick={() => agir({ type: 'ANNONCE', valeur: n })}>
                {n}
              </button>
            ))}
          </div>
        </>
      );
    case 'ALLIANCE':
      if (v.aChoisiAllie) return <p>Ton choix : {v.monAllie ? nom(v.monAllie) : 'personne'}. {attenteTexte}</p>;
      return (
        <>
          <p>
            <strong>Alliance :</strong> choisis en secret un allié. Si vous vous choisissez tous les deux et réussissez votre annonce : +20 chacun.
          </p>
          <div className="choix-joueurs">
            {v.joueurs
              .filter((j) => j.id !== v.moi)
              .map((j) => (
                <button key={j.id} type="button" className="petit" disabled={envoi} onClick={() => agir({ type: 'ALLIANCE', allieId: j.id })}>
                  <span>{j.nom}</span>
                  <small>annonce {j.annonce}</small>
                </button>
              ))}
            <button type="button" className="petit secondaire" disabled={envoi} onClick={() => agir({ type: 'ALLIANCE', allieId: null })}>
              Personne
            </button>
          </div>
        </>
      );
    case 'PLI': {
      if (v.tourId !== v.moi) return <p>Au tour de {nom(v.tourId)}.</p>;
      if (!selection) {
        return (
          <p>
            <strong>À toi de jouer.</strong>{' '}
            {v.familleDemandee === 'chat_noir'
              ? 'Chat noir demandé : fournis un Chat noir si tu peux, ou joue une carte spéciale.'
              : v.familleDemandee
                ? `Suis les ${NOM_FAMILLE[v.familleDemandee]} si tu peux, ou joue un Chat noir ou une carte spéciale.`
                : 'Touche une carte pour la choisir.'}
          </p>
        );
      }
      if (CARTE[selection].speciale === 'croupier') {
        return (
          <>
            <p>
              <strong>Croupier :</strong> choisis sa valeur.
            </p>
            <div className="rangee">
              <button type="button" className="principal" disabled={envoi} onClick={() => agir({ type: 'JOUER', carteId: selection, valeurCroupier: 11 })}>
                Jouer à 11
              </button>
              <button type="button" className="principal" disabled={envoi} onClick={() => agir({ type: 'JOUER', carteId: selection, valeurCroupier: 0 })}>
                Jouer à 0
              </button>
            </div>
          </>
        );
      }
      return (
        <button type="button" className="principal large" disabled={envoi} onClick={() => agir({ type: 'JOUER', carteId: selection })}>
          Jouer {nomSel}
        </button>
      );
    }
    case 'VOL': {
      const source = v.vol?.source === 'baron' ? 'Baron' : 'Pickpocket';
      if (v.vol?.voleurId !== v.moi) return <p>{nom(v.vol?.voleurId)} choisit un butin à voler ({source})…</p>;
      const cibles = v.joueurs.filter((j) => j.id !== v.moi && j.butin.length > 0);
      const sansButin = v.joueurs.filter((j) => j.id !== v.moi && j.butin.length === 0).map((j) => j.nom);
      return (
        <>
          <p>
            <strong>{source} :</strong> touche le butin que tu veux voler. Un adversaire qui garde un Alibi en main est protégé
            {v.evenement === 'couvre_feu' ? ', sauf pendant ce Couvre-feu.' : '.'}
          </p>
          <div className="cibles">
            {cibles.map((j) => (
              <div key={j.id} className="cible">
                <span>{j.nom}</span>
                {j.butin.map((id) => (
                  <Pastille key={id} id={id} onClick={() => agir({ type: 'VOLER', cibleId: j.id, carteId: id })} />
                ))}
              </div>
            ))}
            {sansButin.length > 0 && <span className="vide">Sans butin : {sansButin.join(', ')}</span>}
          </div>
          <button type="button" className="secondaire" disabled={envoi} onClick={() => agir({ type: 'VOLER', cibleId: null })}>
            Ne pas voler
          </button>
        </>
      );
    }
    case 'FIN_DE_PLI':
      return <p>Fin du pli. Le pli suivant commence dans un instant…</p>;
    default:
      return <p>{attenteTexte}</p>;
  }
}

function RecapNuit({ v, nom, estHote, agir, secondes }: { v: Vue; nom: (id: string) => string; estHote: boolean; agir: (a: ActionSansJoueur) => void; secondes: number | null }) {
  const bilan = v.bilans[v.bilans.length - 1];
  const totaux = Object.fromEntries(v.joueurs.map((j) => [j.id, j.score]));
  const signe = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return (
    <Fenetre titre={`Fin de la nuit ${bilan.nuit}`} large>
      {bilan.evenement && <p className="discret">Événement : {NOM_EVENEMENT[bilan.evenement]}</p>}
      <div className="defile">
        <table className="tableau">
          <thead>
            <tr>
              <th>Joueur</th>
              <th title="Plis gagnés / plis annoncés">Plis</th>
              <th>Annonce</th>
              <th>Butin</th>
              <th>Bonus</th>
              <th>Nuit</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {bilan.scores.map((s) => (
              <tr key={s.joueurId} className={s.joueurId === v.moi ? 'ma-ligne' : ''}>
                <td className="nom-court">{nom(s.joueurId)}</td>
                <td className={s.reussie ? 'reussi' : 'rate'}>
                  {s.plis}/{s.annonce}
                </td>
                <td>{signe(s.pointsAnnonce)}</td>
                <td>{signe(s.pointsButin)}</td>
                <td>{signe(s.bonus)}</td>
                <td>
                  <strong>{signe(s.total)}</strong>
                </td>
                <td>{totaux[s.joueurId]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.pret ? (
        <p className="attente">{v.attente.length ? `En attente de ${v.attente.map(nom).join(', ')}.` : ''}</p>
      ) : (
        <button type="button" className="principal large" onClick={() => agir({ type: 'CONTINUER' })}>
          {bilan.nuit === v.nbNuits ? 'Voir le classement' : `Passer à la nuit ${bilan.nuit + 1}`}
        </button>
      )}
      {secondes !== null && <p className="discret">Suite automatique dans {secondes} s.</p>}
      {estHote && v.pret && v.attente.length > 0 && (
        <button type="button" className="lien-discret" onClick={() => agir({ type: 'FORCER_SUITE' })}>
          Continuer sans attendre
        </button>
      )}
    </Fenetre>
  );
}

function FinDePartie(props: { v: Vue; salon: VueSalon; estHote: boolean; appel: Appel; quitter: () => void; nom: (id: string) => string }) {
  const { v, salon, estHote, appel, quitter, nom } = props;
  const classement = [...v.joueurs].sort((a, b) => b.score - a.score);
  const max = classement[0].score;
  const barons = classement.filter((j) => j.score === max);
  const [voirScores, setVoirScores] = useState(false);
  const enr = salon.enregistrement;
  const compteDe = (id: string) => salon.joueurs.find((j) => j.id === id)?.compte ?? null;
  const monBilan = enr?.bilans[v.moi];
  return (
    <Fenetre titre="Fin de la partie" large>
      <div className="couronne" aria-hidden="true">
        ♛
      </div>
      <p className="dernier-baron">
        {barons.map((j) => j.nom).join(' et ')} {barons.length > 1 ? 'deviennent' : 'devient'}
        <span>le Dernier Baron</span>
      </p>
      <ol className="classement">
        {classement.map((j) => {
          const rang = classement.findIndex((x) => x.score === j.score) + 1;
          const bilan = enr?.bilans[j.id];
          const compte = compteDe(j.id);
          const niveau = bilan?.niveau ?? compte?.niveau;
          return (
            <li key={j.id} className={j.id === v.moi ? 'ma-ligne' : ''}>
              <span className="rang">{rang}</span>
              <span className="fin-joueur">
                <span className="fin-nom">
                  {nom(j.id)}
                  {niveau !== undefined && <BadgeNiveau niveau={niveau} titre={bilan?.titre ?? compte?.titre} />}
                </span>
                {bilan && (
                  <small className="fin-compte">
                    🏆 {bilan.victoires} victoire{bilan.victoires > 1 ? 's' : ''} au total · +{bilan.xpGagne} XP
                    {bilan.niveau > bilan.niveauAvant && <strong className="niveau-up"> · Niveau {bilan.niveau} !</strong>}
                  </small>
                )}
                {!bilan && compte && enr?.etat !== 'en_cours' && (
                  <small className="fin-compte">
                    🏆 {compte.victoires} victoire{compte.victoires > 1 ? 's' : ''} au total
                  </small>
                )}
              </span>
              <strong>{j.score} pts</strong>
            </li>
          );
        })}
      </ol>
      {monBilan && (
        <div className={`mon-bilan ${monBilan.niveau > monBilan.niveauAvant ? 'monte' : ''}`}>
          <strong>
            {monBilan.niveau > monBilan.niveauAvant ? `Niveau ${monBilan.niveau} : ${monBilan.titre} !` : `+${monBilan.xpGagne} XP`}
          </strong>
          <small>{detailXp(monBilan)}</small>
          <BarreXp xp={monBilan.xp} />
        </div>
      )}
      {enr?.etat === 'en_cours' && <p className="discret">Enregistrement des victoires…</p>}
      {enr?.etat === 'test' && <p className="discret">Partie de test avec des robots : elle ne compte pas dans les victoires.</p>}
      {enr?.etat === 'erreur' && <p className="discret">Certaines victoires n’ont pas pu être enregistrées.</p>}
      {salon.comptesActifs && !compteDe(v.moi) && enr?.etat !== 'test' && (
        <p className="discret">Crée un compte depuis l’accueil pour garder tes victoires et monter de niveau.</p>
      )}
      {voirScores ? <TableauScores v={v} /> : (
        <button type="button" className="lien-discret" onClick={() => setVoirScores(true)}>
          Voir le détail des nuits
        </button>
      )}
      <div className="rangee">
        {estHote ? (
          <button type="button" className="principal" onClick={() => appel('rejouer')}>
            Rejouer
          </button>
        ) : (
          <p className="attente">L'hôte peut relancer une partie.</p>
        )}
        <button type="button" onClick={quitter}>
          Quitter
        </button>
      </div>
    </Fenetre>
  );
}

function TableauScores({ v }: { v: Vue }) {
  if (!v.bilans.length) return <p>Les scores apparaîtront à la fin de la première nuit.</p>;
  return (
    <div className="defile">
      <table className="tableau">
        <thead>
          <tr>
            <th>Nuit</th>
            {v.joueurs.map((j) => (
              <th key={j.id}>{j.nom}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {v.bilans.map((b) => (
            <tr key={b.nuit}>
              <td>
                {b.nuit}
                {b.evenement && <small className="discret"> · {NOM_EVENEMENT[b.evenement]}</small>}
              </td>
              {v.joueurs.map((j) => {
                const s = b.scores.find((x) => x.joueurId === j.id);
                return (
                  <td key={j.id} className={s?.reussie ? 'reussi' : 'rate'} title={s ? `Annonce ${s.annonce}, ${s.plis} pli(s)` : ''}>
                    {s ? (s.total > 0 ? `+${s.total}` : s.total) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            {v.joueurs.map((j) => (
              <th key={j.id}>{j.score}</th>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Après l'Alliance, montre à tous qui a choisi qui, et les alliances formées. */
function ChoixAllie({ v, id, nom }: { v: Vue; id: string; nom: (id: string | null | undefined) => string }) {
  const choix = v.choixAllies?.[id] ?? null;
  const allie = v.alliances.some(([a, b]) => (a === id || b === id) && (a === choix || b === choix));
  return (
    <div className={`choix-allie ${allie ? 'allie' : ''}`}>
      {allie ? '🤝 Allié avec ' : 'A choisi '}
      <strong>{choix ? (choix === v.moi ? 'toi' : nom(choix)) : 'personne'}</strong>
    </div>
  );
}
