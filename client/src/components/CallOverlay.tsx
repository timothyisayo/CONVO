import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, ScreenShare, ScreenShareOff } from "lucide-react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProviderToken, startProviderCall, updateProviderCallStatus, type ProviderCall } from "@/lib/providers";

type Request = { conversationId: string; calleeId?: string | null; callType: "voice" | "video"; calleeName?: string; calleeAvatarUrl?: string | null; isGroup?: boolean };
type Props = { supabase: SupabaseClient | null; userId: string; displayName: string; avatarUrl?: string | null };

export function CallOverlay({ supabase, userId, displayName, avatarUrl }: Props) {
  const [call, setCall] = useState<ProviderCall | null>(null);
  const [incoming, setIncoming] = useState<ProviderCall | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [peerName, setPeerName] = useState("");
  const [peerAvatarUrl, setPeerAvatarUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const ownChannelRef = useRef<any>(null);
  const peerChannelRef = useRef<any>(null);
  const peerIdRef = useRef("");
  const callRef = useRef<ProviderCall | null>(null);
  const incomingRef = useRef<ProviderCall | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const terminalNoticeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerAttemptRef = useRef(false);
  const durationRef = useRef(0);
  const callEventLoggedRef = useRef(false);
  const participantIdsRef = useRef<string[]>([]);
  const connectedAtRef = useRef<number | null>(null);

  const setCallState = (next: ProviderCall | null) => { callRef.current = next; setCall(next); };
  const setIncomingState = (next: ProviderCall | null) => { incomingRef.current = next; setIncoming(next); };
  const sendSignal = async (recipientId: string, event: string, payload: unknown) => {
    if (!supabase || !recipientId || typeof (supabase as any).channel !== "function") return;
    if (!peerChannelRef.current || peerIdRef.current !== recipientId) {
      if (peerChannelRef.current) void supabase.removeChannel(peerChannelRef.current);
      peerChannelRef.current = (supabase as any).channel(`convo-calls:${recipientId}`);
      peerIdRef.current = recipientId;
      await peerChannelRef.current.subscribe();
    }
    await peerChannelRef.current.send({ type: "broadcast", event, payload });
  };
  const stopRoom = async () => {
    const room = roomRef.current;
    if (!room) return;
    for (const publication of Array.from((room.localParticipant as any).trackPublications?.values?.() || []) as any[]) {
      if (publication.track) { try { await room.localParticipant.unpublishTrack(publication.track, true); } catch {} try { publication.track.stop(); } catch {} }
    }
    room.remoteParticipants.forEach((participant) => participant.trackPublications.forEach((publication: any) => publication.track?.detach()));
    room.disconnect(); roomRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  };
  const cleanup = async (nextStatus = "idle", update = true) => {
    const active = callRef.current || incomingRef.current;
    const peerId = active ? (active.caller_id === userId ? active.callee_id : active.caller_id) : peerIdRef.current;
    if (["ended", "failed"].includes(nextStatus)) { const recipients = new Set(participantIdsRef.current); if (peerId) recipients.add(peerId); for (const recipientId of Array.from(recipients)) { if (recipientId !== userId) { try { await sendSignal(recipientId, nextStatus, { callId: active?.id }); } catch {} } } }
    await stopRoom();
    if (update && active && supabase) { try { await updateProviderCallStatus(supabase, active.id, nextStatus as any); } catch {} }
    if (active?.conversation_id && active.caller_id === userId && supabase && !callEventLoggedRef.current && ["ended", "declined", "failed"].includes(nextStatus)) {
      callEventLoggedRef.current = true;
      const label = nextStatus === "declined" ? "Declined call" : nextStatus === "failed" ? "Call failed" : `${active.call_type === "video" ? "Video" : "Voice"} call · ${Math.floor(durationRef.current / 60).toString().padStart(2, "0")}:${(durationRef.current % 60).toString().padStart(2, "0")}`;
      try { await supabase.rpc("send_mtu_message", { p_conversation_id: active.conversation_id, p_body: `Call event: ${label}` }); } catch {}
    }
    if (terminalNoticeRef.current) { clearTimeout(terminalNoticeRef.current); terminalNoticeRef.current = null; }
    setCallState(null); setIncomingState(null); setStatus("idle"); setError(""); setPeerName(""); setDuration(0); setMuted(false); setCameraOff(false); setScreenSharing(false); setMinimized(false); connectedAtRef.current = null;
    participantIdsRef.current = [];
    if (peerChannelRef.current && supabase) { void supabase.removeChannel(peerChannelRef.current); peerChannelRef.current = null; peerIdRef.current = ""; }
  };
  const connectRoom = async (next: ProviderCall, answer: boolean) => {
    if (!supabase) return;
    answerAttemptRef.current = answer;
    callEventLoggedRef.current = false;
    participantIdsRef.current = [];
    setCallState(next); setIncomingState(null); setStatus(answer ? "connecting" : "calling"); setError(""); setDuration(0); setMuted(false); setCameraOff(false); setScreenSharing(false); setMinimized(false);
    try {
      const access = await getProviderToken(supabase, next.id);
      const room = new Room(); roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Video && remoteVideoRef.current) track.attach(remoteVideoRef.current); if (track.kind === Track.Kind.Audio && remoteAudioRef.current) track.attach(remoteAudioRef.current); });
      room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach());
      room.on(RoomEvent.LocalTrackPublished, (publication) => { if (publication.kind === Track.Kind.Video && localVideoRef.current && publication.track) publication.track.attach(localVideoRef.current); });
      room.on(RoomEvent.LocalTrackUnpublished, (publication) => { if (publication.source === Track.Source.ScreenShare) setScreenSharing(false); });
      room.on(RoomEvent.Reconnecting, () => setStatus("reconnecting"));
      room.on(RoomEvent.Reconnected, () => setStatus("connected"));
      room.on(RoomEvent.Disconnected, () => { if (callRef.current && !["ended", "declined", "failed"].includes(status)) setStatus("ended"); });
      await room.connect(access.url, access.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      if (next.call_type === "video") {
        await room.localParticipant.setCameraEnabled(true);
        const publication = Array.from((room.localParticipant as any).videoTrackPublications?.values?.() || [])[0] as any;
        if (publication?.track && localVideoRef.current) publication.track.attach(localVideoRef.current);
      }
      if (answer) {
        try { await updateProviderCallStatus(supabase, next.id, "answered"); } catch {}
        try { await sendSignal(next.caller_id, "answer", { callId: next.id }); } catch {}
        connectedAtRef.current = Date.now();
        setStatus("connected");
      }
    } catch (e) {
      const message = e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone or camera permission was denied. Allow access and try again." : e instanceof Error ? e.message : "Could not connect the call. Check microphone and camera permissions.";
      setError(message); setStatus("failed");
      try { await updateProviderCallStatus(supabase, next.id, "failed"); } catch {}
      const peerId = next.caller_id === userId ? next.callee_id : next.caller_id; if (peerId) { try { await sendSignal(peerId, "failed", { callId: next.id }); } catch {} }
      await stopRoom();
    }
  };
  useEffect(() => {
    if (!supabase || !userId || typeof (supabase as any).channel !== "function") return;
    const channel = (supabase as any).channel(`convo-calls:${userId}`); ownChannelRef.current = channel;
    channel.on("broadcast", { event: "incoming" }, ({ payload }: any) => { if (payload?.call && !callRef.current && !incomingRef.current) { participantIdsRef.current = Array.isArray(payload.participantIds) ? payload.participantIds : []; setIncomingState(payload.call); setPeerName(typeof payload.callerName === "string" ? payload.callerName : ""); setPeerAvatarUrl(typeof payload.callerAvatarUrl === "string" ? payload.callerAvatarUrl : ""); setStatus("ringing"); window.dispatchEvent(new CustomEvent("convo:incoming-call", { detail: { calleeName: typeof payload.callerName === "string" ? payload.callerName : "Someone" } })); } });
    channel.on("broadcast", { event: "answer" }, ({ payload }: any) => { if (payload?.callId === callRef.current?.id) setStatus("connected"); });
    channel.on("broadcast", { event: "declined" }, ({ payload }: any) => {
      const activeCall = callRef.current || incomingRef.current;
      if (payload?.callId !== activeCall?.id) return;
      setStatus("declined"); setError(`${peerName || "The other person"} declined the call.`);
      terminalNoticeRef.current = setTimeout(() => void cleanup("declined", false), 2200);
    });
    channel.on("broadcast", { event: "ended" }, ({ payload }: any) => {
      const activeCall = callRef.current || incomingRef.current;
      if (payload?.callId !== activeCall?.id) return;
      setStatus("ended"); setError(`${peerName || "The other person"} ended the call.`);
      void stopRoom();
      terminalNoticeRef.current = setTimeout(() => void cleanup("ended", false), 2200);
    });
    channel.on("broadcast", { event: "failed" }, ({ payload }: any) => {
      const activeCall = callRef.current || incomingRef.current;
      if (payload?.callId !== activeCall?.id) return;
      setStatus("failed"); setError("The other person could not connect the call.");
    });
    void channel.subscribe();
    const handler = (event: Event) => { const request = (event as CustomEvent<Request>).detail; setPeerName(request.calleeName || "MTU student"); setPeerAvatarUrl(request.calleeAvatarUrl || ""); void (async () => { try { const result = await startProviderCall(supabase, request); participantIdsRef.current = result.participantIds || []; setCallState(result.call); setStatus("calling"); for (const recipientId of participantIdsRef.current) { if (recipientId !== userId) await sendSignal(recipientId, "incoming", { call: result.call, callerName: displayName, callerAvatarUrl: avatarUrl || undefined, groupName: request.isGroup ? request.calleeName : undefined, participantIds: participantIdsRef.current }); } await connectRoom(result.call, false); } catch (e) { setError(e instanceof Error ? e.message : "This student cannot receive calls right now."); setStatus("failed"); } })(); };
    window.addEventListener("convo:start-call", handler);
    return () => { window.removeEventListener("convo:start-call", handler); void supabase.removeChannel(channel); if (peerChannelRef.current) void supabase.removeChannel(peerChannelRef.current); void stopRoom(); };
  }, [supabase, userId, displayName]);
  useEffect(() => {
    if (status !== "connected") return;
    if (!connectedAtRef.current) connectedAtRef.current = Date.now();
    const timer = window.setInterval(() => { const elapsed = Math.floor((Date.now() - (connectedAtRef.current || Date.now())) / 1000); durationRef.current = elapsed; setDuration(elapsed); }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);
  if (!call && !incoming && status === "idle") return null;
  const active = call || incoming;
  const accept = () => incoming && void connectRoom(incoming, true);
  const retry = () => active && void connectRoom(active, answerAttemptRef.current);
  const decline = async () => { if (!incoming || !supabase) return; try { await sendSignal(incoming.caller_id, "declined", { callId: incoming.id }); } catch {} await cleanup("declined"); };
  const toggleMic = async () => { await roomRef.current?.localParticipant.setMicrophoneEnabled(muted); setMuted(!muted); };
  const toggleCam = async () => { await roomRef.current?.localParticipant.setCameraEnabled(cameraOff); setCameraOff(!cameraOff); };
  const toggleScreenShare = async () => {
    const participant = roomRef.current?.localParticipant;
    if (!participant) return;
    try {
      await participant.setScreenShareEnabled(!screenSharing);
      setScreenSharing((value) => !value);
    } catch (reason) {
      setError(reason instanceof Error && reason.name === "NotAllowedError" ? "Screen sharing was cancelled." : "Screen sharing is unavailable in this browser.");
    }
  };
  const end = () => { void cleanup("ended"); };
  const toggleMinimized = () => { if (!incoming) setMinimized((value) => !value); };
  const formattedDuration = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;
  const title = incoming ? `Incoming call from ${peerName || "MTU student"}` : status === "connected" ? peerName || "Connected" : status === "calling" ? `Calling ${peerName || "MTU student"}` : status === "connecting" ? "Connecting…" : status === "reconnecting" ? "Reconnecting…" : status === "declined" ? "Call declined" : status === "ended" ? "Call ended" : status === "failed" ? peerName || "Call failed" : "Call";
  const stateLabel = status === "connected" ? `● Connected · ${formattedDuration}` : status === "calling" ? "Calling…" : status === "ringing" ? "Ringing…" : status === "connecting" ? "Connecting…" : status === "reconnecting" ? "Reconnecting…" : status === "declined" ? "Declined" : status === "ended" ? "Ended" : status === "failed" ? "Connection failed" : "";
  const profileInitials = (peerName || (incoming ? "Incoming" : "Call")).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "C";
  const callType = active?.call_type === "video" ? "Video call" : "Voice call";
  const callGroupLabel = participantIdsRef.current.length > 1 ? "Group call" : "Private call";
  return <div className={`call-overlay${minimized ? " is-minimized" : ""}`} role="dialog" aria-label="Convo call"><div className="call-overlay-card"><div className="call-overlay-heading"><span className="eyebrow dark">{callType}</span>{!incoming && <button className="call-window-toggle" aria-label={minimized ? "Expand call" : "Minimize call"} onClick={toggleMinimized}>{minimized ? <Maximize2 size={15} /> : <Minimize2 size={15} />}</button>}</div><div className="call-profile-card">{peerAvatarUrl ? <img className="call-profile-avatar call-profile-image" src={peerAvatarUrl} alt={`${peerName || "Student"} profile`} /> : <div className="call-profile-avatar" aria-hidden="true">{profileInitials}</div>}<div className="call-profile-details"><small className="call-profile-kind">{incoming ? "Incoming" : callGroupLabel}</small><h2>{title}</h2>{stateLabel && <strong aria-live="polite">{stateLabel}</strong>}</div></div>{!minimized && <><p>{incoming ? "A verified student is calling you." : error || (active ? `Call ${active.callee_id === userId ? "request" : "in progress"}.` : "")}</p>{active?.call_type === "video" && <><video ref={remoteVideoRef} className="call-video-stage" autoPlay playsInline /><video ref={localVideoRef} className="call-video-local" autoPlay muted playsInline /></>}<audio ref={remoteAudioRef} autoPlay />{error && <small role="alert">{error}</small>}<div className="call-actions">{incoming ? <><button className="outline-button" onClick={decline}><PhoneOff size={15} /> Decline</button><button className="primary-button" onClick={accept}><Phone size={15} /> Accept</button></> : status === "connected" || status === "calling" || status === "reconnecting" ? <><button className="outline-button" onClick={() => void toggleMic()}>{muted ? <MicOff size={15} /> : <Mic size={15} />} {muted ? "Unmute" : "Mute"}</button>{active?.call_type === "video" && <button className="outline-button" onClick={() => void toggleCam()}>{cameraOff ? <CameraOff size={15} /> : <Camera size={15} />} Camera</button>}{active?.call_type === "video" && <button className="outline-button" onClick={() => void toggleScreenShare()}>{screenSharing ? <ScreenShareOff size={15} /> : <ScreenShare size={15} />} {screenSharing ? "Stop sharing" : "Share screen"}</button>}<button className="danger-button" onClick={end}><PhoneOff size={15} /> End</button></> : status === "failed" ? <><button className="outline-button" onClick={retry}><Phone size={15} /> Retry</button><button className="danger-button" onClick={end}><PhoneOff size={15} /> Cancel</button></> : <button className="danger-button" onClick={end}><PhoneOff size={15} /> Cancel</button>}</div></>}</div></div>;
}
