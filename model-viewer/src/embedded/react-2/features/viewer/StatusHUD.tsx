import { useViewerStore } from "./viewerStore";

export function StatusHUD() {
  const stats = useViewerStore((state) => state.stats);
  const modelName = useViewerStore((state) => state.modelName);
  const selected = useViewerStore((state) => state.selected);
  const renderMode = useViewerStore((state) => state.renderMode);

  return (
    <>
      <div className="hud hud-top-left">
        <div className="hud-label">Model</div>
        <div className="hud-value">{modelName}</div>
      </div>
      <div className="hud hud-bottom-left">
        <span>Faces: {stats.faces.toLocaleString("id-ID")}</span>
        <span>Vertices: {stats.vertices.toLocaleString("id-ID")}</span>
        <span>Mode: {renderMode}</span>
      </div>
      <div className="hud hud-bottom-center">{selected ? `Selected: ${selected.name}` : "Klik mesh untuk inspect"}</div>
      <div className="axis-widget" aria-hidden="true">
        <span className="axis axis-x">X</span>
        <span className="axis axis-y">Y</span>
        <span className="axis axis-z">Z</span>
      </div>
    </>
  );
}
