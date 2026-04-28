export function Topbar() {
  return (
    <header style={styles.topbar}>
      <div style={styles.spacer} />
      <div style={styles.status}>
        <span style={styles.statusDot} />
        <span style={styles.statusText}>Connected</span>
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topbar: {
    height: "var(--topbar-height)",
    background: "var(--color-bg-elevated)",
    borderBottom: "1px solid var(--color-border-default)",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: "0 16px",
    flexShrink: 0,
  },
  spacer: {
    flex: 1,
  },
  status: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--color-accent-success)",
  },
  statusText: {
    fontSize: "0.75rem",
    color: "var(--color-text-muted)",
  },
};
