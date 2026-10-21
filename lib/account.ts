// Suppression du compte : efface les données Firestore de l'utilisateur puis le compte anonyme.
import { doc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";

const purgeLearningData = httpsCallable(functions, "purgeLearningData", { timeout: 120000 });

export async function deleteAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const uid = user.uid;
  // Données du parcours (attempts, progress, learning, drafts) : en lecture seule côté client → purge serveur
  try { await purgeLearningData({}); } catch (e) { console.warn("purge parcours échouée:", e); }
  // Sous-collections connues à purger
  for (const sub of ["sessions", "favorites"]) {
    try {
      const snap = await getDocs(collection(db, "users", uid, sub));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    } catch (e) { console.warn(`purge ${sub} échouée:`, e); }
  }
  try { await deleteDoc(doc(db, "users", uid)); } catch (e) { console.warn("purge profil échouée:", e); }
  await user.delete(); // supprime le compte anonyme Firebase Auth
}