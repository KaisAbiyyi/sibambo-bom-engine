import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ATLAS_ORDER,
  ATLAS_STEP_BY_ID,
  ATLAS_STEPS,
  type AtlasStep
} from "./data/blueprintAtlasSteps";
import { BlueprintAtlasEngine } from "./three/BlueprintAtlasEngine";

function connectedLabels(step: AtlasStep) {
  if (step.id === "hasil_final") return "All major systems";
  return step.connected.map((id) => ATLAS_STEP_BY_ID[id]?.label ?? id).join(", ") || "Context system";
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<BlueprintAtlasEngine | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [exploded, setExploded] = useState(true);
  const [xray, setXray] = useState(true);
  const [status, setStatus] = useState("Loading JSON Model");

  const selectedId = ATLAS_ORDER[selectedIndex];
  const selected = ATLAS_STEP_BY_ID[selectedId] ?? ATLAS_STEP_BY_ID.atap_spandek;
  const finalSheet = selectedId === "hasil_final";
  const displayMode = finalSheet ? (exploded ? "Final Sheet / Exploded" : "Final Sheet / Recomposed") : exploded ? "Exploded Atlas" : "Recomposed";
  const connectedSet = useMemo(() => new Set(selected.connected), [selected]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new BlueprintAtlasEngine(canvasRef.current);
    engineRef.current = engine;
    let cancelled = false;

    fetch(`${import.meta.env.BASE_URL}Model_SBMBOOST_bom_visual_nonPretty-print.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        engine.loadModel(data);
        setStatus("JSON Export Model");
      })
      .catch((error: Error) => {
        if (!cancelled) setStatus(`Model gagal: ${error.message}`);
      });

    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.applyAtlas({ selectedId, exploded, xray, finalSheet });
  }, [selectedId, exploded, xray, finalSheet]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        selectIndex(selectedIndex + 1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectIndex(selectedIndex - 1);
      }
      if (event.key === " ") {
        event.preventDefault();
        setExploded((value) => !value);
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        selectIndex(ATLAS_ORDER.length - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIndex]);

  const selectIndex = (nextIndex: number) => {
    setSelectedIndex(Math.max(0, Math.min(ATLAS_ORDER.length - 1, nextIndex)));
  };

  const selectStep = (id: string) => {
    const index = ATLAS_ORDER.indexOf(id as (typeof ATLAS_ORDER)[number]);
    if (index >= 0) selectIndex(index);
  };

  const showFinal = () => {
    selectIndex(ATLAS_ORDER.length - 1);
  };

  return (
    <main className="atlas-sheet">
      <canvas ref={canvasRef} className="atlas-canvas" aria-label="Exploded axonometric 3D model" />

      <header className="sheet-header">
        <strong>SIBAMBO BOM ENGINE</strong>
        <span>SHEET A-05 / Exploded Structural Atlas</span>
        <div>
          <em>{status}</em>
          <em>Manual Three.js</em>
          <em>UI Draft 05</em>
        </div>
      </header>

      <svg className="leader-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {ATLAS_STEPS.map((step) => {
          if (step.id === "hasil_final" && !finalSheet) return null;
          const isActive = step.id === selectedId;
          const isConnected = connectedSet.has(step.id);
          return (
            <line
              key={step.id}
              className={isActive ? "active" : isConnected ? "connected" : ""}
              x1={step.leader.x1}
              y1={step.leader.y1}
              x2={step.leader.x2}
              y2={step.leader.y2}
            />
          );
        })}
      </svg>

      <section className="callout-field" aria-label="Numbered blueprint callouts">
        {ATLAS_STEPS.map((step) => {
          const isActive = step.id === selectedId;
          const isConnected = connectedSet.has(step.id);
          return (
            <button
              key={step.id}
              className={`atlas-callout ${isActive ? "active" : ""} ${isConnected ? "connected" : ""}`}
              style={
                {
                  "--x": `${step.callout.x}%`,
                  "--y": `${step.callout.y}%`,
                  "--step-color": step.color
                } as CSSProperties
              }
              type="button"
              onClick={() => selectStep(step.id)}
            >
              <span>{String(step.number).padStart(2, "0")}</span>
              <strong>{step.label}</strong>
            </button>
          );
        })}
      </section>

      <aside className="detail-note" aria-label="Detail note">
        <div className="note-pin" />
        <p>DETAIL {String(selected.number).padStart(2, "0")} / 15</p>
        <h1>{selected.label}</h1>
        <dl>
          <div>
            <dt>System</dt>
            <dd>{selected.system}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{selected.role}</dd>
          </div>
          <div>
            <dt>Connected</dt>
            <dd>{connectedLabels(selected)}</dd>
          </div>
          <div>
            <dt>Display</dt>
            <dd>{displayMode}</dd>
          </div>
        </dl>
        <p className="note-copy">{selected.description}</p>
      </aside>

      <section className="sheet-controls" aria-label="Sheet controls">
        <button type="button" onClick={() => selectIndex(selectedIndex - 1)} disabled={selectedIndex === 0}>
          Prev Detail
        </button>
        <button type="button" onClick={() => selectIndex(selectedIndex + 1)} disabled={selectedIndex === ATLAS_ORDER.length - 1}>
          Next Detail
        </button>
        <button type="button" onClick={() => setExploded((value) => !value)}>
          {exploded ? "Recompose" : "Explode Atlas"}
        </button>
        <button type="button" onClick={() => setXray((value) => !value)}>
          {xray ? "Hide X-Ray" : "X-Ray Context"}
        </button>
        <button type="button" onClick={showFinal}>
          Final Sheet
        </button>
      </section>

      <aside className="title-block" aria-label="Architectural title block">
        <div>
          <strong>SIBAMBO BOM ENGINE</strong>
          <span>PROJECT</span>
        </div>
        <div>
          <strong>SHEET A-05</strong>
          <span>SHEET</span>
        </div>
        <div>
          <strong>EXPLODED AXONOMETRIC ATLAS</strong>
          <span>VIEW</span>
        </div>
        <div>
          <strong>JSON EXPORT</strong>
          <span>MODEL</span>
        </div>
        <div>
          <strong>05</strong>
          <span>UI DRAFT</span>
        </div>
        <div>
          <strong>UNCHANGED</strong>
          <span>RUBY EXPORTER / JSON SCHEMA</span>
        </div>
      </aside>

      <div className="sheet-mode-readout">
        <span>{displayMode}</span>
        <strong>{String(selected.number).padStart(2, "0")} {selected.label}</strong>
      </div>
    </main>
  );
}
