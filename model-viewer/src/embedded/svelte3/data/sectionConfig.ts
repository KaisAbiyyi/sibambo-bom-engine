import type { MacroGroupKey } from "../types/model";

export const CONTEXT_BY_MACRO: Record<MacroGroupKey, MacroGroupKey[]> = {
  roof: ["walls", "structure"],
  openings: ["walls"],
  walls: ["openings", "structure", "floor"],
  structure: ["floor", "foundation"],
  floor: ["structure", "foundation"],
  foundation: ["floor", "structure"],
  other: ["walls"]
};
