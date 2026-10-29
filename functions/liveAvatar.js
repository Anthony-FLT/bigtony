// LiveAvatar (coach vidéo des leçons) — Functions additives. Chargé depuis index.js par :
//   Object.assign(exports, require("./liveAvatar"));
// Le serveur crée/arrête les sessions, pose flags et quotas, garde la clé API. Le mobile est l'unique
// propriétaire du WebSocket de commande, avec les seuls credentials temporaires de la session.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const textToSpeech = require("@google-cloud/text-to-speech");

if (!getApps().length) initializeApp();
const db = getFirestore();
const REGION = "europe-west1";
const LIVEAVATAR_API_KEY = defineSecret("LIVEAVATAR_API_KEY");
const API = "https://api.liveavatar.com";

// Voix TTS : table par défaut + surcharge à chaud via config/voices (voir voices.js)
const { VOICES, FR_VOICE, refreshVoices } = require("./voices");
const ttsClient = new textToSpeech.TextToSpeechClient();

// ---------------------------------------------------------------
// Configuration serveur : config/liveAvatar
// {
//   enabled: false,                 // pilote désactivé par défaut
//   sandbox: true,                  // sessions sandbox (gratuites) tant que true
//   mode: "CUSTOM",                 // mode du token : "CUSTOM" (ws_url) ou "LITE" — à trancher au premier test
//   maxSessionSeconds: 300,         // plafond produit (borné aussi par le forfait)
//   pilotUids: [],                  // [] = tous les comptes ; sinon seuls ces uid peuvent ouvrir une session
//   dailySessionsPerUser: 10,
//   monthlyMinutesPerUser: 60,
//   globalMonthlyMinutes: 1000,
//   coaches: { us_male: { avatarId: "<uuid>", voice: "us-male", enabled: true }, us_female: {...}, uk_male: {...}, uk_female: {...} }
// }
// Compteurs : config/liveAvatarUsage/{AAAA-MM} { reservedMinutes }, users/{uid}/learning/avatarUsage { "AAAA-MM": { reservedMinutes, sessions }, "AAAA-MM-JJ": { sessions } }
// Sessions : users/{uid}/avatarSessions/{sessionId}
// ---------------------------------------------------------------
// Seul avatar accepté par LiveAvatar en sandbox (Wayne) : substitué automatiquement quand sandbox = true
const SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";
const SANDBOX_MAX_SECONDS = 60; // plafond LiveAvatar des sessions sandbox

async function readConfig() {
  const snap = await db.doc("config/liveAvatar").get();
  const c = snap.data() || {};
  return {
    enabled: c.enabled === true,
    sandbox: c.sandbox !== false,
    mode: c.mode === "LITE" ? "LITE" : "CUSTOM",
    maxSessionSeconds: Math.min(c.sandbox !== false ? SANDBOX_MAX_SECONDS : 3600, Math.max(60, Number(c.maxSessionSeconds) || 300)),
    pilotUids: Array.isArray(c.pilotUids) ? c.pilotUids : [],
    dailySessionsPerUser: Number(c.dailySessionsPerUser) || 10,
    monthlyMinutesPerUser: Number(c.monthlyMinutesPerUser) || 60,
    globalMonthlyMinutes: Number(c.globalMonthlyMinutes) || 1000,
    coaches: c.coaches && typeof c.coaches === "object" ? c.coaches : {},
  };
}
function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Connexion requise");
  return uid;
}
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

async function laFetch(path, { method = "POST", headers = {}, body, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!resp.ok) {
    console.error("LiveAvatar", path, resp.status, text.slice(0, 500));
    throw new HttpsError("unavailable", `liveavatar_${resp.status}`);
  }
  return json;
}

async function stopProvider(sessionId, reason) {
  try {
    await laFetch("/v1/sessions/stop", { headers: { "X-API-KEY": LIVEAVATAR_API_KEY.value() }, body: { session_id: sessionId, reason } });
    return true;
  } catch (e) {
    console.error("stopProvider échoué", sessionId, e?.message);
    return false;
  }
}

// ---------------------------------------------------------------
// startAvatarSession({ coachId, attemptId? }) → { sessionId, livekitUrl, livekitClientToken, wsUrl, maxSessionSeconds, coach }
// attemptId absent = session de test (écran de dev), réservée aux pilotUids.
// Idempotent : une session active par (uid, attemptId|dev) → un double appui renvoie la même.
// ---------------------------------------------------------------
exports.startAvatarSession = onCall({ region: REGION, maxInstances: 5, secrets: [LIVEAVATAR_API_KEY], timeoutSeconds: 30 }, async (request) => {
  const uid = requireAuth(request);
  if (request.data?.warmup === true) return { ok: true }; // préchauffage : instance (et modules) prêts avant le vrai démarrage
  const tStart = Date.now();
  const { coachId = "us_male", attemptId = null, dailyTalkId = null } = request.data || {};
  if (dailyTalkId && !/^\d{4}-\d{2}-\d{2}$/.test(String(dailyTalkId))) throw new HttpsError("invalid-argument", "dailyTalkId invalide");
  const scopeKey = attemptId ? `attempt:${attemptId}` : dailyTalkId ? `daily:${dailyTalkId}` : "dev";
  const sessionsCol = db.collection(`users/${uid}/avatarSessions`);
  // Toutes les lectures en parallèle (config, périmètre, session existante) : ~1 aller-retour Firestore au lieu de 3
  const [cfg, scopeSnap, existing] = await Promise.all([
    readConfig(),
    attemptId ? db.doc(`users/${uid}/attempts/${attemptId}`).get() : dailyTalkId ? db.doc(`users/${uid}/learning/dailyTalk/sessions/${dailyTalkId}`).get() : Promise.resolve(null),
    sessionsCol.where("scopeKey", "==", scopeKey).where("status", "==", "active").limit(1).get(),
  ]);
  if (!cfg.enabled) throw new HttpsError("failed-precondition", "avatar_disabled");
  if (cfg.pilotUids.length && !cfg.pilotUids.includes(uid)) throw new HttpsError("permission-denied", "avatar_not_pilot");
  const coach = cfg.coaches[coachId];
  if (!coach || coach.enabled !== true || typeof coach.avatarId !== "string") throw new HttpsError("failed-precondition", "coach_not_configured");
  // Tentative : existante, possédée, active · Point du jour : session du jour existante et active
  if (attemptId) { const a = scopeSnap?.data(); if (!a || a.active !== true) throw new HttpsError("failed-precondition", "attempt_not_active"); }
  if (!attemptId && dailyTalkId) { const d = scopeSnap?.data(); if (!d || d.state !== "active") throw new HttpsError("failed-precondition", "daily_talk_not_active"); }

  // Session active déjà ouverte pour ce périmètre → la renvoyer (double appui, reconnexion)
  if (!existing.empty) {
    const s = existing.docs[0].data();
    if (Date.now() < s.expiresAt) return { sessionId: s.sessionId, livekitUrl: s.livekitUrl, livekitClientToken: s.livekitClientToken, wsUrl: s.wsUrl, maxSessionSeconds: s.maxSeconds, coach: { id: coachId, voice: coach.voice || "us-male" }, reused: true };
    await existing.docs[0].ref.set({ status: "expired", endedAt: Date.now() }, { merge: true });
  }

  // Réservation transactionnelle du quota (minutes = durée max de la session)
  const minutes = Math.ceil(cfg.maxSessionSeconds / 60);
  const mk = monthKey(), dk = dayKey();
  const globalRef = db.doc(`config/liveAvatarUsage_${mk}`);
  const userRef = db.doc(`users/${uid}/learning/avatarUsage`);
  await db.runTransaction(async (tx) => {
    const [g, u] = await Promise.all([tx.get(globalRef), tx.get(userRef)]);
    const gReserved = Number(g.data()?.reservedMinutes || 0);
    const um = u.data()?.[mk] || {}, ud = u.data()?.[dk] || {};
    if (!cfg.sandbox) {
      if (gReserved + minutes > cfg.globalMonthlyMinutes) throw new HttpsError("resource-exhausted", "global_budget_reached");
      if (Number(um.reservedMinutes || 0) + minutes > cfg.monthlyMinutesPerUser) throw new HttpsError("resource-exhausted", "user_monthly_minutes_reached");
    }
    if (Number(ud.sessions || 0) + 1 > cfg.dailySessionsPerUser) throw new HttpsError("resource-exhausted", "user_daily_sessions_reached");
    tx.set(globalRef, { reservedMinutes: gReserved + minutes, updatedAt: Date.now() }, { merge: true });
    tx.set(userRef, { [mk]: { reservedMinutes: Number(um.reservedMinutes || 0) + minutes, sessions: Number(um.sessions || 0) + 1 }, [dk]: { sessions: Number(ud.sessions || 0) + 1 } }, { merge: true });
  });

  // Création + démarrage fournisseur. En cas d'échec : libération de la réservation.
  let token, started;
  const tProvider = Date.now();
  try {
    token = await laFetch("/v1/sessions/token", {
      headers: { "X-API-KEY": LIVEAVATAR_API_KEY.value() },
      body: { avatar_id: cfg.sandbox ? SANDBOX_AVATAR_ID : coach.avatarId, mode: cfg.mode, is_sandbox: cfg.sandbox, interactivity_type: "PUSH_TO_TALK", max_session_duration: cfg.maxSessionSeconds, video_settings: { quality: "medium", encoding: "H264" } },
    });
    started = await laFetch("/v1/sessions/start", { headers: { Authorization: `Bearer ${token.data.session_token}` } });
  } catch (e) {
    // Refus fournisseur : on rend la réservation ET la session du jour (elle n'a pas eu lieu)
    await db.runTransaction(async (tx) => {
      const [g, u] = await Promise.all([tx.get(globalRef), tx.get(userRef)]);
      tx.set(globalRef, { reservedMinutes: Math.max(0, Number(g.data()?.reservedMinutes || 0) - minutes) }, { merge: true });
      const um = u.data()?.[mk] || {}, ud = u.data()?.[dk] || {};
      tx.set(userRef, {
        [mk]: { reservedMinutes: Math.max(0, Number(um.reservedMinutes || 0) - minutes), sessions: Math.max(0, Number(um.sessions || 0) - 1) },
        [dk]: { sessions: Math.max(0, Number(ud.sessions || 0) - 1) },
      }, { merge: true });
    });
    throw e;
  }
  const d = started.data || {};
  if (!d.ws_url) console.warn(`LiveAvatar: ws_url absent avec mode=${cfg.mode} — essayer l'autre mode dans config/liveAvatar.mode`);
  const now = Date.now();
  const maxSeconds = Math.min(cfg.maxSessionSeconds, Number(d.max_session_duration) || cfg.maxSessionSeconds);
  const doc = {
    sessionId: d.session_id || token.data.session_id,
    scopeKey, attemptId, dailyTalkId, coachId, uid,
    mode: cfg.mode, sandbox: cfg.sandbox,
    livekitUrl: d.livekit_url || null, livekitClientToken: d.livekit_client_token || null, wsUrl: d.ws_url || null,
    maxSeconds, reservedMinutes: minutes,
    status: "active", startedAt: now, expiresAt: now + maxSeconds * 1000 + 15000, endedAt: null, endReason: null,
  };
  await sessionsCol.doc(doc.sessionId).set(doc);
  console.log("startAvatarSession timings", JSON.stringify({ reads_ms: tProvider - tStart, provider_ms: now - tProvider, total_ms: Date.now() - tStart }));
  return { sessionId: doc.sessionId, livekitUrl: doc.livekitUrl, livekitClientToken: doc.livekitClientToken, wsUrl: doc.wsUrl, maxSessionSeconds: maxSeconds, coach: { id: coachId, voice: coach.voice || "us-male" }, reused: false };
});

// ---------------------------------------------------------------
// stopAvatarSession({ sessionId, reason? }) — idempotent ; propriété vérifiée.
// ---------------------------------------------------------------
exports.stopAvatarSession = onCall({ region: REGION, maxInstances: 5, secrets: [LIVEAVATAR_API_KEY], timeoutSeconds: 20 }, async (request) => {
  const uid = requireAuth(request);
  const { sessionId, reason = "USER_CLOSED" } = request.data || {};
  if (typeof sessionId !== "string") throw new HttpsError("invalid-argument", "sessionId manquant");
  const ref = db.doc(`users/${uid}/avatarSessions/${sessionId}`);
  const s = (await ref.get()).data();
  if (!s) throw new HttpsError("not-found", "session_not_found");
  if (s.status !== "active") return { ok: true, alreadyStopped: true };
  const ok = await stopProvider(sessionId, ["USER_CLOSED", "USER_DISCONNECTED", "IDLE_TIMEOUT", "SERVER_ERROR"].includes(reason) ? reason : "USER_CLOSED");
  const usedMinutes = Math.min(s.reservedMinutes, Math.ceil((Date.now() - s.startedAt) / 60000));
  await ref.set({ status: ok ? "stopped" : "stop_failed", endedAt: Date.now(), endReason: reason, usedMinutesEstimate: usedMinutes }, { merge: true });
  // Libération de la part non consommée (estimation locale ; la consommation fournisseur fait foi ensuite)
  const free = Math.max(0, s.reservedMinutes - usedMinutes);
  if (free > 0) {
    const mk = monthKey(new Date(s.startedAt));
    const globalRef = db.doc(`config/liveAvatarUsage_${mk}`);
    const userRef = db.doc(`users/${uid}/learning/avatarUsage`);
    await db.runTransaction(async (tx) => {
      const [g, u] = await Promise.all([tx.get(globalRef), tx.get(userRef)]);
      tx.set(globalRef, { reservedMinutes: Math.max(0, Number(g.data()?.reservedMinutes || 0) - free) }, { merge: true });
      const um = u.data()?.[mk] || {};
      tx.set(userRef, { [mk]: { reservedMinutes: Math.max(0, Number(um.reservedMinutes || 0) - free) } }, { merge: true });
    });
  }
  return { ok, usedMinutesEstimate: usedMinutes };
});

// ---------------------------------------------------------------
// avatarSpeech({ text, lang: "en"|"fr", voice }) → { chunks: [base64 PCM 16 bits 24 kHz mono ≈ 1 s], sampleRate: 24000 }
// Étape A (écran de test). En étape B, lessonTurn renverra ces segments à la place du MP3 quand l'avatar est actif.
// ---------------------------------------------------------------
async function synthesizePcmChunks(text, voice, rate) {
  await refreshVoices(); // objets voix mis à jour en place
  const [res] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice,
    audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000, speakingRate: Math.max(0.5, Math.min(1.5, Number(rate) || 0.95)) },
  });
  let buf = Buffer.from(res.audioContent);
  // Google renvoie un WAV : on retire l'en-tête (44 octets si "RIFF") pour ne garder que le PCM brut attendu par LiveAvatar
  if (buf.length > 44 && buf.toString("ascii", 0, 4) === "RIFF") buf = buf.subarray(44);
  const CHUNK = 24000 * 2; // 1 s de PCM 16 bits mono
  const chunks = [];
  for (let i = 0; i < buf.length; i += CHUNK) chunks.push(buf.subarray(i, i + CHUNK).toString("base64"));
  return chunks;
}
exports.avatarSpeech = onCall({ region: REGION, maxInstances: 5, timeoutSeconds: 30 }, async (request) => {
  requireAuth(request);
  if (request.data?.warmup === true) return { ok: true }; // préchauffage (TTS prêt pour l'ouverture)
  const { text, lang = "en", voice = "us-male", speakingRate = 0.95 } = request.data || {};
  if (typeof text !== "string" || !text.trim() || text.length > 600) throw new HttpsError("invalid-argument", "text invalide");
  const v = lang === "fr" ? FR_VOICE : (VOICES[voice] || VOICES["us-male"]);
  const chunks = await synthesizePcmChunks(text.trim(), v, lang === "fr" ? 1.0 : speakingRate);
  return { chunks, sampleRate: 24000, durationMs: Math.round(chunks.length * 1000) };
});

// ---------------------------------------------------------------
// Nettoyage des sessions orphelines (app tuée sans callback) : toutes les 10 min.
// ---------------------------------------------------------------
exports.cleanupAvatarSessions = onSchedule({ region: REGION, schedule: "every 10 minutes", secrets: [LIVEAVATAR_API_KEY] }, async () => {
  const stale = await db.collectionGroup("avatarSessions").where("status", "==", "active").where("expiresAt", "<", Date.now()).limit(50).get();
  for (const doc of stale.docs) {
    const s = doc.data();
    const ok = await stopProvider(s.sessionId, "ZOMBIE_SESSION_REAP");
    await doc.ref.set({ status: ok ? "stopped" : "stop_failed", endedAt: Date.now(), endReason: "ZOMBIE_SESSION_REAP" }, { merge: true });
  }
  if (stale.size) console.log(`cleanupAvatarSessions: ${stale.size} session(s) traitée(s)`);
});

Object.defineProperty(module.exports, "_internal", { value: { synthesizePcmChunks, readConfig, stopProvider }, enumerable: false });
