// Session audio iOS pour le coach vidéo. Sur iOS, WebRTC (LiveKit) et expo-audio se partagent la même AVAudioSession :
// quand l'enregistrement se termine, expo-audio rebascule en catégorie « lecture seule », ce qui coupe la sortie audio de
// WebRTC (vidéo du coach sans son dès le 2e échange). On ré-applique donc la configuration playAndRecord + haut-parleur
// au démarrage de la session avatar et après chaque enregistrement. Sans effet sur Android.
import { Platform } from "react-native";
import { AudioSession } from "@livekit/react-native";
import { setAudioModeAsync } from "expo-audio";

// Si l'alignement de session (48 kHz, mode enregistrement fixé dès le départ) ne suffit pas, repasser ce drapeau à true :
// la salle LiveKit est alors remontée après chaque enregistrement (son garanti, mais l'image saute ~0,5 s).
export const IOS_RECONNECT_AFTER_RECORDING = false;

export async function applyAvatarAudioSession() {
  console.log("[AUDIO iOS] applyAvatarAudioSession appelé, plateforme =", Platform.OS);
  if (Platform.OS !== "ios") return;
  try {
    // Mode expo-audio « enregistrement autorisé » posé UNE fois ici, avant la configuration LiveKit, et plus jamais modifié
    // pendant la session : ainsi la catégorie AVAudioSession ne change pas entre les tours.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    console.log("[AUDIO iOS] sorties disponibles :", await AudioSession.getAudioOutputs());
    await AudioSession.setAppleAudioConfiguration({
      audioCategory: "playAndRecord",
      audioCategoryOptions: ["allowBluetooth", "defaultToSpeaker"],
      audioMode: "videoChat",
    });
    await AudioSession.startAudioSession();
    // Force la sortie sur le haut-parleur (overrideOutputAudioPort). Sans ça, après un enregistrement, iOS route le son
    // du coach vers l'écouteur du haut (celui des appels) : lèvres qui bougent, « pas de son ».
    await AudioSession.selectAudioOutput("force_speaker");
    console.log("AUDIO iOS : session avatar appliquée, sortie haut-parleur");
  } catch (e) { console.warn("audio session iOS (avatar) :", e); }
}

export async function releaseAvatarAudioSession() {
  console.log("[AUDIO iOS] releaseAvatarAudioSession");
  if (Platform.OS !== "ios") return;
  try { await AudioSession.stopAudioSession(); } catch {}
}

