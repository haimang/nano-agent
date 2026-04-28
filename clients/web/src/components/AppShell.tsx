import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { InspectorPanel } from "./InspectorPanel";
import { MainPanel } from "./MainPanel";
import type { SessionSummary } from "../state/sessions";

type Page = "auth" | "chat" | "settings" | "catalog" | "health";

interface AppShellProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  children: ReactNode;
  sessions: SessionSummary[];
  activeSessionUuid: string | null;
  onSelectSession: (uuid: string) => void;
  onCreateSession: () => void;
  sessionsLoading: boolean;
  onLogout: () => void;
  inspectorContent?: ReactNode;
}

export function AppShell({
  currentPage,
  onNavigate,
  children,
  sessions,
  activeSessionUuid,
  onSelectSession,
  onCreateSession,
  sessionsLoading,
  onLogout,
  inspectorContent,
}: AppShellProps) {
  if (currentPage === "auth") {
    return <div style={styles.fullScreen}>{children}</div>;
  }

  return (
    <div style={styles.container}>
      <Topbar />
      <div style={styles.body}>
        <Sidebar
          currentPage={currentPage}
          onNavigate={onNavigate}
          sessions={sessions}
          activeSessionUuid={activeSessionUuid}
          onSelectSession={onSelectSession}
          onCreateSession={onCreateSession}
          sessionsLoading={sessionsLoading}
          onLogout={onLogout}
        />
        <MainPanel>{children}</MainPanel>
        <InspectorPanel>{inspectorContent}</InspectorPanel>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  fullScreen: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-bg-base)",
  },
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
};
