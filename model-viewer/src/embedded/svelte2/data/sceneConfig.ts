import type { SceneData, SceneId } from "../types/scene";

export const BASE_SCENE_CONFIG: Array<Omit<SceneData, "componentIds" | "activeLayerKeys" | "contextLayerKeys" | "specs">> = [
  {
    id: "hero",
    title: "White mass render",
    subtitle: "Studio overview",
    description: "Full BOM geometry rendered as one white architectural mass. Hard UI frames the model like a pinned presentation board.",
    category: "Mass",
    macroGroup: "all",
    displayMode: "assembled",
    camera: {
      id: "hero",
      theta: 0.72,
      phi: 0.82,
      radiusFactor: 1.28,
      targetXBias: 0,
      targetYBias: 0.08,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "wide"
    },
    layout: { id: "hero", contentZone: "left", modelZone: "center", maxTextWidth: 620, allowTextOverModel: false }
  },
  {
    id: "exploded",
    title: "Exploded board",
    subtitle: "Layer stack",
    description: "Construction systems pull apart into readable slabs, frames, envelope, roof, and ground without losing BOM linkage.",
    category: "Stack",
    macroGroup: "all",
    displayMode: "exploded",
    camera: {
      id: "exploded",
      theta: 0.42,
      phi: 0.72,
      radiusFactor: 1.42,
      targetXBias: 0,
      targetYBias: 0.08,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "wide"
    },
    layout: { id: "exploded", contentZone: "top-left", modelZone: "center", maxTextWidth: 560, allowTextOverModel: false }
  },
  {
    id: "roof",
    title: "Roof clay cut",
    subtitle: "Top shell",
    description: "Roof members isolate as a clean white cap. Edges stay black for technical legibility.",
    category: "Roof",
    macroGroup: "roof",
    displayMode: "focus",
    camera: {
      id: "roof",
      theta: 0.58,
      phi: 0.48,
      radiusFactor: 0.92,
      targetXBias: 0,
      targetYBias: 0.22,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "right",
      zoomIntent: "medium"
    },
    layout: { id: "roof", contentZone: "right", modelZone: "center", maxTextWidth: 470, allowTextOverModel: false }
  },
  {
    id: "openings",
    title: "Opening markers",
    subtitle: "Human scale",
    description: "Doors and windows become black-edged scale marks inside the white mass render.",
    category: "Openings",
    macroGroup: "openings",
    displayMode: "focus",
    camera: {
      id: "openings",
      theta: 0.2,
      phi: 0.96,
      radiusFactor: 0.84,
      targetXBias: 0,
      targetYBias: 0.02,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "detail"
    },
    layout: { id: "openings", contentZone: "left", modelZone: "center", maxTextWidth: 520, allowTextOverModel: false }
  },
  {
    id: "wall",
    title: "Wall envelope",
    subtitle: "Boundary cut",
    description: "Wall planes read as thick clay boundary objects with context muted behind them.",
    category: "Envelope",
    macroGroup: "walls",
    displayMode: "xray",
    camera: {
      id: "wall",
      theta: 0.16,
      phi: 0.86,
      radiusFactor: 1.02,
      targetXBias: 0,
      targetYBias: 0.03,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "right",
      zoomIntent: "medium"
    },
    layout: { id: "wall", contentZone: "right", modelZone: "center", maxTextWidth: 470, allowTextOverModel: false }
  },
  {
    id: "structure",
    title: "Frame isolate",
    subtitle: "Load path",
    description: "Column and beam systems become a white skeletal insert, separated from muted context.",
    category: "Structure",
    macroGroup: "structure",
    displayMode: "xray",
    camera: {
      id: "structure",
      theta: 0.78,
      phi: 0.72,
      radiusFactor: 0.98,
      targetXBias: 0,
      targetYBias: 0.1,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "medium"
    },
    layout: { id: "structure", contentZone: "left", modelZone: "center", maxTextWidth: 500, allowTextOverModel: false }
  },
  {
    id: "floor",
    title: "Floor strata",
    subtitle: "Horizontal cut",
    description: "Floor systems flatten into a stacked clay reading with layer toggles kept at board level.",
    category: "Floor",
    macroGroup: "floor",
    displayMode: "xray",
    camera: {
      id: "floor",
      theta: 0.36,
      phi: 0.62,
      radiusFactor: 0.92,
      targetXBias: 0,
      targetYBias: -0.16,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "right",
      zoomIntent: "medium"
    },
    layout: { id: "floor", contentZone: "right", modelZone: "center", maxTextWidth: 520, allowTextOverModel: false }
  },
  {
    id: "foundation",
    title: "Ground system",
    subtitle: "Foundation cut",
    description: "Bearing layers and ground system sit as the base of the clay model, not as decorative soil graphics.",
    category: "Ground",
    macroGroup: "foundation",
    displayMode: "focus",
    camera: {
      id: "foundation",
      theta: 0.32,
      phi: 1.02,
      radiusFactor: 1.02,
      targetXBias: 0,
      targetYBias: -0.36,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "medium"
    },
    layout: { id: "foundation", contentZone: "left", modelZone: "center", maxTextWidth: 520, allowTextOverModel: false }
  },
  {
    id: "final",
    title: "Final board",
    subtitle: "Recomposed",
    description: "All systems return into one professional white building render for final comparison.",
    category: "Complete",
    macroGroup: "all",
    displayMode: "assembled",
    camera: {
      id: "final",
      theta: 0.66,
      phi: 0.84,
      radiusFactor: 1.2,
      targetXBias: 0,
      targetYBias: 0.08,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "wide"
    },
    layout: { id: "final", contentZone: "left", modelZone: "center", maxTextWidth: 560, allowTextOverModel: false }
  }
];

export const SCENE_ORDER = BASE_SCENE_CONFIG.map((scene) => scene.id) as SceneId[];
