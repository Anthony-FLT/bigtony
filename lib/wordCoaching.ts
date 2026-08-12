import AsyncStorage from "@react-native-async-storage/async-storage";
import { httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";
import { functions, auth } from "./firebase";

const wordCoaching = httpsCallable(functions, "wordCoaching", { timeout: 30000 });

export type Coaching = { ipa: string; meaning_fr: string; how_to_fr: string; trap_fr: string; audioBase64: string };

// Attend qu'un utilisateur (même anonyme) soit connecté
function waitForAuth(): Promise<void> {
  return new Promise((resolve) => {
    if (auth.currentUser) return resolve();
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) { unsub(); resolve(); }
    });
  });
}

export async function getWordCoaching(word: string): Promise<Coaching | null> {
  const key = "coach:" + word.toLowerCase().trim();
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Coaching;
  } catch {}
  try {
    await waitForAuth();
    const res: any = await wordCoaching({ word });
    const data = res.data as Coaching;
    try { await AsyncStorage.setItem(key, JSON.stringify(data)); } catch {}
    return data;
  } catch (e) {
    console.warn("getWordCoaching échoué:", e);
    return null;
  }
}