import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  INSPECTION_ORDER,
  INSPECTION_STEP_BY_ID,
  INSPECTION_STEPS,
  type InspectionStep
} from "./data/inspectionSteps";
import { DigitalTwinEngine } from "./three/DigitalTwinEngine";

const PLAY_INTERVAL_MS = 1050;
const STACK_SYSTEMS = [
  "Roof",
  "Ceiling",
  "Wall/Openings",
  "Structure",
  "Floor",
  "Ground",
  "Foundation",
  "Piles"
];

function stackBand(step: InspectionStep) {
  if (step.id === "cerucuk") return "Piles";
  if (step.id === "pondasi_batu" || step.id === "sloof") return "Foundation";
  if (step.id === "urugan") return "Ground";
  if (step.id === "keramik_lantai" || step.id === "cor_lantai") return "Floor";
  if (step.id === "balok_ring" || step.id === "kolom") return "Structure";
  if (step.id === "dinding_bata" || step.id === "pintu" || step.id === "jendela") return "Wall/Openings";
  if (step.id === "plafon") return "Ceiling";
  return "Roof";
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<DigitalTwinEngine | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState("Loading JSON model");

  const selectedId = INSPECTION_ORDER[selectedIndex];
  const selected = INSPECTION_STEP_BY_ID[selectedId] ?? INSPECTION_STEP_BY_ID.atap_spandek;
  const progress = Math.round(((selectedIndex + 1) / INSPECTION_ORDER.length) * 100);
  const connectedLabels = useMemo(
    () => selected.connected.map((id) => INSPECTION_STEP_BY_ID[id]?.shortLabel ?? id).join(", ") || "Rumah lengkap",
    [selected]
  );

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
        setStatus("JSON Model");
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
    engineRef.current?.applyInspection({ selectedId });
  }, [selectedId]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setSelectedIndex((current) => {
        if (current >= INSPECTION_ORDER.length - 1) {
          window.clearInterval(timer);
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

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
        setIsPlaying((value) => !value);
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        selectIndex(INSPECTION_ORDER.length - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIndex]);

  const selectIndex = (nextIndex: number) => {
    setIsPlaying(false);
    setSelectedIndex(Math.max(0, Math.min(INSPECTION_ORDER.length - 1, nextIndex)));
  };

  const selectStep = (id: string) => {
    const nextIndex = INSPECTION_ORDER.indexOf(id as (typeof INSPECTION_ORDER)[number]);
    if (nextIndex >= 0) selectIndex(nextIndex);
  };

  const focusCurrent = () => {
    engineRef.current?.applyInspection({ selectedId });
  };

  return (
    <main className="inspection-board">
      <canvas ref={canvasRef} className="inspection-canvas" aria-label="3D structural inspection model" />

      <header className="project-strip" aria-label="Project status">
        <div>
          <strong>SIBAMBO / UI Draft 04</strong>
          <span>Top-Down Structural Inspection</span>
        </div>
        <div className="project-chips">
          <span>{status}</span>
          <span>Manual Three.js</span>
          <span>Exporter untouched</span>
        </div>
      </header>

      <section className="layer-tags" aria-label="Floating layer tags">
        <div className="tags-heading">
          <span>Layer Tags</span>
          <strong>{String(selected.order).padStart(2, "0")} / 15</strong>
        </div>
        <div className="tag-grid">
          {INSPECTION_STEPS.map((step) => {
            const state = step.order < selected.order ? "inspected" : step.order === selected.order ? "active" : "pending";
            return (
              <button
                key={step.id}
                className={`layer-tag ${state}`}
                style={{ "--tag-color": step.color } as CSSProperties}
                type="button"
                onClick={() => selectStep(step.id)}
              >
                <span>{String(step.order).padStart(2, "0")}</span>
                <strong>{step.shortLabel}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="inspection-dossier" aria-label="Inspection dossier">
        <div className="dossier-code">
          <span>{String(selected.order).padStart(2, "0")} / 15</span>
          <em>{stackBand(selected)}</em>
        </div>
        <h1>{selected.label}</h1>
        <div className="dossier-meta">
          <div>
            <span>System</span>
            <strong>{selected.system}</strong>
          </div>
          <div>
            <span>Role</span>
            <strong>{selected.role}</strong>
          </div>
          <div>
            <span>Konteks</span>
            <strong>{connectedLabels}</strong>
          </div>
        </div>
        <section>
          <h2>Objective</h2>
          <p>{selected.objective}</p>
        </section>
        <section>
          <h2>Field note</h2>
          <p>{selected.fieldNote}</p>
        </section>
        <section>
          <h2>Checklist</h2>
          <ul>
            {selected.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <div className="checkpoint">
          <span>Checkpoint</span>
          <strong>{selected.risk}</strong>
        </div>
      </aside>

      <section className="sequence-dial" aria-label="Sequence controller">
        <div className="dial-ring" style={{ "--progress": `${progress}%` } as CSSProperties}>
          <strong>{String(selected.order).padStart(2, "0")}</strong>
          <span>of 15</span>
        </div>
        <div className="dial-actions">
          <button type="button" onClick={() => selectIndex(selectedIndex - 1)} disabled={selectedIndex === 0}>
            Prev
          </button>
          <button type="button" onClick={() => setIsPlaying((value) => !value)}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => selectIndex(selectedIndex + 1)} disabled={selectedIndex === INSPECTION_ORDER.length - 1}>
            Next
          </button>
        </div>
        <div className="dial-secondary">
          <button type="button" onClick={focusCurrent}>
            Focus current layer
          </button>
          <button type="button" onClick={() => selectIndex(INSPECTION_ORDER.length - 1)}>
            Show final
          </button>
        </div>
      </section>

      <aside className="stack-map" aria-label="Mini stack map">
        {STACK_SYSTEMS.map((band) => (
          <div key={band} className={stackBand(selected) === band ? "active" : ""}>
            <span />
            {band}
          </div>
        ))}
      </aside>

      <div className="active-callout" style={{ "--callout-color": selected.color } as CSSProperties}>
        <span>{selected.system}</span>
        <strong>{selected.label}</strong>
      </div>
    </main>
  );
}
