export type RenderMode = "shaded" | "wireframe" | "xray" | "surface";
export type CameraMode = "persp" | "top" | "front" | "side";
export type PanelTab = "layers" | "tree" | "materials";
export type Axis = "x" | "y" | "z";

export interface BomPosition {
  x: number;
  y: number;
  z: number;
}

export interface BomVertex {
  position: BomPosition;
}

export interface BomMaterialColor {
  hex?: string;
}

export interface BomMaterial {
  name?: string;
  color?: BomMaterialColor;
  reflectance?: number;
}

export interface BomFace {
  id?: string;
  type: "Face";
  name?: string;
  layer?: string;
  surface_type?: string;
  area_m2?: number;
  volume_m3?: number;
  material_front?: {
    name?: string;
    color?: BomMaterialColor;
  };
  vertices: BomVertex[];
}

export interface BomEntity {
  id?: string;
  type: string;
  name?: string;
  definition_name?: string;
  face_count?: number;
  category?: string;
  center?: BomPosition;
  size?: BomPosition;
  children?: Array<BomEntity | BomFace>;
}

export interface BomModel {
  schema_version?: string;
  export_level?: string;
  exported_at?: string;
  model_name?: string;
  entities?: Array<BomEntity | BomFace>;
  materials?: Record<string, BomMaterial> | BomMaterial[];
}

export interface LayerInfo {
  key: string;
  label: string;
  color: string;
  order: number;
  visible: boolean;
  count: number;
  section: string;
}

export interface TreeNode {
  id: string;
  name: string;
  type: string;
  faceCount?: number;
  children: TreeNode[];
}

export interface ViewerStats {
  faces: number;
  vertices: number;
  meshes: number;
  area: number;
  volume: number;
}

export interface SelectionInfo {
  id?: string;
  name: string;
  type: string;
  visGroup: string;
  layer?: string;
  area?: number;
  volume?: number;
}

export interface TooltipInfo extends SelectionInfo {
  x: number;
  y: number;
}

export interface CutState {
  enabled: boolean;
  value: number;
  label: string;
}
