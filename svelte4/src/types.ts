import type { MacroKey } from "./data/layers";

export type BomVector = { x: number; y: number; z: number };
export type BomVertex = { position: BomVector };

export type BomEntity = {
  id?: string;
  name?: string;
  definition_name?: string;
  type?: string;
  children?: BomEntity[];
  vertices?: BomVertex[];
  material_front?: { name?: string; color?: { hex?: string } } | null;
  surface_type?: string;
  area_m2?: number;
  layer?: string;
  face_count?: number;
  category?: string;
  center?: BomVector;
  size?: { w?: number; h?: number; d?: number; x?: number; y?: number; z?: number };
};

export type BomModelJson = {
  schema_version?: string;
  export_level?: string;
  exported_at?: string;
  entities?: BomEntity[];
  materials?: Record<string, unknown>;
};

export type Bounds = {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
  fitRadius: number;
};

export type LayerStat = {
  key: string;
  label: string;
  macro: MacroKey;
  color: string;
  positions: Float32Array;
  triangleCount: number;
  meshCount: number;
  areaM2: number;
  dominantMaterial: string | null;
  dominantComponent: string | null;
};

export type MacroStat = {
  key: MacroKey;
  label: string;
  color: string;
  layerCount: number;
  triangleCount: number;
  meshCount: number;
  areaM2: number;
};

export type DocumentStats = {
  schemaVersion: string;
  exportLevel: string;
  exportedAt: string;
  exportedAtPretty: string;
  topLevelEntityCount: number;
  entityCount: number;
  groupCount: number;
  faceCount: number;
  componentInstanceCount: number;
  maxDepth: number;
  totalAreaM2: number;
  topLevelHistogram: Record<string, number>;
};

export type ParsedModel = {
  sourceName: string;
  bounds: Bounds;
  layers: LayerStat[];
  macros: MacroStat[];
  document: DocumentStats;
};
