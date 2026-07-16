// Agrège les sessions et favoris de l'utilisateur pour l'écran Progrès.
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { auth, db } from "./firebase";
import { listFavorites, Favorite } from "./favorites";
import { computeStreak } from "./streak";

export type ProgressData = {
  sessionCount: number;
  totalTurns: number;
  avgPron: number | null;
  avgAccuracy: number | null;
  avgFluency: number | null;
  scoreHistory: { score: number }[];     // pron moyen par session, chronologique
  recurringWeak: { word: string; count: number }[];
  favorites: Favorite[];
};

export async function loadMomentum(): Promise<Momentum> {
  const uid = auth.currentUser?.uid;
  const empty: Momentum = { streak: 0, sessionCount: 0, lastScenario: null, topWeakWord: null, favoritesCount: 0 };
  if (!uid) return empty;
  try {
    const q = query(collection(db, "users", uid, "sessions"), orderBy("startedAt", "desc"));
    const snap = await getDocs(q);
    const done = snap.docs.map((d) => d.data()).filter((s) => s.status === "done");

    const weak: Record<string, number> = {};
    for (const s of done) for (const w of s.weakWords || []) weak[w.word] = (weak[w.word] || 0) + (w.count || 1);
    const topWeakWord = Object.entries(weak).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const favs = await listFavorites();
    const streak = await computeStreak();

    return {
      streak,
      sessionCount: done.length,
      lastScenario: done[0]?.scenario ?? null,
      topWeakWord,
      favoritesCount: favs.length,
    };
  } catch (e) {
    console.warn("loadMomentum échoué:", e);
    return empty;
  }
}

export type Momentum = {
  streak: number;
  sessionCount: number;
  lastScenario: string | null;      // id du dernier scénario joué
  topWeakWord: string | null;       // le mot qui revient le plus
  favoritesCount: number;
};

export async function loadProgress(): Promise<ProgressData> {
  const uid = auth.currentUser?.uid;
  const empty: ProgressData = {
    sessionCount: 0, totalTurns: 0, avgPron: null, avgAccuracy: null, avgFluency: null,
    scoreHistory: [], recurringWeak: [], favorites: [],
  };
  if (!uid) return empty;

  try {
    const q = query(collection(db, "users", uid, "sessions"), orderBy("startedAt", "asc"));
    const snap = await getDocs(q);
    const done = snap.docs.map((d) => d.data()).filter((s) => s.status === "done");

    if (done.length === 0) {
      const favorites = await listFavorites();
      return { ...empty, favorites };
    }

    const withScore = done.filter((s) => typeof s.avgPronScore === "number");
    const mean = (sel: (s: any) => number) =>
      withScore.length ? Math.round(withScore.reduce((a, s) => a + sel(s), 0) / withScore.length) : null;

    // Mots faibles récurrents sur toutes les sessions
    const weak: Record<string, number> = {};
    for (const s of done) {
      for (const w of s.weakWords || []) {
        weak[w.word] = (weak[w.word] || 0) + (w.count || 1);
      }
    }
    const recurringWeak = Object.entries(weak)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const favorites = await listFavorites();

    return {
      sessionCount: done.length,
      totalTurns: done.reduce((a, s) => a + (s.turnCount || 0), 0),
      avgPron: mean((s) => s.avgPronScore),
      avgAccuracy: mean((s) => s.avgAccuracyScore ?? s.avgPronScore),
      avgFluency: mean((s) => s.avgFluencyScore ?? s.avgPronScore),
      scoreHistory: withScore.map((s) => ({ score: Math.round(s.avgPronScore) })),
      recurringWeak,
      favorites,
    };
  } catch (e) {
    console.warn("loadProgress échoué:", e);
    return empty;
  }
}