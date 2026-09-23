// Dictionnaire personnel : mot/expression anglais + traduction FR + contexte, enrichi en arrière-plan
// (type, IPA, définition, exemples en contexte, mots proches) via la fonction backend dictionaryEntry.
import { collection, doc, setDoc, deleteDoc, getDoc, getDocs, serverTimestamp, query, orderBy } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";

const dictionaryEntryFn = httpsCallable(functions, "dictionaryEntry", { timeout: 30000 });

export type WordType = "nom" | "verbe" | "adjectif" | "adverbe" | "expression";
export type ExampleCategory = "pro" | "voyage" | "quotidien";
export type FavoriteExample = { category: ExampleCategory; en: string; fr: string };

export type Favorite = {
  word: string;      // sert d'id (normalisé minuscule)
  fr: string;
  scenario?: string;
  addedAt?: number;
  // Champs enrichis — générés en arrière-plan juste après l'ajout, absents le temps que ce soit fait.
  wordType?: WordType;
  ipa?: string;
  gloss?: string;
  definitionEn?: string;
  explanationFr?: string;
  registerTags?: string[];
  relatedWords?: string[];
  examples?: FavoriteExample[];
  enrichedAt?: number;
};

function favId(word: string) {
  return word.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
}

// Ajoute le mot immédiatement (retour visuel instantané), puis lance l'enrichissement
// en arrière-plan sans bloquer l'appelant (fire-and-forget) — la fiche riche arrive
// quelques secondes plus tard, en mise à jour du même document.
export async function addFavorite(word: string, fr: string, scenario?: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const id = favId(word);
  if (!id) return;
  try {
    await setDoc(doc(db, "users", uid, "favorites", id), {
      word: word.trim(),
      fr: fr.trim(),
      scenario: scenario ?? null,
      addedAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn("addFavorite échoué:", e);
    return;
  }
  enrichFavorite(word.trim(), fr.trim()).catch((e) => console.warn("enrichFavorite échoué:", e));
}

// Génère la fiche riche (type, IPA, définition, exemples, mots proches) et la fusionne dans le document.
export async function enrichFavorite(word: string, fr: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const id = favId(word);
  if (!id) return;
  const res: any = await dictionaryEntryFn({ word, fr });
  const d = res.data ?? {};
  await setDoc(
    doc(db, "users", uid, "favorites", id),
    {
      wordType: d.word_type ?? null,
      ipa: d.ipa ?? null,
      gloss: d.gloss ?? null,
      definitionEn: d.definition_en ?? null,
      explanationFr: d.explanation_fr ?? null,
      registerTags: d.register_tags ?? [],
      relatedWords: d.related_words ?? [],
      examples: d.examples ?? [],
      enrichedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function removeFavorite(word: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await deleteDoc(doc(db, "users", uid, "favorites", favId(word)));
  } catch (e) {
    console.warn("removeFavorite échoué:", e);
  }
}

export async function listFavorites(): Promise<Favorite[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  try {
    const q = query(collection(db, "users", uid, "favorites"), orderBy("addedAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Favorite);
  } catch (e) {
    console.warn("listFavorites échoué:", e);
    return [];
  }
}

// Relit un seul mot (utilisé par la fiche mot pour vérifier si l'enrichissement est arrivé).
export async function getFavorite(word: string): Promise<Favorite | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid, "favorites", favId(word)));
    return snap.exists() ? (snap.data() as Favorite) : null;
  } catch (e) {
    console.warn("getFavorite échoué:", e);
    return null;
  }
}