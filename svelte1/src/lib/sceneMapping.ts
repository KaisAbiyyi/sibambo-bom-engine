import { BASE_SCENE_CONFIG } from "../data/sceneConfig";
import { CONTEXT_BY_MACRO } from "../data/sectionConfig";
import { formatArea, formatDecimal, formatInteger } from "./format";
import type { MacroGroupKey, ParsedModel } from "../types/model";
import type { SceneData } from "../types/scene";

export function mapModelToScenes(model: ParsedModel | null): SceneData[] {
  return BASE_SCENE_CONFIG.map((base) => {
    if (!model) {
      return {
        ...base,
        componentIds: [],
        activeLayerKeys: [],
        contextLayerKeys: [],
        specs: [{ label: "Data", value: "Load BOM JSON" }]
      };
    }

    if (base.macroGroup === "all") {
      const allLayerKeys = Object.values(model.macroGroups).flatMap((macro) => macro.layerKeys);
      return {
        ...base,
        componentIds: Object.values(model.macroGroups).flatMap((macro) => macro.componentIds).slice(0, 18),
        activeLayerKeys: allLayerKeys,
        contextLayerKeys: [],
        specs: [
          { label: "Layers", value: String(Object.keys(model.layerRegistry).length) },
          { label: "Meshes", value: formatInteger(model.meshCount) },
          { label: "Footprint", value: `${formatDecimal(model.bounds.footprint)} m span` }
        ]
      };
    }

    const macroKey = base.macroGroup as MacroGroupKey;
    const macro = model.macroGroups[macroKey];
    const contextLayerKeys = CONTEXT_BY_MACRO[macroKey].flatMap((key) => model.macroGroups[key].layerKeys);

    return {
      ...base,
      componentIds: macro.componentIds.slice(0, 16),
      activeLayerKeys: macro.layerKeys,
      contextLayerKeys,
      specs: [
        { label: "Active layers", value: macro.layerKeys.length ? String(macro.layerKeys.length) : "0" },
        { label: "Active meshes", value: formatInteger(macro.meshCount) },
        { label: "Area", value: formatArea(macro.area) }
      ]
    };
  });
}
