// ---------------------------------------------------------------
// Le point du jour — discussion quotidienne courte avec le coach (voir Spec-Point-du-jour.md)
// Le serveur décide (régime, geste du jour, cartes à replacer, tour de clôture) ; le modèle discute.
//   dailyTalkStart({ dateKey, voice })                      → session du jour (créée ou reprise)
//   dailyTalkTurn({ sessionId, audioBase64|text, … })       → un tour (comme lessonTurn)
//   dailyTalkEnd({ sessionId })                             → clôture : phrase du jour, cartes, XP
// Données : users/{uid}/learning/dailyTalk/sessions/{dateKey}, users/{uid}/learning/memory, users/{uid}/learning/review/items/{id}
// ---------------------------------------------------------------
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenAI, Type } = require("@google/genai");
const { FieldValue } = require("firebase-admin/firestore");
const lp = require("./learningPath")._internal;
const MOVES = require("./catalog/dailyMoves.json");

const REGION = "europe-west1";
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const { db, requireAuth, hasEntitlement, VOICES, FR_VOICE, synthesize, coachIdentity, genWithRetry, MAX_AUDIO_BASE64_LENGTH, REVIEW_INTERVALS_DAYS, DAY_MS, readLessonConfig } = lp;

const XP_DAILY_TALK = 10;
const MAX_TURNS_DEFAULT = 5;
const MAX_TURNS_ADVANCED = 6; // B2+
const MEMORY_CAP = 20;
const FREE_SESSIONS_PER_WEEK = 1; // sans abonnement : un point du jour par semaine

const str = (v, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const sessionRef = (uid, dateKey) => db.doc(`users/${uid}/learning/dailyTalk/sessions/${dateKey}`);
const memoryRef = (uid) => db.doc(`users/${uid}/learning/memory`);
const itemsCol = (uid) => db.collection(`users/${uid}/learning/review/items`);

function moveGroup(level) {
  if (level === "A1" || level === "A2") return "A";
  if (level === "B1") return "B";
  return "C";
}
function isValidDateKey(k) { return typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k); }

async function readLevel(uid) {
  const [stateSnap, userSnap] = await Promise.all([db.doc(`users/${uid}/learning/state`).get(), db.doc(`users/${uid}`).get()]);
  const level = stateSnap.data()?.practiceLevel || userSnap.data()?.level || "B1";
  return { level, name: str(userSnap.data()?.name, 40), goals: Array.isArray(userSnap.data()?.goals) ? userSnap.data().goals.slice(0, 4) : [] };
}

// Cartes dues : acquired == false (un seul champ → pas d'index composite), tri mémoire
async function dueCards(uid, now) {
  const snap = await itemsCol(uid).where("acquired", "==", false).get();
  return snap.docs.map((d) => d.data()).filter((c) => (c.nextDueAt || 0) <= now).sort((a, b) => (a.nextDueAt || 0) - (b.nextDueAt || 0));
}

// Geste du jour : rotation dans le groupe du niveau, jamais le même que la veille
async function pickMove(uid, level) {
  const group = MOVES[moveGroup(level)];
  const prev = await db.collection(`users/${uid}/learning/dailyTalk/sessions`).orderBy("startedAt", "desc").limit(1).get();
  const last = prev.docs[0]?.data();
  const count = last ? (last.sessionNumber || 0) : 0;
  let idx = count % group.length;
  if (last && group[idx].id === last.moveId) idx = (idx + 1) % group.length;
  return { move: group[idx], sessionNumber: count + 1 };
}

function regimeFor(due) {
  if (due.length === 0) return { regime: "A", picked: [] };
  if (due.length <= 3) return { regime: "B", picked: due.slice(0, 1) };
  return { regime: "C", picked: due.slice(0, 2) };
}

// Ouverture : courte, personnelle si on sait quelque chose, jamais « let's review »
async function makeOpening(ai, who, level, name, memory, move) {
  const facts = memory.length ? memory.map((f) => `- ${f}`).join("\n") : "(nothing yet)";
  try {
    const res = await genWithRetry(ai, {
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: `Write the opening line of today's chat.` }] }],
      config: {
        systemInstruction: `You are ${who.name}, a warm English coach (${who.english}), starting a short daily chat with ${name || "the learner"} (level ${level}) about THEIR life. You already know each other.
What you know about them:\n${facts}
Today's conversational move you'll steer towards later (do NOT mention it): ${move.move}.
Write ONE opening: a short friendly greeting + ONE easy question about their day or something you know about them (if you know something, use it naturally: "Last time you mentioned…"). 1–2 sentences, simple English for ${level}. Never say "review", "practise", "lesson", "objective".
Respond ONLY with JSON {"opening_en": "...", "opening_fr": "<French translation>"}.`,
        responseMimeType: "application/json",
        responseSchema: { type: Type.OBJECT, properties: { opening_en: { type: Type.STRING }, opening_fr: { type: Type.STRING } }, required: ["opening_en", "opening_fr"] },
        temperature: 0.9,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
    const p = JSON.parse(res.text);
    if (str(p.opening_en)) return { en: str(p.opening_en, 300), fr: str(p.opening_fr, 300) };
  } catch (e) { console.warn("dailyTalk opening fallback", e?.message); }
  return { en: `Hi${name ? ` ${name}` : ""}! How's your day going so far?`, fr: `Salut${name ? ` ${name}` : ""} ! Comment se passe ta journée ?` };
}

// ---------------------------------------------------------------
exports.dailyTalkStart = onCall({ region: REGION, maxInstances: 5, secrets: [GEMINI_API_KEY], timeoutSeconds: 30, memory: "512MiB" }, async (request) => {
  const uid = requireAuth(request);
  if (request.data?.warmup === true) return { ok: true };
  const { dateKey, voice = "us-male" } = request.data || {};
  if (!isValidDateKey(dateKey)) throw new HttpsError("invalid-argument", "dateKey invalide (AAAA-MM-JJ)");
  const now = Date.now();
  const ref = sessionRef(uid, dateKey);
  const existing = (await ref.get()).data();
  if (existing) {
    return {
      sessionId: dateKey, resumed: true, state: existing.state, turns: (existing.turns || []).map(publicTurn), maxTurns: existing.maxTurns,
      regime: existing.regime, reuseTotal: (existing.picked || []).length, reuseDone: (existing.picked || []).filter((c) => c.ok).length,
      openingEn: existing.openingEn, openingFr: existing.openingFr, moveLabelFr: existing.moveLabelFr, result: existing.result || null,
    };
  }

  // Droit : abonné, ou 1 session par semaine glissante sans abonnement
  const premium = await hasEntitlement(uid);
  if (!premium) {
    const weekAgo = now - 7 * DAY_MS;
    const recent = await db.collection(`users/${uid}/learning/dailyTalk/sessions`).where("startedAt", ">=", weekAgo).limit(FREE_SESSIONS_PER_WEEK).get();
    if (recent.size >= FREE_SESSIONS_PER_WEEK) throw new HttpsError("permission-denied", "subscription_required");
  }

  const [{ level, name }, memSnap, due] = await Promise.all([readLevel(uid), memoryRef(uid).get(), dueCards(uid, now)]);
  const memory = Array.isArray(memSnap.data()?.facts) ? memSnap.data().facts.slice(-MEMORY_CAP) : [];
  const { move, sessionNumber } = await pickMove(uid, level);
  const { regime, picked } = regimeFor(due);
  const who = coachIdentity(voice);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const opening = await makeOpening(ai, who, level, name, memory, move);
  const maxTurns = ["B2", "C1", "C2"].includes(level) ? MAX_TURNS_ADVANCED : MAX_TURNS_DEFAULT;

  const doc = {
    state: "active", startedAt: now, updatedAt: now, sessionNumber, level, voice,
    regime, moveId: move.id, moveText: move.move, moveLabelFr: move.labelFr,
    picked: picked.map((c) => ({ id: c.id, phraseEn: c.phraseEn, kind: c.kind, ok: false })),
    memorySnapshot: memory, openingEn: opening.en, openingFr: opening.fr, maxTurns,
    turns: [], phraseCandidateEn: "", phraseCandidateFr: "", result: null,
  };
  await ref.set(doc);
  return {
    sessionId: dateKey, resumed: false, state: "active", turns: [], maxTurns, regime, reuseTotal: picked.length, reuseDone: 0,
    openingEn: opening.en, openingFr: opening.fr, moveLabelFr: move.labelFr, result: null,
  };
});

const publicTurn = (t) => ({ index: t.index, user: t.user, coach: t.coach, coachFr: t.coachFr, coaching: t.coaching || null, modality: t.modality });

// ---------------------------------------------------------------
function buildPrompt(s, who, name, turnNumber) {
  const facts = (s.memorySnapshot || []).length ? s.memorySnapshot.map((f) => `- ${f}`).join("\n") : "(nothing yet)";
  const pending = (s.picked || []).filter((c) => !c.ok);
  const cards = pending.length
    ? pending.map((c) => `- id "${c.id}": "${c.phraseEn}"`).join("\n")
    : "(none today — just have a good chat)";
  const isLast = turnNumber >= s.maxTurns;
  const coachingUsed = (s.turns || []).some((t) => t.coaching);
  return `You are ${who.name}, a warm English coach (${who.english}). This is a short daily chat with ${name || "the learner"} (level ${s.level}) about THEIR life: their day, work, plans, weekend. You already said hello. Never introduce yourself, never say "let's review" or "let's practise", never list objectives or name grammar points. One short reaction to what they said + ONE question per reply, 1–2 sentences, simple natural English for ${s.level}.
WHAT YOU KNOW ABOUT THEM (use it naturally, never recite it):
${facts}

TODAY'S MOVE — the conversational skill the learner should NEED today. Steer the chat so it comes up by itself; never announce it:
${s.moveText}

PHRASES TO GIVE THEM A CHANCE TO REUSE (create the context so they would naturally say it; NEVER say the phrase yourself):
${cards}
If the learner reuses one of these correctly (same meaning, correct form), put its id in "reused_ok". If they attempt it and get it wrong, reformulate it naturally inside your reply (recast) — no correction card for that.

TURN ${turnNumber} OF ${s.maxTurns}:
${isLast
    ? `- This is the LAST turn: react briefly to what they just said, then close warmly in one sentence. NO question. "is_closing": true.`
    : `- React + one question. ${turnNumber >= 2 && pending.length ? "This is a good moment to create a reuse opportunity if you haven't yet." : ""} "is_closing": false.`}

CORRECTION CARD ("coaching"): ${coachingUsed ? "already used in this chat — set coaching to null, recast silently if needed." : `at most ONE per chat, only for an error that blocks understanding or that they repeat. Otherwise null and recast silently. Card = {"explanation_fr": one short French sentence (tutoiement), "target_phrase_en": their sentence corrected, same meaning}.`}

ALWAYS fill "phrase_of_the_day_candidate_en": the learner's best sentence so far in this chat, corrected if needed, same meaning (never a sentence with an error), and its French translation in "phrase_of_the_day_candidate_fr".
"memory_notes": 0–2 short durable facts you learned about them in THIS answer (job, hobby, family, project), in English, 3–8 words each. Empty array if nothing new.
${s.isText ? "The learner TYPED their answer." : `The learner's answer is in the attached audio: first transcribe it verbatim in "transcript" (keep their mistakes). If there is no intelligible speech, set transcript to "" exactly and never invent words.`}
Respond ONLY with JSON matching the schema.`;
}

const TURN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transcript: { type: Type.STRING },
    reply_en: { type: Type.STRING },
    is_closing: { type: Type.BOOLEAN },
    coaching: { type: Type.OBJECT, nullable: true, properties: { explanation_fr: { type: Type.STRING }, target_phrase_en: { type: Type.STRING } }, required: ["explanation_fr", "target_phrase_en"] },
    reused_ok: { type: Type.ARRAY, items: { type: Type.STRING } },
    phrase_of_the_day_candidate_en: { type: Type.STRING },
    phrase_of_the_day_candidate_fr: { type: Type.STRING },
    memory_notes: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["transcript", "reply_en", "is_closing", "reused_ok", "phrase_of_the_day_candidate_en", "phrase_of_the_day_candidate_fr", "memory_notes"],
};

exports.dailyTalkTurn = onCall({ region: REGION, maxInstances: 5, secrets: [GEMINI_API_KEY], timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
  const uid = requireAuth(request);
  if (request.data?.warmup === true) return { ok: true };
  const { sessionId, audioBase64 = null, mimeType = "audio/mp4", text = null, voice = "us-male", speakingRate = 0.95, clientTurnId = null, audioFormat = "mp3" } = request.data || {};
  if (!isValidDateKey(sessionId)) throw new HttpsError("invalid-argument", "sessionId invalide");
  const isText = typeof text === "string" && text.trim().length > 0;
  if (!isText && (typeof audioBase64 !== "string" || !audioBase64)) throw new HttpsError("invalid-argument", "audio ou texte manquant");
  if (!isText && audioBase64.length > MAX_AUDIO_BASE64_LENGTH) throw new HttpsError("invalid-argument", "Audio trop long");
  if (isText && text.length > 2000) throw new HttpsError("invalid-argument", "Texte trop long");
  const wantPcm = audioFormat === "pcm24k";
  const tStart = Date.now();

  const ref = sessionRef(uid, sessionId);
  const [snap, { name }, genCfg] = await Promise.all([ref.get(), readLevel(uid), readLessonConfig()]);
  const s = snap.data();
  if (!s || s.state !== "active") throw new HttpsError("failed-precondition", "session_not_active");
  const turns = s.turns || [];
  if (clientTurnId) { const dup = turns.find((t) => t.clientTurnId === clientTurnId); if (dup && dup.response) return dup.response; }
  const turnNumber = turns.length + 1;
  if (turnNumber > s.maxTurns) throw new HttpsError("failed-precondition", "session_full");

  const who = coachIdentity(voice);
  const history = [`You: ${s.openingEn}`, ...turns.map((t) => `Learner: ${t.user}\nYou: ${t.coach}`)].join("\n");
  const parts = isText
    ? [{ text: `Conversation so far:\n${history}\n\nThe learner's new written answer:\n"${text.trim()}"` }]
    : [{ text: `Conversation so far:\n${history}\n\nThe learner's new spoken answer is in the attached audio.` }, { inlineData: { mimeType, data: audioBase64 } }];
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  let parsed;
  const tG = Date.now();
  try {
    const res = await genWithRetry(ai, {
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts }],
      config: { systemInstruction: buildPrompt({ ...s, isText }, who, name, turnNumber), responseMimeType: "application/json", responseSchema: TURN_SCHEMA, temperature: 0.8, thinkingConfig: { thinkingLevel: genCfg.thinkingLevel } },
    });
    parsed = JSON.parse(res.text);
  } catch (e) {
    console.error("dailyTalkTurn Gemini", e);
    throw new HttpsError("unavailable", "coach_unavailable");
  }
  const geminiMs = Date.now() - tG;

  const transcript = isText ? text.trim() : str(parsed.transcript, 1000);
  if (!transcript) return { heardNothing: true, reply_en: str(parsed.reply_en) || "Sorry, I didn't catch that — could you say it again?", reply_fr: "" };

  const isLast = turnNumber >= s.maxTurns; // le serveur décide, pas le modèle
  const replyEn = str(parsed.reply_en, 500);
  const coachingUsed = turns.some((t) => t.coaching);
  const coaching = !coachingUsed && parsed.coaching && str(parsed.coaching.target_phrase_en)
    ? { explanationFr: str(parsed.coaching.explanation_fr, 300), targetPhraseEn: str(parsed.coaching.target_phrase_en, 300) } : null;
  const pendingIds = new Set((s.picked || []).filter((c) => !c.ok).map((c) => c.id));
  const reusedOk = (Array.isArray(parsed.reused_ok) ? parsed.reused_ok : []).filter((id) => pendingIds.has(id));
  const notes = (Array.isArray(parsed.memory_notes) ? parsed.memory_notes : []).map((n) => str(n, 80)).filter(Boolean).slice(0, 2);

  // TTS de la réplique uniquement
  const v = VOICES[voice] || VOICES["us-male"];
  const synth = wantPcm ? require("./liveAvatar")._internal.synthesizePcmChunks : synthesize;
  let replyAudioBase64 = null, replyPcmChunks = null;
  const ttsPromise = (replyEn ? synth(replyEn, v, speakingRate) : Promise.resolve(null))
    .then((r) => { if (wantPcm) replyPcmChunks = r; else replyAudioBase64 = r; })
    .catch((e) => console.error("dailyTalkTurn TTS", e));

  const now = Date.now();
  const picked = (s.picked || []).map((c) => (reusedOk.includes(c.id) ? { ...c, ok: true, okAtTurn: turnNumber } : c));
  const response = {
    turnIndex: turnNumber - 1, transcript, reply_en: replyEn, reply_fr: "", coaching, // traduction à la demande
    reusedOk, reuseDone: picked.filter((c) => c.ok).length, reuseTotal: picked.length, isLast,
    replyAudioBase64: null, replyPcmChunks: null,
  };
  const turnDoc = { index: turnNumber - 1, clientTurnId: clientTurnId ? str(clientTurnId, 64) : null, user: transcript, coach: replyEn, coachFr: response.reply_fr, coaching, modality: isText ? "text" : "voice", reusedOk, at: now, response };

  const batch = db.batch();
  batch.set(ref, {
    turns: FieldValue.arrayUnion(turnDoc), picked, updatedAt: now,
    phraseCandidateEn: str(parsed.phrase_of_the_day_candidate_en, 300) || s.phraseCandidateEn || "",
    phraseCandidateFr: str(parsed.phrase_of_the_day_candidate_fr, 300) || s.phraseCandidateFr || "",
  }, { merge: true });
  // Cartes réemployées : succès, prochaine échéance espacée
  for (const id of reusedOk) {
    const card = (s.picked || []).find((c) => c.id === id);
    if (!card) continue;
    const itemRef = itemsCol(uid).doc(id);
    const prevSuccess = typeof card.successCount === "number" ? card.successCount : 0;
    const success = prevSuccess + 1;
    const interval = REVIEW_INTERVALS_DAYS[Math.min(success, REVIEW_INTERVALS_DAYS.length - 1)];
    batch.set(itemRef, { successCount: FieldValue.increment(1), seenCount: FieldValue.increment(1), lastSeenAt: now, nextDueAt: now + interval * DAY_MS, acquired: success >= 3 }, { merge: true });
  }
  if (notes.length) batch.set(memoryRef(uid), { facts: FieldValue.arrayUnion(...notes), updatedAt: now }, { merge: true });
  await Promise.all([ttsPromise, batch.commit()]);
  response.replyAudioBase64 = replyAudioBase64;
  response.replyPcmChunks = replyPcmChunks;
  console.log("dailyTalkTurn timings", JSON.stringify({ gemini_ms: geminiMs, total_ms: Date.now() - tStart, turn: turnNumber, regime: s.regime }));
  return response;
});

// ---------------------------------------------------------------
exports.dailyTalkEnd = onCall({ region: REGION, maxInstances: 5, timeoutSeconds: 30 }, async (request) => {
  const uid = requireAuth(request);
  const { sessionId } = request.data || {};
  if (!isValidDateKey(sessionId)) throw new HttpsError("invalid-argument", "sessionId invalide");
  const ref = sessionRef(uid, sessionId);
  const now = Date.now();
  let result = null;
  await db.runTransaction(async (tx) => {
    const [sSnap, stateSnap, memSnap] = await Promise.all([tx.get(ref), tx.get(db.doc(`users/${uid}/learning/state`)), tx.get(memoryRef(uid))]);
    const s = sSnap.data();
    if (!s) throw new HttpsError("not-found", "session_not_found");
    if (s.result && s.state === "ended") { result = s.result; return; } // idempotent
    const turns = s.turns || [];
    if (turns.length === 0) throw new HttpsError("failed-precondition", "no_turns");
    const picked = s.picked || [];
    result = {
      phraseEn: s.phraseCandidateEn || "", phraseFr: s.phraseCandidateFr || "",
      reusedPhrases: picked.filter((c) => c.ok).map((c) => c.phraseEn),
      missedPhrases: picked.filter((c) => !c.ok).map((c) => c.phraseEn),
      moveLabelFr: s.moveLabelFr || "", turns: turns.length, regime: s.regime, xpGained: XP_DAILY_TALK, at: now,
    };
    // Mémoire personnelle plafonnée (les plus récents)
    const facts = Array.isArray(memSnap.data()?.facts) ? memSnap.data().facts : [];
    if (facts.length > MEMORY_CAP) tx.set(memoryRef(uid), { facts: facts.slice(-MEMORY_CAP) }, { merge: true });
    // Cartes proposées mais non replacées : vues, redues demain
    for (const c of picked) if (!c.ok) tx.set(itemsCol(uid).doc(c.id), { seenCount: FieldValue.increment(1), lastSeenAt: now, nextDueAt: now + DAY_MS }, { merge: true });
    const state = stateSnap.data() || {};
    tx.set(db.doc(`users/${uid}/learning/state`), { xp: (state.xp || 0) + XP_DAILY_TALK, lastDailyTalkAt: now, updatedAt: now }, { merge: true });
    tx.set(ref, { state: "ended", endedAt: now, result, updatedAt: now }, { merge: true });
  });
  return result;
});
