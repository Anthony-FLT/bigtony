// LearningHomeScreen — accueil « Parcours » de la cohorte learning_path_v1 (maquette du 20/10).
// En-tête (série, XP, niveau de pratique), carte du chapitre avec chemin, bloc « Pratiquer à mon rythme »,
// expression du jour. Lecture seule : le serveur revalide prérequis et droits à l'ouverture d'une leçon.
import React, { useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Image } from "react-native";
import { L, ILL, Icon, IconName } from "../../components/lessonUi";
import { loadProfile } from "../../lib/profile";
import { getLearningPath } from "../../lib/learningPath/path";
import { CHAPTERS } from "../../lib/learningPath/catalog";
import type { LearningPathView, PathNode } from "../../lib/learningPath/types";
import { computeStreak } from "../../lib/streak";
import { getChallengesDone, HUB_CHALLENGES } from "../../lib/dailyChallenges";
import { getDailyExpression, Expression } from "../../lib/expression";
import { addFavorite, removeFavorite, listFavorites } from "../../lib/favorites";
import type { PaywallSource } from "../../lib/analytics";


// Cache mémoire de l'expression du jour (même logique que l'accueil legacy)
let exprCache: { day: string; expr: Expression; fav: boolean } | null = null;
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

export default function LearningHomeScreen({ refreshKey, premium, onOpenLesson, onLocked, onStartFreeConversation, onGoDailyHub, onShowPaywall, onGoProfile }: {
  refreshKey: number;
  premium: boolean;
  onOpenLesson: (lessonId: string) => void;
  onLocked: () => void; // leçon publiée, prérequis OK, abonnement requis
  onStartFreeConversation: () => void; // « Conversation libre » (discussion du jour legacy)
  onGoDailyHub: () => void; // « Exercices du jour »
  onShowPaywall: (source: PaywallSource) => void;
  onGoProfile: () => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState<LearningPathView | null>(null);
  const [streak, setStreak] = useState(0);
  const [hubDone, setHubDone] = useState(0);
  const [expr, setExpr] = useState<Expression | null>(() => (exprCache?.day === todayKey() ? exprCache.expr : null));
  const [exprFav, setExprFav] = useState(() => (exprCache?.day === todayKey() ? exprCache.fav : false));
  const [showAll, setShowAll] = useState(false);
  const [rowLayouts, setRowLayouts] = useState<Record<string, { y: number; h: number }>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [p, view, s] = await Promise.all([loadProfile(), getLearningPath(premium), computeStreak().catch(() => 0)]);
    setName(p?.name ?? "");
    setPath(view);
    setStreak(s);
    getChallengesDone().then((d) => setHubDone(HUB_CHALLENGES.reduce((n, c) => n + (d[c] ? 1 : 0), 0))).catch(() => {});
    if (exprCache?.day !== todayKey()) {
      getDailyExpression().then(async (e) => {
        if (!e) return;
        const fav = await listFavorites().then((f) => f.some((x: any) => x.word.toLowerCase() === e.en.toLowerCase())).catch(() => false);
        exprCache = { day: todayKey(), expr: e, fav };
        setExpr(e); setExprFav(fav);
      }).catch(() => {});
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
          <Text style={styles.hello}>Salut {name} 👋</Text>
          <Text style={styles.helloSub}>Une étape de plus vers un anglais plus fluide.</Text>
        </View>
        <Pressable onPress={onGoProfile} style={styles.avatar} accessibilityRole="button" accessibilityLabel="Profil">
          <Image source={ILL.avatar} style={{ width: 56, height: 56, borderRadius: 28 }} resizeMode="cover" />
        </Pressable>
      </View>
      <View style={styles.pills}>
        <View style={styles.pill}><Icon name="flamme" size={16} /><Text style={styles.pillText}>{streak} jour{streak > 1 ? "s" : ""}</Text></View>
        <View style={styles.pill}><Icon name="etoile" size={16} /><Text style={styles.pillText}>{path.xp} XP</Text></View>
        <View style={styles.pill}><Icon name="niveau" size={16} /><Text style={styles.pillText}>Niveau : <Text style={{ fontWeight: "800" }}>{path.practiceLevel}</Text></Text></View>
      </View>

      {/* Mon parcours */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Mon parcours</Text>
        <Pressable onPress={() => setShowAll((v) => !v)} hitSlop={8} style={styles.linkBtn} accessibilityRole="button">
          <Text style={styles.linkText}>{showAll ? "Réduire" : "Tout voir"}</Text>
          <Icon name="chevron" size={16} tint={L.primary} style={showAll ? { transform: [{ rotate: "-90deg" }] } : undefined} />
        </Pressable>
      </View>

      <View style={styles.pathCard}>
        <View style={styles.pathHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.chapterK}>CHAPITRE {chapter.order} · {cp.validated}/{cp.total}</Text>
            <Text style={styles.chapterTitle}>{chapter.titleFr}</Text>
            <Text style={styles.chapterPromise}>{chapter.promiseFr.charAt(0).toUpperCase() + chapter.promiseFr.slice(1)}</Text>
          </View>
          <Image source={ILL.bulles} style={styles.chapterImg} resizeMode="contain" />
        </View>
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
        <Pressable onPress={premium ? onStartFreeConversation : () => onShowPaywall("daily_conversation")} style={[styles.tile, styles.tilePeach]} accessibilityRole="button" accessibilityLabel="Conversation libre">
          {!premium && <View style={styles.lockBadge}><Icon name="cadenas" size={12} tint="#fff" /></View>}
          <Image source={ILL.micro} style={styles.tileImg} resizeMode="contain" />
          <View style={styles.tileFoot}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileTitle}>Conversation libre</Text>
              <Text style={styles.tileSub}>Choisis ton sujet</Text>
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

      {/* Expression du jour */}
      {expr && (
        <View style={styles.exprCard}>
          <Pressable onPress={toggleExprFav} hitSlop={8} style={styles.exprStar} accessibilityRole="button" accessibilityLabel={exprFav ? "Retirer des favoris" : "Ajouter aux favoris"}>
            <Icon name="etoile" size={20} style={exprFav ? undefined : { opacity: 0.35 }} />
          </Pressable>
          <Text style={styles.exprK}>EXPRESSION DU JOUR</Text>
          <Text style={styles.exprEn}>{expr.en}</Text>
          <Text style={styles.exprFr}>{expr.fr}</Text>
          <Pressable onPress={premium ? onStartFreeConversation : () => onShowPaywall("daily_conversation")} style={styles.exprBtn} accessibilityRole="button">
            <Text style={styles.exprBtnText}>La mettre en pratique</Text>
            <Icon name="fleche" size={16} tint={L.textPrimary} />
          </Pressable>
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
  exprStar: { position: "absolute", top: 12, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center", zIndex: 2 },
  exprK: { color: "#B9771A", fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  exprEn: { color: L.textPrimary, fontSize: 24, fontWeight: "700", marginTop: 6, letterSpacing: -0.3 },
  exprFr: { color: "#7A4A17", fontSize: 14, marginTop: 4 },
  exprBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", borderWidth: 1.5, borderColor: L.primary, borderRadius: 14, minHeight: 44, paddingHorizontal: 14, marginTop: 10 },
  exprBtnText: { color: L.textPrimary, fontSize: 14, fontWeight: "700" },
});
