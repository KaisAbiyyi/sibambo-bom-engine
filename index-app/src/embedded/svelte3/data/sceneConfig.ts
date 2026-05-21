import type { SceneData, SceneId } from "../types/scene";

export const BASE_SCENE_CONFIG: Array<Omit<SceneData, "componentIds" | "activeLayerKeys" | "contextLayerKeys" | "specs">> = [
  {
    id: "hero",
    title: "Fullscreen 3D reveal",
    subtitle: "Hero reveal",
    description: "The model appears as a clean SketchUp clay render with soft outline and cinematic 3/4 camera.",
    category: "Reveal",
    macroGroup: "all",
    displayMode: "assembled",
    camera: {
      id: "hero",
      theta: 0.72,
      phi: 0.82,
      radiusFactor: 1.5,
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
    title: "Massing breakdown",
    subtitle: "Concept orbit",
    description: "Building systems separate into layered masses while the camera orbits through the diagram.",
    category: "Concept",
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
    title: "Site context mode",
    subtitle: "Top / isometric",
    description: "The camera lifts toward site logic, using the roof mass as anchor while the interface draws context overlays.",
    category: "Site",
    macroGroup: "roof",
    displayMode: "focus",
    camera: {
      id: "roof",
      theta: 0.58,
      phi: 0.5,
      radiusFactor: 1.12,
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
    title: "Interior cutaway",
    subtitle: "Spatial slice",
    description: "Openings and thresholds become the first read before the model moves into a slice-like spatial explanation.",
    category: "Interior",
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
    title: "Guided path camera",
    subtitle: "Walkthrough route",
    description: "Wall boundaries frame a curated path view: the presentation guides the visitor instead of giving random orbit first.",
    category: "Walkthrough",
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
    title: "Feature focus",
    subtitle: "Hotspot detail",
    description: "Structure becomes the detail focus layer: click-hold style hotspots can zoom attention without losing the whole building.",
    category: "Hotspot",
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
    title: "Day / night atmosphere",
    subtitle: "Mood shift",
    description: "The same floor and mass geometry carries two atmospheres: bright architectural day and quiet night silhouette.",
    category: "Atmosphere",
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
    title: "Technical drawing mode",
    subtitle: "Plan / section",
    description: "Foundation and ground view become the technical mode, with orthographic-feeling composition and drawing overlays.",
    category: "Technical",
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
    title: "Free explore mode",
    subtitle: "Full control",
    description: "Only after the cinematic story, the model recomposes and gives users orbit plus layer controls.",
    category: "Explore",
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
