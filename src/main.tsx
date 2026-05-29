import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./design/sightline.css";
import { SightLineTheme } from "./design/ThemeProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SightLineTheme accent="lime">
      <App />
    </SightLineTheme>
  </React.StrictMode>,
);
