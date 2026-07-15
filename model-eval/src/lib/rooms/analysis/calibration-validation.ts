import type { BuildingAnalysisResult, RoomAnalysisResult } from './types';
import type { ProjectConfiguration } from './project-configuration';

export type CalibrationModule = 'all' | 'thermal' | 'ventilation' | 'cooling' | 'lighting' | 'ottv';
export type CalibrationValidationSummary = {
	configurationValid: boolean;
	invalidFields: string[];
	fallbackFields: string[];
	roomCounts: Record<'complete' | 'partial' | 'insufficient', number>;
	warnings: Array<{ roomId?: string; module: CalibrationModule; category: 'orientation' | 'material' | 'envelope' | 'opening'; message: string }>;
};

export function buildCalibrationValidationSummary(config: ProjectConfiguration, analysis: BuildingAnalysisResult): CalibrationValidationSummary {
	const invalidFields = Object.entries(config.values).filter(([, value]) => value.validation === 'invalid').map(([key]) => key);
	const fallbackFields = Object.entries(config.values).filter(([, value]) => value.source === 'fallback' || value.validation === 'fallback').map(([key]) => key);
	const roomCounts = { complete: 0, partial: 0, insufficient: 0 };
	const warnings: CalibrationValidationSummary['warnings'] = [];
	for (const room of analysis.rooms) {
		roomCounts[room.dataQuality]++;
		collectRoomWarnings(room, warnings);
	}
	for (const message of analysis.ottv.missingInputs) warnings.push({ module: 'ottv', category: 'material', message });
	for (const message of analysis.diagnostics.map(d => d.message)) if (/north|orientation/i.test(message)) warnings.push({ module: 'ottv', category: 'orientation', message });
	return { configurationValid: invalidFields.length === 0, invalidFields, fallbackFields, roomCounts, warnings };
}

function collectRoomWarnings(room: RoomAnalysisResult, warnings: CalibrationValidationSummary['warnings']) {
	for (const diagnostic of room.diagnostics) {
		const text = diagnostic.message.toLowerCase();
		const category = /opening|window|door/.test(text) ? 'opening' : /material|u-value|shading/.test(text) ? 'material' : /geometry|envelope|surface/.test(text) ? 'envelope' : 'orientation';
		const module = diagnostic.module === 'ventilation' || diagnostic.module === 'cooling' || diagnostic.module === 'lighting' || diagnostic.module === 'thermal' ? diagnostic.module : 'ottv';
		warnings.push({ roomId: room.roomId, module, category, message: diagnostic.message });
	}
}

export function filterCalibrationWarnings(summary: CalibrationValidationSummary, roomId: string, module: CalibrationModule) {
	return summary.warnings.filter(item => (!roomId || item.roomId === roomId) && (module === 'all' || item.module === module));
}
