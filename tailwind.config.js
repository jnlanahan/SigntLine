/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        sl: {
          bg:            "#0d0e12",
          bgInner:       "#111419",
          accent:        "#C2E84B",
          accentDeep:    "#8FBE2E",
          accentSoft:    "rgba(194,232,75,0.18)",
          ink:           "#F1F4F8",
          ink2:          "#B4BCC8",
          ink3:          "#79808D",
          divider:       "rgba(226,232,242,0.12)",
          dividerStrong: "rgba(226,232,242,0.20)",
          ok:            "#8FCB66",
          okSoft:        "rgba(143,203,102,0.18)",
          error:         "#ef4444",
          thinking:      "#f59e0b",
          chipBg:        "rgba(226,232,242,0.04)",
          segTrack:      "rgba(226,232,242,0.06)",
          segActive:     "rgba(226,232,242,0.14)",
          inputBg:       "rgba(226,232,242,0.05)",
          iconHover:     "rgba(226,232,242,0.09)",
          btnText:       "#1b2400",
        },
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
        serif: [
          '"AW Conqueror Didot"',
          '"Didot"',
          '"Bodoni MT"',
          '"Playfair Display"',
          "Georgia",
          "serif",
        ],
      },
      animation: {
        "fade-in": "fadeIn 0.18s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0", transform: "translateY(-2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
