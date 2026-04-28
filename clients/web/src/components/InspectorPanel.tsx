import type { ReactNode } from "react";

interface InspectorPanelProps {
  children?: ReactNode;
}

export function InspectorPanel({ children }: InspectorPanelProps) {
  if (!children) {
    return (
      <aside style={styles.inspector}>
        <div style={styles.placeholder}>
          <span style={styles.icon}>🔍</span>
          <span style={styles.text}>Select a session to inspect</span>
        </div>
      </aside>
    );
  }

  return <aside style={styles.inspectorFilled}>{children}</aside>;
}

const styles: Record<string, React.CSSProperties> = {
  inspector: {
    width: "var(--inspector-width)",
    minWidth: "var(--inspector-width)",
    background: "var(--color-bg-elevated)",
    borderLeft: "1px solid var(--color-border-default)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  inspectorFilled: {
    width: "var(--inspector-width)",
    minWidth: "var(--inspector-width)",
    background: "var(--color-bg-elevated)",
    borderLeft: "1px solid var(--color-border-default)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    color: "var(--color-text-muted)",
  },
  icon: { fontSize: "2rem" },
  text: { fontSize: "0.875rem" },
};
