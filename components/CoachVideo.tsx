// Bloc vidéo du coach (maquettes 21/10) : grand (vidéo 150 pt + nom/accent/état + « Continuer sans vidéo »)
// ou réduit (ligne avec vignette + état + bouton d'agrandissement). Portrait fixe pendant la connexion et en mode audio.
import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet, Image, ActivityIndicator } from "react-native";
import { AudioSession, LiveKitRoom, useTracks, VideoTrack, isTrackReference, useRoomContext } from "@livekit/react-native";
import { Track } from "livekit-client";
import { L, ILL, Icon } from "./lessonUi";
import type { AvatarController, AvatarStatus } from "../lib/liveAvatar/useAvatarSession";
import { COACHES } from "../lib/learningPath/coaches";

const STATE: Record<AvatarStatus, { label: string; dot: string }> = {
  connecting: { label: "Connexion…", dot: "#B9B2C7" },
  ready: { label: "Prêt", dot: L.success },
  listening: { label: "Je t'écoute", dot: "#D64545" },
  thinking: { label: "Je prépare ma réponse…", dot: L.accentDeep },
  talking: { label: "Sam parle", dot: L.accentDeep },
  audio_only: { label: "Mode audio", dot: "#8A93A8" },
  off: { label: "", dot: "#8A93A8" },
};

// hidden : clavier ouvert — rien n'est affiché mais la salle LiveKit reste montée (sinon la session est coupée)
export default function CoachVideo({ avatar, coachId, reduced, onToggle, hidden = false }: { avatar: AvatarController; coachId: string; reduced: boolean; onToggle: () => void; hidden?: boolean }) {
  const coach = (COACHES as Record<string, (typeof COACHES)["us_male"]>)[coachId] ?? COACHES.us_male;
  const showVideo = !!avatar.creds?.livekitUrl && !!avatar.creds.livekitClientToken && avatar.status !== "audio_only" && avatar.status !== "off";
  useEffect(() => {
    if (!showVideo) return;
    AudioSession.startAudioSession();
    return () => { AudioSession.stopAudioSession(); };
  }, [showVideo]);
  if (avatar.status === "off") return null;
  const st = STATE[avatar.status].label.replace("Sam", coach.displayName);
  const dot = STATE[avatar.status].dot;

  // La salle LiveKit reste montée dans les deux tailles (pas de reconnexion au passage grand ↔ réduit)
  const media = showVideo ? (
    <LiveKitRoom
      serverUrl={avatar.creds!.livekitUrl!}
      token={avatar.creds!.livekitClientToken!}
      connect
      audio={false}
      video={false}
      onConnected={avatar.onRoomConnected}
      onDisconnected={() => avatar.onRoomFailed("room_disconnected")}
      onError={(e: any) => avatar.onRoomFailed(`room_error:${e?.message ?? ""}`)}
    >
      <RemoteAvatarTrack poster={coach.poster} />
    </LiveKitRoom>
  ) : (
    <Image source={coach.poster} style={styles.fill} resizeMode="cover" />
  );

  // IMPORTANT : même arbre React dans les trois états (caché / réduit / grand) — seuls les styles changent.
  // Si la salle LiveKit changeait de place dans l'arbre, React la démonterait → déconnexion → mode audio.
  const mode: "hidden" | "reduced" | "large" = hidden ? "hidden" : reduced ? "reduced" : "large";
  return (
    <View style={mode === "hidden" ? styles.hiddenHolder : mode === "reduced" ? styles.rowCard : styles.wrap} pointerEvents={mode === "hidden" ? "none" : "auto"}>
      <Pressable onPress={onToggle} style={mode === "reduced" ? styles.thumb : styles.video} accessibilityRole="button" accessibilityLabel={mode === "reduced" ? "Agrandir la vidéo" : "Réduire la vidéo"}>
        {media}
        {mode === "large" && avatar.status === "connecting" && <View style={styles.veil}><ActivityIndicator size="large" color={L.primary} /></View>}
        {mode === "large" && (
          <View style={styles.overlayMeta}>
            {avatar.status === "talking"
              ? <View style={styles.bars}>{[0, 1, 2, 3].map((i) => <View key={i} style={[styles.bar, { height: [8, 14, 10, 16][i], backgroundColor: "#fff" }]} />)}</View>
              : avatar.status === "listening" ? <View style={styles.recDot} /> : <View style={[styles.dot, { backgroundColor: dot }]} />}
            <Text style={styles.overlayText} numberOfLines={1}>{coach.displayName} · {coach.accentLabel}{st ? ` · ${st}` : ""}</Text>
          </View>
        )}
        {mode === "large" && (
          <View style={styles.reduceBtn} accessible={false}>
            <Icon name="fleche" size={16} tint={L.textPrimary} style={{ transform: [{ rotate: "135deg" }] }} />
          </View>
        )}
      </Pressable>
      {mode === "reduced" && (
        <>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowName}>{coach.displayName}</Text>
            <View style={styles.stateRow}><View style={[styles.dot, { backgroundColor: dot }]} /><Text style={styles.rowState} numberOfLines={1}>{avatar.status === "audio_only" && avatar.fallbackReason && avatar.fallbackReason !== "user_choice" ? `Mode audio · vidéo indisponible${__DEV__ ? ` (${avatar.fallbackReason})` : ""}` : st}</Text></View>
          </View>
          <Pressable onPress={onToggle} style={styles.expandBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Agrandir la vidéo">
            <Icon name="fleche" size={18} tint={L.textPrimary} style={{ transform: [{ rotate: "-45deg" }] }} />
          </Pressable>
        </>
      )}
      {mode === "large" && avatar.status !== "audio_only" && (
        <Pressable onPress={avatar.continueWithoutVideo} hitSlop={8} style={styles.noVideoPill} accessibilityRole="button" accessibilityLabel="Continuer sans vidéo">
          <Text style={styles.noVideoText}>Sans vidéo</Text>
        </Pressable>
      )}
      {mode === "large" && avatar.status === "audio_only" && avatar.fallbackReason && avatar.fallbackReason !== "user_choice" && (
        <View style={styles.banner}>
          <Icon name="attention" size={18} />
          <Text style={styles.bannerText}>La vidéo est indisponible. Tu peux continuer avec la voix.{__DEV__ ? ` (${avatar.fallbackReason})` : ""}</Text>
        </View>
      )}
    </View>
  );
}

function RemoteAvatarTrack({ poster }: { poster: any }) {
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Camera, Track.Source.Unknown], { onlySubscribed: true });
  const remote = tracks.find((t) => isTrackReference(t) && t.participant.identity !== room.localParticipant.identity && t.publication?.kind === "video");
  if (!remote || !isTrackReference(remote)) return <Image source={poster} style={styles.fill} resizeMode="cover" />;
  return <VideoTrack trackRef={remote} style={styles.fill} objectFit="cover" />;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  overlayMeta: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "rgba(25,41,71,0.55)" },
  overlayText: { flex: 1, color: "#fff", fontSize: 13.5, fontWeight: "700" },
  noVideoPill: { position: "absolute", top: 10, left: 10, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 14, paddingHorizontal: 10, height: 28, justifyContent: "center" },
  video: { height: 150, borderRadius: 22, overflow: "hidden", backgroundColor: "#E3E1EE" },
  fill: { width: "100%", height: "100%" },
  veil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,250,245,0.55)" },
  badge: { position: "absolute", left: 12, bottom: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" },
  bars: { flexDirection: "row", alignItems: "center", gap: 3 },
  bar: { width: 4, borderRadius: 2, backgroundColor: L.accentDeep },
  recDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#D64545" },
  meta: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  name: { color: L.textPrimary, fontSize: 17, fontWeight: "700" },
  accent: { color: L.textSecondary, fontWeight: "600" },
  stateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sub: { color: L.textSecondary, fontSize: 13.5 },
  noVideo: { minHeight: 36, justifyContent: "center", paddingHorizontal: 4 },
  noVideoText: { color: L.textPrimary, fontSize: 12.5, fontWeight: "700" },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: L.surface, borderRadius: 16, borderWidth: 1, borderColor: L.border, padding: 12, marginTop: 10 },
  bannerText: { flex: 1, color: L.textPrimary, fontSize: 14, lineHeight: 20 },
  hiddenHolder: { position: "absolute", width: 1, height: 1, opacity: 0, top: 0, left: 0 },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: L.surface, borderRadius: 18, padding: 10, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  thumb: { width: 56, height: 56, borderRadius: 14, overflow: "hidden", backgroundColor: "#E3E1EE" },
  rowName: { color: L.textPrimary, fontSize: 16, fontWeight: "700" },
  rowState: { color: L.textSecondary, fontSize: 13.5 },
  expandBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: L.background, alignItems: "center", justifyContent: "center" },
  reduceBtn: { position: "absolute", top: 10, right: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" },
});
