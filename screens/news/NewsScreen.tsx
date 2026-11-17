// NewsScreen — une actu du jour, de bout en bout (maquettes du 16/11) : lecture → quiz → résultat → discussion avec le coach.
// Tout le contenu vient de l'édition déjà chargée (lib/news) : rien n'est généré ici. « Actu suivante » enchaîne sur la carte d'après.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Image, Linking, ActivityIndicator, GestureResponderEvent } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { Feather } from "@expo/vector-icons";
import { functions } from "../../lib/firebase";
import { loadProfile } from "../../lib/profile";
import { awardXp } from "../../lib/xp";
import { coachForVoice, type LessonCoach } from "../../lib/learningPath/coaches";
import { O, CoachMedallion, PrimaryCta, SecondaryLink } from "../../components/onbUi";
import NewsCover from "../../components/NewsCover";
import NewsTextSheet from "../../components/NewsTextSheet";
import NewsDiscussion from "./NewsDiscussion";
import {
  NEWS_LEVELS, NEWS_LEVEL_LABEL, newsLevelFor, newsAudioUrl, loadNewsProgress, saveNewsQuiz, markNewsDiscussed,
  type NewsEdition, type NewsItem, type NewsLevel, type NewsLevelContent, type NewsProgress, type NewsWord,
} from "../../lib/news";
import { logNewsOpened, logNewsAudioPlayed, logNewsWordTapped, logNewsQuizStarted, logNewsQuizDone, logNewsDiscussClick } from "../../lib/analytics";

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

type Phase = "article" | "quiz" | "result" | "discussion";
type NewsCtx = { news_id: string; rubrique: string; level: string; position: number };
const INK = O.ink;
const RED = "#C8473B";
const RED_SOFT = "#FBE4E1";

// Prononciation d'un mot ou d'une phrase par la voix du coach (même service que les leçons)
function useSpeak(voice: string, speakingRate: number) {
  const player = useAudioPlayer();
  const [busy, setBusy] = useState<string | null>(null);
  const speak = async (key: string, text: string) => {
    if (!text || busy) return;
    setBusy(key);
    try {
      const res: any = await translateText({ text, mode: "speak", voice, speakingRate });
      if (res.data?.audioBase64) {
        const p = `${FileSystem.cacheDirectory}news_tts_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(p, res.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
        player.replace(p); player.play();
      }
    } catch (e) { console.warn("Lecture échouée:", e); }
    finally { setBusy(null); }
  };
  return { speak, busy };
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Retour">
        <Feather name="arrow-left" size={26} color={INK} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
    </View>
  );
}

// Découpe le texte autour des mots difficiles (mots entiers, sans tenir compte des majuscules)
function splitHardWords(text: string, words: NewsWord[]): { text: string; word?: NewsWord }[] {
  const list = [...words].filter((w) => w.word.length > 1).sort((a, b) => b.word.length - a.word.length);
  if (list.length === 0) return [{ text }];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(list.map((w) => escape(w.word)).join("|"), "gi");
  const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);
  const out: { text: string; word?: NewsWord }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index, end = start + m[0].length;
    if (isLetter(text[start - 1]) || isLetter(text[end])) continue; // au milieu d'un autre mot
    const word = list.find((w) => w.word.toLowerCase() === m![0].toLowerCase());
    if (!word) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: m[0], word });
    last = end;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const mmss = (sec: number) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------
function ArticleView({ item, title, level, userLevel, content, coach, voice, speakingRate, quizDone, onLevel, onBack, onQuiz, onSeeResult, ctx }: {
  item: NewsItem; title: string; level: NewsLevel; userLevel: NewsLevel; content: NewsLevelContent; coach: LessonCoach; voice: string; speakingRate: number;
  quizDone: boolean; onLevel: (l: NewsLevel) => void; onBack: () => void; onQuiz: () => void; onSeeResult: () => void; ctx: () => NewsCtx;
}) {
  const audioUrl = newsAudioUrl(content, voice);
  const player = useAudioPlayer(audioUrl ? { uri: audioUrl } : null);
  const status = useAudioPlayerStatus(player);
  const [rate, setRate] = useState(1);
  const [showFr, setShowFr] = useState(false);
  const [tip, setTip] = useState<{ word: NewsWord; left: number; top: number } | null>(null);
  const cardRef = useRef<View>(null);
  const playedRef = useRef(false);
  const { speak, busy } = useSpeak(voice, speakingRate);
  const segments = useMemo(() => splitHardWords(content.text, content.hard_words), [content]);

  useEffect(() => { setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {}); }, []);
  useEffect(() => { setTip(null); playedRef.current = false; }, [item.id, level]);
  useEffect(() => { try { player.setPlaybackRate(rate); } catch {} }, [player, rate]);

  const finished = status.duration > 0 && status.currentTime >= status.duration - 0.25;
  const togglePlay = async () => {
    try {
      if (status.playing) { player.pause(); return; }
      if (finished) await player.seekTo(0);
      player.play();
      if (!playedRef.current) { playedRef.current = true; logNewsAudioPlayed(ctx()); }
    } catch (e) { console.warn("Lecture de l'actu échouée:", e); }
  };
  const openWord = (word: NewsWord, e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    if (tip?.word.word === word.word) { setTip(null); return; }
    logNewsWordTapped(ctx());
    cardRef.current?.measureInWindow((x, y, w) => {
      setTip({ word, left: Math.max(8, Math.min(pageX - x - 70, w - 200)), top: Math.max(4, pageY - y - 60) });
    });
  };
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

  return (
    <View style={styles.screen}>
      <Header title={title} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} onScrollBeginDrag={() => setTip(null)}>
        <NewsCover item={item} chip="lavender" radius={20} style={styles.articleCover} />
        <Text style={styles.articleTitle} accessibilityRole="header">{item.titleEn}</Text>
        {item.titleFr ? <Text style={styles.articleTitleFr}>{item.titleFr}</Text> : null}

        <View style={styles.segmented} accessibilityRole="tablist">
          {NEWS_LEVELS.map((l) => (
            <Pressable key={l} onPress={() => onLevel(l)} style={[styles.segment, l === level && styles.segmentOn]} accessibilityRole="tab" accessibilityState={{ selected: l === level }}>
              <Text style={[styles.segmentText, l === level && { color: "#fff" }]} maxFontSizeMultiplier={1.2}>{NEWS_LEVEL_LABEL[l]}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.levelNote}>
          <View style={styles.levelCheck}><Feather name="check" size={13} color="#fff" /></View>
          <Text style={styles.levelNoteText}>Ton niveau : <Text style={{ fontWeight: "800" }}>{NEWS_LEVEL_LABEL[userLevel]}</Text></Text>
        </View>

        {audioUrl ? (
          <View style={styles.playerCard}>
            <Image source={coach.poster} style={styles.playerAvatar} resizeMode="cover" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.playerTitle}>Écouter avec {coach.displayName}</Text>
              <View style={styles.playerRow}>
                <Pressable onPress={togglePlay} style={styles.playBtn} accessibilityRole="button" accessibilityLabel={status.playing ? "Mettre en pause" : "Écouter le texte"}>
                  {playedRef.current && !status.isLoaded
                    ? <ActivityIndicator color={INK} />
                    : <Feather name={status.playing ? "pause" : "play"} size={20} color={INK} style={status.playing ? undefined : { marginLeft: 3 }} />}
                </Pressable>
                <Text style={styles.time}>{mmss(status.currentTime)}</Text>
                <View style={styles.track}><View style={[styles.trackFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
                <Text style={styles.time}>{status.duration > 0 ? mmss(status.duration) : "–:––"}</Text>
                <Pressable onPress={() => setRate((r) => (r === 1 ? 0.8 : 1))} style={styles.rate} hitSlop={6} accessibilityRole="button" accessibilityLabel={rate === 1 ? "Vitesse normale. Ralentir" : "Vitesse lente. Revenir à la vitesse normale"}>
                  <Text style={styles.rateText} maxFontSizeMultiplier={1.2}>{rate === 1 ? "1×" : "0,8×"}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        <View ref={cardRef} style={styles.textCard} collapsable={false}>
          <Text style={styles.body} onPress={() => setTip(null)} suppressHighlighting>
            {segments.map((seg, i) => seg.word
              ? <Text key={i} style={styles.hard} onPress={(e) => openWord(seg.word!, e)} accessibilityRole="button" accessibilityLabel={`${seg.text}, traduction : ${seg.word.fr}`}>{seg.text}</Text>
              : seg.text)}
          </Text>
          {tip ? (
            <Pressable onPress={() => speak("tip", tip.word.word)} style={[styles.tip, { left: tip.left, top: tip.top }]} accessibilityRole="button" accessibilityLabel={`${tip.word.word} : ${tip.word.fr}. Écouter`}>
              {busy === "tip" ? <ActivityIndicator size="small" color={O.lavenderInk} /> : <Feather name="volume-2" size={16} color={O.lavenderInk} />}
              <Text style={styles.tipText}>{tip.word.word} <Text style={{ fontWeight: "600" }}>→</Text> {tip.word.fr}</Text>
            </Pressable>
          ) : null}
          {item.summaryFr ? (
            <Pressable onPress={() => setShowFr((v) => !v)} style={styles.frToggle} accessibilityRole="button" accessibilityState={{ expanded: showFr }}>
              <Feather name={showFr ? "chevron-up" : "chevron-down"} size={20} color={O.lavenderInk} />
              <View style={{ flex: 1 }}>
                <Text style={styles.frToggleText}>{showFr ? "Résumé en français" : "Voir le résumé en français"}</Text>
                {showFr ? <Text style={styles.frText}>{item.summaryFr}</Text> : null}
              </View>
            </Pressable>
          ) : null}
        </View>

        {item.source.url ? (
          <Pressable onPress={() => Linking.openURL(item.source.url).catch(() => {})} hitSlop={6} accessibilityRole="link" accessibilityLabel={`D'après ${item.source.name}. Lire l'article d'origine`}>
            <Text style={styles.source}>D'après {item.source.name || "la presse"} · <Text style={styles.sourceLink}>Lire l'article d'origine</Text> ↗</Text>
          </Pressable>
        ) : null}
        <Text style={styles.credits}>Texte rédigé par Déclic Anglais{item.image ? " · illustration générée par IA" : ""}.</Text>
      </ScrollView>
      <View style={styles.bottom}>
        <PrimaryCta label={quizDone ? "Refaire le quiz" : "Faire le quiz"} onPress={onQuiz} />
        {quizDone ? <SecondaryLink label="Voir mon résultat" onPress={onSeeResult} /> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------
function QuizView({ item, title, content, onBack, onDone }: { item: NewsItem; title: string; content: NewsLevelContent; onBack: () => void; onDone: (score: number, total: number) => void }) {
  const questions = content.questions.slice(0, 3);
  const [q, setQ] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [showText, setShowText] = useState(false);
  const cur = questions[q];
  const answered = picked !== null;
  const right = answered && picked === cur.answer;
  const pick = (i: number) => {
    if (answered) return;
    setPicked(i);
    if (i === cur.answer) setScore((s) => s + 1);
  };
  const next = () => {
    if (q + 1 >= questions.length) { onDone(score, questions.length); return; }
    setQ(q + 1); setPicked(null);
  };
  return (
    <View style={styles.screen}>
      <Header title={title} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.quizCount} accessibilityRole="header">Question {q + 1}/{questions.length}</Text>
        <View style={styles.quizSegments}>
          {questions.map((_, i) => <View key={i} style={[styles.quizSegment, i <= q && { backgroundColor: O.primary }]} />)}
        </View>

        <View style={styles.recap}>
          <NewsCover item={item} radius={12} style={styles.recapThumb} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.recapTitle} numberOfLines={1}>{item.titleEn}</Text>
            <Pressable onPress={() => setShowText(true)} hitSlop={8} accessibilityRole="button"><Text style={styles.recapLink}>Revoir le texte</Text></Pressable>
          </View>
        </View>

        <View style={styles.quizCard}>
          <View style={styles.quizChip}><Text style={styles.quizChipText} maxFontSizeMultiplier={1.2}>QUESTION {q + 1}</Text></View>
          <Text style={styles.question}>{cur.question}</Text>
          <View accessibilityRole="radiogroup">
            {cur.options.map((opt, i) => {
              const isAnswer = answered && i === cur.answer;
              const isWrongPick = answered && i === picked && i !== cur.answer;
              return (
                <Pressable key={i} onPress={() => pick(i)} disabled={answered} style={[styles.option, isAnswer && styles.optionRight, isWrongPick && styles.optionWrong]} accessibilityRole="radio" accessibilityState={{ checked: picked === i, disabled: answered }} accessibilityLabel={`${opt}${isAnswer ? ", bonne réponse" : isWrongPick ? ", mauvaise réponse" : ""}`}>
                  <View style={[styles.letter, isAnswer && { backgroundColor: O.success }, isWrongPick && { backgroundColor: "#F3B5AE" }]}>
                    <Text style={[styles.letterText, isAnswer && { color: "#fff" }]} maxFontSizeMultiplier={1.2}>{String.fromCharCode(65 + i)}</Text>
                  </View>
                  <Text style={styles.optionText}>{opt}</Text>
                  {isAnswer ? <Feather name="check" size={22} color={O.success} /> : isWrongPick ? <Feather name="x" size={22} color={RED} /> : null}
                </Pressable>
              );
            })}
          </View>
          {answered ? (
            <View style={[styles.verdict, right ? { backgroundColor: O.mint } : { backgroundColor: RED_SOFT }]} accessibilityLiveRegion="polite">
              <View style={[styles.verdictIcon, { backgroundColor: right ? O.success : RED }]}><Feather name={right ? "check" : "x"} size={14} color="#fff" /></View>
              <Text style={[styles.verdictText, { color: right ? O.success : RED }]}>{right ? "Bien vu !" : "Pas tout à fait."}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <View style={styles.bottom}>
        <PrimaryCta label={q + 1 >= questions.length ? "Voir mon résultat" : "Question suivante"} onPress={next} disabled={!answered} />
      </View>
      <NewsTextSheet visible={showText} item={item} text={content.text} onClose={() => setShowText(false)} />
    </View>
  );
}

// ---------------------------------------------------------------
// Résultat du quiz
// ---------------------------------------------------------------
function ResultView({ item, title, content, score, total, coach, premium, isLast, voice, speakingRate, onBack, onReread, onDiscuss, onNext }: {
  item: NewsItem; title: string; content: NewsLevelContent; score: number; total: number; coach: LessonCoach; premium: boolean; isLast: boolean; voice: string; speakingRate: number;
  onBack: () => void; onReread: () => void; onDiscuss: () => void; onNext: () => void;
}) {
  const { speak, busy } = useSpeak(voice, speakingRate);
  const good = score >= Math.ceil(total * 0.6);
  const verdict = score === total ? "Tout compris !" : good ? "tu as compris l'essentiel." : "On relit ensemble ?";
  return (
    <View style={styles.screen}>
      <Header title={title} onBack={onBack} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 28 }]} showsVerticalScrollIndicator={false}>
        <NewsCover item={item} radius={20} style={styles.resultCover} />
        <View style={styles.resultMedal}><CoachMedallion source={coach.poster} size={112} check={good} /></View>
        <View style={[styles.resultBox, !good && { backgroundColor: O.primarySoft }]}>
          <Text style={styles.resultTitle} accessibilityRole="header">{score}/{total} — {verdict}</Text>
        </View>
        {!good ? <SecondaryLink label="Relire le texte" onPress={onReread} /> : null}

        {content.hard_words.length > 0 ? (
          <View style={styles.wordsCard}>
            <Text style={styles.wordsTitle}>Mots à retenir</Text>
            {content.hard_words.map((w, i) => (
              <Pressable key={`${w.word}-${i}`} onPress={() => speak(`w${i}`, w.word)} style={styles.wordRow} accessibilityRole="button" accessibilityLabel={`${w.word} : ${w.fr}. Écouter`}>
                <Text style={styles.wordEn}>{w.word}</Text>
                <Text style={styles.wordArrow}>→</Text>
                <Text style={styles.wordFr} numberOfLines={2}>{w.fr}</Text>
                {busy === `w${i}` ? <ActivityIndicator size="small" color={O.lavenderInk} /> : <Feather name="volume-2" size={20} color={O.lavenderInk} />}
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.tellCard}>
          <Text style={styles.tellTitle}>Raconte-moi cette actu.</Text>
          <Text style={styles.tellBody}>Deux ou trois phrases suffisent, je t'aide si tu bloques.</Text>
        </View>

        <Pressable onPress={onDiscuss} style={styles.discuss} accessibilityRole="button" accessibilityLabel={`En discuter avec ${coach.displayName}${premium ? "" : ", réservé aux abonnés"}`}>
          {!premium ? <Feather name="lock" size={20} color={INK} /> : null}
          <Text style={styles.discussText} maxFontSizeMultiplier={1.3}>En discuter avec {coach.displayName}{premium ? "" : " · Premium"}</Text>
        </Pressable>
        <Text style={styles.discussNote}>{premium ? "2 min · à l'oral" : "La discussion avec ton coach fait partie de l'abonnement."}</Text>
        <SecondaryLink label={isLast ? "Retour aux actus" : "Actu suivante"} onPress={onNext} />
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------
// Écran
// ---------------------------------------------------------------
export default function NewsScreen({ edition, startIndex, premium, onExit, onLocked }: {
  edition: NewsEdition;
  startIndex: number;
  premium: boolean;
  onExit: () => void;
  onLocked: () => void; // discussion réservée aux abonnés : l'app ouvre le paywall par-dessus
}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(edition.items.length - 1, startIndex)));
  const [phase, setPhase] = useState<Phase>("article");
  const [profile, setProfile] = useState({ level: "A2", voice: "us-male", speechRate: 0.95 });
  const [level, setLevel] = useState<NewsLevel>("A2");
  const [progress, setProgress] = useState<NewsProgress>({});
  const levelChosenRef = useRef(false); // l'utilisateur a choisi lui-même un niveau : on ne le remplace plus

  const item = edition.items[index];
  const content = item.levels[level];
  const coach = coachForVoice(profile.voice);
  const userLevel = newsLevelFor(profile.level);
  const isLast = index >= edition.items.length - 1;
  const title = `L'actu du jour · ${index + 1}/${edition.items.length}`;
  const quiz = progress[item.id]?.quiz ?? null;
  const ctx = (): NewsCtx => ({ news_id: item.id, rubrique: item.rubrique, level, position: item.position });

  useEffect(() => {
    let cancelled = false;
    loadProfile().then((p) => {
      if (cancelled || !p) return;
      setProfile({ level: p.level ?? "A2", voice: p.voice ?? "us-male", speechRate: p.speechRate ?? 0.95 });
      if (!levelChosenRef.current) setLevel(newsLevelFor(p.level));
    }).catch(() => {});
    loadNewsProgress(edition.date).then((p) => { if (!cancelled) setProgress({ ...p }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [edition.date]);

  useEffect(() => { logNewsOpened({ news_id: item.id, rubrique: item.rubrique, level, position: item.position }); }, [item.id]);

  const goNext = () => {
    if (isLast) { onExit(); return; }
    setIndex(index + 1); setPhase("article");
  };
  const finishQuiz = (score: number, total: number) => {
    logNewsQuizDone(ctx(), score, total);
    setProgress((p) => ({ ...p, [item.id]: { ...(p[item.id] ?? {}), quiz: { score, total } } }));
    saveNewsQuiz(edition.date, item.id, score, total).catch(() => {});
    awardXp("exercise", `news_${item.id}`); // même barème que les exercices du jour (plafonné par le serveur)
    setPhase("result");
  };
  const discuss = () => {
    if (!premium) { logNewsDiscussClick(ctx(), "paywall"); onLocked(); return; }
    logNewsDiscussClick(ctx(), "discussion");
    setPhase("discussion");
  };

  if (phase === "discussion") {
    return (
      <NewsDiscussion
        key={item.id}
        item={item}
        isLast={isLast}
        ctx={ctx()}
        onBack={() => setPhase("result")}
        onLocked={() => { setPhase("result"); onLocked(); }}
        onDiscussed={() => {
          setProgress((p) => ({ ...p, [item.id]: { ...(p[item.id] ?? {}), discussed: true } }));
          markNewsDiscussed(edition.date, item.id).catch(() => {});
        }}
        onNext={goNext}
        onFinish={onExit}
      />
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      {phase === "article" ? (
        <ArticleView
          key={`a-${item.id}`}
          item={item} title={title} level={level} userLevel={userLevel} content={content} coach={coach} voice={profile.voice} speakingRate={profile.speechRate}
          quizDone={!!quiz}
          onLevel={(l) => { levelChosenRef.current = true; setLevel(l); }}
          onBack={onExit}
          onQuiz={() => { logNewsQuizStarted(ctx()); setPhase("quiz"); }}
          onSeeResult={() => setPhase("result")}
          ctx={ctx}
        />
      ) : phase === "quiz" ? (
        <QuizView key={`q-${item.id}-${level}`} item={item} title={title} content={content} onBack={() => setPhase("article")} onDone={finishQuiz} />
      ) : (
        <ResultView
          key={`r-${item.id}`}
          item={item} title={title} content={content} score={quiz?.score ?? 0} total={quiz?.total ?? content.questions.slice(0, 3).length}
          coach={coach} premium={premium} isLast={isLast} voice={profile.voice} speakingRate={profile.speechRate}
          onBack={() => setPhase("article")} onReread={() => setPhase("article")} onDiscuss={discuss} onNext={goNext}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: O.bg, paddingTop: 50 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, marginBottom: 10 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: INK, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  scroll: { paddingHorizontal: O.gutter, paddingBottom: 16 },
  bottom: { paddingHorizontal: O.gutter, paddingTop: 10, paddingBottom: 14, backgroundColor: O.bg },

  articleCover: { width: "100%", aspectRatio: 2 },
  articleTitle: { color: INK, fontSize: 28, fontWeight: "800", lineHeight: 34, letterSpacing: -0.5, marginTop: 14 },
  articleTitleFr: { color: O.muted, fontSize: 16, lineHeight: 22, marginTop: 4 },
  segmented: { flexDirection: "row", backgroundColor: O.surface, borderRadius: 18, borderWidth: 1, borderColor: O.border, padding: 3, marginTop: 16 },
  segment: { flex: 1, minHeight: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: O.navy },
  segmentText: { color: INK, fontSize: 15.5, fontWeight: "800" },
  levelNote: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: O.mint, borderRadius: 14, paddingVertical: 9, paddingHorizontal: 14, marginTop: 10 },
  levelCheck: { width: 22, height: 22, borderRadius: 11, backgroundColor: O.success, alignItems: "center", justifyContent: "center" },
  levelNoteText: { color: O.success, fontSize: 15, fontWeight: "600" },

  playerCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: O.surface, borderRadius: 20, borderWidth: 1, borderColor: O.border, padding: 12, marginTop: 12 },
  playerAvatar: { width: 64, height: 64, borderRadius: 32 },
  playerTitle: { color: INK, fontSize: 17, fontWeight: "800", marginBottom: 6 },
  playerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  playBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: O.primary, alignItems: "center", justifyContent: "center" },
  time: { color: O.muted, fontSize: 12.5, fontWeight: "600", minWidth: 30, textAlign: "center" },
  track: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "#E5E0DA", overflow: "hidden" },
  trackFill: { height: 5, borderRadius: 3, backgroundColor: O.primary },
  rate: { backgroundColor: O.lavender, borderRadius: 999, minWidth: 46, minHeight: 32, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  rateText: { color: INK, fontSize: 13.5, fontWeight: "800" },

  textCard: { backgroundColor: O.surface, borderRadius: 20, borderWidth: 1, borderColor: O.border, padding: 16, marginTop: 12 },
  body: { color: INK, fontSize: 18.5, lineHeight: 31 },
  hard: { textDecorationLine: "underline", textDecorationStyle: "dotted", textDecorationColor: "#8C7BEA" },
  tip: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E9E3FB", borderRadius: 999, borderWidth: 1, borderColor: "#CFC5F5", paddingVertical: 8, paddingHorizontal: 14, minHeight: 40, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  tipText: { color: "#3F3399", fontSize: 15.5, fontWeight: "800" },
  frToggle: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: O.lavender, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginTop: 14 },
  frToggleText: { color: O.lavenderInk, fontSize: 15.5, fontWeight: "800" },
  frText: { color: INK, fontSize: 15, lineHeight: 22, marginTop: 6 },
  source: { color: O.muted, fontSize: 13, marginTop: 12, marginHorizontal: 4 },
  sourceLink: { textDecorationLine: "underline" },
  credits: { color: O.muted, fontSize: 12, fontStyle: "italic", marginTop: 4, marginHorizontal: 4 },

  quizCount: { color: INK, fontSize: 26, fontWeight: "800", textAlign: "center", letterSpacing: -0.4, marginTop: 4 },
  quizSegments: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 18, paddingHorizontal: 12 },
  quizSegment: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#D9D5D0" },
  recap: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: O.surface, borderRadius: 20, borderWidth: 1, borderColor: O.border, padding: 10 },
  recapThumb: { width: 104, height: 62 },
  recapTitle: { color: INK, fontSize: 15, fontWeight: "800" },
  recapLink: { color: O.lavenderInk, fontSize: 15, fontWeight: "700", textDecorationLine: "underline", marginTop: 4 },
  quizCard: { backgroundColor: O.surface, borderRadius: 22, borderWidth: 1, borderColor: O.border, padding: 16, marginTop: 14 },
  quizChip: { alignSelf: "flex-start", backgroundColor: "#FFD3AC", borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 },
  quizChipText: { color: INK, fontSize: 13, fontWeight: "800", letterSpacing: 0.4 },
  question: { color: INK, fontSize: 23, fontWeight: "800", lineHeight: 30, letterSpacing: -0.3, marginTop: 12, marginBottom: 14 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: O.surface, borderRadius: 16, borderWidth: 1.5, borderColor: O.border, minHeight: 60, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10 },
  optionRight: { backgroundColor: O.mint, borderColor: O.success },
  optionWrong: { backgroundColor: RED_SOFT, borderColor: RED },
  letter: { width: 36, height: 36, borderRadius: 18, backgroundColor: O.primarySoft, alignItems: "center", justifyContent: "center" },
  letterText: { color: INK, fontSize: 16, fontWeight: "800" },
  optionText: { flex: 1, color: INK, fontSize: 17, fontWeight: "700", lineHeight: 23 },
  verdict: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginTop: 4 },
  verdictIcon: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  verdictText: { fontSize: 17, fontWeight: "800" },

  resultCover: { width: "100%", aspectRatio: 3.2 },
  resultMedal: { alignItems: "center", marginTop: 10 },
  resultBox: { backgroundColor: O.mint, borderRadius: 20, paddingVertical: 16, paddingHorizontal: 16, marginTop: 8 },
  resultTitle: { color: INK, fontSize: 25, fontWeight: "800", lineHeight: 31, textAlign: "center", letterSpacing: -0.4 },
  wordsCard: { backgroundColor: O.lavender, borderRadius: 20, padding: 14, marginTop: 14 },
  wordsTitle: { color: "#3F3399", fontSize: 19, fontWeight: "800", marginBottom: 10, marginLeft: 4 },
  wordRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: O.surface, borderRadius: 14, minHeight: 46, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 8 },
  wordEn: { color: "#3F3399", fontSize: 16.5, fontWeight: "800", flexShrink: 1 },
  wordArrow: { color: O.muted, fontSize: 16 },
  wordFr: { flex: 1, color: O.muted, fontSize: 16 },
  tellCard: { backgroundColor: O.navy, borderRadius: 20, padding: 18, marginTop: 14 },
  tellTitle: { color: "#fff", fontSize: 21, fontWeight: "800" },
  tellBody: { color: "rgba(255,255,255,0.88)", fontSize: 15.5, lineHeight: 22, marginTop: 4 },
  discuss: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: O.primary, borderRadius: O.radiusButton, minHeight: 58, paddingHorizontal: 16, marginTop: 14 },
  discussText: { color: INK, fontSize: 18, fontWeight: "800" },
  discussNote: { color: O.muted, fontSize: 14, textAlign: "center", marginTop: 8 },
});
