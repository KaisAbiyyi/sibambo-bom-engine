export type BomVector = {
  x: number;
  y: number;
  z: number;
};

export type BomVertex = {
  position: BomVector;
};

export type BomMaterial = {
  name?: string;
  color?: {
    hex?: string;
  };
  reflectance?: number;
};

export type BomEntity = {
  id?: string;
  name?: string;
  definition_name?: string;
  type?: string;
  children?: BomEntity[];
  vertices?: BomVertex[];
  material_front?: BomMaterial | null;
  surface_type?: string;
  area_m2?: number;
  layer?: string;
  face_count?: number;
  category?: string;
  center?: BomVector;
  size?: {
    w?: number;
    h?: number;
    d?: number;
    x?: number;
    y?: number;
    z?: number;
  };
};

export type BomModelJson = {
  export_level?: string;
  entities?: BomEntity[];
  materials?: Record<string, BomMaterial>;
  metadata?: Record<string, unknown>;
};
