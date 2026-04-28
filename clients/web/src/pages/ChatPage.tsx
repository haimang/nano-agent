import { useState, useEffect, useRef, useCallback } from "react";
import { getAuthState } from "../state/auth";
import { requireAuth } from "../apis/auth";
import * as sessionsApi from "../apis/sessions";
import { HeartbeatTracker } from "../heartbeat";
import type { ApiResponse } from "../apis/transport";

interface StreamEvent {
  kind?: string;
  seq?: number;
  name?: string;
  payload?: Record<string, unknown>;
  ts?: number;
  terminal?: string;
  session_uuid?: string;
  last_phase?: string;
  reason?: string;
  new_attachment_at?: string;
}

interface MessageItem {
  role: "user" | "assistant" | "system";
  content: string;
  seq?: number;
  kind?: string;
}

interface ChatPageProps {
  activeSessionUuid: string | null;
  onCreateSession: () => void;
  onStatusChange: (status: Record<string, unknown> | null) => void;
}

const UPSTREAM_WS_BASE = "wss://nano-agent-orchestrator-core-preview.haimang.workers.dev";

function getWsBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: { VITE_NANO_BASE_URL?: string } })
    .env?.VITE_NANO_BASE_URL;
  if (env) {
    const url = new URL(env);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.origin;
  }
  return UPSTREAM_WS_BASE;
}

export function ChatPage({ activeSessionUuid, onCreateSession, onStatusChange }: ChatPageProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [sending, setSending] = useState(false);
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<HeartbeatTracker | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSeenSeqRef = useRef(0);
  const messagesRef = useRef<MessageItem[]>([]);

  const cleanupWs = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    heartbeatRef.current = null;
  }, []);

  const addMessage = useCallback((msg: MessageItem) => {
    messagesRef.current = [...messagesRef.current, msg];
    setMessages([...messagesRef.current]);
  }, []);

  const connectWs = useCallback((sessionUuid: string) => {
    cleanupWs();

    const auth = getAuthState();
    if (!auth) return;

    setWsStatus("connecting");
    setWsError(null);

    const wsBase = getWsBaseUrl();
    const url = new URL(`${wsBase}/sessions/${sessionUuid}/ws`);
    url.searchParams.set("access_token", auth.token);
    url.searchParams.set("trace_uuid", crypto.randomUUID());
    url.searchParams.set("last_seen_seq", String(lastSeenSeqRef.current));

    const socket = new WebSocket(url.toString());
    socketRef.current = socket;

    const heartbeat = new HeartbeatTracker({ intervalMs: 15_000, timeoutMs: 45_000 });
    heartbeatRef.current = heartbeat;
    let lastHeartbeatSentAt = 0;

    const sendHeartbeat = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!heartbeat.shouldSendHeartbeat(lastHeartbeatSentAt)) return;
      lastHeartbeatSentAt = Date.now();
      socket.send(JSON.stringify({
        message_type: "session.heartbeat",
        body: { ts: lastHeartbeatSentAt },
      }));
    };

    const timer = window.setInterval(sendHeartbeat, heartbeat.interval);
    heartbeatTimerRef.current = timer;

    socket.addEventListener("open", () => {
      setWsStatus("connected");
      sendHeartbeat();
      socket.send(JSON.stringify({
        message_type: "session.resume",
        body: { last_seen_seq: lastSeenSeqRef.current },
      }));

      sessionsApi.sessionStatus(auth, sessionUuid).then((status) => {
        onStatusChange(status);
      }).catch(() => {});
    });

    socket.addEventListener("message", (event) => {
      heartbeat.recordHeartbeat();
      try {
        const parsed: StreamEvent = JSON.parse(event.data);

        if (typeof parsed.seq === "number" && Number.isFinite(parsed.seq) && parsed.seq > 0) {
          lastSeenSeqRef.current = Math.max(lastSeenSeqRef.current, parsed.seq);
          socket.send(JSON.stringify({
            message_type: "session.stream.ack",
            body: { stream_uuid: "main", acked_seq: parsed.seq },
          }));
        }

        if (parsed.kind === "event" && parsed.payload) {
          const payload = parsed.payload as { kind?: string; content?: string; content_type?: string; is_final?: boolean };
          if (payload.kind === "llm.delta" && typeof payload.content === "string") {
            const last = messagesRef.current[messagesRef.current.length - 1];
            if (last && last.role === "assistant" && last.kind === "llm.delta" && !last.seq) {
              last.content += payload.content;
              setMessages([...messagesRef.current]);
            } else {
              addMessage({ role: "assistant", content: payload.content, kind: "llm.delta" });
            }
          } else if (payload.kind === "llm.complete") {
            const last = messagesRef.current[messagesRef.current.length - 1];
            if (last && last.role === "assistant" && last.kind === "llm.delta") {
              last.kind = "llm.complete";
              last.seq = parsed.seq;
              setMessages([...messagesRef.current]);
              addMessage({ role: "system", content: `[Complete]`, kind: "llm.complete", seq: parsed.seq });
            }
          } else if (payload.kind === "terminal" || payload.kind === "session.complete") {
            addMessage({ role: "system", content: `[Session ended]`, kind: "terminal" });
          } else if (payload.kind) {
            addMessage({ role: "system", content: `[${payload.kind}]`, kind: payload.kind, seq: parsed.seq });
          }
        } else if (parsed.kind === "terminal") {
          addMessage({ role: "system", content: `[Session ${parsed.terminal ?? "ended"}]`, kind: "terminal" });
        } else if (parsed.kind === "session.heartbeat") {
          // silent
        } else if (parsed.kind === "attachment_superseded") {
          setWsError("Connection replaced by a new attachment");
          setWsStatus("disconnected");
        }
      } catch {
        addMessage({ role: "system", content: "[Invalid message received]", kind: "error" });
      }
    });

    socket.addEventListener("close", () => {
      setWsStatus("disconnected");
      cleanupWs();
    });

    socket.addEventListener("error", () => {
      setWsError("WebSocket connection error");
      setWsStatus("disconnected");
      cleanupWs();
    });
  }, [cleanupWs, addMessage, onStatusChange]);

  const handleSend = useCallback(async (isFirst: boolean) => {
    if (!input.trim() || !activeSessionUuid) return;

    const text = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    addMessage({ role: "user", content: text });

    const auth = getAuthState();
    if (!auth) {
      setError("Not authenticated");
      setSending(false);
      return;
    }

    try {
      if (isFirst) {
        await sessionsApi.startSession(auth, activeSessionUuid, text);
        setStarted(true);
      } else {
        await sessionsApi.sendInput(auth, activeSessionUuid, text);
      }
      connectWs(activeSessionUuid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [input, activeSessionUuid, addMessage, connectWs]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(!started);
    }
  };

  useEffect(() => {
    return () => cleanupWs();
  }, [cleanupWs]);

  useEffect(() => {
    if (activeSessionUuid) {
      const auth = getAuthState();
      if (!auth) return;

      sessionsApi.sessionStatus(auth, activeSessionUuid)
        .then(async (status) => {
          onStatusChange(status);

          const durable = status && typeof status === "object"
            ? (status as { durable_truth?: { last_event_seq?: number } }).durable_truth
            : undefined;

          if (durable?.last_event_seq) {
            lastSeenSeqRef.current = Math.max(lastSeenSeqRef.current, durable.last_event_seq);
          }

          try {
            const timelineData = await sessionsApi.timeline(auth, activeSessionUuid);
            if (Array.isArray(timelineData) && timelineData.length > 0) {
              setStarted(true);
              messagesRef.current = [];

              for (const ev of timelineData) {
                const kind = typeof ev.kind === "string" ? ev.kind : "";
                const content = typeof ev.content === "string" ? ev.content : "";
                const contentType = typeof ev.content_type === "string" ? ev.content_type : "";
                const role = typeof ev.role === "string" ? ev.role : "";

                if (role === "user" || kind === "user.input") {
                  const body = ev.body as { text?: string } | undefined;
                  const msgText = body?.text ?? content;
                  if (msgText) {
                    messagesRef.current.push({ role: "user", content: msgText, seq: ev.seq as number });
                  }
                } else if (kind === "llm.delta" && contentType === "text") {
                  const last = messagesRef.current[messagesRef.current.length - 1];
                  if (last && last.role === "assistant" && last.kind === "llm.delta") {
                    last.content += content;
                  } else {
                    messagesRef.current.push({ role: "assistant", content, kind: "llm.delta" });
                  }
                } else if (kind === "session.update") {
                  // tracking
                } else if (kind && !["session.heartbeat", "session.resume", "session.stream.ack"].includes(kind)) {
                  messagesRef.current.push({
                    role: "system",
                    content: `[${kind}]`,
                    kind,
                    seq: ev.seq as number,
                  });
                }

                if (typeof ev.seq === "number" && ev.seq > 0) {
                  lastSeenSeqRef.current = Math.max(lastSeenSeqRef.current, ev.seq);
                }
              }
              setMessages([...messagesRef.current]);
            }
          } catch {
            // timeline may fail for new sessions
          }
        })
        .catch(() => onStatusChange(null));

      connectWs(activeSessionUuid);
    } else {
      setMessages([]);
      messagesRef.current = [];
      setStarted(false);
    }

    return () => {
      // cleanup handled by effect above
    };
  }, [activeSessionUuid, connectWs, onStatusChange]);

  if (!activeSessionUuid) {
    return (
      <div style={styles.emptyState}>
        <span style={styles.emptyIcon}>💬</span>
        <span style={styles.emptyText}>Select a session or create a new one</span>
        <button onClick={onCreateSession} style={styles.createBtn}>
          New Session
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <span style={styles.sessionLabel}>
          Session: {activeSessionUuid.slice(0, 8)}...
        </span>
        <div style={styles.wsIndicator}>
          <span
            style={{
              ...styles.wsDot,
              background:
                wsStatus === "connected"
                  ? "var(--color-accent-success)"
                  : wsStatus === "connecting"
                    ? "var(--color-accent-warning)"
                    : "var(--color-text-muted)",
            }}
          />
          <span style={styles.wsText}>{wsStatus}</span>
          {wsError && <span style={styles.wsError}>{wsError}</span>}
        </div>
      </div>

      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.emptyChat}>
            <span style={styles.emptyIcon}>💬</span>
            <span style={styles.emptyText}>
              {started ? "Waiting for response..." : "Type a message to begin"}
            </span>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              ...(msg.role === "user" ? styles.messageUser : {}),
              ...(msg.role === "assistant" ? styles.messageAssistant : {}),
              ...(msg.role === "system" ? styles.messageSystem : {}),
            }}
          >
            <span style={styles.messageRole}>
              {msg.role === "user" ? "You" : msg.role === "assistant" ? "Agent" : ""}
            </span>
            <span style={styles.messageContent}>{msg.content}</span>
          </div>
        ))}
        {sending && (
          <div style={styles.messageAssistant}>
            <span style={styles.messageRole}>Agent</span>
            <span style={styles.typing}>typing...</span>
          </div>
        )}
      </div>

      {error && <div style={styles.errorBar}>{error}</div>}

      <div style={styles.composer}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          style={styles.composerInput}
          disabled={sending}
        />
        <button
          onClick={() => handleSend(!started)}
          style={styles.sendBtn}
          disabled={sending || !input.trim()}
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
    borderBottom: "1px solid var(--color-border-default)",
    background: "var(--color-bg-elevated)",
    flexShrink: 0,
  },
  sessionLabel: {
    fontSize: "0.75rem",
    fontFamily: "monospace",
    color: "var(--color-text-muted)",
  },
  wsIndicator: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  wsDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
  },
  wsText: {
    fontSize: "0.7rem",
    color: "var(--color-text-muted)",
  },
  wsError: {
    fontSize: "0.7rem",
    color: "var(--color-accent-error)",
    marginLeft: 8,
  },
  messages: {
    flex: 1,
    overflow: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  emptyChat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    margin: "auto",
    color: "var(--color-text-muted)",
  },
  emptyIcon: { fontSize: "3rem" },
  emptyText: { fontSize: "0.875rem" },
  message: {
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: "var(--radius-md)",
    fontSize: "0.875rem",
    lineHeight: 1.5,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  messageUser: {
    alignSelf: "flex-end",
    background: "var(--color-accent-primary)",
    color: "var(--color-text-inverse)",
  },
  messageAssistant: {
    alignSelf: "flex-start",
    background: "var(--color-bg-overlay)",
    color: "var(--color-text-primary)",
    border: "1px solid var(--color-border-subtle)",
  },
  messageSystem: {
    alignSelf: "center",
    background: "transparent",
    color: "var(--color-text-muted)",
    fontSize: "0.7rem",
    padding: "4px 8px",
  },
  messageRole: {
    fontSize: "0.65rem",
    fontWeight: 700,
    opacity: 0.7,
    textTransform: "uppercase",
  },
  messageContent: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  typing: {
    fontSize: "0.8rem",
    fontStyle: "italic",
    opacity: 0.7,
  },
  errorBar: {
    padding: "8px 16px",
    background: "rgba(248,113,113,0.15)",
    color: "var(--color-accent-error)",
    fontSize: "0.75rem",
    borderTop: "1px solid rgba(248,113,113,0.3)",
  },
  composer: {
    display: "flex",
    gap: 8,
    padding: 16,
    borderTop: "1px solid var(--color-border-default)",
    background: "var(--color-bg-elevated)",
  },
  composerInput: {
    flex: 1,
    padding: "10px 14px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border-accent)",
    background: "var(--color-bg-sunken)",
    color: "var(--color-text-primary)",
    fontSize: "0.875rem",
    outline: "none",
  },
  sendBtn: {
    padding: "10px 20px",
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "var(--color-accent-primary)",
    color: "var(--color-text-inverse)",
    fontSize: "0.875rem",
    fontWeight: 700,
    cursor: "pointer",
  },

  emptyState: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    color: "var(--color-text-muted)",
  },
  createBtn: {
    padding: "10px 24px",
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "var(--color-accent-primary)",
    color: "var(--color-text-inverse)",
    fontSize: "0.875rem",
    fontWeight: 700,
    cursor: "pointer",
    marginTop: 8,
  },
};
