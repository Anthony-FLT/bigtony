// Niveau CECRL — source unique, partagée client/serveur (mêmes clés que les prompts).
export type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

// Auto-évaluation en langage humain → niveau CECRL
export const LEVEL_OPTIONS: { key: Level; title: string; desc: string }[] = [
  { key: "A1", title: "Grand débutant", desc: "Quelques mots, quelques phrases toutes faites" },
  { key: "A2", title: "Je me débrouille", desc: "Des phrases simples sur des sujets familiers" },
  { key: "B1", title: "Je tiens une conversation", desc: "Je me fais comprendre mais je rame parfois" },
  { key: "B2", title: "Je suis à l'aise", desc: "Je parle assez librement, je veux gagner en fluidité" },
  { key: "C1", title: "Avancé", desc: "Je manque juste de naturel et de précision" },
  { key: "C2", title: "Quasi bilingue", desc: "Je peaufine les derniers détails" },
];

const ORDER: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Recalibrage : l'auto-éval prime, le score du test ajuste d'un cran max.
// Test très bas (<40) alors qu'on se dit avancé → on descend d'un cran.
// Test excellent (>85) alors qu'on se dit débutant → on monte d'un cran.
export function calibrateLevel(declared: Level, testScore: number | null): Level {
  if (testScore == null) return declared;
  const i = ORDER.indexOf(declared);
  if (testScore < 40 && i > 0) return ORDER[i - 1];
  if (testScore > 85 && i < ORDER.length - 1) return ORDER[i + 1];
  return declared;
}