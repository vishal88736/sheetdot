import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../functions/functions.js";
import "./index.css";
import { App } from "./App.js";

function enableSharedRuntimeStartupLoad() {
  try {
    const officeAddin = (
      Office as unknown as {
        addin?: { setStartupBehavior?: (behavior: unknown) => Promise<void> };
        StartupBehavior?: { load?: unknown };
      }
    )?.addin;
    const loadBehavior = (
      Office as unknown as { StartupBehavior?: { load?: unknown } }
    )?.StartupBehavior?.load;

    if (officeAddin?.setStartupBehavior && loadBehavior !== undefined) {
      void officeAddin.setStartupBehavior(loadBehavior);
    }
  } catch {
    // Host doesn't support SharedRuntime startup behavior
  }
}

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
    enableSharedRuntimeStartupLoad();
    mountTaskPane();
  });
} else {
  mountTaskPane();
}
