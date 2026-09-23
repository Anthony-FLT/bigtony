// Écoute du jour : réutilise la génération de dailyReading (texte + QCM), avec un cache séparé.
// L'audio est fabriqué côté écran via translateText mode "speak" (avec la voix de l'utilisateur).
import { doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";
import { loadProfile } from "./profile";

const dailyReadingFn = httpsCallable(functions, "dailyReading", { timeout: 30000 });

export type ListeningQuestion = { question: string; options: string[]; answer: number };
export type HardWord = { word: string; fr: string };
export type ListeningContent = { text: string; hard_words: HardWord[]; questions: ListeningQuestion[] };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayListening(): Promise<ListeningContent | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const ref = doc(db, "users", uid, "dailyChallenges", todayKey());

  try {
    const snap = await getDoc(ref);
    const d: any = snap.data() || {};
    if (d.listeningContent?.text) return d.listeningContent as ListeningContent;
  } catch {}

  try {
    const p = await loadProfile();
    // Graine préfixée "listen-" pour un texte distinct de la lecture du jour.
    const res: any = await dailyReadingFn({
      level: p?.level ?? "B1",
      interests: p?.interests ?? [],
      goals: p?.goals ?? [],
      job: p?.job ?? null,
      seed: "listen-" + todayKey() + "-" + Math.random().toString(36).slice(2, 7),
    });
    const content: ListeningContent = {
      text: res.data.text ?? "",
      hard_words: res.data.hard_words ?? [],
      questions: res.data.questions ?? [],
    };
    if (!content.text || content.questions.length === 0) return null;
    await setDoc(ref, { listeningContent: content }, { merge: true });
    return content;
  } catch (e) {
    console.warn("getTodayListening échoué:", e);
    return null;
  }
}

// Réponses déjà données aujourd'hui (même principe que la lecture — pour ne pas perdre le résultat).
export async function getTodayListeningAnswers(): Promise<Record<number, number>> {
  const uid = auth.currentUser?.uid;
  if (!uid) return {};
  try {
    const snap = await getDoc(doc(db, "users", uid, "dailyChallenges", todayKey()));
    const d: any = snap.data() || {};
    return d.listeningAnswers ?? {};
  } catch (e) {
    console.warn("getTodayListeningAnswers échoué:", e);
    return {};
  }
}

export async function saveListeningAnswer(questionIndex: number, optionIndex: number): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(
      doc(db, "users", uid, "dailyChallenges", todayKey()),
      { listeningAnswers: { [questionIndex]: optionIndex } },
      { merge: true }
    );
  } catch (e) {
    console.warn("saveListeningAnswer échoué:", e);
  }
}