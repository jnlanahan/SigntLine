/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        panel: {
          bg: "rgba(15, 17, 22, 0.88)",
          border: "rgba(255, 255, 255, 0.08)",
        },
        accent: {
          DEFAULT: "#7C5CFF",
          soft: "rgba(124, 92, 255, 0.18)",
        },
        watching: "#22c55e",
        thinking: "#f59e0b",
        waiting: "#94a3b8",
        error: "#ef4444",
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
      },
      animation: {
        pulse: "pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.18s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: 0, transform: "translateY(-2px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
