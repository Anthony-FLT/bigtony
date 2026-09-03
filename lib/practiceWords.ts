// Mots à retravailler : écorchés en scène (misheard + mots faibles) ou ajoutés par l'utilisateur.
import { collection, doc, setDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp, increment } from "firebase/firestore";
import { auth, db } from "./firebase";

export type PracticeWord = {
  word: string;
  heardAs?: string;
  source: "scene" | "manual";
  count: number;
  mastered?: boolean;
  addedAt?: number;
  lastSeen?: number;
};
function wid(word: string) {
  return word.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
}

// Mots anglais trop courants pour valoir un exercice de prononciation.
const COMMON_WORDS = new Set([
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "mine", "yours", "ours", "theirs",
  "this", "that", "these", "those", "who", "whom", "whose", "which", "what",
  "a", "an", "the", "and", "or", "but", "if", "so", "as", "than", "then", "because",
  "of", "to", "in", "on", "at", "by", "for", "with", "from", "into", "onto", "off",
  "up", "down", "out", "over", "under", "about", "after", "before", "between",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "done", "have", "has", "had", "having",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "not", "no", "yes", "yeah", "ok", "okay", "oh", "ah", "um", "uh", "hmm", "well",
  "here", "there", "now", "just", "very", "too", "also", "only", "even", "still",
  "some", "any", "all", "each", "every", "many", "much", "more", "most", "few", "less",
  "one", "two", "three", "first", "next", "last",
  "good", "bad", "big", "small", "new", "old", "yes", "please", "thanks", "thank",
  "he's", "she's", "it's", "i'm", "you're", "we're", "they're", "don't", "doesn't",
  "didn't", "isn't", "aren't", "wasn't", "won't", "can't", "i've", "i'll", "i'd",
]);

// Un mot mérite-t-il d'entrer AUTOMATIQUEMENT dans le labo ?
function isWorthPracticing(word: string): boolean {
  const w = word.trim().toLowerCase().replace(/[^a-z']/g, "");
  if (w.length < 3) return false;        // trop court (I, a, to, up…)
  if (COMMON_WORDS.has(w)) return false; // mot ultra-courant
  return true;
}

// Enregistre un mot écorché en scène (appelé à chaque tour pour chaque paire misheard + mot faible)
export async function recordStumble(word: string, heardAs?: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const id = wid(word);
  if (!id) return;
  if (!isWorthPracticing(word)) return; // on n'encombre pas le labo avec les mots courants/courts
  try {
    await setDoc(
      doc(db, "users", uid, "practiceWords", id),
      {
        word: word.trim(),
        heardAs: heardAs ?? null,
        source: "scene",
        count: increment(1),
        lastSeen: serverTimestamp(),
        addedAt: serverTimestamp(), // ignoré si déjà présent grâce au merge (setDoc merge ne réécrit pas addedAt si on ne veut pas — voir note)
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("recordStumble échoué:", e);
  }
}

// Ajout manuel par l'utilisateur — retourne le mot créé (ou null en cas d'échec)
export async function addManualWord(word: string): Promise<PracticeWord | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const id = wid(word);
  if (!id) return null;
  try {
    await setDoc(
      doc(db, "users", uid, "practiceWords", id),
      { word: word.trim(), source: "manual", count: increment(0), addedAt: serverTimestamp(), lastSeen: serverTimestamp() },
      { merge: true }
    );
    return { word: word.trim(), source: "manual", count: 0, addedAt: Date.now() };
  } catch (e) {
    console.warn("addManualWord échoué:", e);
    return null;
  }
}

export async function removeWord(word: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await deleteDoc(doc(db, "users", uid, "practiceWords", wid(word)));
  } catch (e) {
    console.warn("removeWord échoué:", e);
  }
}

export async function listPracticeWords(): Promise<PracticeWord[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  try {
    const q = query(collection(db, "users", uid, "practiceWords"), orderBy("count", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as PracticeWord);
  } catch (e) {
    console.warn("listPracticeWords échoué:", e);
    return [];
  }
}

// Sélection du jour : fait tourner les mots à retravailler pour varier d'un jour à l'autre.
export async function getDailySelection(max = 5): Promise<PracticeWord[]> {
 const all = (await listPracticeWords()).filter((w) => !w.mastered);
  if (all.length === 0) return [];
  // Rotation déterministe basée sur le jour : décale la fenêtre chaque jour
  const dayNum = Math.floor(Date.now() / 86400000); // numéro de jour
  const start = (dayNum * max) % all.length;
  const out: PracticeWord[] = [];
  for (let i = 0; i < Math.min(max, all.length); i++) {
    out.push(all[(start + i) % all.length]);
  }
  return out;
}

export async function setMastered(word: string, mastered: boolean): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid, "practiceWords", wid(word)), { mastered }, { merge: true });
  } catch (e) {
    console.warn("setMastered échoué:", e);
  }
}