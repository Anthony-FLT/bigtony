// Statistiques du nouveau flux pour l'écran Progrès : leçons terminées, points du jour, XP, temps estimé, cartes à replacer.
// Lecture directe Firestore (attempts, learning/* sont lisibles par le client, jamais écrits par lui).
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "./firebase";

export type LearningWeekStats = {
  weekLessons: number;        // leçons terminées (validées ou non) depuis lundi
  weekLessonsValidated: number;
  weekDailyTalks: number;     // points du jour terminés depuis lundi
  weekXp: number;             // XP gagnés depuis lundi (leçons + points du jour + exercices + scènes)
  weekExercises: number;      // exercices du jour faits depuis lundi (écoute, lecture, traduction)
  weekScenes: number;         // scènes terminées depuis lundi
  xpTotal: number;            // learning/state.xp
  reviewDue: number;          // cartes de révision dues (à replacer au prochain point du jour)
  reviewTotal: number;        // cartes non acquises
  minutesPerDay: number[];    // L..D, temps estimé leçons + points du jour (minutes)
  totalMinutes: number;
};

const DAY_MS = 86_400_000;
const MAX_ATTEMPT_MIN = 15; // une tentative laissée ouverte ne compte pas des heures

function mondayOf(d = new Date()): Date {
  const m = new Date(d);
  m.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  m.setHours(0, 0, 0, 0);
  return m;
}
const dayIndex = (ms: number, monday: Date) => Math.floor((ms - monday.getTime()) / DAY_MS); // 0 = lundi
const dateKeyToMs = (key: string) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d, 12).getTime(); };

export async function getLearningWeekStats(): Promise<LearningWeekStats> {
  const empty: LearningWeekStats = { weekLessons: 0, weekLessonsValidated: 0, weekDailyTalks: 0, weekXp: 0, weekExercises: 0, weekScenes: 0, xpTotal: 0, reviewDue: 0, reviewTotal: 0, minutesPerDay: [0, 0, 0, 0, 0, 0, 0], totalMinutes: 0 };
  const uid = auth.currentUser?.uid;
  if (!uid) return empty;
  const monday = mondayOf();
  const mondayMs = monday.getTime();
  const now = Date.now();
  try {
    const [attemptsSnap, dailySnap, stateSnap, reviewSnap, ledgerSnap] = await Promise.all([
      getDocs(query(collection(db, "users", uid, "attempts"), where("active", "==", false))),
      getDocs(collection(db, "users", uid, "learning", "dailyTalk", "sessions")),
      getDoc(doc(db, "users", uid, "learning", "state")),
      getDocs(query(collection(db, "users", uid, "learning", "review", "items"), where("acquired", "==", false))),
      getDocs(query(collection(db, "users", uid, "learning", "xp", "ledger"), where("at", ">=", mondayMs))),
    ]);
    const s = { ...empty, minutesPerDay: [0, 0, 0, 0, 0, 0, 0] };
    // Leçons clôturées cette semaine
    for (const d of attemptsSnap.docs) {
      const a = d.data() as any;
      const endAt = typeof a.result?.at === "number" ? a.result.at : null;
      if (!endAt || endAt < mondayMs) continue;
      s.weekLessons++;
      if (a.result?.kind === "validated" || a.result?.kind === "validated_with_support") s.weekLessonsValidated++;
      s.weekXp += Number(a.result?.xpGained) || 0;
      const startAt = typeof a.createdAt === "number" ? a.createdAt : endAt;
      const min = Math.min(MAX_ATTEMPT_MIN, Math.max(1, Math.round((endAt - startAt) / 60_000)));
      const i = dayIndex(endAt, monday);
      if (i >= 0 && i < 7) s.minutesPerDay[i] += min;
      s.totalMinutes += min;
    }
    // Points du jour terminés cette semaine (clé = date locale)
    for (const d of dailySnap.docs) {
      const t = d.data() as any;
      if (t.state !== "ended") continue;
      const dayMs = dateKeyToMs(d.id);
      if (dayMs < mondayMs) continue;
      s.weekDailyTalks++;
      s.weekXp += Number(t.result?.xpGained) || 0;
      const min = Math.min(MAX_ATTEMPT_MIN, Math.max(1, Math.round(((t.endedAt || t.updatedAt || dayMs) - (t.startedAt || dayMs)) / 60_000)));
      const i = dayIndex(dayMs, monday);
      if (i >= 0 && i < 7) s.minutesPerDay[i] += min;
      s.totalMinutes += min;
    }
    // Exercices et scènes de la semaine (journal XP serveur)
    for (const d of ledgerSnap.docs) {
      const e = d.data() as any;
      s.weekXp += Number(e.xp) || 0;
      if (e.source === "exercise") s.weekExercises++;
      if (e.source === "scene") s.weekScenes++;
    }
    s.xpTotal = Number(stateSnap.data()?.xp) || 0;
    for (const d of reviewSnap.docs) {
      const c = d.data() as any;
      s.reviewTotal++;
      if ((c.nextDueAt || 0) <= now) s.reviewDue++;
    }
    return s;
  } catch (e) {
    console.warn("getLearningWeekStats échoué:", e);
    return empty;
  }
}
