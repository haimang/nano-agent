import { useState, useEffect } from "react";
import { getAuthState } from "../../state/auth";
import * as sessionsApi from "../../apis/sessions";
import * as debugApi from "../../apis/debug";
import { ApiRequestError } from "../../apis/transport";

interface InspectorTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  sessionUuid: string;
  sessionStatus: Record<string, unknown> | null;
}

const TABS = ["status", "timeline", "history", "usage", "files", "logs", "recent", "audit", "packages"] as const;

interface TimelineEvent {
  kind?: string;
  seq?: number;
  content?: string;
  content_type?: string;
  role?: string;
  [key: string]: unknown;
}

export function InspectorTabs({ activeTab, onTabChange, sessionUuid, sessionStatus }: InspectorTabsProps) {
  const [timelineData, setTimelineData] = useState<TimelineEvent[] | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, unknown> | null>(null);
  const [usageData, setUsageData] = useState<Record<string, unknown> | null>(null);
  const [filesData, setFilesData] = useState<Record<string, unknown> | null>(null);
  const [debugData, setDebugData] = useState<Record<string, Record<string, unknown> | null>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  // Reset all cached data when session changes
  useEffect(() => {
    setTimelineData(null);
    setHistoryData(null);
    setUsageData(null);
    setFilesData(null);
    setDebugData({});
    setErrors({});
    setLoading(null);
  }, [sessionUuid]);

  useEffect(() => {
    const auth = getAuthState();
    if (!auth || !sessionUuid) return;

    if (activeTab === "timeline" && timelineData === null) {
      setLoading("timeline");
      sessionsApi.timeline(auth, sessionUuid)
        .then((data) => setTimelineData(data))
        .catch((err) => setErrors((prev) => ({
          ...prev,
          timeline: err instanceof ApiRequestError ? err.details.message : "Failed",
        })))
        .finally(() => setLoading(null));
    }

    if (activeTab === "history" && historyData === null) {
      setLoading("history");
      sessionsApi.history(auth, sessionUuid)
        .then((data) => setHistoryData(data))
        .catch((err) => setErrors((prev) => ({
          ...prev,
          history: err instanceof ApiRequestError ? err.details.message : "Failed",
        })))
        .finally(() => setLoading(null));
    }

    if (activeTab === "usage" && usageData === null) {
      setLoading("usage");
      sessionsApi.usage(auth, sessionUuid)
        .then((data) => setUsageData(data))
        .catch((err) => setErrors((prev) => ({
          ...prev,
          usage: err instanceof ApiRequestError ? err.details.message : "Failed",
        })))
        .finally(() => setLoading(null));
    }

    if (activeTab === "files" && filesData === null) {
      setLoading("files");
      sessionsApi.files(auth, sessionUuid)
        .then((data) => setFilesData(data))
        .catch((err) => setErrors((prev) => ({
          ...prev,
          files: err instanceof ApiRequestError ? err.details.message : "Failed",
        })))
        .finally(() => setLoading(null));
    }

    if (activeTab === "logs" && !debugData.logs) {
      setLoading("logs");
      debugApi.logs(auth, { session_uuid: sessionUuid, limit: 20 })
        .then((data) => setDebugData((prev) => ({ ...prev, logs: data })))
        .catch((err) => setErrors((prev) => ({
          ...prev,
          logs: err instanceof ApiRequestError ? err.details.message : "Failed",
        })))
        .finally(() => setLoading(null));
    }

    if (activeTab === "recent" && !debugData.recent) {
      setLoading("recent");
      debugApi.recentErrors(auth, { limit: 20 })
        .then((data) => setDebugData((prev) => ({ ...prev, recent: data })))
        .catch((err) => setErrors((prev) => ({
          ...prev,
          recent: err instanceof ApiRequestError ? err.details.message : "Failed",
        })))
        .finally(() => setLoading(null));
    }

    if (activeTab === "audit" && !debugData.audit) {
      setLoading("audit");
      debugApi.audit(auth, { session_uuid: sessionUuid, limit: 20 })
        .then((data) => setDebugData((prev) => ({ ...prev, audit: data })))
        .catch((err) => setErrors((prev) => ({
          ...prev,
          audit: err instanceof ApiRequestError ? err.details.message : "Failed",
        })))
        .finally(() => setLoading(null));
    }

    if (activeTab === "packages" && !debugData.packages) {
      setLoading("packages");
      debugApi.packages(auth)
        .then((data) => setDebugData((prev) => ({ ...prev, packages: data })))
        .catch((err) => setErrors((prev) => ({
          ...prev,
          packages: err instanceof ApiRequestError ? err.details.message : "Failed",
        })))
        .finally(() => setLoading(null));
    }
  }, [activeTab, sessionUuid, timelineData, historyData, usageData, filesData, debugData]);

  const renderStatus = () => {
    const status = sessionStatus;
    const durable = status && typeof status === "object"
      ? (status as { durable_truth?: Record<string, unknown> }).durable_truth
      : undefined;

    return (
      <div style={styles.panel}>
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Runtime</div>
          {status && typeof status === "object" ? (
            <pre style={styles.pre}>
              {JSON.stringify(status, null, 2)}
            </pre>
          ) : (
            <div style={styles.empty}>No status data available</div>
          )}
        </div>
        {durable && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Durable Truth</div>
            <pre style={styles.pre}>
              {JSON.stringify(durable, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderTimeline = () => {
    if (loading === "timeline") return <div style={styles.empty}>Loading...</div>;
    if (errors.timeline) return <div style={styles.error}>{errors.timeline}</div>;
    if (!timelineData) return <div style={styles.empty}>No timeline data</div>;

    return (
      <div style={styles.panel}>
        <div style={styles.sectionTitle}>Events ({timelineData.length})</div>
        <div style={styles.eventList}>
          {timelineData.map((ev, i) => (
            <div key={i} style={styles.eventItem}>
              <span style={styles.eventSeq}>{ev.seq ?? "-"}</span>
              <span style={styles.eventKind}>{ev.kind ?? ev.role ?? "?"}</span>
              {ev.content && (
                <span style={styles.eventContent}>
                  {typeof ev.content === "string"
                    ? ev.content.slice(0, 60) + (ev.content.length > 60 ? "..." : "")
                    : String(ev.content)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderHistory = () => {
    if (loading === "history") return <div style={styles.empty}>Loading...</div>;
    if (errors.history) return <div style={styles.error}>{errors.history}</div>;
    if (!historyData) return <div style={styles.empty}>No history data</div>;

    const messages = historyData && typeof historyData === "object" && "messages" in historyData
      ? (historyData as { messages: Array<{ role?: string; body?: { text?: string }; kind?: string; created_at?: string }> }).messages
      : [];

    return (
      <div style={styles.panel}>
        <div style={styles.sectionTitle}>Messages ({messages?.length ?? 0})</div>
        <div style={styles.eventList}>
          {Array.isArray(messages) && messages.map((msg, i) => (
            <div key={i} style={styles.eventItem}>
              <span style={styles.eventKind}>{msg.role ?? msg.kind ?? "?"}</span>
              <span style={styles.eventContent}>
                {msg.body?.text?.slice(0, 60) ?? ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderUsage = () => {
    if (loading === "usage") return <div style={styles.empty}>Loading...</div>;
    if (errors.usage) return <div style={styles.error}>{errors.usage}</div>;
    if (!usageData) return <div style={styles.empty}>No usage data</div>;

    return (
      <div style={styles.panel}>
        <div style={styles.sectionTitle}>Usage Snapshot</div>
        <pre style={styles.pre}>{JSON.stringify(usageData, null, 2)}</pre>
        <div style={styles.note}>
          Note: usage data is a point-in-time snapshot. Live usage updates are not yet available.
        </div>
      </div>
    );
  };

  const renderJsonPanel = (tab: string, data: Record<string, unknown> | null) => {
    if (loading === tab) return <div style={styles.empty}>Loading...</div>;
    if (errors[tab]) return <div style={styles.error}>{errors[tab]}</div>;
    if (!data) return <div style={styles.empty}>No {tab} data</div>;
    return (
      <div style={styles.panel}>
        <div style={styles.sectionTitle}>{tab} Snapshot</div>
        <pre style={styles.pre}>{JSON.stringify(data, null, 2)}</pre>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case "status": return renderStatus();
      case "timeline": return renderTimeline();
      case "history": return renderHistory();
      case "usage": return renderUsage();
      case "files": return renderJsonPanel("files", filesData);
      case "logs": return renderJsonPanel("logs", debugData.logs ?? null);
      case "recent": return renderJsonPanel("recent", debugData.recent ?? null);
      case "audit": return renderJsonPanel("audit", debugData.audit ?? null);
      case "packages": return renderJsonPanel("packages", debugData.packages ?? null);
      default: return null;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            style={{
              ...styles.tab,
              ...(activeTab === tab ? styles.tabActive : {}),
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      <div style={styles.content}>{renderContent()}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  tabs: {
    display: "flex",
    borderBottom: "1px solid var(--color-border-default)",
    padding: "4px 8px",
    gap: 2,
  },
  tab: {
    padding: "6px 12px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    color: "var(--color-text-muted)",
    fontSize: "0.75rem",
    fontWeight: 500,
    textTransform: "capitalize",
    cursor: "pointer",
  },
  tabActive: {
    background: "var(--color-bg-overlay)",
    color: "var(--color-text-primary)",
  },
  content: {
    flex: 1,
    overflow: "auto",
  },
  panel: {
    padding: 12,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "var(--color-text-secondary)",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  pre: {
    fontSize: "0.65rem",
    fontFamily: "monospace",
    color: "var(--color-text-muted)",
    background: "var(--color-bg-sunken)",
    padding: 8,
    borderRadius: "var(--radius-sm)",
    overflow: "auto",
    maxHeight: 400,
    whiteSpace: "pre-wrap",
  },
  empty: {
    padding: 24,
    textAlign: "center",
    fontSize: "0.8rem",
    color: "var(--color-text-muted)",
  },
  error: {
    padding: 24,
    textAlign: "center",
    fontSize: "0.8rem",
    color: "var(--color-accent-error)",
  },
  eventList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  eventItem: {
    display: "flex",
    gap: 8,
    alignItems: "baseline",
    padding: "4px 6px",
    borderRadius: "var(--radius-sm)",
    background: "var(--color-bg-sunken)",
    fontSize: "0.7rem",
    fontFamily: "monospace",
  },
  eventSeq: {
    color: "var(--color-text-muted)",
    minWidth: 24,
    fontSize: "0.65rem",
  },
  eventKind: {
    color: "var(--color-accent-primary)",
    minWidth: 70,
    fontSize: "0.65rem",
    fontWeight: 600,
  },
  eventContent: {
    color: "var(--color-text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    fontSize: "0.65rem",
  },
  note: {
    marginTop: 8,
    padding: 8,
    background: "rgba(251,191,36,0.1)",
    border: "1px solid rgba(251,191,36,0.2)",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.65rem",
    color: "var(--color-accent-warning)",
  },
};
