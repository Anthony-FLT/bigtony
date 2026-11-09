// AvatarAudioRefresh — iOS : relance l'unité audio de WebRTC sans toucher à la vidéo.
// À placer DANS <LiveKitRoom> (CoachVideo.tsx). À chaque changement de avatar.audioEpoch (déclenché après un enregistrement
// expo-audio, qui laisse WebRTC muet), on se désabonne de la piste audio du coach, on attend que le désabonnement soit
// EFFECTIF (événement TrackUnsubscribed → WebRTC a détruit son unité audio), puis on se réabonne : WebRTC recrée l'unité
// avec la session audio courante. Ne rend rien.
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRoomContext } from "@livekit/react-native";
import { RoomEvent, Track } from "livekit-client";
import type { AvatarController } from "../lib/liveAvatar/useAvatarSession";

const SETTLE_MS = 300; // délai après le désabonnement effectif, le temps que l'unité audio soit bien arrêtée
const FALLBACK_MS = 1200; // si l'événement n'arrive pas, on se réabonne quand même

export default function AvatarAudioRefresh({ avatar }: { avatar: AvatarController }) {
  const room = useRoomContext();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // pas au montage
    if (Platform.OS !== "ios") return;
    const pubs = Array.from(room.remoteParticipants.values()).flatMap((p) => Array.from(p.trackPublications.values())).filter((pub) => pub.kind === Track.Kind.Audio);
    console.log("[AUDIO iOS] réabonnement audio : pistes audio distantes =", pubs.length, "abonnées =", pubs.filter((p) => p.isSubscribed).length);
    if (!pubs.length) return;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const resubscribe = (why: string) => {
      if (done) return; done = true;
      room.off(RoomEvent.TrackUnsubscribed, onUnsub);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        pubs.forEach((pub) => pub.setSubscribed(true));
        console.log(`[AUDIO iOS] piste audio du coach réabonnée (${why})`);
      }, SETTLE_MS);
    };
    const onUnsub = (_track: unknown, pub: { kind?: string }) => { if (pub?.kind === Track.Kind.Audio) { console.log("[AUDIO iOS] désabonnement audio effectif"); resubscribe("événement"); } };
    room.on(RoomEvent.TrackUnsubscribed, onUnsub);
    timer = setTimeout(() => resubscribe("délai de secours"), FALLBACK_MS);
    pubs.forEach((pub) => pub.setSubscribed(false));
    return () => { room.off(RoomEvent.TrackUnsubscribed, onUnsub); if (timer) clearTimeout(timer); };
  }, [avatar.audioEpoch]);
  return null;
}
