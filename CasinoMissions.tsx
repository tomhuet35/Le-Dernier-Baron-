/**
 * Les missions d'un jeu (Baron Express, Bal du Grand Hôtel) : l'avancement de chacune et le trophée à gagner, exposé
 * ensuite dans le Bureau du Baron. Les règles sont dans shared/missions.ts ; le serveur tient l'avancement.
 */
import type { CSSProperties } from 'react';
import type { VueCasino } from '../../shared/casino';
import { MISSIONS, TROPHEES, type IdTrophee, type JeuMission } from '../../shared/missions';
import { tr } from './traduction';
import './missions.css';

export function PanneauMissions({ jeu, vue }: { jeu: JeuMission; vue: VueCasino }) {
  const def = MISSIONS[jeu];
  const t = TROPHEES[def.trophee];
  const avancement = vue.contrats?.missions ?? {};
  const gagne = (vue.contrats?.trophees ?? []).includes(def.trophee);
  const faites = def.missions.filter((m) => gagne || (avancement[m.id] ?? 0) >= m.cible).length;
  return (
    <details className={`mi-panneau ${gagne ? 'gagne' : ''}`} open={!gagne}>
      <summary>
        <img src={t.image} alt="" className={gagne ? '' : 'a-gagner'} />
        <span>
          <strong>{tr('Missions', 'Missions')}</strong>
          <small>{gagne ? tr(`Trophée gagné : ${tr(...t.nom)}`, `Trophy won: ${tr(...t.nom)}`) : tr(`${faites}/${def.missions.length} · à gagner : ${tr(...t.nom)}`, `${faites}/${def.missions.length} · prize: ${tr(...t.nom)}`)}</small>
        </span>
      </summary>
      <ol>
        {def.missions.map((m) => {
          const n = gagne ? m.cible : Math.min(m.cible, avancement[m.id] ?? 0);
          const fait = n >= m.cible;
          return (
            <li key={m.id} className={fait ? 'faite' : ''}>
              <span className="mi-nom">
                {fait ? '✓ ' : ''}
                {tr(...m.nom)}
              </span>
              <span className="mi-barre" aria-hidden="true">
                <i style={{ '--part': n / m.cible } as CSSProperties} />
              </span>
              <small>
                {n}/{m.cible}
              </small>
            </li>
          );
        })}
      </ol>
      {!gagne && <p className="mi-aide">{tr('Finis les missions : le trophée rejoint les vitrines de ton Bureau.', 'Finish the missions: the trophy joins the showcases of your Office.')}</p>}
    </details>
  );
}

/** Les trophées des jeux, dans le Bureau du Baron. */
export function VitrinesTrophees({ trophees, moi }: { trophees: IdTrophee[]; moi: boolean }) {
  return (
    <section className="mi-trophees">
      <h2>{tr('Trophées des jeux', 'Game trophies')}</h2>
      <ul>
        {(Object.keys(TROPHEES) as IdTrophee[]).map((id) => {
          const t = TROPHEES[id];
          const a = trophees.includes(id);
          return (
            <li key={id} className={a ? 'pleine' : 'vide'}>
              <img src={t.image} alt={a ? tr(...t.nom) : ''} />
              <strong>{a ? tr(...t.nom) : '???'}</strong>
              <small>{id === 'locomotive' ? tr('Missions du Baron Express', 'Baron Express missions') : tr('Missions du Bal du Grand Hôtel', 'Grand Hotel Ball missions')}</small>
            </li>
          );
        })}
      </ul>
      {moi && <p className="discret">{tr('Chaque trophée se gagne en finissant les missions de son jeu.', 'Each trophy is won by finishing its game’s missions.')}</p>}
    </section>
  );
}

/** Le texte du bandeau quand une mission se termine ou qu'un trophée est gagné. */
export function texteMission(e: { finies: string[]; trophee: IdTrophee | null }): string {
  if (e.trophee) return tr(`Trophée gagné : ${tr(...TROPHEES[e.trophee].nom)} ! Il t’attend dans ton Bureau.`, `Trophy won: ${tr(...TROPHEES[e.trophee].nom)}! It awaits in your Office.`);
  const m = Object.values(MISSIONS)
    .flatMap((x) => x.missions)
    .find((x) => x.id === e.finies[0]);
  return m ? tr(`Mission accomplie : ${tr(...m.nom)}`, `Mission complete: ${tr(...m.nom)}`) : '';
}
