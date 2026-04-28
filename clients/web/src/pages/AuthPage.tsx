import { useState } from "react";
import * as authApi from "../apis/auth";
import { setAuthState } from "../state/auth";
import { ApiRequestError } from "../apis/transport";

type AuthMode = "login" | "register";

interface AuthPageProps {
  onSuccess: () => void;
}

export function AuthPage({ onSuccess }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let auth: authApi.AuthState;
      if (mode === "register") {
        auth = await authApi.register(email, password, displayName || "Nano User");
      } else {
        auth = await authApi.login(email, password);
      }
      setAuthState(auth);
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiRequestError
          ? `${err.details.message} (${err.details.status})`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.logo}>⚡</span>
          <h1 style={styles.title}>nano-agent</h1>
          <p style={styles.subtitle}>
            {mode === "login" ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.tabs}>
            <button
              type="button"
              onClick={() => { setMode("login"); setError(null); }}
              style={{
                ...styles.tab,
                ...(mode === "login" ? styles.tabActive : {}),
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode("register"); setError(null); }}
              style={{
                ...styles.tab,
                ...(mode === "register" ? styles.tabActive : {}),
              }}
            >
              Register
            </button>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              style={styles.input}
              required
            />
          </div>

          {mode === "register" && (
            <div style={styles.field}>
              <label style={styles.label}>Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                style={styles.input}
              />
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={styles.input}
              required
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" style={styles.submit} disabled={loading}>
            {loading
              ? "Please wait..."
              : mode === "login"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--color-bg-base)",
  },
  card: {
    width: 400,
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-default)",
    borderRadius: "var(--radius-lg)",
    padding: 32,
  },
  header: {
    textAlign: "center",
    marginBottom: 24,
  },
  logo: { fontSize: "2rem" },
  title: {
    fontSize: "var(--fontSize-xl)",
    fontWeight: 700,
    marginTop: 8,
  },
  subtitle: {
    fontSize: "0.875rem",
    color: "var(--color-text-muted)",
    marginTop: 4,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  tabs: {
    display: "flex",
    background: "var(--color-bg-sunken)",
    borderRadius: "var(--radius-md)",
    padding: 4,
  },
  tab: {
    flex: 1,
    padding: "8px 16px",
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
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "var(--color-text-secondary)",
  },
  input: {
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border-accent)",
    background: "var(--color-bg-sunken)",
    color: "var(--color-text-primary)",
    fontSize: "0.875rem",
    outline: "none",
  },
  submit: {
    padding: "10px 20px",
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "var(--color-accent-primary)",
    color: "var(--color-text-inverse)",
    fontSize: "0.875rem",
    fontWeight: 700,
    marginTop: 8,
    cursor: "pointer",
  },
  error: {
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    background: "rgba(248,113,113,0.15)",
    border: "1px solid rgba(248,113,113,0.3)",
    color: "var(--color-accent-error)",
    fontSize: "0.8rem",
  },
};
