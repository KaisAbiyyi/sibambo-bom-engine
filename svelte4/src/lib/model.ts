import { MACRO_COLORS, MACRO_LABELS, detectLayerKeyFromName, layerMeta } from "../data/layers";
import type { BomEntity, BomModelJson, Bounds, DocumentStats, LayerStat, MacroStat, ParsedModel } from "../types";
import type { MacroKey } from "../data/layers";

type LayerAccumulator = {
  key: string;
  label: string;
  macro: MacroKey;
  color: string;
  order: number;
  positions: number[];
  triangleCount: number;
  meshCount: number;
  areaM2: number;
  materials: string[];
  components: string[];
};

type WalkStats = {
  entityCount: number;
  groupCount: number;
  faceCount: number;
  componentInstanceCount: number;
  maxDepth: number;
  totalAreaM2: number;
  topLevelHistogram: Record<string, number>;
};

const EMPTY_BOUNDS: Bounds = {
  min: [-4, -1, -4],
  max: [4, 4, 4],
  center: [0, 1.5, 0],
  size: [8, 5, 8],
  fitRadius: 13
};

function entityName(entity: BomEntity): string {
  return entity.name || entity.definition_name || entity.type || "Unnamed entity";
}

function resolveLayerKey(surfaceType?: string, parentLayer?: string | null): string {
  if (parentLayer) return parentLayer;
  if (surfaceType) return surfaceType;
  return "other";
}

function mode(values: string[]): string | null {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function datePrefix(value?: string): string {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  return match?.[1] ?? value;
}

function pushBounds(bounds: { min: number[]; max: number[] }, x: number, y: number, z: number): void {
  bounds.min[0] = Math.min(bounds.min[0], x);
  bounds.min[1] = Math.min(bounds.min[1], y);
  bounds.min[2] = Math.min(bounds.min[2], z);
  bounds.max[0] = Math.max(bounds.max[0], x);
  bounds.max[1] = Math.max(bounds.max[1], y);
  bounds.max[2] = Math.max(bounds.max[2], z);
}

function makeBounds(raw: { min: number[]; max: number[] }): Bounds {
  if (raw.min.some((value) => !Number.isFinite(value)) || raw.max.some((value) => !Number.isFinite(value))) {
    return EMPTY_BOUNDS;
  }
  const size: [number, number, number] = [
    Math.max(raw.max[0] - raw.min[0], 0.01),
    Math.max(raw.max[1] - raw.min[1], 0.01),
    Math.max(raw.max[2] - raw.min[2], 0.01)
  ];
  const center: [number, number, number] = [
    (raw.min[0] + raw.max[0]) / 2,
    (raw.min[1] + raw.max[1]) / 2,
    (raw.min[2] + raw.max[2]) / 2
  ];
  const footprint = Math.max(size[0], size[2], 1);
  const fitRadius = (footprint / 2) / Math.tan((38 / 2) * Math.PI / 180) + size[1] * 0.62;
  return {
    min: raw.min as [number, number, number],
    max: raw.max as [number, number, number],
    center,
    size,
    fitRadius
  };
}

function layerFor(acc: Map<string, LayerAccumulator>, key: string): LayerAccumulator {
  const existing = acc.get(key);
  if (existing) return existing;
  const meta = layerMeta(key);
  const created: LayerAccumulator = {
    key,
    label: meta.label,
    macro: meta.macro,
    color: meta.color,
    order: meta.order,
    positions: [],
    triangleCount: 0,
    meshCount: 0,
    areaM2: 0,
    materials: [],
    components: []
  };
  acc.set(key, created);
  return created;
}

function addFace(
  entity: BomEntity,
  layerKey: string,
  parentName: string | null,
  layers: Map<string, LayerAccumulator>,
  bounds: { min: number[]; max: number[] }
): void {
  const vertices = entity.vertices
    ?.filter((vertex) => vertex.position)
    .map((vertex) => [vertex.position.x, vertex.position.z, -vertex.position.y] as const);
  if (!vertices || vertices.length < 3) return;

  const layer = layerFor(layers, layerKey);
  const componentName = parentName || entityName(entity);
  const material = entity.material_front?.name || entity.surface_type || null;

  for (let i = 1; i < vertices.length - 1; i += 1) {
    const tri = [vertices[0], vertices[i], vertices[i + 1]];
    for (const vertex of tri) {
      layer.positions.push(vertex[0], vertex[1], vertex[2]);
      pushBounds(bounds, vertex[0], vertex[1], vertex[2]);
    }
    layer.triangleCount += 1;
  }

  layer.meshCount += 1;
  layer.areaM2 += entity.area_m2 || 0;
  if (material) layer.materials.push(material);
  if (componentName) layer.components.push(componentName);
}

function walk(
  entity: BomEntity,
  depth: number,
  parentLayer: string | null,
  parentName: string | null,
  layers: Map<string, LayerAccumulator>,
  stats: WalkStats,
  bounds: { min: number[]; max: number[] }
): void {
  const name = entityName(entity);
  const detectedLayer = detectLayerKeyFromName(name) || parentLayer;

  stats.entityCount += 1;
  stats.maxDepth = Math.max(stats.maxDepth, depth);
  if (entity.type === "Group") stats.groupCount += 1;
  if (entity.type === "ComponentInstance") stats.componentInstanceCount += 1;
  if (entity.type === "Face") {
    stats.faceCount += 1;
    stats.totalAreaM2 += entity.area_m2 || 0;
    addFace(entity, resolveLayerKey(entity.surface_type, detectedLayer), parentName, layers, bounds);
  }

  entity.children?.forEach((child) => walk(child, depth + 1, detectedLayer, name, layers, stats, bounds));
}

function buildDocumentStats(json: BomModelJson, stats: WalkStats): DocumentStats {
  return {
    schemaVersion: json.schema_version || "",
    exportLevel: json.export_level || "",
    exportedAt: json.exported_at || "",
    exportedAtPretty: datePrefix(json.exported_at),
    topLevelEntityCount: Array.isArray(json.entities) ? json.entities.length : 0,
    entityCount: stats.entityCount,
    groupCount: stats.groupCount,
    faceCount: stats.faceCount,
    componentInstanceCount: stats.componentInstanceCount,
    maxDepth: stats.maxDepth,
    totalAreaM2: stats.totalAreaM2,
    topLevelHistogram: stats.topLevelHistogram
  };
}

export function parseBomModel(json: BomModelJson, sourceName = "BOM JSON"): ParsedModel {
  if (!json || !Array.isArray(json.entities) || json.entities.length === 0) {
    throw new Error("BOM JSON must contain a non-empty entities array.");
  }

  const layers = new Map<string, LayerAccumulator>();
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  };
  const stats: WalkStats = {
    entityCount: 0,
    groupCount: 0,
    faceCount: 0,
    componentInstanceCount: 0,
    maxDepth: 0,
    totalAreaM2: 0,
    topLevelHistogram: {}
  };

  for (const entity of json.entities) {
    const bucket = entity.type || "unknown";
    stats.topLevelHistogram[bucket] = (stats.topLevelHistogram[bucket] ?? 0) + 1;
    walk(entity, 1, null, null, layers, stats, bounds);
  }

  const parsedLayers: LayerStat[] = [...layers.values()]
    .filter((layer) => layer.positions.length > 0)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map((layer) => ({
      key: layer.key,
      label: layer.label,
      macro: layer.macro,
      color: layer.color,
      positions: new Float32Array(layer.positions),
      triangleCount: layer.triangleCount,
      meshCount: layer.meshCount,
      areaM2: layer.areaM2,
      dominantMaterial: mode(layer.materials),
      dominantComponent: mode(layer.components)
    }));

  const macroMap = new Map<MacroKey, MacroStat>();
  for (const layer of parsedLayers) {
    const current =
      macroMap.get(layer.macro) ??
      ({
        key: layer.macro,
        label: MACRO_LABELS[layer.macro],
        color: MACRO_COLORS[layer.macro],
        layerCount: 0,
        triangleCount: 0,
        meshCount: 0,
        areaM2: 0
      } satisfies MacroStat);
    current.layerCount += 1;
    current.triangleCount += layer.triangleCount;
    current.meshCount += layer.meshCount;
    current.areaM2 += layer.areaM2;
    macroMap.set(layer.macro, current);
  }

  return {
    sourceName,
    bounds: makeBounds(bounds),
    layers: parsedLayers,
    macros: [...macroMap.values()].sort((a, b) => b.areaM2 - a.areaM2),
    document: buildDocumentStats(json, stats)
  };
}

export function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

export function formatArea(value: number): string {
  return `${formatNumber(value, value >= 100 ? 0 : 1)} m²`;
}
