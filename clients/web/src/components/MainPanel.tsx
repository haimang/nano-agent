import type { ReactNode } from "react";

interface MainPanelProps {
  children: ReactNode;
}

export function MainPanel({ children }: MainPanelProps) {
  return <main style={styles.main}>{children}</main>;
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    flex: 1,
    overflow: "auto",
    background: "var(--color-bg-base)",
  },
};
