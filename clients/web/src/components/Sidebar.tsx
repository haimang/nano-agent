import type { SessionSummary } from "../state/sessions";
import { SessionList } from "./SessionList";

type Page = "auth" | "chat" | "settings" | "catalog" | "health";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  sessions: SessionSummary[];
  activeSessionUuid: string | null;
  onSelectSession: (uuid: string) => void;
  onCreateSession: () => void;
  sessionsLoading: boolean;
  onLogout: () => void;
}

const navItems: { page: Page; label: string; icon: string }[] = [
  { page: "chat", label: "Chat", icon: "💬" },
  { page: "catalog", label: "Catalog", icon: "📦" },
  { page: "health", label: "Health", icon: "🫀" },
  { page: "settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar({
  currentPage,
  onNavigate,
  sessions,
  activeSessionUuid,
  onSelectSession,
  onCreateSession,
  sessionsLoading,
  onLogout,
}: SidebarProps) {
  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand}>
        <span style={styles.brandIcon}>⚡</span>
        <span style={styles.brandText}>nano-agent</span>
      </div>
      <nav style={styles.nav}>
        {navItems.map((item) => (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            style={{
              ...styles.navItem,
              ...(currentPage === item.page ? styles.navItemActive : {}),
            }}
          >
            <span style={styles.navIcon}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <SessionList
        sessions={sessions}
        activeSessionUuid={activeSessionUuid}
        onSelect={(uuid) => {
          onSelectSession(uuid);
          onNavigate("chat");
        }}
        onCreateNew={onCreateSession}
        loading={sessionsLoading}
      />
      <div style={styles.footer}>
        <button onClick={onLogout} style={styles.logoutBtn}>
          Sign Out
        </button>
        <span style={styles.version}>web-v10</span>
      </div>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: "var(--sidebar-width)",
    minWidth: "var(--sidebar-width)",
    background: "var(--color-bg-elevated)",
    borderRight: "1px solid var(--color-border-default)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid var(--color-border-subtle)",
    height: "var(--topbar-height)",
  },
  brandIcon: { fontSize: "1.25rem" },
  brandText: {
    fontSize: "0.875rem",
    fontWeight: 700,
    color: "var(--color-text-primary)",
  },
  nav: {
    padding: "8px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    borderBottom: "1px solid var(--color-border-subtle)",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "transparent",
    color: "var(--color-text-secondary)",
    fontSize: "0.875rem",
    fontWeight: 500,
    textAlign: "left",
    cursor: "pointer",
  },
  navItemActive: {
    background: "var(--color-bg-overlay)",
    color: "var(--color-text-primary)",
  },
  navIcon: { fontSize: "1rem", width: 20, textAlign: "center" },
  footer: {
    padding: "8px 16px",
    borderTop: "1px solid var(--color-border-subtle)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  version: {
    fontSize: "0.75rem",
    color: "var(--color-text-muted)",
  },
  logoutBtn: {
    padding: "4px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-border-default)",
    background: "transparent",
    color: "var(--color-text-muted)",
    fontSize: "0.7rem",
    cursor: "pointer",
  },
};
