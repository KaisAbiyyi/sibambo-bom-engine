import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMPONENTS,
  COMPONENT_BY_ID,
  MODE_LABELS,
  TIMELINE_IDS,
  componentForScanDepth,
  type AnalysisMode
} from "./data/componentRegistry";
import { DigitalTwinEngine } from "./three/DigitalTwinEngine";

const MODES = Object.keys(MODE_LABELS) as AnalysisMode[];
const SCAN_BANDS = [
  { label: "Roof", depth: 8 },
  { label: "Ceiling", depth: 20 },
  { label: "Envelope", depth: 34 },
  { label: "Frame", depth: 50 },
  { label: "Floor", depth: 62 },
  { label: "Substructure", depth: 75 },
  { label: "Foundation", depth: 88 },
  { label: "Cerucuk", depth: 96 }
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<DigitalTwinEngine | null>(null);
  const [mode, setMode] = useState<AnalysisMode>("overview");
  const [selectedId, setSelectedId] = useState("hasil_final");
  const [scanDepth, setScanDepth] = useState(50);
  const [status, setStatus] = useState("Loading JSON model");

  const displaySelectedId = mode === "section-scan" ? componentForScanDepth(scanDepth) : selectedId;
  const selected = COMPONENT_BY_ID[displaySelectedId] ?? COMPONENT_BY_ID.hasil_final;

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new DigitalTwinEngine(canvasRef.current);
    engineRef.current = engine;
    let cancelled = false;

    fetch("/Model_SBMBOOST_bom_visual_nonPretty-print.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        engine.loadModel(data);
        setStatus("JSON Model Loaded");
      })
      .catch((error: Error) => {
        if (!cancelled) setStatus(`Model load failed: ${error.message}`);
      });

    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.applyView({ mode, selectedId: displaySelectedId, scanDepth });
  }, [mode, displaySelectedId, scanDepth]);

  useEffect(() => {
    if (mode === "section-scan") setSelectedId(componentForScanDepth(scanDepth));
  }, [mode, scanDepth]);

  const connectedLabels = useMemo(
    () => selected.connected.map((id) => COMPONENT_BY_ID[id]?.shortLabel ?? id).join(", ") || "Full system",
    [selected]
  );

  const selectComponent = (id: string) => {
    setSelectedId(id);
    if (mode === "overview" || mode === "material-map") setMode("component-focus");
  };

  const setScanBand = (depth: number) => {
    setScanDepth(depth);
    setSelectedId(componentForScanDepth(depth));
  };

  const changeMode = (item: AnalysisMode) => {
    setMode(item);
    if (item === "overview") setSelectedId("hasil_final");
    if (item === "load-path" && !["atap_spandek", "perabung", "balok_ring", "kolom", "sloof", "pondasi_batu", "cerucuk", "urugan"].includes(selectedId)) {
      setSelectedId("kolom");
    }
    if (item === "section-scan") setSelectedId(componentForScanDepth(scanDepth));
  };

  return (
    <main className="twin-shell">
      <header className="top-status">
        <div>
          <strong>SIBAMBO DIGITAL TWIN</strong>
          <span>UI Draft 03 / Structural Assembly Lab</span>
        </div>
        <div className="status-pills" aria-label="Model status">
          <span>{status}</span>
          <span>Manual Three.js</span>
          <span>No exporter changes</span>
        </div>
      </header>

      <section className="lab-grid">
        <aside className="mode-panel">
          <div className="panel-kicker">Analysis Mode</div>
          <div className="mode-list">
            {MODES.map((item) => (
              <button
                key={item}
                className={mode === item ? "active" : ""}
                type="button"
                onClick={() => changeMode(item)}
              >
                <span>{MODE_LABELS[item]}</span>
              </button>
            ))}
          </div>

          {mode === "section-scan" && (
            <div className="scan-control">
              <label htmlFor="scan-depth">Scanner depth</label>
              <input
                id="scan-depth"
                max="100"
                min="0"
                onInput={(event) => setScanDepth(Number(event.currentTarget.value))}
                type="range"
                value={scanDepth}
                onChange={(event) => setScanDepth(Number(event.target.value))}
              />
              <div className="scan-readout">
                <span>Roof</span>
                <strong>{scanDepth}%</strong>
                <span>Pile</span>
              </div>
              <div className="scan-bands" aria-label="Scanner bands">
                {SCAN_BANDS.map((band) => (
                  <button
                    key={band.label}
                    className={componentForScanDepth(scanDepth) === componentForScanDepth(band.depth) ? "active" : ""}
                    type="button"
                    onClick={() => setScanBand(band.depth)}
                    onMouseDown={() => setScanBand(band.depth)}
                    onPointerDown={() => setScanBand(band.depth)}
                  >
                    {band.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="stage-panel">
          <canvas ref={canvasRef} className="twin-canvas" aria-label="3D digital twin model" />
          <div className="stage-readout">
            <span>{MODE_LABELS[mode]}</span>
              <strong>{selected.label}</strong>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="panel-kicker">Component Inspector</div>
          <h1>{selected.label}</h1>
          <dl className="inspector-list">
            <div>
              <dt>System</dt>
              <dd>{selected.system}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{selected.role}</dd>
            </div>
            <div>
              <dt>Material / category</dt>
              <dd>{selected.material}</dd>
            </div>
            <div>
              <dt>Connected to</dt>
              <dd>{connectedLabels}</dd>
            </div>
            <div>
              <dt>Visibility state</dt>
              <dd>{mode === "assembly" ? "Assembly step" : MODE_LABELS[mode]}</dd>
            </div>
          </dl>
          <p>{selected.description}</p>

          {mode === "material-map" && (
            <div className="material-legend">
              {COMPONENTS.filter((item) => item.id !== "hasil_final").map((item) => (
                <button
                  key={item.id}
                  className={displaySelectedId === item.id ? "active" : ""}
                  type="button"
                  onClick={() => selectComponent(item.id)}
                >
                  <span style={{ background: item.color }} />
                  {item.shortLabel}
                </button>
              ))}
            </div>
          )}
        </aside>
      </section>

      <footer className="assembly-timeline" aria-label="Assembly timeline">
        <div className="timeline-title">
          <strong>Top-Down Exploration</strong>
          <span>{mode === "assembly" ? "active assembly slice" : "roof to pile sequence"}</span>
        </div>
        <div className="timeline-scroll">
          {TIMELINE_IDS.map((id, index) => {
            const component = COMPONENT_BY_ID[id];
            return (
              <button
                key={id}
                className={displaySelectedId === id ? "active" : ""}
                type="button"
                onClick={() => {
                  setSelectedId(id);
                  if (mode === "overview" || mode === "material-map") setMode("assembly");
                }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {component.label}
              </button>
            );
          })}
        </div>
      </footer>
    </main>
  );
}
