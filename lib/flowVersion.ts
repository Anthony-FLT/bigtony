// Cohorte de parcours : « legacy » (parcours actuel) ou « learning_path_v1 » (nouveau parcours).
// Règles : un compte sans champ est legacy, sans écriture. Seul le serveur assigne, une seule fois,
// à la création du profil, et seulement si le flag est activé côté serveur.
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { FlowVersion } from "./learningPath/types";

const assignFlowVersionFn = httpsCallable<{}, { flowVersion: FlowVersion; assigned: boolean }>(functions, "assignFlowVersion", { timeout: 15000 });

// À appeler UNIQUEMENT quand le profil n'existe pas encore (nouvel utilisateur, avant l'onboarding).
// Idempotent : si une valeur existe déjà, le serveur la renvoie sans la changer.
// En cas d'échec réseau : legacy, pour ne jamais bloquer le démarrage.
export async function ensureFlowVersion(): Promise<FlowVersion> {
  try {
    const r = await assignFlowVersionFn({});
    return r.data?.flowVersion === "learning_path_v1" ? "learning_path_v1" : "legacy";
  } catch (e) {
    console.warn("assignFlowVersion échoué, repli legacy:", e);
    return "legacy";
  }
}

export function resolveFlowVersion(profileValue: unknown): FlowVersion {
  return profileValue === "learning_path_v1" ? "learning_path_v1" : "legacy";
}
