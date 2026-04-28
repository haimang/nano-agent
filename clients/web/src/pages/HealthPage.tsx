import { useState, useEffect } from "react";
import * as debugApi from "../apis/debug";
import type { WorkerHealthSnapshot } from "../apis/debug";
import { ApiRequestError } from "../apis/transport";

export function HealthPage() {
  const [data, setData] = useState<WorkerHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    debugApi.workerHealth()
      .then((result) => setData(result))
      .catch((err) => {
        setError(err instanceof ApiRequestError ? err.details.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Worker Health</h2>
      <p style={styles.description}>
        Snapshot of all orchestrator worker health status.
      </p>

      {loading && <div style={styles.emptyText}>Loading...</div>}
      {error && <div style={styles.errorText}>{error}</div>}

      {data && (
        <>
          <div style={styles.summary}>
            <div style={styles.summaryItem}>
              <span style={styles.summaryLabel}>Environment</span>
              <span style={styles.summaryValue}>{data.environment}</span>
            </div>
            <div style={styles.summaryItem}>
              <span style={styles.summaryLabel}>Live/Total</span>
              <span style={styles.summaryValue}>
                {data.summary?.live ?? 0} / {data.summary?.total ?? 0}
              </span>
            </div>
            <div style={styles.summaryItem}>
              <span style={styles.summaryLabel}>Generated</span>
              <span style={styles.summaryValue}>
                {data.generated_at ?? "unknown"}
              </span>
            </div>
          </div>

          <div style={styles.table}>
            <div style={styles.tableHeader}>
              <span style={{ ...styles.col, flex: 2 }}>Worker</span>
              <span style={styles.col}>Status</span>
              <span style={styles.col}>Version</span>
            </div>
            {data.workers?.map((w, i) => (
              <div key={i} style={styles.tableRow}>
                <span style={{ ...styles.col, flex: 2, fontFamily: "monospace", fontSize: "0.7rem" }}>
                  {w.worker}
                </span>
                <span style={styles.col}>
                  <span
                    style={{
                      ...styles.badge,
                      background: w.live
                        ? "rgba(52,211,153,0.2)"
                        : "rgba(248,113,113,0.2)",
                      color: w.live
                        ? "var(--color-accent-success)"
                        : "var(--color-accent-error)",
                    }}
                  >
                    {w.status}
                  </span>
                </span>
                <span style={{ ...styles.col, fontSize: "0.7rem" }}>
                  {w.worker_version ?? "-"}
                </span>
              </div>
            ))}
          </div>

          <div style={styles.note}>
            This is a debug/operations endpoint. Data format is not a standard facade envelope.
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, maxWidth: 900 },
  heading: { fontSize: "1.25rem", fontWeight: 700, marginBottom: 8 },
  description: { fontSize: "0.875rem", color: "var(--color-text-muted)", marginBottom: 16 },
  summary: {
    display: "flex",
    gap: 16,
    marginBottom: 16,
    padding: 12,
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "var(--radius-md)",
  },
  summaryItem: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  summaryLabel: { fontSize: "0.65rem", color: "var(--color-text-muted)", textTransform: "uppercase" },
  summaryValue: { fontSize: "0.85rem", fontWeight: 600 },
  table: {
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
  },
  tableHeader: {
    display: "flex",
    padding: "10px 16px",
    background: "var(--color-bg-sunken)",
    borderBottom: "1px solid var(--color-border-default)",
    fontWeight: 600,
    fontSize: "0.8rem",
    color: "var(--color-text-muted)",
  },
  tableRow: {
    display: "flex",
    padding: "8px 16px",
    borderBottom: "1px solid var(--color-border-subtle)",
    alignItems: "center",
  },
  col: { flex: 1, fontSize: "0.8rem" },
  badge: {
    padding: "2px 8px",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.7rem",
    fontWeight: 600,
  },
  emptyText: { color: "var(--color-text-muted)", fontSize: "0.875rem", padding: 16 },
  errorText: { color: "var(--color-accent-error)", fontSize: "0.875rem", padding: 16 },
  note: {
    marginTop: 16,
    padding: 10,
    background: "rgba(56,189,248,0.1)",
    border: "1px solid rgba(56,189,248,0.2)",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.7rem",
    color: "var(--color-accent-primary)",
  },
};
