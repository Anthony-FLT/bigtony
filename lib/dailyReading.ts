// Lecture du jour : contenu (texte + mots difficiles + QCM) généré à la demande et mis en cache dans le doc du jour.
import { doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";
import { loadProfile } from "./profile";
import { themeForToday } from "./dailyThemes";

const dailyReadingFn = httpsCallable(functions, "dailyReading", { timeout: 30000 });

export type ReadingQuestion = { question: string; options: string[]; answer: number };
export type HardWord = { word: string; fr: string };
export type ReadingContent = { text: string; hard_words: HardWord[]; questions: ReadingQuestion[] };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayReading(): Promise<ReadingContent | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const ref = doc(db, "users", uid, "dailyChallenges", todayKey());

  try {
    const snap = await getDoc(ref);
    const d: any = snap.data() || {};
    if (d.readingContent?.text) return d.readingContent as ReadingContent;
  } catch {}

  try {
    const p = await loadProfile();
    const theme = themeForToday(p?.interests ?? [], p?.job ?? null, "reading");
    const res: any = await dailyReadingFn({
      level: p?.level ?? "B1",
      interests: [theme],
      goals: p?.goals ?? [],
      job: null,
      seed: todayKey() + "-" + Math.random().toString(36).slice(2, 7),
    });
    const content: ReadingContent = {
      text: res.data.text ?? "",
      hard_words: res.data.hard_words ?? [],
      questions: res.data.questions ?? [],
    };
    if (!content.text || content.questions.length === 0) return null;
    await setDoc(ref, { readingContent: content }, { merge: true });
    return content;
  } catch (e) {
    console.warn("getTodayReading échoué:", e);
    return null;
  }
}

// Réponses déjà données aujourd'hui (pour ne pas perdre le résultat en quittant/revenant sur l'écran).
export async function getTodayReadingAnswers(): Promise<Record<number, number>> {
  const uid = auth.currentUser?.uid;
  if (!uid) return {};
  try {
    const snap = await getDoc(doc(db, "users", uid, "dailyChallenges", todayKey()));
    const d: any = snap.data() || {};
    return d.readingAnswers ?? {};
  } catch (e) {
    console.warn("getTodayReadingAnswers échoué:", e);
    return {};
  }
}

// Enregistre une réponse au fil de l'eau (merge : n'écrase pas les autres questions déjà répondues).
export async function saveReadingAnswer(questionIndex: number, optionIndex: number): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(
      doc(db, "users", uid, "dailyChallenges", todayKey()),
      { readingAnswers: { [questionIndex]: optionIndex } },
      { merge: true }
    );
  } catch (e) {
    console.warn("saveReadingAnswer échoué:", e);
  }
}