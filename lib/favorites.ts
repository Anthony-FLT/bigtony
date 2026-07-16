// Mots favoris de l'utilisateur : mot anglais + traduction FR + contexte.
import { collection, doc, setDoc, deleteDoc, getDocs, serverTimestamp, query, orderBy } from "firebase/firestore";
import { auth, db } from "./firebase";

export type Favorite = {
  word: string;      // sert d'id (normalisé minuscule)
  fr: string;
  scenario?: string;
  addedAt?: number;
};

function favId(word: string) {
  return word.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
}

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
  }
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