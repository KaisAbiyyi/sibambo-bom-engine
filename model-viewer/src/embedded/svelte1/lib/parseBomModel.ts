import { BoxGeometry } from "three";
import type { BomEntity, BomModelJson } from "../types/bom";
import type { ComponentMeta, LayerKey, ModelMesh, ParsedModel } from "../types/model";
import { buildGeometryFromFace } from "./buildGeometryFromFace";
import { computeModelBounds } from "./computeModelBounds";
import { detectLayerGroup, detectLayerKeyFromName, resolveLayerKey } from "./detectLayerGroup";

type ParseAccumulator = {
  meshes: ModelMesh[];
  components: Record<string, ComponentMeta>;
  faceCount: number;
};

function entityName(entity: BomEntity): string {
  return entity.name || entity.definition_name || entity.type || "Unnamed entity";
}

function walkEntity(entity: BomEntity, parentLayer: LayerKey | null, acc: ParseAccumulator) {
  const name = entityName(entity);
  const detectedLayer = detectLayerKeyFromName(name) || parentLayer;

  if (entity.id) {
    acc.components[entity.id] = {
      id: entity.id,
      name,
      type: entity.type || "Entity",
      layerKey: detectedLayer || undefined,
      macroGroup: detectedLayer ? detectLayerGroup(detectedLayer) : undefined,
      faceCount: entity.face_count
    };
  }

  if (entity.type === "Face") {
    const layerKey = resolveLayerKey(entity.surface_type, parentLayer);
    const built = buildGeometryFromFace(entity);
    if (!built) return;

    const id = entity.id || `face-${acc.meshes.length}`;
    const macroGroup = detectLayerGroup(layerKey);
    acc.meshes.push({
      id,
      name: entity.material_front?.name || entity.surface_type || id,
      layerKey,
      macroGroup,
      geometry: built.geometry,
      position: built.position,
      areaM2: entity.area_m2 || 0,
      materialName: entity.material_front?.name
    });
    acc.faceCount += built.triangleCount;

    if (entity.id && acc.components[entity.id]) {
      acc.components[entity.id].layerKey = layerKey;
      acc.components[entity.id].macroGroup = macroGroup;
      acc.components[entity.id].areaM2 = entity.area_m2 || 0;
    }
  }

  if (entity.type === "BBox" && entity.center && entity.size) {
    const layerKey = resolveLayerKey(entity.category, detectedLayer);
    const macroGroup = detectLayerGroup(layerKey);
    const width = Math.max(entity.size.w || entity.size.x || 0.01, 0.01);
    const height = Math.max(entity.size.h || entity.size.z || 0.01, 0.01);
    const depth = Math.max(entity.size.d || entity.size.y || 0.01, 0.01);
    const geometry = new BoxGeometry(width, height, depth);
    geometry.computeBoundingBox();
    acc.meshes.push({
      id: entity.id || `bbox-${acc.meshes.length}`,
      name,
      layerKey,
      macroGroup,
      geometry,
      position: [entity.center.x, entity.center.z, -entity.center.y],
      areaM2: 0
    });
    acc.faceCount += 12;
  }

  entity.children?.forEach((child) => walkEntity(child, detectedLayer, acc));
}

export function parseBomModel(data: BomModelJson, sourceName = "BOM Engine JSON"): ParsedModel {
  if (!Array.isArray(data.entities)) {
    throw new Error("BOM JSON must contain an entities array.");
  }

  const acc: ParseAccumulator = {
    meshes: [],
    components: {},
    faceCount: 0
  };

  data.entities.forEach((entity) => walkEntity(entity, null, acc));

  if (!acc.meshes.length) {
    throw new Error("No renderable faces or bounding boxes were found in this JSON.");
  }

  return computeModelBounds({
    sourceName,
    meshes: acc.meshes,
    components: acc.components,
    faceCount: acc.faceCount
  });
}
