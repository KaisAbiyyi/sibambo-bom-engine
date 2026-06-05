import { LAYER_META } from "./layerMeta";
import { useViewerStore } from "./viewerStore";

export function TooltipOverlay() {
  const tooltip = useViewerStore((state) => state.tooltip);
  if (!tooltip) return null;
  const meta = LAYER_META[tooltip.visGroup] ?? LAYER_META.other;

  return (
    <div className="tooltip-overlay" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
      <div className="tooltip-type">{meta.label}</div>
      <div className="tooltip-name">{tooltip.name}</div>
      <div className="tooltip-extra">{tooltip.area != null ? `${tooltip.area.toFixed(2)} m2` : tooltip.type}</div>
    </div>
  );
}
