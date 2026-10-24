/**
 * Filtre à insultes du chat des parties publiques (français et anglais).
 * Les mots sont comparés en minuscules, sans accents, chiffres « déguisés » remplacés (3 → e, 0 → o…)
 * et lettres répétées réduites à une seule (« connnnard » = « connard »).
 * Le mot entier est remplacé par sa première lettre suivie d'étoiles : « c****** ».
 */

/** Mots interdits seulement en entier (trop courts ou présents dans des mots ordinaires). */
const MOTS_ENTIERS = [
  // français
  'con', 'cons', 'conne', 'connes', 'pd', 'pds', 'pede', 'pedes', 'fdp', 'ntm', 'tg', 'ptn', 'tamere', 'tamer', 'salaud', 'salauds',
  'abruti', 'abrutie', 'abrutis', 'debile', 'debiles', 'cretin', 'cretine', 'cretins', 'mongol', 'mongole', 'mongols', 'gogol', 'gogole',
  'triso', 'trisomique', 'negro', 'chienne', 'garce', 'raclure', 'ordure', 'ordures', 'merde', 'merdes', 'merdeux', 'merdique',
  'bite', 'bites', 'chatte', 'couille', 'couilles', 'gouine', 'tapette', 'tafiole', 'pute', 'putes', 'putain', 'catin',
  'nique', 'niquer', 'niktamer', 'niquetamere', 'zob', 'teub', 'pouilleux',
  // anglais
  'ass', 'arse', 'dick', 'dicks', 'cock', 'cocks', 'prick', 'twat', 'twats', 'stfu', 'kys', 'fag', 'fags',
  'retard', 'retards', 'retarded', 'scum', 'dumbass',
];

/** Racines interdites au début d'un mot (enculé, enculer, connasse, salopard…). */
const RACINES = [
  // français
  'encul', 'connar', 'conas', 'salop', 'pouf', 'branleu', 'enfoir', 'batar', 'tarlouz', 'bougnoul', 'youpin', 'negre', 'negres',
  'pedal', 'grosemerde', 'filsdepute', 'nazi', 'pedophil',
  // anglais
  'fuck', 'fuk', 'motherf', 'shit', 'bitch', 'bastard', 'cunt', 'nigg', 'nigga', 'fagot', 'whor', 'slut', 'wank', 'asshol', 'dickhead',
  'dumbfuck', 'cocksuck', 'pussy',
];

const DEGUISEMENTS: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '€': 'e', '!': 'i', '|': 'i' };

/** Forme comparable d'un mot : minuscules, sans accents ni chiffres déguisés, sans lettres répétées. */
export function formeComparable(mot: string): string {
  return mot
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$€!|]/g, (c) => DEGUISEMENTS[c] ?? c)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const ENTIERS = new Set(MOTS_ENTIERS.map(formeComparable));
const DEBUTS = RACINES.map(formeComparable);

export function estInsulte(mot: string): boolean {
  const f = formeComparable(mot);
  if (f.length < 2) return false;
  return ENTIERS.has(f) || DEBUTS.some((r) => f.startsWith(r));
}

/** Remplace les insultes d'un message par des étoiles. Renvoie aussi le nombre de mots masqués. */
export function filtrerMessage(texte: string): { texte: string; masques: number } {
  let masques = 0;
  // Un « mot » : lettres, chiffres et signes souvent utilisés pour déguiser (f*ck reste repéré grâce à l'astérisque collé).
  // Les mots composés (« pique-nique ») sont jugés en entier.
  const resultat = texte.replace(/[\p{L}\p{N}@$€!|*]+(?:-[\p{L}\p{N}@$€!|*]+)*/gu, (mot) => {
    const sansEtoile = mot.replace(/\*/g, '');
    const touche = estInsulte(mot) || (mot.includes('*') && sansEtoile.length >= 3 && estInsulteMasquee(mot));
    if (!touche) return mot;
    masques += 1;
    return mot[0] + '*'.repeat(Math.max(1, [...mot].length - 1));
  });
  // Lettres espacées (« c o n n a r d ») : on recolle les suites de lettres isolées.
  const espacees = resultat.replace(/\b(?:\p{L}[ .\-_]){2,}\p{L}\b/gu, (suite) => {
    const colle = suite.replace(/[ .\-_]/g, '');
    if (!estInsulte(colle)) return suite;
    masques += 1;
    return colle[0] + '*'.repeat(colle.length - 1);
  });
  return { texte: espacees, masques };
}

/** « f*ck », « sh*t » : un astérisque à la place d'une voyelle. */
function estInsulteMasquee(mot: string): boolean {
  return ['a', 'e', 'i', 'o', 'u'].some((v) => estInsulte(mot.replace(/\*/g, v)));
}

/** Pseudo choquant (parties publiques) : remplacé par un nom neutre. */
export function pseudoAcceptable(nom: string): boolean {
  if (filtrerMessage(nom).masques > 0) return false;
  // Pseudo collé (« GrosConnard ») : on cherche aussi les racines à l'intérieur du mot.
  const f = formeComparable(nom);
  return !DEBUTS.some((r) => r.length >= 4 && f.includes(r));
}
