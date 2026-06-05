import { useViewerStore } from "../viewerStore";

interface LayerPanelProps {
  onLayerToggle: (key: string, visible: boolean) => void;
  onAllLayers: (visible: boolean) => void;
}

export function LayerPanel({ onLayerToggle, onAllLayers }: LayerPanelProps) {
  const layers = useViewerStore((state) => state.layers);
  let currentSection = "";

  if (!layers.length) return <div className="empty-panel">Load JSON untuk melihat layer model.</div>;

  return (
    <div className="panel-stack">
      <div className="panel-actions">
        <button type="button" onClick={() => onAllLayers(true)}>
          All
        </button>
        <button type="button" onClick={() => onAllLayers(false)}>
          None
        </button>
      </div>
      {layers.map((layer) => {
        const showSection = layer.section !== currentSection;
        currentSection = layer.section;
        return (
          <div key={layer.key}>
            {showSection ? <div className="section-heading">{layer.section}</div> : null}
            <label className="layer-row">
              <span className="layer-swatch" style={{ background: layer.color }} />
              <span className="layer-name">{layer.label}</span>
              <span className="layer-count">{layer.count}</span>
              <input
                checked={layer.visible}
                type="checkbox"
                onChange={(event) => onLayerToggle(layer.key, event.target.checked)}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}
