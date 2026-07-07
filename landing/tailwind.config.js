/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // AgentQuorum identity. No neon, no glass.
        "bg-base": "#ffffff",
        ink: "#121212",
        "ink-soft": "#333333",
        gray: { 450: "#666666", 350: "#888888" },
        hair: "#e2e2e2",
        oxblood: "#7a1620",   // red ink on the record (replaces brand neon)
        inkblue: "#326891",   // links
        seal: "#121212",
      },
      fontFamily: {
        sans: ["Libre Franklin", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Source Serif 4", "Georgia", "serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
        plate: ["UnifrakturMaguntia", "Source Serif 4", "serif"],
      },
      maxWidth: { "7xl": "80rem" },
    },
  },
  plugins: [],
};
