/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        sl: {
          bg:            "#F7F5EF",
          bgInner:       "#EFECE3",
          accent:        "#C2E84B",
          accentDeep:    "#8FBE2E",
          accentSoft:    "rgba(194,232,75,0.22)",
          ink:           "#23271C",
          ink2:          "#4C5243",
          ink3:          "#7B816D",
          divider:       "rgba(44,48,34,0.14)",
          dividerStrong: "rgba(44,48,34,0.24)",
          ok:            "#4F8A2C",
          okSoft:        "rgba(110,167,66,0.18)",
          error:         "#DB3B3B",
          thinking:      "#C07C10",
          chipBg:        "rgba(44,48,34,0.04)",
          segTrack:      "rgba(44,48,34,0.06)",
          segActive:     "rgba(44,48,34,0.14)",
          inputBg:       "rgba(44,48,34,0.05)",
          iconHover:     "rgba(44,48,34,0.09)",
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
