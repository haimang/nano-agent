import { useState, useEffect, useCallback, type ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { CatalogPage } from "./pages/CatalogPage";
import { HealthPage } from "./pages/HealthPage";
import { getAuthState, setAuthState, requireAuth } from "./state/auth";
import { getSessions, setSessions, type SessionSummary } from "./state/sessions";
import * as sessionsApi from "./apis/sessions";
import { ApiRequestError } from "./apis/transport";
import { InspectorTabs } from "./components/inspector/InspectorTabs";

type Page = "auth" | "chat" | "settings" | "catalog" | "health";

export function App() {
  const [page, setPage] = useState<Page>("auth");
  const [authChecked, setAuthChecked] = useState(false);
  const [sessions, setSessionsState] = useState<SessionSummary[]>([]);
  const [activeSessionUuid, setActiveSessionUuid] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<Record<string, unknown> | null>(null);
  const [inspectorTab, setInspectorTab] = useState<string>("status");

  const loadSessions = useCallback(async () => {
    const auth = getAuthState();
    if (!auth) return;
    setSessionsLoading(true);
    try {
      const data = await sessionsApi.listMySessions(auth);
      const list = (data && typeof data === "object" && "sessions" in data
        ? (data as { sessions: SessionSummary[] }).sessions
        : Array.isArray(data)
          ? data
          : []) as SessionSummary[];
      setSessions(list);
      setSessionsState(list);
    } catch (err) {
      if (err instanceof ApiRequestError && err.details.kind === "auth.expired") {
        setAuthState(null);
        setPage("auth");
      }
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const createSession = useCallback(async () => {
    const auth = requireAuth();
    setSessionsLoading(true);
    try {
      const result = await sessionsApi.createSession(auth);
      setActiveSessionUuid(result.session_uuid);
      setPage("chat");
      await loadSessions();
    } catch (err) {
      if (err instanceof ApiRequestError && err.details.kind === "auth.expired") {
        setAuthState(null);
        setPage("auth");
        return;
      }
      console.error("Failed to create session:", err);
    } finally {
      setSessionsLoading(false);
    }
  }, [loadSessions]);

  const selectSession = useCallback(async (uuid: string) => {
    setActiveSessionUuid(uuid);
    const auth = getAuthState();
    if (!auth) return;
    try {
      const status = await sessionsApi.sessionStatus(auth, uuid);
      setSessionStatus(status);
    } catch {
      setSessionStatus(null);
    }
  }, []);

  const handleLogout = useCallback(() => {
    setAuthState(null);
    setActiveSessionUuid(null);
    setSessionsState([]);
    setSessionStatus(null);
    setPage("auth");
  }, []);

  const handleAuthSuccess = useCallback(() => {
    setPage("chat");
    setAuthChecked(true);
    setTimeout(() => loadSessions(), 0);
  }, [loadSessions]);

  useEffect(() => {
    const auth = getAuthState();
    if (auth) {
      setPage("chat");
      loadSessions();
    } else {
      setPage("auth");
    }
    setAuthChecked(true);
  }, [loadSessions]);

  if (!authChecked) {
    return <div style={styles.loading} />;
  }

  const renderPage = (): ReactNode => {
    switch (page) {
      case "auth":
        return <AuthPage onSuccess={handleAuthSuccess} />;
      case "chat":
        return (
          <ChatPage
            activeSessionUuid={activeSessionUuid}
            onCreateSession={createSession}
            onStatusChange={setSessionStatus}
          />
        );
      case "settings":
        return <SettingsPage />;
      case "catalog":
        return <CatalogPage />;
      case "health":
        return <HealthPage />;
    }
  };

  const inspectorContent = page === "chat" && activeSessionUuid ? (
    <InspectorTabs
      activeTab={inspectorTab}
      onTabChange={setInspectorTab}
      sessionUuid={activeSessionUuid}
      sessionStatus={sessionStatus}
    />
  ) : undefined;

  return (
    <AppShell
      currentPage={page}
      onNavigate={setPage}
      sessions={sessions}
      activeSessionUuid={activeSessionUuid}
      onSelectSession={selectSession}
      onCreateSession={createSession}
      sessionsLoading={sessionsLoading}
      onLogout={handleLogout}
      inspectorContent={inspectorContent}
    >
      {renderPage()}
    </AppShell>
  );
}

const styles: Record<string, React.CSSProperties> = {
  loading: {
    height: "100%",
    background: "var(--color-bg-base)",
  },
};
