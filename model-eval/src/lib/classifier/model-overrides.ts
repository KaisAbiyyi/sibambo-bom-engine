import type { BuildingCategory } from './rule-bank-v1';

export type ModelSpecificOverride = {
	id: string;
	modelPattern: RegExp;
	faceIdPattern: RegExp;
	category: Exclude<BuildingCategory, 'unknown'>;
	confidence: number;
	reason: string;
};

// Deliberately empty. Corpus-specific corrections belong here, never in general rules.
export const MODEL_SPECIFIC_OVERRIDES: ModelSpecificOverride[] = [];
