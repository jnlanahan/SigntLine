// sightline/icons.tsx
// Line icons used across the SightLine overlay. Each inherits color via the
// `c` prop (defaults to currentColor).
import React from "react";

type IconProps = { c?: string };
const sq = { width: 19, height: 19 } as const;

export const IList = ({ c = "currentColor" }: IconProps) => (
  <svg style={sq} viewBox="0 0 20 20" fill="none"><path d="M3 5h2M3 10h2M3 15h2" stroke={c} strokeWidth="1.7" strokeLinecap="round" /><path d="M8 5h9M8 10h9M8 15h6" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>
);
export const IMic = ({ c = "currentColor" }: IconProps) => (
  <svg style={sq} viewBox="0 0 20 20" fill="none"><rect x="7.5" y="2.5" width="5" height="9.5" rx="2.5" stroke={c} strokeWidth="1.7" /><path d="M4 9.5a6 6 0 0 0 12 0M10 15.5V18" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>
);
export const IPause = ({ c = "currentColor" }: IconProps) => (
  <svg style={sq} viewBox="0 0 20 20" fill="none"><rect x="5.5" y="4" width="3.2" height="12" rx="1.2" fill={c} /><rect x="11.3" y="4" width="3.2" height="12" rx="1.2" fill={c} /></svg>
);
export const ISpark = ({ c = "currentColor" }: IconProps) => (
  <svg style={sq} viewBox="0 0 20 20" fill="none"><path d="M10 2.5c.4 3.4 1.6 4.6 5 5-3.4.4-4.6 1.6-5 5-.4-3.4-1.6-4.6-5-5 3.4-.4 4.6-1.6 5-5Z" fill={c} /><path d="M15.5 12.5c.2 1.5.7 2 2.2 2.2-1.5.2-2 .7-2.2 2.2-.2-1.5-.7-2-2.2-2.2 1.5-.2 2-.7 2.2-2.2Z" fill={c} /></svg>
);
export const IGear = ({ c = "currentColor" }: IconProps) => (
  <svg style={sq} viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2.6" stroke={c} strokeWidth="1.6" /><path d="M10 2.4v2.2M10 15.4v2.2M17.6 10h-2.2M4.6 10H2.4M15.4 4.6l-1.6 1.6M6.2 13.8l-1.6 1.6M15.4 15.4l-1.6-1.6M6.2 6.2 4.6 4.6" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>
);
export const ISend = ({ c = "currentColor" }: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V4M4.5 7.5 8 4l3.5 3.5" stroke={c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IExpand = ({ c = "currentColor" }: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 6V2.5h3.5M12 6V2.5H8.5M2 8v3.5h3.5M12 8v3.5H8.5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const ISupport = ({ c = "currentColor" }: IconProps) => (
  <svg width="21" height="21" viewBox="0 0 22 22" fill="none"><path d="M5 11v-1a6 6 0 0 1 12 0v1" stroke={c} strokeWidth="1.7" strokeLinecap="round" /><rect x="3" y="11" width="3.4" height="5.4" rx="1.6" stroke={c} strokeWidth="1.7" /><rect x="15.6" y="11" width="3.4" height="5.4" rx="1.6" stroke={c} strokeWidth="1.7" /><path d="M17.3 16.4c0 1.7-1.6 2.6-3.3 2.6" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>
);
export const IClipboard = ({ c = "currentColor" }: IconProps) => (
  <svg width="21" height="21" viewBox="0 0 22 22" fill="none"><rect x="4.5" y="4" width="13" height="15" rx="2.2" stroke={c} strokeWidth="1.7" /><rect x="8" y="2.4" width="6" height="3.4" rx="1.3" stroke={c} strokeWidth="1.7" /><path d="M8 10.5h6M8 14h4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>
);
export const ICap = ({ c = "currentColor" }: IconProps) => (
  <svg width="21" height="21" viewBox="0 0 22 22" fill="none"><path d="M11 4 19.5 8 11 12 2.5 8 11 4Z" stroke={c} strokeWidth="1.7" strokeLinejoin="round" /><path d="M5.5 9.6V13.5c0 1.5 2.5 2.7 5.5 2.7s5.5-1.2 5.5-2.7V9.6" stroke={c} strokeWidth="1.7" strokeLinecap="round" /><path d="M19.5 8v4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>
);
export const IChevron = ({ c = "currentColor" }: IconProps) => (
  <svg width="9" height="12" viewBox="0 0 9 12" fill="none"><path d="M2 1l5 5-5 5" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
