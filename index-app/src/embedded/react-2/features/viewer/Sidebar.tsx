import { LayerPanel } from "./panels/LayerPanel";
import { MaterialPanel } from "./panels/MaterialPanel";
import { TreePanel } from "./panels/TreePanel";
import type { PanelTab } from "./types";
import { useViewerStore } from "./viewerStore";

interface SidebarProps {
  onLayerToggle: (key: string, visible: boolean) => void;
  onAllLayers: (visible: boolean) => void;
  onFocusNode: (id: string) => void;
}

const tabs: Array<{ id: PanelTab; label: string }> = [
  { id: "layers", label: "Layers" },
  { id: "tree", label: "Tree" },
  { id: "materials", label: "Materials" }
];

export function Sidebar({ onLayerToggle, onAllLayers, onFocusNode }: SidebarProps) {
  const activeTab = useViewerStore((state) => state.activeTab);
  const setActiveTab = useViewerStore((state) => state.setActiveTab);
  const stats = useViewerStore((state) => state.stats);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">Model Data</div>
        <div className="sidebar-subtitle">Layer, hierarchy, material</div>
      </div>
      <div className="sidebar-tabs">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {activeTab === "layers" ? <LayerPanel onLayerToggle={onLayerToggle} onAllLayers={onAllLayers} /> : null}
        {activeTab === "tree" ? <TreePanel onFocusNode={onFocusNode} /> : null}
        {activeTab === "materials" ? <MaterialPanel /> : null}
      </div>
      <div className="stats-grid">
        <Stat label="Faces" value={stats.faces.toLocaleString("id-ID")} />
        <Stat label="Vertices" value={stats.vertices.toLocaleString("id-ID")} />
        <Stat label="Area m2" value={stats.area.toFixed(1)} />
        <Stat label="Meshes" value={stats.meshes.toLocaleString("id-ID")} />
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
