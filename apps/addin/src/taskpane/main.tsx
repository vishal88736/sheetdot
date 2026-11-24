import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../functions/functions.js";
import "./index.css";
import { App } from "./App.js";

function mountTaskPane() {
  const container = document.getElementById("root");
  if (!container) return;

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
  Office.onReady(() => {
    mountTaskPane();
  });
} else {
  mountTaskPane();
}
