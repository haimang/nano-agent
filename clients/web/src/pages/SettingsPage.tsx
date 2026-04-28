export function SettingsPage() {
  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Settings</h2>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Orchestrator URL</h3>
        <p style={styles.sectionText}>
          The upstream orchestrator-core endpoint. Requests are proxied through the
          same-origin BFF at <code style={styles.code}>/api/*</code>.
        </p>
        <div style={styles.value}>
          <span style={styles.valueLabel}>Preview default:</span>
          <code style={styles.valueCode}>
            nano-agent-orchestrator-core-preview.haimang.workers.dev
          </code>
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>BFF Layer</h3>
        <p style={styles.sectionText}>
          All HTTP traffic flows through Cloudflare Pages Functions (
          <code style={styles.code}>functions/api/[[path]].ts</code>) to provide
          same-origin routing, CORS headers, and trace injection.
        </p>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>WebSocket</h3>
        <p style={styles.sectionText}>
          The WebSocket connection for chat streaming connects directly to the
          orchestrator-core. This is a controlled exception for foundation phase.
        </p>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Auth</h3>
        <p style={styles.sectionText}>
          Authentication uses bearer tokens obtained through the facade auth routes.
          Tokens are persisted in localStorage for session continuity.
        </p>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Known Limitations</h3>
        <ul style={styles.limitsList}>
          <li style={styles.limitsItem}>
            <strong>Usage:</strong> Usage data is a point-in-time HTTP snapshot.
            Live push updates are not yet available.
          </li>
          <li style={styles.limitsItem}>
            <strong>Permissions:</strong> Permission decision HTTP path is live,
            but runtime unblock via WebSocket is not yet implemented.
          </li>
          <li style={styles.limitsItem}>
            <strong>Files:</strong> File inspection is limited to metadata.
            Upload/download/preview are not yet available.
          </li>
          <li style={styles.limitsItem}>
            <strong>Model selector:</strong> Model/provider switching is not yet
            available in the UI.
          </li>
          <li style={styles.limitsItem}>
            <strong>Catalog:</strong> Catalog data may be empty if no plugins are loaded.
          </li>
        </ul>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, maxWidth: 640 },
  heading: { fontSize: "1.25rem", fontWeight: 700, marginBottom: 24 },
  section: {
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "var(--radius-md)",
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: "0.875rem", fontWeight: 600, marginBottom: 4 },
  sectionText: {
    fontSize: "0.8rem",
    color: "var(--color-text-muted)",
    marginBottom: 12,
    lineHeight: 1.5,
  },
  code: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    background: "var(--color-bg-sunken)",
    padding: "2px 6px",
    borderRadius: "var(--radius-sm)",
  },
  value: {
    padding: 10,
    background: "var(--color-bg-sunken)",
    borderRadius: "var(--radius-sm)",
  },
  valueLabel: { fontSize: "0.7rem", color: "var(--color-text-muted)", display: "block", marginBottom: 4 },
  valueCode: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    color: "var(--color-text-secondary)",
    wordBreak: "break-all",
  },
  limitsList: {
    margin: 0,
    paddingLeft: 20,
  },
  limitsItem: {
    fontSize: "0.8rem",
    color: "var(--color-text-muted)",
    marginBottom: 6,
    lineHeight: 1.4,
  },
};
