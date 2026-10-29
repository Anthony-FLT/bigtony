// LiveAvatar côté mobile : appels serveur (création/arrêt), client WebSocket de commande, file d'énoncés.
// Le mobile est l'unique propriétaire du WebSocket ; le serveur ne l'ouvre jamais.
// Contrat (docs 21/10/2026) : attendre session.state_updated{connected}, puis agent.speak{audio} par segment,
// agent.speak_end, agent.interrupt, agent.start_listening / agent.stop_listening. PCM 16 bits 24 kHz mono base64.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

const startAvatarSessionFn = httpsCallable(functions, "startAvatarSession", { timeout: 30000 });
const stopAvatarSessionFn = httpsCallable(functions, "stopAvatarSession", { timeout: 20000 });
const avatarSpeechFn = httpsCallable(functions, "avatarSpeech", { timeout: 30000 });

export type AvatarCredentials = {
  sessionId: string;
  livekitUrl: string | null;
  livekitClientToken: string | null;
  wsUrl: string | null;
  maxSessionSeconds: number;
  coach: { id: string; voice: string };
  reused: boolean;
};

export type AvatarStartError = "avatar_disabled" | "avatar_not_pilot" | "coach_not_configured" | "budget" | "provider" | "unknown";
export function avatarStartError(e: any): AvatarStartError {
  const m = String(e?.message ?? "");
  if (/avatar_disabled/.test(m)) return "avatar_disabled";
  if (/avatar_not_pilot|dev_session_pilot_only/.test(m)) return "avatar_not_pilot";
  if (/coach_not_configured/.test(m)) return "coach_not_configured";
  if (/budget_reached|minutes_reached|sessions_reached/.test(m)) return "budget";
  if (/liveavatar_/.test(m)) return "provider";
  return "unknown";
}

// scope : id de tentative, ou "daily:AAAA-MM-JJ" pour le point du jour
export async function startAvatarSession(coachId: string, scope?: string): Promise<AvatarCredentials> {
  const payload = scope?.startsWith("daily:") ? { coachId, dailyTalkId: scope.slice(6) } : { coachId, ...(scope ? { attemptId: scope } : {}) };
  const res: any = await startAvatarSessionFn(payload);
  return res.data as AvatarCredentials;
}
// Préchauffe startAvatarSession et avatarSpeech (démarrage à froid ≈ 3–5 s chacun évité). Sans effet si déjà chaudes.
let lastWarmAt = 0;
export function warmAvatar(): void {
  if (Date.now() - lastWarmAt < 60_000) return; // au plus une fois par minute
  lastWarmAt = Date.now();
  startAvatarSessionFn({ warmup: true }).catch(() => {});
  avatarSpeechFn({ warmup: true }).catch(() => {});
}
export async function stopAvatarSession(sessionId: string, reason: "USER_CLOSED" | "USER_DISCONNECTED" | "IDLE_TIMEOUT" | "SERVER_ERROR" = "USER_CLOSED"): Promise<void> {
  try { await stopAvatarSessionFn({ sessionId, reason }); } catch (e) { console.warn("stopAvatarSession échoué:", e); }
}
export async function avatarSpeech(text: string, lang: "en" | "fr", voice: string, speakingRate = 0.95): Promise<string[]> {
  const res: any = await avatarSpeechFn({ text, lang, voice, speakingRate });
  return (res.data?.chunks ?? []) as string[];
}

// ---------------------------------------------------------------
// Client de commande : un WebSocket par session, énoncés joués un par un.
// ---------------------------------------------------------------
export type AvatarState = "connecting" | "connected" | "listening" | "talking" | "disconnected" | "error";
type Listener = (s: AvatarState, detail?: string) => void;

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export class AvatarCommandClient {
  private ws: WebSocket | null = null;
  private state: AvatarState = "connecting";
  private listeners = new Set<Listener>();
  private queue: { chunks: string[]; resolve: () => void; id: string }[] = [];
  private current: { id: string; resolve: () => void } | null = null;
  private generation = 0; // invalide les énoncés périmés après interrupt
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  readonly timings: { connectMs?: number; firstSpeakStartedMs?: number } = {};

  constructor(private wsUrl: string, private connectTimeoutMs = 12000) {}

  onState(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  getState() { return this.state; }
  private setState(s: AvatarState, detail?: string) { this.state = s; this.listeners.forEach((l) => l(s, detail)); }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      let settled = false;
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      this.connectTimer = setTimeout(() => {
        if (!settled) { settled = true; this.setState("error", "connect_timeout"); try { ws.close(); } catch {} reject(new Error("connect_timeout")); }
      }, this.connectTimeoutMs);
      ws.onmessage = (ev: any) => {
        let msg: any;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        const type = msg?.type;
        if (type === "session.state_updated") {
          if (msg.state === "connected" || msg?.payload?.state === "connected") {
            if (!settled) { settled = true; if (this.connectTimer) clearTimeout(this.connectTimer); this.timings.connectMs = Date.now() - t0; this.setState("connected"); resolve(); }
          } else if (msg.state === "disconnected" || msg?.payload?.state === "disconnected") {
            this.setState("disconnected");
          }
        } else if (type === "agent.speak_started") {
          if (this.timings.firstSpeakStartedMs === undefined) this.timings.firstSpeakStartedMs = Date.now();
          this.setState("talking");
        } else if (type === "agent.speak_ended" || type === "agent.speak_interrupted") {
          const src = msg.source_event_id;
          if (this.current && (!src || src === this.current.id)) { const cur = this.current; this.current = null; cur.resolve(); this.next(); }
          if (!this.current) this.setState("connected");
        } else if (type === "error") {
          console.warn("LiveAvatar error:", JSON.stringify(msg).slice(0, 300));
        }
      };
      ws.onerror = (e: any) => { if (!settled) { settled = true; if (this.connectTimer) clearTimeout(this.connectTimer); reject(new Error("ws_error")); } this.setState("error", "ws_error"); };
      ws.onclose = () => { this.setState("disconnected"); this.failAll(); };
    });
  }

  private send(type: string, payload?: Record<string, unknown>, eventId?: string) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const msg: Record<string, unknown> = { type, event_id: eventId ?? uuid() };
    if (payload) Object.assign(msg, payload);
    this.ws.send(JSON.stringify(msg));
  }

  // Joue un énoncé (segments PCM base64 ≈ 1 s). Résolu quand l'avatar a fini de le dire (ou qu'il a été interrompu).
  speak(chunks: string[]): Promise<void> {
    if (!chunks.length) return Promise.resolve();
    return new Promise((resolve) => {
      this.queue.push({ chunks, resolve, id: uuid() });
      if (!this.current) this.next();
    });
  }
  private next() {
    const item = this.queue.shift();
    if (!item) return;
    const gen = this.generation;
    this.current = { id: item.id, resolve: item.resolve };
    // Premier segment avec l'event_id de l'énoncé (c'est lui qui identifie l'énoncé côté LiveAvatar)
    item.chunks.forEach((audio, i) => { if (gen === this.generation) this.send("agent.speak", { audio }, i === 0 ? item.id : undefined); });
    if (gen === this.generation) this.send("agent.speak_end");
  }
  // Interrompt l'énoncé en cours et purge tout ce qui attend (l'utilisateur veut parler)
  interrupt() {
    this.generation++;
    this.send("agent.interrupt");
    this.failAll();
    if (this.ws && this.ws.readyState === 1) this.setState("connected");
  }
  private failAll() {
    const cur = this.current; this.current = null; cur?.resolve();
    this.queue.splice(0).forEach((q) => q.resolve());
  }
  startListening() { this.send("agent.start_listening"); this.setState("listening"); }
  stopListening() { this.send("agent.stop_listening"); if (this.state === "listening") this.setState("connected"); }

  close() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.generation++;
    this.failAll();
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.setState("disconnected");
  }
}
