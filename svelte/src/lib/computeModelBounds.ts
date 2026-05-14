import { Box3, Vector3 } from "three";
import { LAYER_META, MACRO_GROUPS, MACRO_LABELS } from "../data/layerMeta";
import type { LayerKey, LayerModel, MacroGroupKey, MacroModel, ModelMesh, ParsedModel } from "../types/model";

function translatedGeometryBox(mesh: ModelMesh): Box3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox?.clone() ?? new Box3();
  return box.translate(new Vector3(...mesh.position));
}

export function computeModelBounds(params: {
  sourceName: string;
  meshes: ModelMesh[];
  components: ParsedModel["components"];
  faceCount: number;
}): ParsedModel {
  const layers = {} as Record<string, LayerModel>;
  const modelBox = new Box3();

  params.meshes.forEach((mesh) => {
    const meta = LAYER_META[mesh.layerKey];
    if (!layers[mesh.layerKey]) {
      layers[mesh.layerKey] = {
        key: mesh.layerKey,
        label: meta.label,
        macroGroup: meta.group,
        color: meta.color,
        meshes: [],
        meshCount: 0,
        componentIds: [],
        area: 0,
        totalAreaM2: 0,
        bounds: new Box3(),
        box: new Box3(),
        center: new Vector3(),
        size: new Vector3()
      };
    }

    const layer = layers[mesh.layerKey];
    layer.meshes.push(mesh);
    layer.meshCount += 1;
    layer.area += mesh.areaM2 || 0;
    layer.totalAreaM2 += mesh.areaM2 || 0;
    if (mesh.id) layer.componentIds.push(mesh.id);
    const meshBox = translatedGeometryBox(mesh);
    layer.bounds.union(meshBox);
    layer.box.union(meshBox);
    modelBox.union(meshBox);
  });

  Object.values(layers).forEach((layer) => {
    if (!layer.box.isEmpty()) layer.box.getCenter(layer.center);
    if (!layer.box.isEmpty()) layer.box.getSize(layer.size);
    layer.componentIds = Array.from(new Set(layer.componentIds));
  });

  if (modelBox.isEmpty()) {
    modelBox.setFromCenterAndSize(new Vector3(), new Vector3(8, 5, 8));
  }

  const center = modelBox.getCenter(new Vector3());
  const size = modelBox.getSize(new Vector3());
  const footprint = Math.max(size.x, size.z, 1);
  const fitRadius = (footprint / 2) / Math.tan((42 / 2) * Math.PI / 180) * 1.28 + size.y * 0.42;

  const macros = {} as Record<MacroGroupKey, MacroModel>;
  (Object.keys(MACRO_GROUPS) as MacroGroupKey[]).forEach((macroKey) => {
    const macroBox = new Box3();
    const layerKeys = MACRO_GROUPS[macroKey].filter((key) => layers[key]);
    const componentIds: string[] = [];
    let totalAreaM2 = 0;
    let meshCount = 0;

    layerKeys.forEach((layerKey) => {
      const layer = layers[layerKey];
      macroBox.union(layer.box);
      componentIds.push(...layer.componentIds);
      totalAreaM2 += layer.totalAreaM2;
      meshCount += layer.meshCount;
    });

    const macroCenter = macroBox.isEmpty() ? center.clone() : macroBox.getCenter(new Vector3());
    const macroSize = macroBox.isEmpty() ? size.clone() : macroBox.getSize(new Vector3());
    const scale = Math.max(size.y, footprint) * 0.38;
    const offsets: Record<MacroGroupKey, Vector3> = {
      roof: new Vector3(0.08, 1.34, -0.42),
      openings: new Vector3(-0.68, 0.16, 0.52),
      walls: new Vector3(0.52, 0.08, -0.36),
      structure: new Vector3(0.02, 0.02, 0.08),
      floor: new Vector3(-0.24, -0.58, 0.34),
      foundation: new Vector3(0.12, -1.34, -0.42),
      other: new Vector3(0.08, macroCenter.y >= center.y ? 0.32 : -0.32, 0.08)
    };

    macros[macroKey] = {
      key: macroKey,
      id: macroKey,
      label: MACRO_LABELS[macroKey],
      layerKeys,
      meshCount,
      componentIds: Array.from(new Set(componentIds)),
      area: totalAreaM2,
      totalAreaM2,
      bounds: macroBox,
      box: macroBox,
      center: macroCenter,
      size: macroSize,
      explodeOffset: offsets[macroKey].multiplyScalar(scale)
    };
  });

  return {
    sourceName: params.sourceName,
    meshCount: params.meshes.length,
    faceCount: params.faceCount,
    componentCount: Object.keys(params.components).length,
    layerRegistry: layers,
    macroGroups: macros,
    layers,
    macros,
    components: params.components,
    bounds: {
      box: modelBox,
      center,
      size,
      footprint,
      fitRadius
    }
  };
}

export function disposeParsedModel(model: ParsedModel | null) {
  if (!model) return;
  Object.values(model.layers).forEach((layer) => {
    layer.meshes.forEach((mesh) => mesh.geometry.dispose());
  });
}
