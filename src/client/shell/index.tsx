/**
 * React shell entry point — mounts the pre-game React app.
 *
 * This replaces the old Lit-based Main.ts as the shell entry point.
 * The in-game React root (SpaceScene/GameHUD) is mounted separately
 * by ClientGameRunner via scene/ReactRoot.tsx.
 */
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Import styles
import "../styles.css";
import "../styles/core/typography.css";
import "../styles/core/variables.css";
import "../styles/layout/container.css";
import "../styles/layout/header.css";
import "../styles/modal/chat.css";

// Note: GoogleAdElement, GutterAds, and GameStartingModal were Lit components
// that are no longer needed. The React HUD overlay handles GameStartingModal,
// and ad elements are managed separately if needed.

function bootstrap() {
  const container = document.getElementById("shell-root");
  if (!container) {
    console.error("[Shell] #shell-root not found in DOM");
    return;
  }

  const root = createRoot(container);
  root.render(<App />);

  // Remove preload class
  requestAnimationFrame(() => {
    document.documentElement.classList.remove("preload");
  });

  console.log("[Shell] React shell mounted");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
