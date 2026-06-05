import { LAYER_META } from "./layerMeta";
import { useViewerStore } from "./viewerStore";

export function InspectorPanel() {
  const selected = useViewerStore((state) => state.selected);

  if (!selected) {
    return (
      <aside className="inspector-panel">
        <div className="panel-title">Inspector</div>
        <div className="empty-panel">Klik komponen di canvas untuk melihat properti.</div>
      </aside>
    );
  }

  const meta = LAYER_META[selected.visGroup] ?? LAYER_META.other;

  return (
    <aside className="inspector-panel">
      <div className="inspector-header">
        <span className="layer-swatch" style={{ background: meta.color }} />
        <div>
          <div className="panel-title">{selected.name}</div>
          <div className="panel-subtitle">{meta.label}</div>
        </div>
      </div>
      <dl className="inspector-list">
        <Row label="Type" value={selected.type} />
        <Row label="Layer" value={selected.layer || "-"} />
        <Row label="Vis Group" value={selected.visGroup} />
        <Row label="Area" value={selected.area != null ? `${selected.area.toFixed(3)} m2` : "-"} />
        <Row label="Volume" value={selected.volume != null ? `${selected.volume.toFixed(3)} m3` : "-"} />
        <Row label="ID" value={selected.id || "-"} />
      </dl>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
