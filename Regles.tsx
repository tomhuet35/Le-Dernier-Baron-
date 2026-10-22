import type React from 'react';
import { useState } from 'react';
import { CARTES } from '../../shared/cartes';
import type { Famille, TypeEvenement } from '../../shared/types';
import { COULEUR_FAMILLE, EFFET_EVENEMENT, NOM_EVENEMENT, NOM_FAMILLE, infoCarte } from './textes';
import { Fenetre, Zoom } from './ui';

/** Règles illustrées : chaque notion est montrée avec les vraies cartes du jeu (touche une carte pour l'agrandir). */

type Onglet = 'essentiel' | 'nuit' | 'cartes' | 'plis' | 'evenements' | 'score';
const ONGLETS: [Onglet, string][] = [
  ['essentiel', 'L’essentiel'],
  ['nuit', 'Une nuit'],
  ['cartes', 'Les cartes'],
  ['plis', 'Les plis'],
  ['evenements', 'Événements'],
  ['score', 'Score'],
];

const nombre = (test: (c: (typeof CARTES)[number]) => boolean) => CARTES.filter(test).length;

const FAMILLES: { famille: Famille; carte: string }[] = [
  { famille: 'billets', carte: 'billets-10' },
  { famille: 'lingots', carte: 'lingots-10' },
  { famille: 'lames', carte: 'lames-10' },
  { famille: 'diamants', carte: 'diamants-10' },
];

const PERSONNAGES: { carte: string; speciale: string; resume: string; detail: string }[] = [
  {
    carte: 'baron',
    speciale: 'baron',
    resume: 'Bat tout le monde… sauf le Pickpocket.',
    detail: 'Quand il gagne un pli, il peut voler un butin. +20 s’il capture un Homme de main.',
  },
  {
    carte: 'pickpocket',
    speciale: 'pickpocket',
    resume: 'Vole un butin dès qu’il est posé.',
    detail: 'Il vole même s’il perd le pli. S’il tombe sur le Baron : Braquage, il gagne le pli et +40.',
  },
  {
    carte: 'homme-de-main-1',
    speciale: 'homme_de_main',
    resume: 'Bat toutes les cartes numérotées.',
    detail: 'S’il y en a plusieurs dans le pli, le premier posé gagne. Seuls le Baron et le Juge le battent.',
  },
  {
    carte: 'alibi-1',
    speciale: 'alibi',
    resume: 'Ne gagne jamais, mais protège.',
    detail: 'Tant que tu le gardes en main, on ne peut pas te voler (sauf pendant un Couvre-feu). Pratique pour perdre un pli.',
  },
  {
    carte: 'juge',
    speciale: 'juge',
    resume: 'Le monde à l’envers.',
    detail: 'Ne gagne jamais. Quand il est dans le pli, la plus petite valeur l’emporte, toutes familles confondues.',
  },
  {
    carte: 'croupier',
    speciale: 'croupier',
    resume: 'Vaut 0 ou 11, au choix.',
    detail: 'Tu choisis en le posant : 11 pour battre un 10, ou 0 pour perdre exprès. Il compte comme la famille demandée.',
  },
];

const EVENEMENTS: { type: TypeEvenement; carte: string; conseil: string }[] = [
  { type: 'casse_du_siecle', carte: 'casse-du-siecle-1', conseil: 'Bonne nuit pour viser les grosses cartes de gang.' },
  { type: 'descente_police', carte: 'descente-police-1', conseil: 'Le butin ne rapporte rien : concentre-toi sur ton annonce.' },
  { type: 'couvre_feu', carte: 'couvre-feu-1', conseil: 'Ton Alibi ne te sauve plus : le Baron et le Pickpocket ont le champ libre.' },
  { type: 'trahison', carte: 'trahison-1', conseil: 'Tu annonces d’abord, puis ta main change : prévois une marge.' },
  { type: 'alliance', carte: 'alliance-1', conseil: 'Choisis quelqu’un dont l’annonce te semble réaliste.' },
];

function Carte({ id, petite, legende, onZoom }: { id: string; petite?: boolean; legende?: string; onZoom: (id: string) => void }) {
  const info = infoCarte(id);
  return (
    <figure className={`regle-carte ${petite ? 'petite' : ''}`}>
      <button type="button" onClick={() => onZoom(id)} aria-label={`Voir ${info.nom} en grand`}>
        <img src={info.image} alt={info.nom} loading="lazy" draggable={false} />
      </button>
      {legende && <figcaption>{legende}</figcaption>}
    </figure>
  );
}

function Etape({ n, titre, children }: { n: number | string; titre: string; children: React.ReactNode }) {
  return (
    <li className="regle-etape">
      <span className="regle-numero">{n}</span>
      <div>
        <strong>{titre}</strong>
        {children}
      </div>
    </li>
  );
}

function Exemple({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="regle-exemple">
      <span className="etiquette">{titre}</span>
      {children}
    </div>
  );
}

export function ReglesIllustrees({ ongletInitial = 'essentiel' }: { ongletInitial?: Onglet }) {
  const [onglet, setOnglet] = useState<Onglet>(ongletInitial);
  const [zoom, setZoom] = useState<string | null>(null);
  const z = setZoom;
  return (
    <div className="regles">
      <nav className="regles-onglets" aria-label="Parties des règles">
        {ONGLETS.map(([id, nom]) => (
          <button key={id} type="button" className={onglet === id ? 'actif' : ''} aria-pressed={onglet === id} onClick={() => setOnglet(id)}>
            {nom}
          </button>
        ))}
      </nav>

      {onglet === 'essentiel' && (
        <section className="regles-page">
          <p className="regles-accroche">
            8 nuits, de 3 à 6 joueurs. À chaque nuit, tu paries sur le nombre de plis que tu vas gagner… et tu dois tomber <em>pile</em>.
          </p>
          <ol className="regles-etapes">
            <Etape n={1} titre="Tu reçois tes cartes">
              <p>Nuit 1 : 1 carte. Nuit 2 : 2 cartes… Nuit 8 : 8 cartes. Une nuit compte autant de plis que de cartes en main.</p>
              <div className="regles-nuits" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} style={{ '--n': i + 1 } as React.CSSProperties}>
                    <i />
                    {i + 1}
                  </span>
                ))}
              </div>
            </Etape>
            <Etape n={2} titre="Tu annonces combien de plis tu vas gagner">
              <p>En secret, de 0 au nombre de cartes. Toutes les annonces sont révélées ensemble.</p>
            </Etape>
            <Etape n={3} titre="Chacun pose une carte, la plus forte remporte le pli">
              <p>Le gagnant garde la plus belle carte de gang du pli : c’est son butin.</p>
            </Etape>
            <Etape n={4} titre="Tu marques des points si tu as vu juste">
              <p>Annonce réussie : +10 par pli, plus ton butin. Annonce ratée : −10 par pli d’écart, et pas de butin.</p>
            </Etape>
          </ol>
          <div className="regles-couronne">
            <span aria-hidden="true">♛</span>
            <p>Après la 8e nuit, le joueur qui a le plus de points devient <strong>le Dernier Baron</strong>.</p>
          </div>
          <p className="discret">Pendant une partie, un appui long sur une carte l’affiche en grand avec son effet. Chaque joueur a 30 secondes pour agir.</p>
        </section>
      )}

      {onglet === 'nuit' && (
        <section className="regles-page">
          <ol className="regles-etapes">
            <Etape n={1} titre="Distribution">
              <p>Toutes les cartes sont mélangées à chaque nuit. À la nuit n, chacun reçoit n cartes. Le premier joueur est affiché avant les annonces.</p>
            </Etape>
            <Etape n={2} titre="Événement (nuits 2 à 7)">
              <p>Une carte Événement est révélée au centre de la table et change les règles pour la nuit.</p>
              <div className="regles-rangee">
                <Carte id="trahison-1" petite onZoom={z} />
                <Carte id="casse-du-siecle-1" petite onZoom={z} />
                <Carte id="couvre-feu-1" petite onZoom={z} />
              </div>
            </Etape>
            <Etape n={3} titre="Annonces">
              <p>Chacun choisit en secret combien de plis il pense gagner (de 0 au nombre de cartes), puis tout est révélé.</p>
            </Etape>
            <Etape n="+" titre="Trahison ou Alliance">
              <p>Ces deux événements ajoutent une étape juste après les annonces : passer une carte, ou choisir un allié.</p>
            </Etape>
            <Etape n={4} titre="Les plis">
              <p>Le premier joueur ouvre le premier pli, puis on joue chacun son tour. Le gagnant d’un pli ouvre le suivant.</p>
            </Etape>
            <Etape n={5} titre="Le score">
              <p>Quand tous les plis sont joués, chacun compare ses plis à son annonce et marque ses points. Le premier joueur passe au suivant.</p>
            </Etape>
          </ol>
        </section>
      )}

      {onglet === 'cartes' && (
        <section className="regles-page">
          <h3>
            Cartes de gang <small>{nombre((c) => c.type === 'gang')} cartes</small>
          </h3>
          <p>Quatre familles, numérotées de 1 à 10. Ce sont elles qui forment le butin.</p>
          <div className="regles-familles">
            {FAMILLES.map((f) => (
              <div key={f.famille} className="regles-famille">
                <Carte id={f.carte} onZoom={z} />
                <span className="pastille-famille" style={{ background: COULEUR_FAMILLE[f.famille] }}>
                  {NOM_FAMILLE[f.famille]}
                </span>
              </div>
            ))}
          </div>

          <h3>
            Chat noir, l’atout <small>{nombre((c) => c.type === 'atout')} cartes</small>
          </h3>
          <div className="regles-perso">
            <Carte id="chat-noir-10" onZoom={z} />
            <div>
              <strong>Bat toutes les cartes de gang.</strong>
              <p>Il se joue à tout moment, même si tu as la famille demandée. Entre deux Chats noirs, le plus fort gagne. Il n’est jamais pris comme butin.</p>
              <p>S’il ouvre le pli, c’est le Chat noir qui est demandé.</p>
            </div>
          </div>

          <h3>
            Les personnages <small>{nombre((c) => c.type === 'speciale')} cartes</small>
          </h3>
          <p>Ils se jouent à tout moment, même si tu as la famille demandée.</p>
          {PERSONNAGES.map((p) => (
            <div key={p.carte} className="regles-perso">
              <Carte id={p.carte} onZoom={z} />
              <div>
                <strong>
                  {infoCarte(p.carte).nom}
                  <small> ×{nombre((c) => c.speciale === p.speciale)}</small>
                </strong>
                <span className="regles-resume">{p.resume}</span>
                <p>{p.detail}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {onglet === 'plis' && (
        <section className="regles-page">
          <h3>Suivre la famille</h3>
          <p>
            La <strong>première carte numérotée</strong> posée fixe la famille demandée. Si tu as cette famille en main, tu dois la jouer… ou jouer un
            Chat noir ou un personnage. Sinon, tu joues ce que tu veux.
          </p>
          <Exemple titre="Exemple">
            <div className="regles-rangee">
              <Carte id="lames-07" petite legende="Ouvre : Lames demandé" onZoom={z} />
              <span className="regles-fleche">→</span>
              <Carte id="lames-03" petite legende="Autorisé" onZoom={z} />
              <Carte id="chat-noir-04" petite legende="Autorisé" onZoom={z} />
              <Carte id="billets-09" petite legende="Interdit si tu as des Lames" onZoom={z} />
            </div>
          </Exemple>

          <h3>Qui remporte le pli ?</h3>
          <p>On regarde dans cet ordre ; la première règle qui s’applique désigne le gagnant.</p>
          <ol className="regles-podium">
            <li>
              <span className="regles-rang">1</span>
              <span className="regles-cartes">
                <Carte id="pickpocket" petite onZoom={z} />
                <Carte id="baron" petite onZoom={z} />
              </span>
              <span>
                <strong>Braquage</strong> : Pickpocket et Baron dans le même pli, le Pickpocket gagne (+40).
              </span>
            </li>
            <li>
              <span className="regles-rang">2</span>
              <span className="regles-cartes">
                <Carte id="baron" petite onZoom={z} />
              </span>
              <span>
                <strong>Le Baron</strong>.
              </span>
            </li>
            <li>
              <span className="regles-rang">3</span>
              <span className="regles-cartes">
                <Carte id="homme-de-main-1" petite onZoom={z} />
              </span>
              <span>
                <strong>Un Homme de main</strong> : le premier posé.
              </span>
            </li>
            <li>
              <span className="regles-rang">4</span>
              <span className="regles-cartes">
                <Carte id="chat-noir-08" petite onZoom={z} />
              </span>
              <span>
                <strong>Un Chat noir</strong> : le plus fort.
              </span>
            </li>
            <li>
              <span className="regles-rang">5</span>
              <span className="regles-cartes">
                <Carte id="diamants-10" petite onZoom={z} />
                <Carte id="croupier" petite onZoom={z} />
              </span>
              <span>
                <strong>La famille demandée</strong> : la plus forte (Croupier compris, à 0 ou 11). Les autres familles ne gagnent jamais.
              </span>
            </li>
          </ol>
          <p className="discret">Si le pli ne contient qu’un Pickpocket et des cartes qui ne gagnent pas, il le remporte. L’Alibi et le Juge ne gagnent jamais.</p>

          <h3>Le Juge : le monde à l’envers</h3>
          <Exemple titre="Exemple avec le Juge">
            <div className="regles-rangee">
              <Carte id="juge" petite onZoom={z} />
              <Carte id="diamants-09" petite onZoom={z} />
              <Carte id="baron" petite onZoom={z} />
              <Carte id="billets-02" petite legende="Gagne !" onZoom={z} />
            </div>
            <p>La plus petite valeur gagne, toutes familles confondues : les personnages comme le Baron ne gagnent pas.</p>
          </Exemple>

          <h3>Butin et vols</h3>
          <div className="regles-perso">
            <Carte id="diamants-09" onZoom={z} />
            <div>
              <p>
                Le gagnant du pli garde la <strong>carte de gang la plus forte</strong> du pli, même d’une autre famille. Elle vaut sa valeur en points à
                la fin de la nuit, si l’annonce est réussie.
              </p>
              <p>Le Pickpocket vole un butin dès qu’il est posé ; le Baron en vole un quand il gagne un pli. Un Alibi gardé en main protège.</p>
            </div>
          </div>
        </section>
      )}

      {onglet === 'evenements' && (
        <section className="regles-page">
          <p>
            Une carte Événement est tirée au début des <strong>nuits 2 à 7</strong> (la première et la dernière nuit n’en ont pas). Elle ne vaut que pour
            la nuit en cours.
          </p>
          {EVENEMENTS.map((e) => (
            <div key={e.type} className="regles-perso">
              <Carte id={e.carte} onZoom={z} />
              <div>
                <strong>{NOM_EVENEMENT[e.type]}</strong>
                <p>{EFFET_EVENEMENT[e.type]}</p>
                <p className="regles-conseil">💡 {e.conseil}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {onglet === 'score' && (
        <section className="regles-page">
          <table className="regles-score">
            <tbody>
              <tr>
                <th>Annonce réussie</th>
                <td>+10 par pli annoncé</td>
                <td className="regles-ex">annonce 3, 3 plis → +30</td>
              </tr>
              <tr>
                <th>Annonce ratée</th>
                <td>−10 par pli d’écart</td>
                <td className="regles-ex">annonce 2, 4 plis → −20</td>
              </tr>
              <tr>
                <th>Annonce 0 réussie</th>
                <td>+10 × numéro de la nuit</td>
                <td className="regles-ex">nuit 5 → +50</td>
              </tr>
              <tr>
                <th>Annonce 0 ratée</th>
                <td>−10 × numéro de la nuit</td>
                <td className="regles-ex">nuit 5 → −50</td>
              </tr>
              <tr>
                <th>Butin</th>
                <td>sa valeur, seulement si l’annonce est réussie</td>
                <td className="regles-ex">Diamants 9 → +9</td>
              </tr>
              <tr>
                <th>Bonus</th>
                <td>seulement si l’annonce est réussie</td>
                <td className="regles-ex">Baron + Homme de main +20 · Braquage +40 · Alliance +20</td>
              </tr>
            </tbody>
          </table>
          <Exemple titre="Exemple complet (nuit 4)">
            <div className="regles-rangee">
              <Carte id="diamants-09" petite onZoom={z} />
              <Carte id="lames-06" petite onZoom={z} />
            </div>
            <p>
              Tu annonces 2 plis et tu en gagnes 2, avec ce butin : 2 × 10 = <strong>20</strong> + butin 9 + 6 = <strong>15</strong>, soit{' '}
              <strong>35 points</strong>. Si tu avais gagné 3 plis : −10, et le butin ne compte pas.
            </p>
          </Exemple>
          <p className="discret">Casse du siècle : butin ×2. Descente de police : butin à 0.</p>
        </section>
      )}

      {zoom && <Zoom id={zoom} onFermer={() => setZoom(null)} />}
    </div>
  );
}

export function FenetreRegles({ onFermer }: { onFermer: () => void }) {
  return (
    <Fenetre titre="Règles du jeu" onFermer={onFermer} large>
      <ReglesIllustrees />
    </Fenetre>
  );
}
