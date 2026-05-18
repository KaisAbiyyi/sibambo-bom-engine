import type { SceneData, SceneId } from "../types/scene";

export const BASE_SCENE_CONFIG: Array<Omit<SceneData, "componentIds" | "activeLayerKeys" | "contextLayerKeys" | "specs">> = [
  {
    id: "hero",
    title: "The Building as a System",
    subtitle: "Anatomi Bangunan",
    description: "The model is introduced as one construction body: roof, envelope, frame, floors, and ground working together.",
    category: "System",
    macroGroup: "all",
    displayMode: "assembled",
    camera: {
      id: "hero",
      theta: 0.65,
      phi: 0.92,
      radiusFactor: 1.55,
      targetXBias: 0.12,
      targetYBias: 0.1,
      modelScreenX: "right",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "wide"
    },
    layout: { id: "hero", contentZone: "left", modelZone: "right", maxTextWidth: 620, allowTextOverModel: false }
  },
  {
    id: "exploded",
    title: "Exploded Anatomy",
    subtitle: "Layers separate",
    description: "Layer groups separate according to construction hierarchy while the real geometry remains linked to its BOM source layers.",
    category: "Separation",
    macroGroup: "all",
    displayMode: "exploded",
    camera: {
      id: "exploded",
      theta: 0.08,
      phi: 0.88,
      radiusFactor: 1.78,
      targetXBias: -0.03,
      targetYBias: 0.12,
      modelScreenX: "center",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "wide"
    },
    layout: { id: "exploded", contentZone: "top-left", modelZone: "center", maxTextWidth: 560, allowTextOverModel: false }
  },
  {
    id: "roof",
    title: "The Protective Plane",
    subtitle: "Roof system",
    description: "Roof layers are isolated as a sloped protective surface: ridge, roof sheets, listplank, and related roof slopes.",
    category: "Protection",
    macroGroup: "roof",
    displayMode: "focus",
    camera: {
      id: "roof",
      theta: 0.65,
      phi: 0.42,
      radiusFactor: 1.05,
      targetXBias: -0.18,
      targetYBias: 0.28,
      modelScreenX: "left",
      modelScreenY: "center",
      safeTextZone: "right",
      zoomIntent: "medium"
    },
    layout: { id: "roof", contentZone: "right", modelZone: "left", maxTextWidth: 470, allowTextOverModel: false }
  },
  {
    id: "openings",
    title: "Human Scale",
    subtitle: "Openings",
    description: "Door and window geometry becomes the scale reference for thresholds, sight lines, and inhabited edges.",
    category: "Occupancy",
    macroGroup: "openings",
    displayMode: "focus",
    camera: {
      id: "openings",
      theta: 0.18,
      phi: 0.92,
      radiusFactor: 0.72,
      targetXBias: 0.2,
      targetYBias: 0.02,
      modelScreenX: "right",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "detail"
    },
    layout: { id: "openings", contentZone: "left", modelZone: "right", maxTextWidth: 520, allowTextOverModel: false }
  },
  {
    id: "wall",
    title: "Wall Envelope",
    subtitle: "Boundary",
    description: "Wall planes are read as thick boundary systems rather than flat generic surfaces.",
    category: "Envelope",
    macroGroup: "walls",
    displayMode: "xray",
    camera: {
      id: "wall",
      theta: 0.05,
      phi: 0.88,
      radiusFactor: 1.08,
      targetXBias: -0.18,
      targetYBias: 0.03,
      modelScreenX: "left",
      modelScreenY: "center",
      safeTextZone: "right",
      zoomIntent: "medium"
    },
    layout: { id: "wall", contentZone: "right", modelZone: "left", maxTextWidth: 470, allowTextOverModel: false }
  },
  {
    id: "structure",
    title: "Load Path",
    subtitle: "Structural frame",
    description: "Columns and beams become the primary reading, with context layers reduced to tracing-paper references.",
    category: "Gravity",
    macroGroup: "structure",
    displayMode: "xray",
    camera: {
      id: "structure",
      theta: 0.82,
      phi: 0.7,
      radiusFactor: 1.05,
      targetXBias: 0.02,
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
    title: "Horizontal Strata",
    subtitle: "Floor layers",
    description: "Floor finish, slab, and base layers are read as horizontal strata tied directly to available model layers.",
    category: "Planes",
    macroGroup: "floor",
    displayMode: "xray",
    camera: {
      id: "floor",
      theta: 0.35,
      phi: 0.68,
      radiusFactor: 0.95,
      targetXBias: -0.16,
      targetYBias: -0.16,
      modelScreenX: "left",
      modelScreenY: "center",
      safeTextZone: "right",
      zoomIntent: "medium"
    },
    layout: { id: "floor", contentZone: "right", modelZone: "left", maxTextWidth: 520, allowTextOverModel: false }
  },
  {
    id: "foundation",
    title: "Below the Surface",
    subtitle: "Foundation descent",
    description: "Foundation and ground layers are emphasized while the camera descends toward the bearing system.",
    category: "Ground",
    macroGroup: "foundation",
    displayMode: "focus",
    camera: {
      id: "foundation",
      theta: 0.12,
      phi: 1.1,
      radiusFactor: 1.2,
      targetXBias: 0.14,
      targetYBias: -0.36,
      modelScreenX: "right",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "medium"
    },
    layout: { id: "foundation", contentZone: "left", modelZone: "right", maxTextWidth: 520, allowTextOverModel: false }
  },
  {
    id: "final",
    title: "Complete System",
    subtitle: "Final recomposition",
    description: "The building recomposes into an assembled construction organism, retaining the legibility discovered through each layer.",
    category: "Synthesis",
    macroGroup: "all",
    displayMode: "assembled",
    camera: {
      id: "final",
      theta: 0.58,
      phi: 0.86,
      radiusFactor: 1.35,
      targetXBias: 0.16,
      targetYBias: 0.08,
      modelScreenX: "right",
      modelScreenY: "center",
      safeTextZone: "left",
      zoomIntent: "wide"
    },
    layout: { id: "final", contentZone: "left", modelZone: "right", maxTextWidth: 560, allowTextOverModel: false }
  }
];

export const SCENE_ORDER = BASE_SCENE_CONFIG.map((scene) => scene.id) as SceneId[];
