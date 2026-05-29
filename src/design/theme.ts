// sightline/theme.ts
// Accent palettes + theme tokens for the SightLine overlay components.

export type AccentName = "lime" | "cobalt" | "rose" | "slate";

export interface AccentDef {
  accent: string;
  deep: string;
  soft: string;
  gold: string;
  rgb: string; // "r,g,b" — used for alpha variants
  on: string; // text color on top of the accent
  logo: string; // logo/orb gradient
  wave: [number, number, number][]; // waveform gradient stops
}

export const ACCENTS: Record<AccentName, AccentDef> = {
  lime: {
    accent: "#C2E84B", deep: "#8FBE2E", soft: "#D7F27A", gold: "#E6F59A", rgb: "194,232,75", on: "#1b2400",
    logo: "linear-gradient(150deg,#E6F59A 0%,#C2E84B 48%,#8FBE2E 100%)",
    wave: [[230, 245, 154], [194, 232, 75], [159, 209, 46], [127, 181, 46]],
  },
  cobalt: {
    accent: "#4F8BF2", deep: "#2E63D6", soft: "#6FA8FF", gold: "#9FC2FF", rgb: "79,139,242", on: "#ffffff",
    logo: "linear-gradient(150deg,#8FB8FF 0%,#4F8BF2 48%,#2E63D6 100%)",
    wave: [[143, 184, 255], [79, 139, 242], [62, 111, 224], [88, 104, 232]],
  },
  rose: {
    accent: "#FF6B81", deep: "#E0364F", soft: "#FF9AAB", gold: "#FFB3C0", rgb: "255,107,129", on: "#33000d",
    logo: "linear-gradient(150deg,#FFB3C0 0%,#FF6B81 48%,#E0364F 100%)",
    wave: [[255, 179, 192], [255, 107, 129], [240, 67, 106], [224, 54, 79]],
  },
  slate: {
    accent: "#9FB2C8", deep: "#6B7E96", soft: "#C2CFDE", gold: "#CDD8E6", rgb: "159,178,200", on: "#10141b",
    logo: "linear-gradient(150deg,#CDD8E6 0%,#9FB2C8 48%,#6B7E96 100%)",
    wave: [[205, 216, 230], [159, 178, 200], [126, 145, 171], [107, 126, 150]],
  },
};

export interface SightLineTheme {
  glassBg: string;
  glassGrad: string;
  border: string;
  hi: string;
  ink: string;
  ink2: string;
  ink3: string;
  instr: string;
  green: string;
  greenRGB: string;
  logoInk: string;
  font: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  gold: string;
  accentRGB: string;
  onAccent: string;
  logoGrad: string;
  waveStops: [number, number, number][];
}

/** light-on-dark hairline / tint at a given alpha */
export const lt = (a: number) => `rgba(226,232,242,${a})`;
/** accent rgb at a given alpha */
export const ar = (rgb: string, a: number) => `rgba(${rgb},${a})`;

export function makeTheme(name: AccentName = "lime"): SightLineTheme {
  const a = ACCENTS[name] ?? ACCENTS.lime;
  return {
    glassBg: "rgba(22,24,29,0.64)",
    glassGrad: "linear-gradient(180deg, rgba(46,50,60,0.40) 0%, rgba(17,19,24,0.28) 100%)",
    border: lt(0.12), hi: lt(0.2),
    ink: "#F1F4F8", ink2: "#B4BCC8", ink3: "#79808D",
    instr: "linear-gradient(180deg, #121419 0%, #0a0b0e 100%)",
    green: "#8FCB66", greenRGB: "143,203,102", logoInk: "#0e1118",
    font: '"AW Conqueror Didot", "Didot", "Bodoni MT", "Playfair Display", Georgia, serif',
    accent: a.accent, accentDeep: a.deep, accentSoft: a.soft, gold: a.gold,
    accentRGB: a.rgb, onAccent: a.on, logoGrad: a.logo, waveStops: a.wave,
  };
}

/** interpolate a waveform color at fraction f (0..1) across the accent's stops */
export function waveColor(stops: [number, number, number][], f: number): string {
  const seg = f * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const t = seg - i, a = stops[i], b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
