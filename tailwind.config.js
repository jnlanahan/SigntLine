/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        // New design system tokens
        sl: {
          bg:           "#0d1117",
          bgInner:      "#111827",
          headerBg:     "#0a0f1a",
          accent:       "#8FC4EC",
          accentDeep:   "#5A93C7",
          accentSoft:   "rgba(90,147,199,0.18)",
          orbInner:     "#0f1a26",
          orbOuter:     "#04080f",
          ink:          "#F4E8DA",
          ink2:         "#B8A89A",
          ink3:         "#7A6E63",
          divider:      "rgba(244,232,218,0.08)",
          dividerStrong:"rgba(244,232,218,0.14)",
          ok:           "#5BD08B",
          okSoft:       "rgba(91,208,139,0.18)",
          error:        "#ef4444",
          thinking:     "#f59e0b",
          chipBg:       "rgba(244,232,218,0.04)",
          segTrack:     "rgba(244,232,218,0.06)",
          segActive:    "rgba(244,232,218,0.14)",
          inputBg:      "rgba(244,232,218,0.04)",
          iconHover:    "rgba(244,232,218,0.07)",
          btnText:      "#15110d",
        },
        // Keep legacy tokens during migration
        panel: {
          bg:     "rgba(15, 17, 22, 0.88)",
          border: "rgba(255, 255, 255, 0.08)",
        },
        accent: {
          DEFAULT: "#8FC4EC",
          soft: "rgba(90, 147, 199, 0.18)",
        },
        watching: "#5BD08B",
        thinking: "#f59e0b",
        waiting:  "#94a3b8",
        error:    "#ef4444",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      animation: {
        pulse:          "pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in":      "fadeIn 0.18s ease-out",
        "sl-lava1":     "sl-lava1 14s ease-in-out infinite",
        "sl-lava2":     "sl-lava2 16s ease-in-out infinite",
        "sl-bloom":     "sl-window-bloom 5.5s ease-in-out infinite",
        "dpad-bloom":   "dpad-bloom 5.5s ease-in-out infinite",
        "dpad-pulse":   "dpad-core-pulse 4.2s ease-in-out infinite",
        "dpad-blob1":   "dpad-blob1 5s ease-in-out infinite",
        "dpad-blob2":   "dpad-blob2 5s ease-in-out infinite",
        "live-pulse":   "sl-live-pulse 1.5s ease-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0", transform: "translateY(-2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "sl-lava1": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%":      { transform: "translate(40px, -20px) scale(1.15)" },
          "66%":      { transform: "translate(-20px, 30px) scale(0.9)" },
        },
        "sl-lava2": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%":      { transform: "translate(-30px, 50px) scale(1.2)" },
        },
        "sl-window-bloom": {
          "0%, 100%": { opacity: "0.75", transform: "scale(0.98)" },
          "50%":      { opacity: "1",    transform: "scale(1.02)" },
        },
        "dpad-bloom": {
          "0%, 100%": { opacity: "0.7", transform: "scale(0.98)" },
          "50%":      { opacity: "1",   transform: "scale(1.04)" },
        },
        "dpad-core-pulse": {
          "0%, 100%": { opacity: "0.85", transform: "translate(-50%, -50%) scale(1)" },
          "50%":      { opacity: "1",    transform: "translate(-50%, -50%) scale(1.08)" },
        },
        "dpad-blob1": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%":      { transform: "translate(6px, -8px) scale(1.15)" },
          "66%":      { transform: "translate(-5px, 5px) scale(0.9)" },
        },
        "dpad-blob2": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%":      { transform: "translate(-9px, 10px) scale(1.2)" },
        },
        "sl-live-pulse": {
          "0%":   { transform: "scale(0.6)", opacity: "0.5" },
          "80%":  { transform: "scale(2)",   opacity: "0" },
          "100%": { transform: "scale(2)",   opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};
