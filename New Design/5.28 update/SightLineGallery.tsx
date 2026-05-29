// sightline/SightLineGallery.tsx
// Optional demo — renders every view. Not required for import; handy for a
// /dev route to eyeball the components.
"use client";

import React, { useState } from "react";
import { AccentName } from "./theme";
import { SightLineTheme } from "./ThemeProvider";
import { ModePicker, ExpandedPanel, CompressedPanel, CollapsedBar, MiniOrb, SightLineMode } from "./panels";

const SWATCHES: [AccentName, string][] = [
  ["lime", "#C2E84B"], ["cobalt", "#4F8BF2"], ["rose", "#FF6B81"], ["slate", "#9FB2C8"],
];

function Stage({ label, w, h, children }: { label: string; w: number; h: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
      <div
        className="relative flex items-start justify-center overflow-hidden rounded-2xl p-6"
        style={{ width: w, height: h, background: "radial-gradient(120% 80% at 70% 0%, #1c2024 0%, transparent 55%), linear-gradient(160deg, #15171c, #0b0c0f)" }}
      >
        {children}
      </div>
    </div>
  );
}

export function SightLineGallery() {
  const [accent, setAccent] = useState<AccentName>("lime");
  const [mode, setMode] = useState<SightLineMode>("tech_support");
  return (
    <SightLineTheme accent={accent}>
      <div className="min-h-screen bg-[#0a0b0e] px-10 py-8 text-neutral-200">
        <div className="mb-2 flex flex-wrap items-center gap-4">
          <h1 className="m-0 text-[22px] font-bold tracking-tight">SightLine — React components</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-neutral-500">Accent</span>
            {SWATCHES.map(([name, hex]) => (
              <button
                key={name}
                onClick={() => setAccent(name)}
                title={name}
                className="h-6 w-6 cursor-pointer rounded-lg"
                style={{ background: hex, border: accent === name ? "2px solid #fff" : "2px solid transparent" }}
              />
            ))}
          </div>
        </div>
        <p className="mb-7 max-w-xl text-sm text-neutral-400">Default accent is Lime. Every view is its own component.</p>

        <div className="flex flex-wrap items-start gap-9">
          <Stage label="Home · Mode picker" w={460} h={476}><ModePicker selected={mode} onSelect={setMode} /></Stage>
          <Stage label="Expanded · dual monitor" w={460} h={760}><ExpandedPanel /></Stage>
          <Stage label="Compressed · single monitor" w={348} h={460}><CompressedPanel /></Stage>
          <Stage label="Collapsed bar" w={400} h={184}><div style={{ marginTop: 26 }}><CollapsedBar /></div></Stage>
          <Stage label="Mini orb" w={220} h={200}><div style={{ marginTop: 26 }}><MiniOrb /></div></Stage>
        </div>
      </div>
    </SightLineTheme>
  );
}
