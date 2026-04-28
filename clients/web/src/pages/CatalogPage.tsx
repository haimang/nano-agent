import { useState, useEffect } from "react";
import * as catalogApi from "../apis/catalog";
import { ApiRequestError } from "../apis/transport";

type CatalogKind = "skills" | "commands" | "agents";

export function CatalogPage() {
  const [kind, setKind] = useState<CatalogKind>("skills");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    catalogApi.catalog(kind)
      .then((result) => setData(result))
      .catch((err) => {
        setError(err instanceof ApiRequestError ? err.details.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [kind]);

  const items = data && typeof data === "object"
    ? (Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>).items)
        ? (data as { items: unknown[] }).items
        : Array.isArray((data as Record<string, unknown>)[kind])
          ? (data as Record<string, unknown[]>)[kind]
          : [])
    : [];

  const tabs: { k: CatalogKind; label: string }[] = [
    { k: "skills", label: "Skills" },
    { k: "commands", label: "Commands" },
    { k: "agents", label: "Agents" },
  ];

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Catalog</h2>
      <p style={styles.description}>
        Browse available skills, commands, and agents registered in the orchestrator.
      </p>
      <div style={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setKind(t.k)}
            style={{
              ...styles.tab,
              ...(kind === t.k ? styles.tabActive : {}),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div style={styles.emptyText}>Loading...</div>}
      {error && <div style={styles.errorText}>{error}</div>}

      {!loading && !error && (
        <>
          {!Array.isArray(items) || items.length === 0 ? (
            <div style={styles.empty}>
              <span style={styles.emptyText}>
                No {kind} registered in catalog. This may be expected if the orchestrator has no plugins loaded.
              </span>
            </div>
          ) : (
            <div style={styles.list}>
              {items.map((item, i) => {
                const obj = item as Record<string, unknown>;
                const title = typeof obj.name === "string" ? obj.name
                  : typeof obj.command === "string" ? obj.command
                  : typeof obj.id === "string" ? obj.id
                  : `#${i}`;
                const desc = typeof obj.description === "string" ? obj.description : undefined;
                return (
                  <div key={i} style={styles.card}>
                    <div style={styles.cardTitle}>{title}</div>
                    {desc && <div style={styles.cardDesc}>{desc}</div>}
                    <pre style={styles.cardJson}>
                      {JSON.stringify(obj, null, 2).slice(0, 400)}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
          <div style={styles.note}>
            Catalog data is populated by the orchestrator at runtime. Content may be empty in preview environments.
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, maxWidth: 800 },
  heading: { fontSize: "1.25rem", fontWeight: 700, marginBottom: 8 },
  description: { fontSize: "0.875rem", color: "var(--color-text-muted)", marginBottom: 16 },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 16,
    background: "var(--color-bg-sunken)",
    borderRadius: "var(--radius-md)",
    padding: 4,
    width: "fit-content",
  },
  tab: {
    padding: "6px 14px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    color: "var(--color-text-muted)",
    fontSize: "0.875rem",
    fontWeight: 500,
    cursor: "pointer",
  },
  tabActive: {
    background: "var(--color-bg-overlay)",
    color: "var(--color-text-primary)",
  },
  empty: {
    padding: 48,
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "var(--radius-md)",
    textAlign: "center",
  },
  emptyText: { color: "var(--color-text-muted)", fontSize: "0.875rem" },
  errorText: { color: "var(--color-accent-error)", fontSize: "0.875rem", padding: 16 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  card: {
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "var(--radius-md)",
    padding: 12,
  },
  cardTitle: { fontSize: "0.875rem", fontWeight: 600, marginBottom: 4 },
  cardDesc: { fontSize: "0.8rem", color: "var(--color-text-muted)", marginBottom: 8 },
  cardJson: {
    fontSize: "0.65rem",
    fontFamily: "monospace",
    color: "var(--color-text-muted)",
    background: "var(--color-bg-sunken)",
    padding: 6,
    borderRadius: "var(--radius-sm)",
    overflow: "hidden",
    maxHeight: 120,
    whiteSpace: "pre-wrap",
  },
  note: {
    marginTop: 16,
    padding: 10,
    background: "rgba(251,191,36,0.1)",
    border: "1px solid rgba(251,191,36,0.2)",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.7rem",
    color: "var(--color-accent-warning)",
  },
};
