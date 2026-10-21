/** Générateur pseudo-aléatoire (mulberry32) : l'état est un simple nombre, ce qui garde le moteur pur et rejouable. */
export function suivant(etat: number): [number, number] {
  const a = (etat + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** Mélange de Fisher-Yates. Renvoie le tableau mélangé et le nouvel état du générateur. */
export function melanger<T>(tableau: readonly T[], etat: number): [T[], number] {
  const copie = tableau.slice();
  let s = etat;
  for (let i = copie.length - 1; i > 0; i--) {
    const [x, ns] = suivant(s);
    s = ns;
    const j = Math.floor(x * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return [copie, s];
}
