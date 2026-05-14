import { useState } from "react";
import { AnatomyPage } from "./features/anatomy/AnatomyPage";
import { ViewerPage } from "./features/viewer/ViewerPage";

type AppMode = "viewer" | "anatomy";

export default function App() {
  const [mode, setMode] = useState<AppMode>("anatomy");

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">SB</div>
          <div>
            <div className="brand-title">Sibambo BOM Engine</div>
            <div className="brand-subtitle">UI Draft 01 - React frontend only</div>
          </div>
        </div>
        <nav className="mode-tabs" aria-label="Mode aplikasi">
          <button
            className={mode === "anatomy" ? "active" : ""}
            type="button"
            onClick={() => setMode("anatomy")}
          >
            Anatomy Story
          </button>
          <button
            className={mode === "viewer" ? "active" : ""}
            type="button"
            onClick={() => setMode("viewer")}
          >
            Model Viewer
          </button>
        </nav>
      </header>
      {mode === "viewer" ? <ViewerPage /> : <AnatomyPage />}
    </div>
  );
}
