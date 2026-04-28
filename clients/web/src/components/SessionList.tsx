import type { SessionSummary } from "../state/sessions";

interface SessionListProps {
  sessions: SessionSummary[];
  activeSessionUuid: string | null;
  onSelect: (uuid: string) => void;
  onCreateNew: () => void;
  loading: boolean;
}

const statusColors: Record<string, string> = {
  active: "var(--color-accent-success)",
  starting: "var(--color-accent-warning)",
  detached: "var(--color-text-muted)",
  ended: "var(--color-text-muted)",
};

export function SessionList({
  sessions,
  activeSessionUuid,
  onSelect,
  onCreateNew,
  loading,
}: SessionListProps) {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerText}>Sessions</span>
        <button onClick={onCreateNew} style={styles.newBtn} disabled={loading}>
          +
        </button>
      </div>
      <div style={styles.list}>
        {sessions.length === 0 && !loading && (
          <div style={styles.empty}>
            No sessions yet. Click + to create one.
          </div>
        )}
        {loading && sessions.length === 0 && (
          <div style={styles.empty}>Loading...</div>
        )}
        {sessions.map((s) => (
          <button
            key={s.session_uuid}
            onClick={() => onSelect(s.session_uuid)}
            style={{
              ...styles.item,
              ...(s.session_uuid === activeSessionUuid ? styles.itemActive : {}),
            }}
          >
            <span
              style={{
                ...styles.dot,
                background: statusColors[s.status] ?? "var(--color-text-muted)",
              }}
            />
            <span style={styles.itemId}>
              {s.session_uuid.slice(0, 8)}...
            </span>
            <span style={styles.itemStatus}>{s.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: "1px solid var(--color-border-subtle)",
  },
  headerText: {
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--color-text-muted)",
  },
  newBtn: {
    width: 24,
    height: 24,
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "var(--color-bg-overlay)",
    color: "var(--color-text-primary)",
    fontSize: "0.9rem",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  list: {
    flex: 1,
    overflow: "auto",
    padding: "4px",
  },
  empty: {
    padding: "12px 8px",
    fontSize: "0.75rem",
    color: "var(--color-text-muted)",
    textAlign: "center",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    color: "var(--color-text-secondary)",
    fontSize: "0.75rem",
    width: "100%",
    textAlign: "left",
    cursor: "pointer",
  },
  itemActive: {
    background: "var(--color-bg-overlay)",
    color: "var(--color-text-primary)",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  },
  itemId: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "monospace",
    fontSize: "0.7rem",
  },
  itemStatus: {
    fontSize: "0.65rem",
    color: "var(--color-text-muted)",
    flexShrink: 0,
  },
};
