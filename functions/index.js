// Big Tony — un tour de conversation vocale + scoring Azure, scénario paramétré.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenAI, Type } = require("@google/genai");
const textToSpeech = require("@google-cloud/text-to-speech");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const execFileAsync = promisify(execFile);

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const AZURE_SPEECH_KEY = defineSecret("AZURE_SPEECH_KEY");

const AZURE_REGION = "francecentral";
const MAX_AUDIO_BASE64_LENGTH = 2_500_000;
const MAX_HISTORY_TURNS = 12;

// ---------------------------------------------------------------
// Scénarios (source de vérité côté serveur — le client n'envoie qu'un id)
// ---------------------------------------------------------------
const SCENARIOS = {
  // ---- PRO ----
  "entretien-embauche": {
    role: "a JOB INTERVIEWER at an English-speaking company",
    setting: "A job interview for a position the candidate really wants. Professional but human tone.",
    firstTurn: "If this is the first turn, greet the candidate warmly and ask them to introduce themselves.",
    focus: "Ask one question at a time: background, strengths, a challenge they overcame, salary expectations near the end.",
  },
  "point-hebdo-teams": {
    role: "the ENGLISH-SPEAKING MANAGER in a weekly Teams status meeting",
    setting: "A short weekly sync. The employee must report progress, blockers, and next steps on their project.",
    firstTurn: "If this is the first turn, open the meeting casually ('Hi, thanks for joining') and ask for a status update.",
    focus: "Ask follow-up questions about delays, dependencies and deadlines. Occasionally use common corporate idioms naturally.",
  },
  "presentation-pro": {
    role: "a COLLEAGUE attending the person's short work presentation, who asks questions at the end",
    setting: "The person is presenting an idea or project to an international team. You listen, then challenge politely.",
    firstTurn: "If this is the first turn, invite them warmly to start their presentation ('The floor is yours').",
    focus: "Let them present, then ask clarifying and slightly challenging questions about feasibility, cost, and impact.",
  },
  "negociation-salaire": {
    role: "an ENGLISH-SPEAKING MANAGER in a salary raise negotiation",
    setting: "The person is asking for a raise or better conditions. You are fair but push back to test their arguments.",
    firstTurn: "If this is the first turn, acknowledge they asked to talk and invite them to make their case.",
    focus: "Ask them to justify their value with concrete arguments. Negotiate: counter, then find middle ground if they argue well.",
  },
  // ---- VOYAGE ----
  "arrivee-hotel": {
    role: "a HOTEL RECEPTIONIST in New York",
    setting: "Check-in at a Manhattan hotel after a long flight. Friendly, fast-paced, real-world small talk.",
    firstTurn: "If this is the first turn, welcome the guest and ask for their reservation details.",
    focus: "Cover realistic check-in matters: reservation, ID, breakfast hours, wifi, and a small problem to solve.",
  },
  "aeroport-controle": {
    role: "a BORDER CONTROL OFFICER at a US airport",
    setting: "Passport control after landing. Polite but official; routine questions about the trip.",
    firstTurn: "If this is the first turn, ask for their passport and the purpose of their visit.",
    focus: "Ask about purpose of travel, length of stay, accommodation, return ticket. Keep it official but not hostile.",
  },
  "restaurant-commande": {
    role: "a WAITER in a busy American restaurant",
    setting: "The person is ordering a meal. Friendly, chatty, offers recommendations.",
    firstTurn: "If this is the first turn, greet them, mention today's special, and ask if they'd like a drink to start.",
    focus: "Take their order step by step: drinks, starter, main, preferences and allergies. Suggest dishes.",
  },
  // ---- QUOTIDIEN ----
  "rencontre-inconnu": {
    role: "a FRIENDLY STRANGER making small talk at a social event",
    setting: "A casual party or meetup. Light, warm small talk to break the ice.",
    firstTurn: "If this is the first turn, introduce yourself casually and ask an easy opening question.",
    focus: "Keep it light: where they're from, what they do, hobbies, weekend plans. Natural, friendly small talk.",
  },
  "cafe-ami": {
    role: "a CLOSE FRIEND catching up over coffee",
    setting: "Two friends chatting casually. Relaxed, warm, personal.",
    firstTurn: "If this is the first turn, greet them like an old friend and ask how they've been.",
    focus: "Chat about their week, news, plans, feelings. Be warm, react, share a little back. Very casual register.",
  },
  "demander-chemin": {
    role: "a HELPFUL LOCAL giving directions in the street",
    setting: "The person is lost in a city and needs directions to a place.",
    firstTurn: "If this is the first turn, notice they look lost and offer to help.",
    focus: "Help them find their way: understand where they want to go, give directions, landmarks, transport options.",
  },
};

// Consignes de simplification par niveau CECRL, injectées dans chaque prompt.
const LEVEL_GUIDANCE = {
  A1: "The person is a TRUE BEGINNER. Speak VERY slowly and simply: 4-8 word sentences, the 500 most common English words only, present tense. One tiny idea per turn. Never use idioms or phrasal verbs.",
  A2: "The person is ELEMENTARY. Short simple sentences (up to 10 words), common vocabulary, mostly present and past tense. Avoid idioms. Rephrase if they seem lost.",
  B1: "The person is INTERMEDIATE. Clear, everyday English, moderate pace. Simple connectors are fine. Introduce at most one idiom per turn and keep it easy.",
  B2: "The person is UPPER-INTERMEDIATE. Natural conversational English at normal pace. Idioms are fine but stay mainstream. Don't dumb down.",
  C1: "The person is ADVANCED. Speak naturally, full native register, idioms and nuance welcome. Challenge them a little.",
  C2: "The person is NEAR-NATIVE. Full natural native speech, no accommodation needed.",
};

function levelBlock(level) {
  const g = LEVEL_GUIDANCE[level] || LEVEL_GUIDANCE.B1;
  return `\nLEVEL ADAPTATION: ${g}\nIMPORTANT: if the person's previous answers show they are struggling (very short answers, long silences reflected as empty transcripts, visible confusion), simplify further on the fly — shorter sentences, easier words, and gently rephrase your question.`;
}

function buildSystemPrompt(scenario, level, sceneContext, customContext, isLastTurn) {
  const base = customContext
    ? `You are the person's English conversation partner in a scene they described: "${customContext}". Play the most fitting character.`
    : scenario.role
    ? `You are role-playing ${scenario.role}, talking to a French person whose spoken English is hesitant.`
    : `You are the person's English conversation partner in this scene. Play the most fitting character, talking to a French person whose spoken English is hesitant.`;

  // Détails du scénario prédéfini uniquement (absents en scène personnalisée)
  const scenarioLines = (customContext || !scenario.role)
    ? ""
    : `\nSetting: ${scenario.setting}\n${scenario.focus}\n${scenario.firstTurn}`;

  const ctx = sceneContext ? `\nESTABLISHED SCENE (stay consistent with it the whole conversation): ${sceneContext}` : "";

  return `${base}${levelBlock(level)}${ctx}${scenarioLines}

You receive: the conversation so far (text) and the person's latest answer (audio).

Respond ONLY with JSON matching the schema. Fields:
- "transcript": verbatim transcript of what the person said in the audio, in English, including their mistakes. If the audio contains no intelligible speech (silence, breathing, background noise only), set it to "" exactly — NEVER invent words that were not spoken.
- "reply_en": your next line, in character. 1 to 3 sentences of natural spoken English. Your goal is to make the LEARNER talk as much as possible: ask OPEN questions (what, why, how, tell me about…) that require a full sentence to answer. Avoid yes/no questions and avoid giving instructions they just obey. Draw them out.
- "feedback_fr": 1 à 3 phrases EN FRANÇAIS, ton bienveillant MAIS honnête et utile. Commente UNIQUEMENT ce que tu as réellement entendu. Ta priorité : si la phrase contient une VRAIE erreur de grammaire, de structure ou de vocabulaire (temps incorrect, mot mal choisi, ordre des mots non naturel, tournure qu'un anglophone ne dirait jamais), tu DOIS la signaler ET donner la formulation correcte, même si la phrase reste compréhensible. Ne félicite JAMAIS une phrase qui contient une erreur : "compréhensible" n'est pas "correct". Structure ton retour ainsi : (1) reconnais brièvement l'effort ou ce qui est réussi, (2) corrige clairement l'erreur principale en donnant la bonne version en anglais entre guillemets, avec tact. Exemple de ton juste : « Ta phrase se comprend bien ! Une correction : on dit "I'm doing a Master's in history" plutôt que "class level master in university". » Si la phrase est réellement correcte et naturelle, dis-le sincèrement sans inventer de faux problème. Si la réponse était très courte (un ou deux mots), invite gentiment à faire une phrase complète. Pour la prononciation, NE donne PAS de correction phonétique et n'invente JAMAIS une erreur sur un son (le système la mesure séparément) — signale un souci seulement si un mot a été rendu vraiment incompréhensible. Parle directement à la personne ("tu").
- "correction": an object showing the person's sentence and its corrected version, word by word, for a color-coded display.
  - "has_errors": true if the person's sentence contains any grammar, word-order, verb-tense or word-choice error; false if it was already correct and natural.
  - "original": the person's sentence (from the transcript) split into word tokens. Each token: {text, wrong} where "wrong" is true ONLY for the specific words that are grammatically incorrect or wrongly chosen. Keep every word of their sentence in order, including correct ones (wrong=false for those).
  - "corrected": the fully correct, natural English version of their sentence, split into word tokens. Each token: {text, changed} where "changed" is true for words that were added or modified compared to the original. If has_errors is false, "corrected" is identical to "original" with all changed=false.
  Only correct real errors — do NOT rephrase for style if the sentence is already correct. Base "original" strictly on what was actually said (the transcript), never invent words.
  Attach punctuation to the adjacent word within its token (e.g. "countries." as one token).
- "reply_fr": a natural French translation of your "reply_en" line, for a learner who needs help understanding.
- "hard_words": array of words or short expressions FROM your "reply_en" that a French learner at this level might not know. For each: {word, fr} where fr is its French translation in context. Include only genuinely difficult items for this level (0 to 4 items). At high levels this is often empty.
${isLastTurn ? `
THIS IS THE FINAL TURN of the session. In "reply_en", warmly acknowledge what the person just said and give a short, natural CLOSING line. DO NOT ask a new question. Wrap up the conversation.` : ""}
If "transcript" is "": stay in character in "reply_en" with a short line like "Sorry, I didn't catch that — could you say that again?", and in "feedback_fr" dis simplement que tu n'as rien entendu et encourage à réessayer, sans rien inventer.`;
}

const ttsClient = new textToSpeech.TextToSpeechClient();

async function convertToWav(audioBase64) {
  const tmp = os.tmpdir();
  const stamp = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const inPath = path.join(tmp, `in_${stamp}.m4a`);
  const outPath = path.join(tmp, `out_${stamp}.wav`);
  try {
    await fs.writeFile(inPath, Buffer.from(audioBase64, "base64"));
    await execFileAsync(ffmpegPath, [
      "-y", "-i", inPath,
      "-ar", "16000", "-ac", "1", "-f", "wav",
      outPath,
    ]);
    return await fs.readFile(outPath);
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}

async function assessPronunciation(wavBuffer, azureKey) {
  const paConfig = {
    ReferenceText: "",
    GradingSystem: "HundredMark",
    Granularity: "Word",
    Dimension: "Comprehensive",
    EnableMiscue: false,
  };
  const url = `https://${AZURE_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": azureKey,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      "Pronunciation-Assessment": Buffer.from(JSON.stringify(paConfig)).toString("base64"),
      "Accept": "application/json",
    },
    body: wavBuffer,
  });
  if (!resp.ok) {
    throw new Error(`Azure ${resp.status}: ${await resp.text()}`);
  }
  const json = await resp.json();
  const nbest = json.NBest?.[0];
  const pa = nbest?.PronunciationAssessment ?? nbest;
  if (pa?.PronScore === undefined) {
    console.log("Azure PA absent, réponse:", JSON.stringify(json).slice(0, 1500));
    return null;
  }
  const wordScore = (w) => w.PronunciationAssessment?.AccuracyScore ?? w.AccuracyScore;
  return {
    pronScore: pa.PronScore,
    accuracyScore: pa.AccuracyScore,
    fluencyScore: pa.FluencyScore,
    azureText: nbest.Display,
    weakWords: (nbest.Words || [])
      .filter((w) => wordScore(w) !== undefined && wordScore(w) < 75)
      .map((w) => ({ word: w.Word, score: Math.round(wordScore(w)) })),
  };
}

// Compare ce que la personne voulait dire (Gemini) à ce que l'ASR a entendu (Azure)
// et remonte les mots mal prononcés qui ont changé de sens.
async function compareMisheard(ai, intended, heard) {
  if (!intended || !heard) return [];
  try {
    const r = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: `Intended: "${intended}"\nRecognized by the speech engine: "${heard}"` }] }],
      config: {
        systemInstruction: `A French learner spoke English. "Intended" is what they meant to say (clean). "Recognized" is what an automatic speech recognizer actually heard from their audio. Find the words where a MISPRONUNCIATION made the recognizer hear a DIFFERENT, meaning-changing word. Ignore trivial differences (articles, contractions, fillers, punctuation, plural/tense variants, word order). Return JSON {"pairs":[{"said":"<the intended word>","heard":"<what was recognized instead>"}]} with 0 to 3 of the most important pairs, most significant first. Return an empty array if the pronunciation was essentially fine.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pairs: {
              type: Type.ARRAY,
              items: { type: Type.OBJECT, properties: { said: { type: Type.STRING }, heard: { type: Type.STRING } }, required: ["said", "heard"] },
            },
          },
          required: ["pairs"],
        },
        temperature: 0,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
    return JSON.parse(r.text).pairs || [];
  } catch (e) {
    console.warn("compareMisheard error", e);
    return [];
  }
}

exports.spikeTurn = onCall(
  {
    region: "europe-west1",
    secrets: [GEMINI_API_KEY, AZURE_SPEECH_KEY],
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 2,
  },
    async (request) => {
    const { audioBase64, mimeType = "audio/mp4", history = [], scenarioId = "entretien-embauche", level = "B1", sceneContext = null, customContext = null, isLastTurn = false } =
      request.data || {};

    const scenario = scenarioId ? SCENARIOS[scenarioId] : null;
    if (!scenario && !customContext && !sceneContext) {
      throw new HttpsError("invalid-argument", `Scénario inconnu: ${scenarioId}`);
    }
    if (!audioBase64 || typeof audioBase64 !== "string") {
      throw new HttpsError("invalid-argument", "audioBase64 manquant");
    }
    if (audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
      throw new HttpsError("invalid-argument", "Audio trop long (garde-fou coût)");
    }
    const historyText =
      history
        .slice(-MAX_HISTORY_TURNS)
        .map((t) => `Person: ${t.user}\nYou: ${t.coach}`)
        .join("\n") || "(first turn)";

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    const tConv = Date.now();
    let wavBuffer = null;
    try {
      wavBuffer = await convertToWav(audioBase64);
    } catch (e) {
      console.error("ffmpeg error", e);
    }
    const convMs = Date.now() - tConv;

    const t0 = Date.now();
    let geminiMs = 0;
    let azureMs = 0;

    const geminiPromise = ai.models
      .generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              { text: `Conversation so far:\n${historyText}\n\nThe person's new spoken answer is in the attached audio.` },
              { inlineData: { mimeType, data: audioBase64 } },
            ],
          },
        ],
        config: {
          systemInstruction: buildSystemPrompt(scenario ?? {}, level, sceneContext, customContext, isLastTurn),
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcript: { type: Type.STRING },
              reply_en: { type: Type.STRING },
              reply_fr: { type: Type.STRING },
              feedback_fr: { type: Type.STRING },
              hard_words: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    fr: { type: Type.STRING },
                  },
                  required: ["word", "fr"],
                },
              },
              correction: {
                type: Type.OBJECT,
                properties: {
                  has_errors: { type: Type.BOOLEAN },
                  original: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        wrong: { type: Type.BOOLEAN },
                      },
                      required: ["text", "wrong"],
                    },
                  },
                  corrected: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        changed: { type: Type.BOOLEAN },
                      },
                      required: ["text", "changed"],
                    },
                  },
                },
                required: ["has_errors", "original", "corrected"],
              },
            },
            required: ["transcript", "reply_en", "reply_fr", "feedback_fr", "hard_words"],
          },
          temperature: 0.7,
          thinkingConfig: { thinkingLevel: "low" },
        },
      })
      .then((r) => {
        geminiMs = Date.now() - t0;
        return r;
      });

    const azurePromise = wavBuffer
      ? assessPronunciation(wavBuffer, AZURE_SPEECH_KEY.value())
          .then((r) => {
            azureMs = Date.now() - t0;
            return r;
          })
          .catch((e) => {
            console.error("Azure PA error", e);
            azureMs = Date.now() - t0;
            return null;
          })
      : Promise.resolve(null);

    let result, pronunciation;
    try {
      [result, pronunciation] = await Promise.all([geminiPromise, azurePromise]);
    } catch (e) {
      console.error("Gemini error", e);
      throw new HttpsError("internal", `Gemini: ${e.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch (e) {
      console.error("JSON parse error, raw:", result.text);
      throw new HttpsError("internal", "Réponse Gemini non parsable");
    }

    const t1 = Date.now();
    let ttsResponse;
    let misheard = [];
    try {
      const [tts, mh] = await Promise.all([
        ttsClient.synthesizeSpeech({
          input: { text: parsed.reply_en },
          voice: { languageCode: "en-US", name: "en-US-Neural2-D" },
          audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
        }),
        compareMisheard(ai, parsed.transcript, pronunciation?.azureText || ""),
      ]);
      ttsResponse = tts[0];
      misheard = mh;
    } catch (e) {
      console.error("TTS error", e);
      throw new HttpsError("internal", `TTS: ${e.message}`);
    }
    const ttsMs = Date.now() - t1;

   return {
      transcript: parsed.transcript,
      reply_en: parsed.reply_en,
      reply_fr: parsed.reply_fr,
      feedback_fr: parsed.feedback_fr,
      hard_words: parsed.hard_words ?? [],
      misheard,
      pronunciation,
      replyAudioBase64: Buffer.from(ttsResponse.audioContent).toString("base64"),
      timings: { conv_ms: convMs, gemini_ms: geminiMs, azure_ms: azureMs, tts_ms: ttsMs, total_ms: Date.now() - tConv },
      usage: result.usageMetadata ?? null,
    };
  }
);

// ---------------------------------------------------------------
// Débrief de fin de session (inchangé)
// ---------------------------------------------------------------
const DEBRIEF_PROMPT = `You are a warm, honest English pronunciation and speaking coach. You debrief IN FRENCH the conversation session of a French learner who wants to feel more confident speaking English.

You receive each turn with: what the student meant to say, what a literal speech recognizer actually heard (Azure), the pronunciation scores, and the weakest words.

Key insight: when "meant to say" and "was heard as" differ on a word, that word was mispronounced enough that a native speaker would have misunderstood it. C'est l'information la plus précieuse du débrief.

Respond ONLY with JSON matching the schema:
- "points_forts": exactement 2 chaînes, courtes, spécifiques et MÉRITÉES (appuyées sur les données réelles de la session, jamais de compliment inventé).
- "axe": 1 chaîne — LE point prioritaire à travailler, concret et actionnable, appuyé sur les mesures.
- "message_fr": 3 à 4 phrases en français, ton bienveillant, direct et encourageant, en vouvoyant OU tutoyant de façon neutre et professionnelle. PAS de surnoms familiers (jamais "mon pote", "champion", etc.), PAS de personnage. Un coach compétent et humain, sobre. Honnête : si un mot a été entendu comme un autre, dis-le clairement ("quand tu dis X, un Américain entend Y").`;
exports.sessionDebrief = onCall(
  {
    region: "europe-west1",
    secrets: [GEMINI_API_KEY],
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 2,
  },
  async (request) => {
    const { turns = [] } = request.data || {};
    if (!Array.isArray(turns) || turns.length === 0) {
      throw new HttpsError("invalid-argument", "turns manquant ou vide");
    }

    const scored = turns.filter((t) => t.pronunciation);
    const avg = (sel) =>
      scored.length ? Math.round(scored.reduce((s, t) => s + sel(t.pronunciation), 0) / scored.length) : null;
    const weakCounts = {};
    for (const t of scored) {
      for (const w of t.pronunciation.weakWords || []) {
        weakCounts[w.word] = (weakCounts[w.word] || 0) + 1;
      }
    }
    const recurring = Object.entries(weakCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word, n]) => `${word} (x${n})`)
      .join(", ");

    const sessionText = turns
      .map((t, i) => {
        const p = t.pronunciation;
        const lines = [
          `Turn ${i + 1}`,
          `- Student meant to say: "${t.user}"`,
          p ? `- Azure literally heard: "${p.azureText}"` : `- Azure: no measurement`,
          p
            ? `- Scores: pron ${Math.round(p.pronScore)}, accuracy ${Math.round(p.accuracyScore)}, fluency ${Math.round(p.fluencyScore)}${
                p.weakWords?.length ? ` — weak words: ${p.weakWords.map((w) => `${w.word}(${w.score})`).join(", ")}` : ""
              }`
            : "",
          `- Interviewer replied: "${t.coach}"`,
        ];
        return lines.filter(Boolean).join("\n");
      })
      .join("\n\n");

    const summary = `Session summary:\n- Turns: ${turns.length}\n- Average scores: pron ${avg((p) => p.pronScore)}, accuracy ${avg(
      (p) => p.accuracyScore
    )}, fluency ${avg((p) => p.fluencyScore)}\n- Recurring weak words: ${recurring || "none"}\n\n${sessionText}`;

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    let result;
    try {
      result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: summary }] }],
        config: {
          systemInstruction: DEBRIEF_PROMPT,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              points_forts: { type: Type.ARRAY, items: { type: Type.STRING } },
              axe: { type: Type.STRING },
              message_fr: { type: Type.STRING },
            },
            required: ["points_forts", "axe", "message_fr"],
          },
          temperature: 0.8,
          thinkingConfig: { thinkingLevel: "low" },
        },
      });
      return JSON.parse(result.text);
    } catch (e) {
      console.error("Debrief error", e, result?.text);
      throw new HttpsError("internal", `Debrief: ${e.message}`);
    }
  }
);

exports.scenarioOpening = onCall(
  {
    region: "europe-west1",
    secrets: [GEMINI_API_KEY],
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 2,
  },
  async (request) => {
    const { scenarioId = "entretien-embauche", level = "B1", customContext = null } = request.data || {};

    const scenario = scenarioId ? SCENARIOS[scenarioId] : null;
    if (!scenario && !customContext && !sceneContext) {
      throw new HttpsError("invalid-argument", `Scénario inconnu: ${scenarioId}`);
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    // Garde-fou : contexte personnalisé inapproprié
    if (customContext) {
      const safe = await isContextSafe(ai, customContext);
      if (!safe) throw new HttpsError("invalid-argument", "UNSAFE_CONTEXT");
    }

    const roleLine = customContext
      ? `You are the person's English conversation partner in a scene THEY described: "${customContext}". Play the most fitting character for that scene.`
      : `You are role-playing ${scenario.role}. Setting: ${scenario.setting}`;

    const prompt = `${roleLine}${levelBlock(level)}
Invent a brief, concrete, ORIGINAL context for this scene — a specific company/place name, a role, one vivid detail. Be creative and vary it a lot every single time: different industries, cities, situations. Never reuse the obvious default.
Respond ONLY with JSON:
- "context_fr": 1 à 2 phrases EN FRANÇAIS qui plantent le décor pour la personne ("Tu es chez...", "Tu viens d'atterrir..."), concrètes et immersives.
- "reply_en": your OPENING line, in character, 1-2 sentences of natural spoken English, ending with a simple question to get the person talking.
- "reply_fr": a natural French translation of your reply_en.
- "hard_words": array of {word, fr} for words a French learner at this level might not know (0 to 4 items).`;

    let result;
    try {
      result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: "Start the scene." }] }],
        config: {
          systemInstruction: prompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              context_fr: { type: Type.STRING },
              reply_en: { type: Type.STRING },
              reply_fr: { type: Type.STRING },
              hard_words: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { word: { type: Type.STRING }, fr: { type: Type.STRING } },
                  required: ["word", "fr"],
                },
              },
            },
            required: ["context_fr", "reply_en", "reply_fr", "hard_words"],
          },
          temperature: 1.0,
          thinkingConfig: { thinkingLevel: "low" },
        },
      });
    } catch (e) {
      console.error("Opening error", e);
      throw new HttpsError("internal", `Opening: ${e.message}`);
    }
    const parsed = JSON.parse(result.text);

    let ttsResponse;
    try {
      [ttsResponse] = await ttsClient.synthesizeSpeech({
        input: { text: parsed.reply_en },
        voice: { languageCode: "en-US", name: "en-US-Neural2-D" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
      });
    } catch (e) {
      console.error("TTS error", e);
      throw new HttpsError("internal", `TTS: ${e.message}`);
    }

    return {
      context_fr: parsed.context_fr,
      reply_en: parsed.reply_en,
      reply_fr: parsed.reply_fr,
      hard_words: parsed.hard_words ?? [],
      replyAudioBase64: Buffer.from(ttsResponse.audioContent).toString("base64"),
    };
  }
);

// Discussion quotidienne : thème 100% inventé par l'IA, ancré sur le profil.
exports.dailyOpening = onCall(
  {
    region: "europe-west1",
    secrets: [GEMINI_API_KEY],
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 2,
  },
  async (request) => {
    const { level = "B1", interests = [], goals = [], job = null } = request.data || {};

    const profileBits = [];
    if (job) profileBits.push(`their job: ${job}`);
    if (interests.length) profileBits.push(`interests: ${interests.join(", ")}`);
    if (goals.length) profileBits.push(`learning goals: ${goals.join(", ")}`);
    const profileLine = profileBits.length
      ? `Anchor the scene on this person's profile when relevant (${profileBits.join("; ")}), but stay surprising and varied.`
      : `Pick any everyday, travel, or work situation. Stay surprising and varied.`;

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const prompt = `You invent a fresh, original English conversation scene for a daily speaking practice with a French learner.
${profileLine}
Invent a DIFFERENT scene every single time — vary the setting, your role, the city, the situation. Never default to a generic job interview.

CRITICAL — your job is to make the LEARNER talk as much as possible:
- Play a character who ASKS OPEN QUESTIONS and invites the person to explain, describe, tell a story, give an opinion. Questions that need a real sentence to answer, never yes/no.
- NEVER give step-by-step instructions the person just obeys ("follow me", "push the button"). That makes them answer "ok" — useless for practice.
- Pick a scene that naturally pushes them to speak: someone curious about them, a friend asking about their week, a local asking what they think, a colleague wanting details. The person should do most of the talking.
- Each of your lines must end with a question that opens the conversation up, not closes it.
Keep it doable for the level, but always draw them out.
${levelBlock(level)}

Respond ONLY with JSON:
- "theme_fr": 2 à 4 mots EN FRANÇAIS résumant le thème du jour (ex. "Commander à Bangkok", "Un imprévu au bureau").
- "context_fr": 1 à 2 phrases EN FRANÇAIS qui plantent le décor ("Tu es...", "Tu viens de...").
- "reply_en": your OPENING line in character, 1-2 sentences, ending with an OPEN question that makes the person say a full sentence (what, why, how, tell me about…), never a yes/no or an instruction.
- "reply_fr": a natural French translation of reply_en.
- "hard_words": array of {word, fr} for words a French learner at this level might not know (0 to 4 items).`;

    let result;
    try {
      result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: "Invent today's scene." }] }],
        config: {
          systemInstruction: prompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              theme_fr: { type: Type.STRING },
              context_fr: { type: Type.STRING },
              reply_en: { type: Type.STRING },
              reply_fr: { type: Type.STRING },
              hard_words: {
                type: Type.ARRAY,
                items: { type: Type.OBJECT, properties: { word: { type: Type.STRING }, fr: { type: Type.STRING } }, required: ["word", "fr"] },
              },
            },
            required: ["theme_fr", "context_fr", "reply_en", "reply_fr", "hard_words"],
          },
          temperature: 1.1,
          thinkingConfig: { thinkingLevel: "low" },
        },
      });
    } catch (e) {
      console.error("dailyOpening error", e);
      throw new HttpsError("internal", `Daily: ${e.message}`);
    }
    const parsed = JSON.parse(result.text);

    let ttsResponse;
    try {
      [ttsResponse] = await ttsClient.synthesizeSpeech({
        input: { text: parsed.reply_en },
        voice: { languageCode: "en-US", name: "en-US-Neural2-D" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
      });
    } catch (e) {
      console.error("TTS error", e);
      throw new HttpsError("internal", `TTS: ${e.message}`);
    }

    return {
      theme_fr: parsed.theme_fr,
      context_fr: parsed.context_fr,
      reply_en: parsed.reply_en,
      reply_fr: parsed.reply_fr,
      hard_words: parsed.hard_words ?? [],
      replyAudioBase64: Buffer.from(ttsResponse.audioContent).toString("base64"),
    };
  }
);

// ---------------------------------------------------------------
// Labo : évaluation SCRIPTÉE d'une phrase lue (granularité phonème)
// Entrée : { audioBase64, mimeType, referenceText }
// Sortie : { recognized, pronScore, accuracyScore, fluencyScore, words:[{word, score, phonemes:[{phoneme, score}]}] }
// ---------------------------------------------------------------
async function assessScripted(wavBuffer, azureKey, referenceText) {
  const paConfig = {
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme", // ← le mot ET ses phonèmes
    Dimension: "Comprehensive",
    EnableMiscue: true, // scripté : détecte mots omis/insérés
  };
  const url = `https://${AZURE_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": azureKey,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      "Pronunciation-Assessment": Buffer.from(JSON.stringify(paConfig)).toString("base64"),
      "Accept": "application/json",
    },
    body: wavBuffer,
  });
  if (!resp.ok) throw new Error(`Azure ${resp.status}: ${await resp.text()}`);

  const json = await resp.json();
  const nbest = json.NBest?.[0];
  const pa = nbest?.PronunciationAssessment ?? nbest;
  if (pa?.PronScore === undefined) {
    console.log("Labo PA absent:", JSON.stringify(json).slice(0, 1500));
    return null;
  }
  const wAcc = (w) => w.PronunciationAssessment?.AccuracyScore ?? w.AccuracyScore ?? 0;
  const pAcc = (p) => p.PronunciationAssessment?.AccuracyScore ?? p.AccuracyScore ?? 0;
  return {
    recognized: nbest.Display,
    pronScore: pa.PronScore,
    accuracyScore: pa.AccuracyScore,
    fluencyScore: pa.FluencyScore,
    words: (nbest.Words || []).map((w) => ({
      word: w.Word,
      score: Math.round(wAcc(w)),
      errorType: w.PronunciationAssessment?.ErrorType ?? "None",
      phonemes: (w.Phonemes || []).map((p) => ({ phoneme: p.Phoneme, score: Math.round(pAcc(p)) })),
    })),
  };
}

exports.labAssess = onCall(
  {
    region: "europe-west1",
    secrets: [AZURE_SPEECH_KEY],
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 2,
  },
  async (request) => {
    const { audioBase64, mimeType = "audio/mp4", referenceText } = request.data || {};
    if (!audioBase64 || typeof audioBase64 !== "string") {
      throw new HttpsError("invalid-argument", "audioBase64 manquant");
    }
    if (!referenceText || typeof referenceText !== "string") {
      throw new HttpsError("invalid-argument", "referenceText manquant");
    }
    if (audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
      throw new HttpsError("invalid-argument", "Audio trop long (garde-fou coût)");
    }

    let wavBuffer;
    try {
      wavBuffer = await convertToWav(audioBase64);
    } catch (e) {
      console.error("ffmpeg error", e);
      throw new HttpsError("internal", "Conversion audio échouée");
    }

    let result;
    try {
      result = await assessScripted(wavBuffer, AZURE_SPEECH_KEY.value(), referenceText);
    } catch (e) {
      console.error("Labo Azure error", e);
      throw new HttpsError("internal", `Azure: ${e.message}`);
    }
    if (!result) throw new HttpsError("internal", "Rien de reconnu — réessaie en parlant plus fort");
    return result;
  }
);

// Traduction à la demande (mot isolé ou phrase entière) EN → FR
exports.translateText = onCall(
  { region: "europe-west1", secrets: [GEMINI_API_KEY], memory: "256MiB", timeoutSeconds: 20, maxInstances: 3 },
  async (request) => {
    const { text, mode = "word" } = request.data || {};
    if (!text || typeof text !== "string") throw new HttpsError("invalid-argument", "text manquant");
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const instruction =
      mode === "word"
        ? `Translate this English word or short expression into French. Give ONLY the most common French translation, 1 to 4 words, no explanation.`
        : `Translate this English sentence into natural French. Give ONLY the translation, no quotes, no explanation.`;
    try {
      const r = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text }] }],
        config: { systemInstruction: instruction, temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } },
      });
      return { translation: (r.text || "").trim() };
    } catch (e) {
      console.error("translateText error", e);
      throw new HttpsError("internal", `Translate: ${e.message}`);
    }
  }
);

// Filtre les contextes de scène personnalisés inappropriés
async function isContextSafe(ai, text) {
  try {
    const r = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        systemInstruction: `You are a safety filter for a language-learning app used by all ages. Reply with JSON {"safe": boolean}. Mark "safe": false if the scene involves violence, death, self-harm, sexual content, hate, illegal activity, or anything disturbing/morbid/inappropriate for a general-audience learning app. Otherwise "safe": true.`,
        responseMimeType: "application/json",
        responseSchema: { type: Type.OBJECT, properties: { safe: { type: Type.BOOLEAN } }, required: ["safe"] },
        temperature: 0,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
    return JSON.parse(r.text).safe === true;
  } catch (e) {
    console.warn("Safety filter error, refus par défaut:", e);
    return false; // en cas de doute, on refuse
  }
}

// Première discussion après l'onboarding : accueil simple et personnel, pour révéler le produit en douceur.
exports.welcomeOpening = onCall(
  { region: "europe-west1", secrets: [GEMINI_API_KEY], memory: "256MiB", timeoutSeconds: 30, maxInstances: 2 },
  async (request) => {
    const { level = "B1", name = null, interests = [], goals = [], job = null } = request.data || {};

    const bits = [];
    if (name) bits.push(`their name: ${name}`);
    if (job) bits.push(`their job: ${job}`);
    if (interests.length) bits.push(`their interests: ${interests.join(", ")}`);
    if (goals.length) bits.push(`why they're learning English: ${goals.join(", ")}`);
    const profileLine = bits.length ? `What you already know about them: ${bits.join("; ")}.` : "";

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const prompt = `You are a warm, friendly English conversation coach meeting a French learner for their VERY FIRST conversation in the app. This first chat must feel EASY, light and encouraging — the goal is to make them think "oh, I can actually do this, and it's fun", NOT to test or challenge them.

${profileLine}

This is a gentle GET-TO-KNOW-YOU chat, NOT a roleplay scene and NOT a topical quiz. Your opening's job is to make them INTRODUCE THEMSELVES and feel at ease — do NOT dive into a specific narrow topic yet (that comes later, built on their answer). Greet them warmly by first name, add ONE light personal touch as a soft question (an interest or their job — e.g. "I see you're into science — do you work in tech?"), then invite them to tell you a bit about themselves and what brings them here to practise English. Keep the English very simple and easy for their level.
Vibe example: "Hi Jhon! Great to meet you. I see you like science and tech — do you work in that field? Tell me a bit about yourself and what brings you here."
Respond ONLY with JSON:
- "context_fr": 1 phrase EN FRANÇAIS, légère, qui pose l'ambiance ("Première discussion : on apprend à se connaître, tranquillement.").
- "reply_en": your warm opening: 2-3 short simple sentences — greet by first name, one light personal touch (interest or job as a gentle question), and an invitation to introduce themselves / say what brings them here. NOT a narrow topical question.
- "reply_fr": a natural French translation of reply_en.
- "hard_words": array of {word, fr} for words a French learner at this level might not know (0 to 3 items, usually few since it stays simple).`;

    let result;
    try {
      result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: "Start the welcome chat." }] }],
        config: {
          systemInstruction: prompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              context_fr: { type: Type.STRING },
              reply_en: { type: Type.STRING },
              reply_fr: { type: Type.STRING },
              hard_words: {
                type: Type.ARRAY,
                items: { type: Type.OBJECT, properties: { word: { type: Type.STRING }, fr: { type: Type.STRING } }, required: ["word", "fr"] },
              },
            },
            required: ["context_fr", "reply_en", "reply_fr", "hard_words"],
          },
          temperature: 1.0,
          thinkingConfig: { thinkingLevel: "low" },
        },
      });
    } catch (e) {
      console.error("welcomeOpening error", e);
      throw new HttpsError("internal", `Welcome: ${e.message}`);
    }
    const parsed = JSON.parse(result.text);

    let ttsResponse;
    try {
      [ttsResponse] = await ttsClient.synthesizeSpeech({
        input: { text: parsed.reply_en },
        voice: { languageCode: "en-US", name: "en-US-Neural2-D" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
      });
    } catch (e) {
      console.error("TTS error", e);
      throw new HttpsError("internal", `TTS: ${e.message}`);
    }

    return {
      context_fr: parsed.context_fr,
      reply_en: parsed.reply_en,
      reply_fr: parsed.reply_fr,
      hard_words: parsed.hard_words ?? [],
      replyAudioBase64: Buffer.from(ttsResponse.audioContent).toString("base64"),
    };
  }
);

// Expression du jour : une expression/idiome utile, ancrée sur le profil, renouvelée chaque jour.
exports.dailyExpression = onCall(
  { region: "europe-west1", secrets: [GEMINI_API_KEY], memory: "256MiB", timeoutSeconds: 20, maxInstances: 2 },
  async (request) => {
    const { level = "B1", interests = [], goals = [], job = null, seed = "" } = request.data || {};

    const bits = [];
    if (job) bits.push(`job: ${job}`);
    if (interests.length) bits.push(`interests: ${interests.join(", ")}`);
    if (goals.length) bits.push(`goals: ${goals.join(", ")}`);
    const profileLine = bits.length
      ? `Tailor it to this learner when relevant (${bits.join("; ")}) — e.g. meeting/office expressions for someone targeting work English.`
      : `Pick a broadly useful everyday expression.`;

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const prompt = `Give ONE useful English expression or idiom a French learner would love to know — natural, commonly used by native speakers, not textbook-stiff.
${profileLine}
Pick a DIFFERENT one each time; vary register and theme. Keep it doable for their level.${levelBlock(level)}
Respond ONLY with JSON:
- "en": the expression itself (short, a few words).
- "fr": its natural French meaning/translation.
- "example_en": one short natural example sentence using it.
- "example_fr": the French translation of that example.
Variation token (ignore in output, just use it to vary): ${seed}`;

    try {
      const r = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: "Give today's expression." }] }],
        config: {
          systemInstruction: prompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              en: { type: Type.STRING },
              fr: { type: Type.STRING },
              example_en: { type: Type.STRING },
              example_fr: { type: Type.STRING },
            },
            required: ["en", "fr", "example_en", "example_fr"],
          },
          temperature: 1.15,
          thinkingConfig: { thinkingLevel: "low" },
        },
      });
      return JSON.parse(r.text);
    } catch (e) {
      console.error("dailyExpression error", e);
      throw new HttpsError("internal", `Expression: ${e.message}`);
    }
  }
);

// Fiche de prononciation d'un mot : explication FR + phonétique + audio modèle.
exports.wordCoaching = onCall(
  { region: "europe-west1", secrets: [GEMINI_API_KEY], memory: "256MiB", timeoutSeconds: 25, maxInstances: 3 },
  async (request) => {
    const { word = "" } = request.data || {};
    if (!word || typeof word !== "string") throw new HttpsError("invalid-argument", "word manquant");

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const prompt = `You help a FRENCH speaker pronounce an English word. Word: "${word}".
Respond ONLY with JSON:
- "ipa": the IPA transcription, US English, with slashes (e.g. "/ʃuːt/").
- "meaning_fr": a very short French meaning (a few words).
- "how_to_fr": 2 to 3 sentences IN FRENCH explaining concretely HOW to pronounce this word right — position de la bouche/langue, découpage en syllabes, le(s) son(s) difficile(s) pour un francophone. Pratique et imagé, jamais théorique. Tutoie.
- "trap_fr": one short French sentence naming THE most common French-speaker mistake on this exact word (ce qu'il ne faut PAS faire).`;

    let coaching;
    try {
      const r = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: `Coach the word "${word}".` }] }],
        config: {
          systemInstruction: prompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ipa: { type: Type.STRING },
              meaning_fr: { type: Type.STRING },
              how_to_fr: { type: Type.STRING },
              trap_fr: { type: Type.STRING },
            },
            required: ["ipa", "meaning_fr", "how_to_fr", "trap_fr"],
          },
          temperature: 0.5,
          thinkingConfig: { thinkingLevel: "low" },
        },
      });
      coaching = JSON.parse(r.text);
    } catch (e) {
      console.error("wordCoaching error", e);
      throw new HttpsError("internal", `Coaching: ${e.message}`);
    }

    let audioBase64 = "";
    try {
      const [tts] = await ttsClient.synthesizeSpeech({
        input: { text: word },
        voice: { languageCode: "en-US", name: "en-US-Neural2-D" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.9 },
      });
      audioBase64 = Buffer.from(tts.audioContent).toString("base64");
    } catch (e) {
      console.warn("wordCoaching TTS error", e);
    }

    return { ...coaching, audioBase64 };
  }
);