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
	totalArea?: number;
	projectedPlanArea?: number;
	memberCount?: number;
	upwardArea?: number;
	downwardArea?: number;
	modelRelativeCoverage?: number;
	compactness?: number;
	score?: number;
	status?: 'primary' | 'secondary' | 'noise';
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
	acceptedHorizontalCount?: number;
	rejectedHorizontalCount?: number;
	acceptedVerticalCount?: number;
	rejectedVerticalCount?: number;
	unitsInspected?: number;
	duplicatesSkipped?: number;
	batchesProcessed?: number;
	cancelled?: boolean;
}

export interface BarrierGraphNode {
	id: string;
	coord: PlanCoord;
}

export interface BarrierGraphEdge {
	id: string;
	nodeAId: string;
	nodeBId: string;
	start: PlanCoord;
	end: PlanCoord;
	originalStart: PlanCoord;
	originalEnd: PlanCoord;
	verticalEvidenceIds: string[];
	logicalObjectId: string;
	classificationUnitIds: string[];
	materialIds: number[];
	storeyCandidateId: string;
}

export interface BarrierGraph {
	storeyCandidateId: string;
	nodes: BarrierGraphNode[];
	edges: BarrierGraphEdge[];
	components: string[][];
	diagnostics: {
		inputBarriers: number;
		acceptedEdges: number;
		rejectedEdges: number;
		snappedEndpoints: number;
		duplicateEdgesMerged: number;
		graphNodes: number;
		graphEdges: number;
		connectedComponents: number;
	};
}

export interface RoomEvidenceSnapshot {
	storeyBands: StoreyBandEvidence[];
	horizontalSurfaces: HorizontalSurfaceEvidence[];
	verticalBarriers: VerticalBarrierEvidence[];
	boundaryOpenings: BoundaryOpeningEvidence[];
	diagnostics: RoomEvidenceDiagnostics;
	barrierGraphs?: BarrierGraph[];
}
