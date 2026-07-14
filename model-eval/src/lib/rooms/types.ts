export type PlanCoord = { x: number; z: number };
export type PlanBounds = { min: PlanCoord; max: PlanCoord };
export type PlanSegment = { start: PlanCoord; end: PlanCoord };

export interface StoreyBandEvidence {
	id: string;
	logicalObjectId: string;
	classificationUnitIds: string[];
	elevationRange: { min: number; max: number };
	planBounds: PlanBounds;
	materialIds?: number[];
	storeyName?: string;
	quality: number;
	isAmbiguous: boolean;
}

export interface HorizontalSurfaceEvidence {
	id: string;
	logicalObjectId: string;
	classificationUnitIds: string[];
	elevation: number;
	planBounds: PlanBounds;
	materialIds?: number[];
	surfaceType: 'floor' | 'ceiling';
	areaM2: number;
	quality: number;
	isAmbiguous: boolean;
}

export interface VerticalBarrierEvidence {
	id: string;
	logicalObjectId: string;
	classificationUnitIds: string[];
	elevationRange: { min: number; max: number };
	segment: PlanSegment;
	materialIds?: number[];
	thickness: number;
	isExterior: boolean;
	quality: number;
	isAmbiguous: boolean;
}

export interface BoundaryOpeningEvidence {
	id: string;
	logicalObjectId: string;
	classificationUnitIds: string[];
	elevationRange: { min: number; max: number };
	segment: PlanSegment;
	materialIds?: number[];
	openingType: 'door' | 'window' | 'opening';
	width: number;
	height: number;
	quality: number;
	isAmbiguous: boolean;
}

export interface RoomEvidenceDiagnostics {
	totalStoreyBands: number;
	totalHorizontalSurfaces: number;
	totalVerticalBarriers: number;
	totalBoundaryOpenings: number;
	duplicatedIdsCount: number;
	executionTimeMs: number;
}

export interface RoomEvidenceSnapshot {
	storeyBands: StoreyBandEvidence[];
	horizontalSurfaces: HorizontalSurfaceEvidence[];
	verticalBarriers: VerticalBarrierEvidence[];
	boundaryOpenings: BoundaryOpeningEvidence[];
	diagnostics: RoomEvidenceDiagnostics;
}
