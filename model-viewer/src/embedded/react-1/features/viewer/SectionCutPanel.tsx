import type { Axis } from "./types";
import { useViewerStore } from "./viewerStore";

interface SectionCutPanelProps {
  open: boolean;
  onToggle: (axis: Axis, enabled: boolean, value?: number) => void;
  onReset: () => void;
}

const axes: Array<{ id: Axis; label: string; color: string }> = [
  { id: "x", label: "X Axis", color: "#EF4444" },
  { id: "y", label: "Y Axis", color: "#2DD4BF" },
  { id: "z", label: "Z Axis", color: "#60A5FA" }
];

export function SectionCutPanel({ open, onToggle, onReset }: SectionCutPanelProps) {
  const cuts = useViewerStore((state) => state.cuts);
  if (!open) return null;

  return (
    <aside className="section-cut-panel">
      <div className="panel-title">Section Cut</div>
      {axes.map((axis) => (
        <div className="cut-control" key={axis.id}>
          <div className="cut-head">
            <label style={{ color: axis.color }}>{axis.label}</label>
            <span>{cuts[axis.id].label}</span>
          </div>
          <input
            max={1}
            min={-1}
            step={0.01}
            type="range"
            value={cuts[axis.id].value}
            onChange={(event) => onToggle(axis.id, cuts[axis.id].enabled, Number(event.target.value))}
          />
          <label className="switch-row">
            <input
              checked={cuts[axis.id].enabled}
              type="checkbox"
              onChange={(event) => onToggle(axis.id, event.target.checked, cuts[axis.id].value)}
            />
            Enabled
          </label>
        </div>
      ))}
      <button className="tool-button full" type="button" onClick={onReset}>
        Reset Cuts
      </button>
    </aside>
  );
}
