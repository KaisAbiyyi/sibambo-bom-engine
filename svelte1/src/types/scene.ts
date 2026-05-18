import type { LayerKey, MacroGroupKey, DisplayMode } from "./model";

export type SceneId =
  | "hero"
  | "exploded"
  | "roof"
  | "openings"
  | "wall"
  | "structure"
  | "floor"
  | "foundation"
  | "final";

export type SceneCameraPreset = {
  id: SceneId;
  theta: number;
  phi: number;
  radiusFactor: number;
  targetXBias: number;
  targetYBias: number;
  targetZBias?: number;
  modelScreenX: "left" | "center" | "right";
  modelScreenY: "top" | "center" | "bottom";
  safeTextZone: "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  zoomIntent: "wide" | "medium" | "close" | "detail";
};

export type SceneLayoutPreset = {
  id: SceneId;
  contentZone: "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  modelZone: "left" | "center" | "right" | "bottom-center";
  maxTextWidth: number;
  allowTextOverModel: boolean;
};

export type CameraBlendState = {
  fromId: SceneId;
  toId: SceneId;
  progress: number;
};

export type SceneData = {
  id: SceneId;
  title: string;
  subtitle?: string;
  description: string;
  category: string;
  macroGroup: MacroGroupKey | "all";
  displayMode: DisplayMode;
  componentIds: string[];
  activeLayerKeys: LayerKey[];
  contextLayerKeys: LayerKey[];
  specs?: Array<{ label: string; value: string }>;
  camera: SceneCameraPreset;
  layout: SceneLayoutPreset;
};
