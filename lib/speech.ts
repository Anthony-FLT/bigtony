// Vitesse de la voix (TTS) : 4 crans, appliqués à la conversation et à l'écoute.
// "Normal" = 0.95, la valeur actuelle du backend (ce que l'utilisateur entend déjà).
export const SPEECH_RATES: { label: string; value: number }[] = [
  { label: "Très lent", value: 0.7 },
  { label: "Lent", value: 0.82 },
  { label: "Normal", value: 0.95 },
  { label: "Rapide", value: 1.1 },
];

export const DEFAULT_RATE = 0.95;

// Libellé du cran le plus proche d'une valeur donnée.
export function labelForRate(value: number | undefined): string {
  const v = value ?? DEFAULT_RATE;
  let best = SPEECH_RATES[2];
  let bestDiff = Infinity;
  for (const r of SPEECH_RATES) {
    const d = Math.abs(r.value - v);
    if (d < bestDiff) { bestDiff = d; best = r; }
  }
  return best.label;
}

// Cran suivant (pour le bouton d'accès rapide qui fait défiler les vitesses).
export function nextRate(value: number | undefined): number {
  const v = value ?? DEFAULT_RATE;
  let i = SPEECH_RATES.findIndex((r) => Math.abs(r.value - v) < 0.001);
  if (i < 0) i = 2;
  return SPEECH_RATES[(i + 1) % SPEECH_RATES.length].value;
}
