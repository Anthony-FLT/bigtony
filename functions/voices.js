// Voix Google TTS des coachs — table par défaut + surcharge à chaud depuis Firestore (config/voices), cache 60 s.
// Document config/voices (tous les champs optionnels) :
// { "us-male": { "name": "en-US-Chirp3-HD-Charon" }, "us-female": { "name": "en-US-Chirp3-HD-Kore" },
//   "uk-male": { "name": "en-GB-Chirp3-HD-Orus" }, "uk-female": { "name": "en-GB-Chirp3-HD-Aoede" }, "fr": { "name": "fr-FR-Chirp3-HD-Charon" } }
// languageCode est déduit du nom (préfixe xx-XX) s'il n'est pas donné. Une entrée absente ou invalide = voix par défaut.
// Les objets VOICES[k] et FR_VOICE sont mis à jour EN PLACE : une référence déjà résolue voit la nouvelle voix.
const { getFirestore } = require("firebase-admin/firestore");

const DEFAULT_VOICES = {
  "us-male":   { languageCode: "en-US", name: "en-US-Neural2-D" },
  "us-female": { languageCode: "en-US", name: "en-US-Neural2-F" },
  "uk-male":   { languageCode: "en-GB", name: "en-GB-Neural2-B" },
  "uk-female": { languageCode: "en-GB", name: "en-GB-Neural2-A" },
};
const DEFAULT_FR = { languageCode: "fr-FR", name: "fr-FR-Neural2-B" };

const VOICES = Object.fromEntries(Object.entries(DEFAULT_VOICES).map(([k, v]) => [k, { ...v }]));
const FR_VOICE = { ...DEFAULT_FR };

const TTL_MS = 60_000;
let readAt = 0;
let inflight = null;

function normalize(entry, fallback) {
  const name = typeof entry?.name === "string" ? entry.name.trim() : "";
  if (!name) return { ...fallback };
  const m = name.match(/^([a-z]{2}-[A-Z]{2})-/);
  const languageCode = typeof entry.languageCode === "string" && entry.languageCode ? entry.languageCode : (m ? m[1] : fallback.languageCode);
  return { languageCode, name };
}

// Recharge la table depuis config/voices si le cache a expiré. Jamais bloquant en cas d'erreur (on garde la table courante).
async function refreshVoices() {
  if (Date.now() - readAt < TTL_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const d = (await getFirestore().doc("config/voices").get()).data() || {};
      for (const k of Object.keys(DEFAULT_VOICES)) Object.assign(VOICES[k], normalize(d[k], DEFAULT_VOICES[k]));
      Object.assign(FR_VOICE, normalize(d.fr, DEFAULT_FR));
    } catch (e) {
      console.warn("config/voices illisible, voix par défaut conservées:", e?.message || e);
    } finally {
      readAt = Date.now();
      inflight = null;
    }
  })();
  return inflight;
}

// Résolution synchrone (index.js) : renvoie la voix courante et déclenche un rafraîchissement en arrière-plan si besoin.
// La mise à jour étant faite en place, l'objet renvoyé reflète la nouvelle voix dès que la lecture Firestore aboutit.
function resolveVoice(key) {
  refreshVoices().catch(() => {});
  return VOICES[key] || VOICES["us-male"];
}

module.exports = { VOICES, FR_VOICE, DEFAULT_VOICES, refreshVoices, resolveVoice };
