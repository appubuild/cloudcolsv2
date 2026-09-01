import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Single brand primary + semantic CSS-variable tokens (light/dark).
        primary: {
          DEFAULT: "var(--primary)",
          fg: "#ffffff",
          hover: "var(--primary)",
          soft: "var(--surface-2)",
        },
        background: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        foreground: "var(--text)",
        "muted-foreground": "var(--text-muted)",
        border: "var(--border)",
        // Neutral scale for explicit shades.
        neutral: {
          0: "#ffffff",
          50: "#f7f8fa",
          100: "#eff1f4",
          200: "#e2e5ea",
          300: "#cbd0d9",
          400: "#9ca3af",
          500: "#6b7280",
          600: "#4b5563",
          700: "#374151",
          800: "#1f2937",
          900: "#111827",
        },
        success: { DEFAULT: "#16a34a", soft: "#ecfdf3" },
        warning: { DEFAULT: "#d97706", soft: "#fff7ed" },
        error: { DEFAULT: "#dc2626", soft: "#fef2f2" },
        info: { DEFAULT: "#2563eb", soft: "#eff4ff" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
        elevated: "0 12px 32px rgba(16,24,40,0.14)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "slide-up": {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in .18s ease-out",
        "slide-up": "slide-up .2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
