import { DEFAULT_ANALYSIS_CONFIGURATION, type RoomAnalysisConfiguration } from './types';

export const PROJECT_CONFIGURATION_SCHEMA = 'model-eval-project-configuration';
export const PROJECT_CONFIGURATION_VERSION = 1;
export type ProjectConfigurationSource = 'model' | 'user' | 'profile' | 'fallback';
export type ProjectConfigurationState = 'valid' | 'invalid' | 'fallback';
export type ProjectConfigurationValue = { value: number; unit: string; source: ProjectConfigurationSource; validation: ProjectConfigurationState; note?: string };
export type ProjectConfiguration = { schema: typeof PROJECT_CONFIGURATION_SCHEMA; version: typeof PROJECT_CONFIGURATION_VERSION; values: Record<keyof RoomAnalysisConfiguration, ProjectConfigurationValue> };

const limits: Record<keyof RoomAnalysisConfiguration, [number, number, string]> = {
	indoorDesignTempC: [16, 32, '°C'], outdoorDesignTempC: [16, 55, '°C'], relativeHumidityPercent: [10, 100, '%'],
	localWindSpeedMs: [0, 30, 'm/s'], localWindDirectionDeg: [0, 360, '°'], projectNorthDeg: [0, 360, '°'],
	defaultLuminaireFluxLm: [100, 100000, 'lm'], defaultLuminaireWattageW: [1, 5000, 'W'], coefficientOfUtilization: [0.1, 1, 'ratio'],
	lightLossFactor: [0.1, 1, 'ratio'], acSafetyMargin: [0, 1, 'ratio'], defaultWallUValue: [0.05, 15, 'W/m²K'],
	defaultGlazingUValue: [0.1, 15, 'W/m²K'], defaultSolarFactor: [0, 1, 'ratio'], defaultShadingCoefficient: [0, 1, 'ratio'],
	defaultSolarAbsorptance: [0, 1, 'ratio'], ottvThresholdWm2: [1, 200, 'W/m²']
};

export function createDefaultProjectConfiguration(): ProjectConfiguration {
	const values = {} as ProjectConfiguration['values'];
	for (const key of Object.keys(DEFAULT_ANALYSIS_CONFIGURATION) as Array<keyof RoomAnalysisConfiguration>) {
		const [min, max, unit] = limits[key]; const value = DEFAULT_ANALYSIS_CONFIGURATION[key] ?? 0;
		values[key] = { value, unit, source: 'profile', validation: value >= min && value <= max ? 'valid' : 'fallback' };
	}
	return { schema: PROJECT_CONFIGURATION_SCHEMA, version: PROJECT_CONFIGURATION_VERSION, values };
}

export function validateProjectConfiguration(input: unknown): { ok: true; value: ProjectConfiguration } | { ok: false; issues: string[] } {
	if (!input || typeof input !== 'object') return { ok: false, issues: ['Configuration must be an object'] };
	const raw = input as Partial<ProjectConfiguration>; const issues: string[] = [];
	if (raw.schema !== PROJECT_CONFIGURATION_SCHEMA) issues.push('Unsupported configuration schema');
	if (raw.version !== PROJECT_CONFIGURATION_VERSION) issues.push('Unsupported configuration version');
	const values = raw.values as ProjectConfiguration['values'];
	for (const key of Object.keys(limits) as Array<keyof RoomAnalysisConfiguration>) {
		const field = values?.[key]; const [min, max] = limits[key];
		if (!field || !Number.isFinite(field.value) || field.value < min || field.value > max) issues.push(`${key} must be between ${min} and ${max}`);
	}
	return issues.length ? { ok: false, issues } : { ok: true, value: structuredClone(raw) as ProjectConfiguration };
}

export function updateProjectConfiguration(config: ProjectConfiguration, key: keyof RoomAnalysisConfiguration, value: number): ProjectConfiguration {
	const next = structuredClone(config); const [min, max] = limits[key];
	next.values[key] = { ...next.values[key], value, source: 'user', validation: Number.isFinite(value) && value >= min && value <= max ? 'valid' : 'invalid' };
	return next;
}

export function resetProjectConfigurationField(config: ProjectConfiguration, key: keyof RoomAnalysisConfiguration): ProjectConfiguration {
	const defaults = createDefaultProjectConfiguration(); return { ...config, values: { ...config.values, [key]: defaults.values[key] } };
}

export function toRoomAnalysisConfiguration(config: ProjectConfiguration): RoomAnalysisConfiguration {
	const validated = validateProjectConfiguration(config); if (!validated.ok) throw new Error(validated.issues.join('; '));
	const output = {} as RoomAnalysisConfiguration;
	for (const key of Object.keys(config.values) as Array<keyof RoomAnalysisConfiguration>) output[key] = config.values[key].value as never;
	return output;
}

export function exportProjectConfiguration(config: ProjectConfiguration): string { return JSON.stringify(config, null, 2); }
export function importProjectConfiguration(json: string) { try { return validateProjectConfiguration(JSON.parse(json)); } catch { return { ok: false as const, issues: ['Malformed configuration JSON'] }; } }
