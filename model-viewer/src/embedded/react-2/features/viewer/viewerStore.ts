import { create } from "zustand";
import type {
  Axis,
  CutState,
  LayerInfo,
  PanelTab,
  RenderMode,
  SelectionInfo,
  TooltipInfo,
  TreeNode,
  ViewerStats
} from "./types";

interface ViewerState {
  activeTab: PanelTab;
  renderMode: RenderMode;
  layers: LayerInfo[];
  tree: TreeNode[];
  materials: Array<{ name: string; color: string; reflectance?: number | string }>;
  stats: ViewerStats;
  selected: SelectionInfo | null;
  tooltip: TooltipInfo | null;
  loading: boolean;
  loadError: string | null;
  modelName: string;
  cuts: Record<Axis, CutState>;
  setActiveTab: (tab: PanelTab) => void;
  setRenderMode: (mode: RenderMode) => void;
  setLayers: (layers: LayerInfo[]) => void;
  setTree: (tree: TreeNode[]) => void;
  setMaterials: (materials: ViewerState["materials"]) => void;
  setStats: (stats: ViewerStats) => void;
  setSelected: (selected: SelectionInfo | null) => void;
  setTooltip: (tooltip: TooltipInfo | null) => void;
  setLoading: (loading: boolean) => void;
  setLoadError: (error: string | null) => void;
  setModelName: (name: string) => void;
  setCut: (axis: Axis, cut: CutState) => void;
}

const defaultCuts: Record<Axis, CutState> = {
  x: { enabled: false, value: 1, label: "off" },
  y: { enabled: false, value: 1, label: "off" },
  z: { enabled: false, value: 1, label: "off" }
};

export const useViewerStore = create<ViewerState>((set) => ({
  activeTab: "layers",
  renderMode: "shaded",
  layers: [],
  tree: [],
  materials: [],
  stats: { faces: 0, vertices: 0, meshes: 0, area: 0, volume: 0 },
  selected: null,
  tooltip: null,
  loading: false,
  loadError: null,
  modelName: "No model loaded",
  cuts: defaultCuts,
  setActiveTab: (activeTab) => set({ activeTab }),
  setRenderMode: (renderMode) => set({ renderMode }),
  setLayers: (layers) => set({ layers }),
  setTree: (tree) => set({ tree }),
  setMaterials: (materials) => set({ materials }),
  setStats: (stats) => set({ stats }),
  setSelected: (selected) => set({ selected }),
  setTooltip: (tooltip) => set({ tooltip }),
  setLoading: (loading) => set({ loading }),
  setLoadError: (loadError) => set({ loadError }),
  setModelName: (modelName) => set({ modelName }),
  setCut: (axis, cut) => set((state) => ({ cuts: { ...state.cuts, [axis]: cut } }))
}));
