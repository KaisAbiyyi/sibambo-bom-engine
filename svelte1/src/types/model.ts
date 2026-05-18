import type { BufferGeometry, Box3, Vector3 } from "three";

export type LayerKey =
  | "perabung"
  | "atap_spandek"
  | "listplank"
  | "roof_slope"
  | "door"
  | "window"
  | "wall_x_pos"
  | "wall_x_neg"
  | "wall_y_pos"
  | "wall_y_neg"
  | "kolom"
  | "balok"
  | "structure"
  | "keramik_lantai"
  | "cor_lantai"
  | "floor"
  | "urugan"
  | "sloof"
  | "pondasi_batu"
  | "cerucuk"
  | "foundation"
  | "piri_piri"
  | "ceiling"
  | "furniture"
  | "notasi_2d"
  | "other";

export type MacroGroupKey =
  | "roof"
  | "openings"
  | "walls"
  | "structure"
  | "floor"
  | "foundation"
  | "other";

export type DisplayMode = "assembled" | "exploded" | "focus" | "xray";

export type ModelMesh = {
  id: string;
  name: string;
  layerKey: LayerKey;
  macroGroup: MacroGroupKey;
  geometry: BufferGeometry;
  position: [number, number, number];
  areaM2: number;
  materialName?: string;
};

export type ComponentMeta = {
  id: string;
  name: string;
  type: string;
  layerKey?: LayerKey;
  macroGroup?: MacroGroupKey;
  faceCount?: number;
  areaM2?: number;
};

export type LayerModel = {
  key: LayerKey;
  label: string;
  macroGroup: MacroGroupKey;
  color: string;
  meshes: ModelMesh[];
  meshCount: number;
  componentIds: string[];
  area: number;
  totalAreaM2: number;
  bounds: Box3;
  box: Box3;
  center: Vector3;
  size: Vector3;
};

export type MacroModel = {
  key: MacroGroupKey;
  id: MacroGroupKey;
  label: string;
  layerKeys: LayerKey[];
  meshCount: number;
  componentIds: string[];
  area: number;
  totalAreaM2: number;
  bounds: Box3;
  box: Box3;
  center: Vector3;
  size: Vector3;
  explodeOffset: Vector3;
};

export type LayerRegistry = Record<string, LayerModel>;
export type MacroGroupRegistry = Record<MacroGroupKey, MacroModel>;

export type ParsedModel = {
  sourceName: string;
  meshCount: number;
  faceCount: number;
  componentCount: number;
  layerRegistry: LayerRegistry;
  macroGroups: MacroGroupRegistry;
  layers: LayerRegistry;
  macros: MacroGroupRegistry;
  components: Record<string, ComponentMeta>;
  bounds: {
    box: Box3;
    center: Vector3;
    size: Vector3;
    footprint: number;
    fitRadius: number;
  };
};
