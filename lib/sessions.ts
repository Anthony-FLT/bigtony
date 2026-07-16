// Persistance des sessions de conversation dans Firestore.
// Structure : users/{uid}/sessions/{sessionId}
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  increment,
} from "firebase/firestore";
import { auth, db } from "./firebase";

export type SessionPronunciation = {
  pronScore: number;
  accuracyScore: number;
  fluencyScore: number;
  azureText: string;
  weakWords: { word: string; score: number }[];
} | null;

export type SessionTurn = {
  user: string;
  coach: string;
  feedback: string;
  pronunciation: SessionPronunciation;
  at: number; // Date.now() — serverTimestamp interdit dans arrayUnion
};

export type SessionDebrief = {
  points_forts: string[];
  axe: string;
  message_fr: string;
};

function uidOrThrow(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Utilisateur non connecté");
  return uid;
}

// Crée la session au premier tour réussi. Retourne l'id du document.
export async function startSession(scenario: string, kind: "daily" | "scenario" | "custom" = "scenario"): Promise<string> {
  const uid = uidOrThrow();
  const ref = await addDoc(collection(db, "users", uid, "sessions"), {
    scenario,
    kind,
    status: "active",
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    turnCount: 0,
    turns: [],
  });
  return ref.id;
}

// Ajoute un tour au fil de l'eau — la session survit à un kill de l'app.
export async function addTurn(sessionId: string, turn: SessionTurn): Promise<void> {
  const uid = uidOrThrow();
  await updateDoc(doc(db, "users", uid, "sessions", sessionId), {
    turns: arrayUnion(turn),
    turnCount: increment(1),
    updatedAt: serverTimestamp(),
  });
}

// Clôture : débrief + agrégats calculés (matière de l'écran Progrès).
export async function closeSession(
  sessionId: string,
  debrief: SessionDebrief,
  turns: SessionTurn[]
): Promise<void> {
  const uid = uidOrThrow();

  const scored = turns.filter((t) => t.pronunciation);
  const avg = (sel: (p: NonNullable<SessionPronunciation>) => number) =>
    scored.length
      ? Math.round(scored.reduce((s, t) => s + sel(t.pronunciation!), 0) / scored.length)
      : null;

  // Mots faibles agrégés : occurrences + pire score
  const weak: Record<string, { count: number; worstScore: number }> = {};
  for (const t of scored) {
    for (const w of t.pronunciation!.weakWords) {
      const e = weak[w.word];
      weak[w.word] = {
        count: (e?.count ?? 0) + 1,
        worstScore: Math.min(e?.worstScore ?? 100, w.score),
      };
    }
  }
  const weakWords = Object.entries(weak)
    .map(([word, v]) => ({ word, count: v.count, worstScore: v.worstScore }))
    .sort((a, b) => b.count - a.count || a.worstScore - b.worstScore);

  await updateDoc(doc(db, "users", uid, "sessions", sessionId), {
    status: "done",
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    debrief,
    avgPronScore: avg((p) => p.pronScore),
    avgAccuracyScore: avg((p) => p.accuracyScore),
    avgFluencyScore: avg((p) => p.fluencyScore),
    weakWords,
  });
}

