import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./design/sightline.css";
import { SightLineTheme } from "./design/ThemeProvider";
import { useSettings } from "./store/settings";
import type { AccentName } from "./lib/api";

function DynamicTheme({ children }: { children: React.ReactNode }) {
  const accent = useSettings((s) => (s.settings?.accentColor ?? "lime") as AccentName);
  return <SightLineTheme accent={accent}>{children}</SightLineTheme>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DynamicTheme>
      <App />
    </DynamicTheme>
  </React.StrictMode>,
);
