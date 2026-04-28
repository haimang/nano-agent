export function Topbar() {
  return (
    <header style={styles.topbar}>
      <span style={styles.brand}>nano-agent</span>
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
    padding: "0 16px",
    flexShrink: 0,
  },
  brand: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--color-text-muted)",
    letterSpacing: "0.05em",
  },
};
