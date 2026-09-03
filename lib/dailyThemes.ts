// Thème du jour : rotation imposée parmi les centres d'intérêt + le métier (à égalité).
// Un thème différent par exercice ET par jour, pour éviter la monotonie.
export type DailyExercise = "reading" | "translation" | "listening";

// Complète le pool UNIQUEMENT si l'utilisateur a très peu de centres d'intérêt,
// sinon il n'y aurait aucune variété possible.
const FALLBACK_THEMES = [
  "daily life and small talk",
  "travel and holidays",
  "food and cooking",
  "science and nature",
  "cinema, music and culture",
];

export function themeForToday(interests: string[], job: string | null, exercise: DailyExercise): string {
  const pool: string[] = [];
  for (const i of interests || []) {
    const t = (i || "").trim();
    if (t) pool.push(t);
  }
  if (job && job.trim()) pool.push(job.trim());

  // Garantit un minimum de variété si le pool est trop petit.
  if (pool.length < 3) {
    for (const f of FALLBACK_THEMES) if (!pool.includes(f)) pool.push(f);
  }
  if (pool.length === 0) return "daily life";

  const day = Math.floor(Date.now() / 86400000);
  const third = Math.max(1, Math.floor(pool.length / 3));
  const off = exercise === "reading" ? 0 : exercise === "translation" ? third : 2 * third;
  return pool[(day + off) % pool.length];
}