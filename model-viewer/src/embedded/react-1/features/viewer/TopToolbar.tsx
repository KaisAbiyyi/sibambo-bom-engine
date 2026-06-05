import type { CameraMode, RenderMode } from "./types";
import { useViewerStore } from "./viewerStore";

interface TopToolbarProps {
  onMode: (mode: RenderMode) => void;
  onCamera: (mode: CameraMode) => void;
  onResetCamera: () => void;
  onLoadClick: () => void;
  onToggleSection: () => void;
}

const renderModes: Array<{ id: RenderMode; label: string }> = [
  { id: "shaded", label: "Shaded" },
  { id: "wireframe", label: "Wire" },
  { id: "xray", label: "X-Ray" },
  { id: "surface", label: "Surface" }
];

const cameraModes: Array<{ id: CameraMode; label: string }> = [
  { id: "persp", label: "Persp" },
  { id: "top", label: "Top" },
  { id: "front", label: "Front" },
  { id: "side", label: "Side" }
];

export function TopToolbar({ onMode, onCamera, onResetCamera, onLoadClick, onToggleSection }: TopToolbarProps) {
  const renderMode = useViewerStore((state) => state.renderMode);
  const setRenderMode = useViewerStore((state) => state.setRenderMode);

  return (
    <div className="top-toolbar">
      <div className="toolbar-group">
        <span className="toolbar-label">View</span>
        <div className="segmented">
          {renderModes.map((mode) => (
            <button
              className={renderMode === mode.id ? "active" : ""}
              key={mode.id}
              type="button"
              onClick={() => {
                setRenderMode(mode.id);
                onMode(mode.id);
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar-group">
        <span className="toolbar-label">Camera</span>
        <div className="segmented">
          {cameraModes.map((mode) => (
            <button key={mode.id} type="button" onClick={() => onCamera(mode.id)}>
              {mode.label}
            </button>
          ))}
          <button type="button" onClick={onResetCamera}>
            Reset
          </button>
        </div>
      </div>
      <div className="toolbar-spacer" />
      <button className="tool-button" type="button" onClick={onLoadClick}>
        Load JSON
      </button>
      <button className="tool-button" type="button" onClick={onToggleSection}>
        Section Cut
      </button>
    </div>
  );
}
