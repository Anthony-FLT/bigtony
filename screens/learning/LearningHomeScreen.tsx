// LearningHomeScreen — accueil « Parcours » de la cohorte learning_path_v1 (maquette du 20/10).
// En-tête (série, XP, niveau de pratique), carte du chapitre avec chemin, bloc « Pratiquer à mon rythme »,
// expression du jour. Lecture seule : le serveur revalide prérequis et droits à l'ouverture d'une leçon.
import React, { useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Image, Modal } from "react-native";
import { useAudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../lib/firebase";
import { L, ILL, Icon, IconName } from "../../components/lessonUi";
import { loadProfile, saveProfile } from "../../lib/profile";
import { coachForVoice, COACHES, LessonCoach } from "../../lib/learningPath/coaches";
import { getDailyTalkStatus } from "../../lib/dailyTalk";
import { getLearningPath } from "../../lib/learningPath/path";
import { CHAPTERS } from "../../lib/learningPath/catalog";
import type { LearningPathView, PathNode } from "../../lib/learningPath/types";
import { computeStreak } from "../../lib/streak";
import { getChallengesDone, HUB_CHALLENGES } from "../../lib/dailyChallenges";
import { getDailyExpression, Expression } from "../../lib/expression";
import { addFavorite, removeFavorite, listFavorites } from "../../lib/favorites";
import type { PaywallSource } from "../../lib/analytics";


// Cache mémoire de l'expression du jour (même logique que l'accueil legacy)
let exprCache: { day: string; expr: Expression; fav: boolean; audioPath?: string; audioVoice?: string } | null = null;
const todayKey = () => new Date().toDateString();

type NodeUi = { icon: IconName; label: string; tone: "done" | "active" | "locked" | "ghost"; openable: boolean; paywall: boolean };
function nodeUi(n: PathNode): NodeUi {
  if (n.editorial === "unpublished") return { icon: "horloge", label: "À venir", tone: "ghost", openable: false, paywall: false };
  if (n.pedagogical === "validated") return { icon: "check", label: "Terminé", tone: "done", openable: true, paywall: false };
  if (n.pedagogical === "hidden_preview" || n.pedagogical === "locked_prerequisite") return { icon: "cadenas", label: "Verrouillé", tone: "locked", openable: false, paywall: false };
  if (n.access === "subscription_required") return { icon: "cadenas", label: "Avec l'abonnement", tone: "locked", openable: false, paywall: true };
  if (n.pedagogical === "in_progress") return { icon: "bulle", label: "En cours", tone: "active", openable: true, paywall: false };
  if (n.pedagogical === "needs_practice") return { icon: "rejouer", label: "À consolider", tone: "active", openable: true, paywall: false };
  return { icon: "bulle", label: "Disponible", tone: "active", openable: true, paywall: false };
}

const NODE_HALO = 64;
const NODE_OFFSET = 36;

// Pointillés en courbe entre les nœuds du chemin (surcouche absolue, à partir des positions mesurées)
function PathDots({ rows }: { rows: { key: string; x: number; layout?: { y: number; h: number } }[] }) {
  const dots: { x: number; y: number }[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (!a.layout || !b.layout) continue;
    // Les halos sont centrés verticalement dans leur ligne : on relie le bas de l'un au haut du suivant
    const cyA = a.layout.y + a.layout.h / 2, cyB = b.layout.y + b.layout.h / 2;
    const y0 = cyA + NODE_HALO / 2 - 4, y1 = cyB - NODE_HALO / 2 + 4;
    if (y1 - y0 < 12) continue;
    const steps = Math.max(3, Math.round((y1 - y0) / 12));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const ease = t * t * (3 - 2 * t); // courbe en S
      dots.push({ x: a.x + (b.x - a.x) * ease, y: y0 + (y1 - y0) * t });
    }
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {dots.map((d, i) => <View key={i} style={[styles.pathDot, { left: d.x - 3, top: d.y - 3 }]} />)}
    </View>
  );
}

const translateText = httpsCallable(functions, "translateText", { timeout: 25000 });

const COACH_SQUARE = 86;
const COACH_CUTOUT_H = 104;
function cutoutRatio(src: any): number {
  const r = Image.resolveAssetSource(src);
  return r && r.width && r.height ? r.width / r.height : 1;
}

export default function LearningHomeScreen({ refreshKey, premium, onOpenLesson, onLocked, onStartFreeConversation, onGoDailyHub, onShowPaywall, onGoProfile, onGoDailyTalk }: {
  refreshKey: number;
  premium: boolean;
  onOpenLesson: (lessonId: string) => void;
  onLocked: () => void; // leçon publiée, prérequis OK, abonnement requis
  onStartFreeConversation: () => void; // « Conversation libre » (discussion du jour legacy)
  onGoDailyHub: () => void; // « Exercices du jour »
  onShowPaywall: (source: PaywallSource) => void;
  onGoProfile: () => void;
  onGoDailyTalk: () => void; // « Le point du jour » (discussion quotidienne avec le coach)
}) {
  const [name, setName] = useState("");
  const [coachPoster, setCoachPoster] = useState<any>(() => coachForVoice(null).poster);
  const [coachName, setCoachName] = useState(coachForVoice(null).displayName);

  const [dailyStatus, setDailyStatus] = useState<"todo" | "in_progress" | "done">("todo");
  const [path, setPath] = useState<LearningPathView | null>(null);
  const [streak, setStreak] = useState(0);
  const [hubDone, setHubDone] = useState(0);
  const [expr, setExpr] = useState<Expression | null>(() => (exprCache?.day === todayKey() ? exprCache.expr : null));
  const [exprFav, setExprFav] = useState(() => (exprCache?.day === todayKey() ? exprCache.fav : false));
  const [voice, setVoice] = useState("us-male");
  const [speechRate, setSpeechRate] = useState(0.95);
  const [exprBusy, setExprBusy] = useState(false);
  const player = useAudioPlayer();
  const [showCoachPicker, setShowCoachPicker] = useState(false);
  const coach = coachForVoice(voice);
  // Changer de coach = changer la voix du profil (même réglage que dans Profil)
  const pickCoach = async (c: LessonCoach) => {
    setShowCoachPicker(false);
    if (c.voice === voice) return;
    setVoice(c.voice); setCoachPoster(c.poster); setCoachName(c.displayName);
    try { await saveProfile({ voice: c.voice }); } catch (e) { console.warn("Changement de coach échoué:", e); }
  };
  // Écoute de l'expression du jour avec la voix du coach
  // Audio préparé dès l'affichage (fonction + TTS ≈ 2–10 s à froid) ; un tap sur « Écouter » joue le fichier en cache
  const prepareExprAudio = async (e: Expression, v: string, rate: number): Promise<string | null> => {
    if (exprCache?.day === todayKey() && exprCache.audioPath && exprCache.audioVoice === v) return exprCache.audioPath;
    const res: any = await translateText({ text: e.en, mode: "speak", voice: v, speakingRate: rate });
    if (!res.data?.audioBase64) return null;
    const path = FileSystem.cacheDirectory + `expr_${todayKey()}_${v}_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(path, res.data.audioBase64, { encoding: FileSystem.EncodingType.Base64 });
    if (exprCache?.day === todayKey()) { exprCache.audioPath = path; exprCache.audioVoice = v; }
    return path;
  };
  const listenExpr = async () => {
    if (!expr || exprBusy) return;
    setExprBusy(true);
    try {
      const path = await prepareExprAudio(expr, voice, speechRate);
    if (path) { player.replace({ uri: path }); player.seekTo(0); player.play(); }
    } catch (e) { console.warn("Écoute expression échouée:", e); }
    finally { setExprBusy(false); }
  };
  const [showAll, setShowAll] = useState(false);
  const [rowLayouts, setRowLayouts] = useState<Record<string, { y: number; h: number }>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [p, view, s] = await Promise.all([loadProfile(), getLearningPath(premium), computeStreak().catch(() => 0)]);
    setName(p?.name ?? "");
    setCoachPoster(coachForVoice(p?.voice).poster); setCoachName(coachForVoice(p?.voice).displayName);
    if (p?.voice) setVoice(p.voice); if (p?.speechRate) setSpeechRate(p.speechRate);
    getDailyTalkStatus().then(setDailyStatus).catch(() => {});
    setPath(view);
    setStreak(s);
    getChallengesDone().then((d) => setHubDone(HUB_CHALLENGES.reduce((n, c) => n + (d[c] ? 1 : 0), 0))).catch(() => {});
    if (exprCache?.day !== todayKey()) {
      getDailyExpression().then(async (e) => {
        if (!e) return;
        const fav = await listFavorites().then((f) => f.some((x: any) => x.word.toLowerCase() === e.en.toLowerCase())).catch(() => false);
        exprCache = { day: todayKey(), expr: e, fav };
        setExpr(e); setExprFav(fav);
        prepareExprAudio(e, p?.voice || "us-male", p?.speechRate || 0.95).catch(() => {});
      }).catch(() => {});
    } else if (exprCache && !exprCache.audioPath) {
      prepareExprAudio(exprCache.expr, p?.voice || "us-male", p?.speechRate || 0.95).catch(() => {});
    }
  };
  useEffect(() => { load(); }, [refreshKey, premium]);

  const toggleExprFav = async () => {
    if (!expr) return;
    if (!premium) { onShowPaywall("daily_expression_favorite"); return; }
    if (exprFav) { await removeFavorite(expr.en); setExprFav(false); if (exprCache) exprCache.fav = false; }
    else { await addFavorite(expr.en, expr.fr); setExprFav(true); if (exprCache) exprCache.fav = true; }
  };

  if (!path) {
    return <View style={[styles.container, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={L.primary} /></View>;
  }

  const next = path.nextNode;
  const currentChapterId = next?.chapter.id ?? CHAPTERS[0].id;
  const chapterNodes = path.nodes.filter((n) => n.chapter.id === currentChapterId);
  const chapter = chapterNodes[0]?.chapter ?? CHAPTERS[0];
  const cp = path.chapterProgress[currentChapterId] ?? { validated: 0, total: chapterNodes.length };
  const pct = cp.total ? Math.round((cp.validated / cp.total) * 100) : 0;
  // Vue compacte : la dernière terminée, la courante, la suivante
  const curIdx = next ? chapterNodes.findIndex((n) => n.lesson.id === next.lesson.id) : chapterNodes.length - 1;
  const compact = chapterNodes.filter((_, i) => i >= Math.max(0, curIdx - 1) && i <= curIdx + 1);
  const shown = showAll ? chapterNodes : compact;
  const laterChapters = CHAPTERS.filter((c) => c.order > chapter.order);

  const press = (n: PathNode) => {
    const ui = nodeUi(n);
    if (ui.paywall) { onLocked(); return; }
    if (ui.openable) onOpenLesson(n.lesson.id);
  };
  const nextUi = next ? nodeUi(next) : null;
  const total = HUB_CHALLENGES.length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      {/* En-tête */}
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>Hi {name}</Text>
          <Text style={styles.helloSub}>Une étape de plus vers un anglais plus fluide.</Text>
        </View>

      </View>
      <View style={styles.pills}>
        <View style={styles.pill}><Icon name="flamme" size={16} /><Text style={styles.pillText}>{streak} jour{streak > 1 ? "s" : ""}</Text></View>
        <View style={styles.pill}><Icon name="etoile" size={16} /><Text style={styles.pillText}>{path.xp} XP</Text></View>
        <View style={styles.pill}><Icon name="niveau" size={16} /><Text style={styles.pillText}>Niveau : <Text style={{ fontWeight: "800" }}>{path.practiceLevel}</Text></Text></View>
      </View>

      {/* Mon parcours */}
        <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Mon parcours</Text>
      </View>

      <View style={styles.pathCard}>
        <View style={styles.pathHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.chapterK}>CHAPITRE {chapter.order} · {cp.validated}/{cp.total}</Text>
            <Text style={styles.chapterTitle}>{chapter.titleFr}</Text>
            <Text style={styles.chapterPromise}>{chapter.promiseFr.charAt(0).toUpperCase() + chapter.promiseFr.slice(1)}</Text>
          </View>
          {/* Buste détouré qui déborde du carré coloré (couleur propre au coach) */}
          <View style={styles.coachFrame}>
            <View style={[styles.coachSquare, { backgroundColor: coach.tint }]} />
            {/* Largeur calculée depuis le ratio du PNG : le bas de l'image = le bas du carré, quel que soit le cadrage */}
            <Image source={coach.cutout} style={[styles.coachCutout, { width: COACH_CUTOUT_H * cutoutRatio(coach.cutout) }]} resizeMode="stretch" />
          </View>
        </View>
        {/* Coach du parcours */}
        <Pressable onPress={() => setShowCoachPicker(true)} style={styles.coachRow} accessibilityRole="button" accessibilityLabel={`Coach : ${coachName}. Changer`}>
          <View style={{ flex: 1 }}>
            <Text style={styles.coachRowTitle}>Avec {coachName} · Coach IA</Text>
            <Text style={styles.coachRowSub}>{coach.accent === "en-GB" ? "Anglais britannique" : "Anglais américain"}</Text>
          </View>
          <Text style={styles.coachRowChange}>Changer</Text>
          <Icon name="chevron" size={16} />
        </Pressable>
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(4, pct)}%` }]} /></View>
          <Text style={styles.progressPct}>{pct} %</Text>
        </View>

        <View style={styles.nodes}>
          <PathDots rows={shown.map((n, i) => ({ key: n.lesson.id, x: (i % 2) * NODE_OFFSET + NODE_HALO / 2, layout: rowLayouts[n.lesson.id] }))} />
          {shown.map((n, i) => {
            const ui = nodeUi(n);
            const isCurrent = next?.lesson.id === n.lesson.id;
            const offset = (i % 2) * NODE_OFFSET; // chemin en zigzag léger
            return (
              <Pressable
                key={n.lesson.id}
                onLayout={(e: LayoutChangeEvent) => { const { y, height } = e.nativeEvent.layout; setRowLayouts((r) => (r[n.lesson.id]?.y === y && r[n.lesson.id]?.h === height ? r : { ...r, [n.lesson.id]: { y, h: height } })); }}
                onPress={() => press(n)}
                disabled={!ui.openable && !ui.paywall}
                style={[styles.nodeRow, { paddingLeft: offset }]}
                accessibilityRole="button"
                accessibilityLabel={`Leçon ${n.lesson.order}, ${n.lesson.titleFr}, ${ui.label}`}
                accessibilityState={{ disabled: !ui.openable && !ui.paywall }}
              >
                <View style={[styles.nodeHalo, ui.tone === "done" && styles.haloDone, ui.tone === "active" && styles.haloActive, (ui.tone === "locked" || ui.tone === "ghost") && styles.haloLocked]}>
                  <View style={[styles.node, ui.tone === "done" && styles.nodeDone, ui.tone === "active" && styles.nodeActive, (ui.tone === "locked" || ui.tone === "ghost") && styles.nodeLocked]}>
                    <Icon name={ui.icon} size={isCurrent ? 24 : 20} tint={ui.tone === "done" || ui.tone === "active" ? "#fff" : undefined} />
                  </View>
                </View>
                {isCurrent ? (
                  <View style={styles.callout}>
                    <Text style={styles.calloutTitle}>{n.lesson.titleFr}</Text>
                    <Text style={styles.calloutSub} numberOfLines={2}>{n.variant?.titleFr ?? ui.label}{n.variant ? ` · ${n.variant.targetMinutes} min` : ""}</Text>
                  </View>
                ) : (
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.nodeTitle, (ui.tone === "locked" || ui.tone === "ghost") && { color: L.textSecondary }]}>{n.lesson.titleFr}</Text>
                    <Text style={styles.nodeSub}>{ui.label}{ui.tone === "done" && n.variant ? ` · ${n.variant.targetMinutes} min` : ""}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {showAll && laterChapters.length > 0 && (
          <View style={styles.laterWrap}>
            {laterChapters.map((c) => (
              <View key={c.id} style={styles.laterRow}>
                <Icon name="cadenas" size={14} />
                <Text style={styles.laterText}>Chapitre {c.order} · {c.titleFr}</Text>
                <Text style={styles.laterTag}>{c.published ? "Verrouillé" : "À venir"}</Text>
              </View>
            ))}
          </View>
        )}

        {next && nextUi ? (
          <Pressable onPress={() => press(next)} style={styles.cta} accessibilityRole="button">
            <Text style={styles.ctaText}>{nextUi.paywall ? "Débloquer ma prochaine leçon" : next.pedagogical === "in_progress" ? "Reprendre ma leçon" : "Continuer ma leçon"}</Text>
            <Icon name="fleche" size={20} tint={L.textPrimary} />
          </Pressable>
        ) : (
          <View style={[styles.cta, { backgroundColor: L.accentSoft }]}><Text style={styles.ctaText}>Toutes les leçons disponibles sont terminées</Text></View>
        )}
      </View>

      {/* Pratiquer à mon rythme */}
      <Text style={[styles.sectionTitle, { marginTop: 28, marginBottom: 12 }]}>Pratiquer à mon rythme</Text>
      <View style={styles.tiles}>
        {/* Le point du jour : discussion quotidienne avec le coach (1/semaine sans abonnement, le serveur décide) */}
        <Pressable onPress={onGoDailyTalk} style={[styles.tile, styles.tilePeach, dailyStatus === "done" && { backgroundColor: L.successSoft }]} accessibilityRole="button" accessibilityLabel={`Le point du jour avec ${coachName}`}>
          {dailyStatus === "done" && <View style={styles.countBadge}><Icon name="check" size={14} /></View>}
          <Image source={ILL.micro} style={styles.tileImg} resizeMode="contain" />
          <View style={styles.tileFoot}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileTitle}>Le point du jour</Text>
              <Text style={styles.tileSub}>{dailyStatus === "done" ? "Fait pour aujourd'hui" : dailyStatus === "in_progress" ? "En cours · reprendre" : `3 min avec ${coachName}`}</Text>
            </View>
            <Icon name="chevron" size={18} />
          </View>
        </Pressable>
        <Pressable onPress={premium ? onGoDailyHub : () => onShowPaywall("daily_hub")} style={[styles.tile, styles.tileLavender]} accessibilityRole="button" accessibilityLabel="Exercices du jour">
          {premium ? (
            <View style={styles.countBadge}><Text style={styles.countText}>{hubDone}/{total}</Text></View>
          ) : (
            <View style={styles.lockBadge}><Icon name="cadenas" size={12} tint="#fff" /></View>
          )}
          <Image source={ILL.casque} style={styles.tileImg} resizeMode="contain" />
          <View style={styles.tileFoot}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileTitle}>Exercices du jour</Text>
              <Text style={styles.tileSub}>Écoute · Lecture · Traduction</Text>
            </View>
            <Icon name="chevron" size={18} />
          </View>
        </Pressable>
      </View>

      {/* Choix du coach */}
      <Modal visible={showCoachPicker} transparent animationType="fade" onRequestClose={() => setShowCoachPicker(false)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setShowCoachPicker(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Choisis ton coach</Text>
            <Text style={styles.pickerSub}>Sa voix et son accent t'accompagnent dans les leçons et le point du jour.</Text>
            {(Object.values(COACHES) as LessonCoach[]).filter((c) => c.enabled).map((c) => (
              <Pressable key={c.id} onPress={() => pickCoach(c)} style={[styles.pickerRow, c.voice === voice && styles.pickerRowOn]} accessibilityRole="button" accessibilityState={{ selected: c.voice === voice }}>
                <Image source={c.poster} style={styles.pickerImg} resizeMode="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickerName}>{c.displayName}</Text>
                  <Text style={styles.pickerAccent}>{c.accentLabel}</Text>
                </View>
                {c.voice === voice && <Icon name="check" size={20} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Expression du jour */}
      {expr && (
        <View style={styles.exprCard}>
          <Text style={styles.exprK}>EXPRESSION DU JOUR</Text>
          <Text style={styles.exprEn}>{expr.en}</Text>
          <Text style={styles.exprFr}>{expr.fr}</Text>
          <View style={styles.exprActions}>
            <Pressable onPress={listenExpr} disabled={exprBusy} style={[styles.exprBtn, exprBusy && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel="Écouter l'expression">
              <Icon name="ecouter" size={16} tint={L.textPrimary} />
              <Text style={styles.exprBtnText}>Écouter</Text>
            </Pressable>
            <Pressable onPress={toggleExprFav} style={[styles.exprBtn, exprFav && styles.exprBtnOn]} accessibilityRole="button" accessibilityLabel={exprFav ? "Retirer des favoris" : "Garder dans mes favoris"}>
              <Icon name="etoile" size={16} tint={L.textPrimary} />
              <Text style={styles.exprBtnText}>{exprFav ? "Gardée" : "Garder"}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.background },
  content: { paddingHorizontal: L.gutter, paddingTop: 52, paddingBottom: 32 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  hello: { fontSize: 30, fontWeight: "700", color: L.textPrimary, letterSpacing: -0.5 },
  helloSub: { fontSize: 15, color: L.textSecondary, marginTop: 4 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: L.accentSoft, overflow: "hidden" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: L.accentSoft, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 12, minHeight: 36 },
  pillText: { color: L.textPrimary, fontSize: 14, fontWeight: "600" },

  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 26, marginBottom: 12 },
  sectionTitle: { fontSize: 24, fontWeight: "700", color: L.textPrimary, letterSpacing: -0.3 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36 },
  linkText: { color: L.primary, fontSize: 15, fontWeight: "600" },

  pathCard: { backgroundColor: L.surface, borderRadius: 24, padding: 18, borderWidth: 1, borderColor: L.border },
  pathHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  chapterK: { color: "#D97A2B", fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  chapterTitle: { color: L.textPrimary, fontSize: 24, fontWeight: "700", marginTop: 4, letterSpacing: -0.3 },
  chapterPromise: { color: L.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  chapterImg: { width: 92, height: 80 },
  coachFrame: { width: 112, height: COACH_CUTOUT_H, alignItems: "flex-end", justifyContent: "flex-end" },
  coachSquare: { position: "absolute", right: 0, bottom: 0, width: COACH_SQUARE, height: COACH_SQUARE, borderRadius: 18 },
  coachCutout: { position: "absolute", right: 0, bottom: 0, height: COACH_CUTOUT_H, borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }, // bas aligné sur le carré, dépasse en haut et à gauche
  coachRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: L.background, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginTop: 12 },
  coachRowTitle: { color: L.textPrimary, fontSize: 14, fontWeight: "700" },
  coachRowSub: { color: L.textSecondary, fontSize: 12.5, marginTop: 1 },
  coachRowChange: { color: L.textPrimary, fontSize: 13.5, fontWeight: "700" },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(10,14,25,0.55)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: L.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 32 },
  pickerTitle: { color: L.textPrimary, fontSize: 20, fontWeight: "800" },
  pickerSub: { color: L.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 12 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.surface, borderRadius: 18, padding: 10, marginTop: 8, borderWidth: 2, borderColor: "transparent" },
  pickerRowOn: { borderColor: L.accentDeep },
  pickerImg: { width: 56, height: 56, borderRadius: 14, backgroundColor: L.accentSoft },
  pickerName: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },
  pickerAccent: { color: L.textSecondary, fontSize: 13 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, marginBottom: 14 },
  progressTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: L.border, overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 5, backgroundColor: L.accent },
  progressPct: { color: L.textSecondary, fontSize: 13, fontWeight: "700", width: 40, textAlign: "right" },

  nodes: { gap: 6 },
  pathDot: { position: "absolute", width: 6, height: 6, borderRadius: 3, backgroundColor: "#C9C2F0" },
  nodeRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 64 },
  nodeHalo: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  haloDone: { backgroundColor: "#E6F4EC" },
  haloActive: { backgroundColor: L.accentSoft },
  haloLocked: { backgroundColor: "#EEEDF6" },
  node: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: L.border },
  nodeDone: { backgroundColor: L.successFill },
  nodeActive: { backgroundColor: L.accentDeep },
  nodeLocked: { backgroundColor: "#E3E1EE" },
  nodeTitle: { color: L.textPrimary, fontSize: 17, fontWeight: "700" },
  nodeSub: { color: L.textSecondary, fontSize: 14, marginTop: 2 },
  callout: { flex: 1, backgroundColor: L.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: L.border, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  calloutTitle: { color: L.textPrimary, fontSize: 18, fontWeight: "700" },
  calloutSub: { color: L.textSecondary, fontSize: 14, marginTop: 3, lineHeight: 19 },
  laterWrap: { marginTop: 10, gap: 8 },
  laterRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  laterText: { flex: 1, color: L.textPrimary, fontSize: 14, fontWeight: "600" },
  laterTag: { color: L.textSecondary, fontSize: 12 },

  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: L.accentDeep, borderRadius: 18, minHeight: L.buttonMinHeight, paddingHorizontal: 16, marginTop: 16 },
  ctaText: { color: L.textPrimary, fontSize: 18, fontWeight: "700" },

  tiles: { flexDirection: "row", gap: 12 },
  tile: { flex: 1, borderRadius: 22, padding: 14, minHeight: 170, justifyContent: "space-between" },
  tilePeach: { backgroundColor: "#FDE7D2" },
  tileLavender: { backgroundColor: "#E7E3FB" },
  tileImg: { width: 80, height: 72 },
  tileFoot: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 10 },
  tileTitle: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },
  tileSub: { color: L.textSecondary, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  lockBadge: { position: "absolute", top: 12, right: 12, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(25,41,71,0.85)", alignItems: "center", justifyContent: "center", zIndex: 2 },
  countBadge: { position: "absolute", top: 12, right: 12, backgroundColor: L.surface, borderRadius: 14, paddingVertical: 5, paddingHorizontal: 12, zIndex: 2 },
  countText: { color: "#6B5CE7", fontSize: 14, fontWeight: "700" },

  exprCard: { backgroundColor: "#FBE4A8", borderRadius: 22, padding: 18, marginTop: 14 },
  exprK: { color: "#B9771A", fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  exprEn: { color: L.textPrimary, fontSize: 24, fontWeight: "700", marginTop: 6, letterSpacing: -0.3 },
  exprFr: { color: "#7A4A17", fontSize: 14, marginTop: 4 },
  exprActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 10 },
  exprBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderColor: L.primary, borderRadius: 14, minHeight: 44, paddingHorizontal: 14 },
  exprBtnOn: { backgroundColor: "rgba(255,255,255,0.75)" },
  exprBtnText: { color: L.textPrimary, fontSize: 14, fontWeight: "700" },
});
