export const theme = {
  colors: {
    bg: {
      base: "#0f172a",
      elevated: "#111827",
      sunken: "#020617",
      overlay: "#1e293b",
    },
    border: {
      default: "#334155",
      subtle: "#1e293b",
      accent: "#475569",
    },
    text: {
      primary: "#e2e8f0",
      secondary: "#94a3b8",
      muted: "#64748b",
      inverse: "#082f49",
    },
    accent: {
      primary: "#38bdf8",
      primaryHover: "#7dd3fc",
      success: "#34d399",
      warning: "#fbbf24",
      error: "#f87171",
    },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    full: 9999,
  },
  fontSize: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    xxl: "1.5rem",
  },
} as const;

export const layout = {
  sidebar: {
    width: 260,
    minWidth: 200,
    maxWidth: 360,
  },
  inspector: {
    width: 320,
    minWidth: 260,
    maxWidth: 480,
  },
  topbar: {
    height: 48,
  },
} as const;
