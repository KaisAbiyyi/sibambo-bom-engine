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
	normalizedBarrierGraphs?: import('./helpers').NormalizedBarrierGraph[];
}

export interface BoundaryLoopCandidate {
	id: string;
	storeyCandidateId: string;
	connectedComponentIndex: number;
	nodeIds: string[];
	edgeIds: string[];
	verticalEvidenceIds: string[];
	sourceEvidenceIds: string[];
	logicalObjectIds: string[];
	classificationUnitIds: string[];
	materialIds: number[];
	signedArea: number;
	absoluteArea: number;
	area: number;
	perimeter: number;
	planBounds: PlanBounds;
	bounds?: PlanBounds;
	orientation: 'cw' | 'ccw';
	isAmbiguous: boolean;
	quality: number;
}

export interface BoundaryLoopDiagnostics {
	componentsInspected: number;
	halfEdgesCreated: number;
	traversalsAttempted: number;
	closedTraversalsFound: number;
	outerFacesExcluded: number;
	duplicateLoopsRemoved: number;
	zeroAreaLoopsRejected: number;
	selfIntersectingLoopsRejected: number;
	acceptedCandidates: number;
}

export interface BoundaryLoopResult {
	candidates: BoundaryLoopCandidate[];
	diagnostics: BoundaryLoopDiagnostics;
}

export type BoundaryLoopStatus = 'primary' | 'secondary' | 'noise';

export interface BoundaryLoopQuality {
	nearZeroArea: boolean;
	extremeAspectRatio: boolean;
	lowCompactness: boolean;
	veryShortPerimeter: boolean;
	excessiveEdgeCount: boolean;
	weakSourceDiversity: boolean;
	nestedOrOverlapping: boolean;
	geometricallyPlausible: boolean;
}

export interface RankedBoundaryLoopCandidate extends BoundaryLoopCandidate {
	score: number;
	status: BoundaryLoopStatus;
	compactness: number;
	boundsAspectRatio: number;
	edgeCount: number;
	uniqueSourceObjectCount: number;
	sharedEdgeIds: string[];
	adjacentLoopIds: string[];
	qualityFlags: BoundaryLoopQuality;
}

export interface RankedBoundaryLoopResult {
	candidates: RankedBoundaryLoopCandidate[];
	diagnostics: BoundaryLoopDiagnostics & {
		rawLoopCount: number;
		primaryLoopCount: number;
		secondaryLoopCount: number;
		noiseLoopCount: number;
		rankedFingerprint: string;
	};
}

export type LoopSurfaceAssignmentRole = 'lower-support' | 'upper-cover' | 'intersecting' | 'ambiguous';

export interface LoopSurfaceAssignmentQuality {
	approximateOverlap: boolean;
	weakPlanOverlap: boolean;
	strongPlanOverlap: boolean;
	elevationMismatch: boolean;
	orientationConflict: boolean;
	multipleLowerCandidates: boolean;
	multipleUpperCandidates: boolean;
	noHorizontalSupport: boolean;
	ambiguousRole: boolean;
}

export interface LoopSurfaceAssignment {
	id: string;
	loopCandidateId: string;
	storeyCandidateId: string;
	horizontalEvidenceId: string;
	logicalObjectId: string;
	classificationUnitIds: string[];
	materialIds: number[];
	orientation: 'up' | 'down' | 'horizontal' | 'unknown';
	elevation: number;
	loopArea: number;
	overlapArea: number;
	overlapProxy?: number;
	loopCoverageRatio: number;
	evidenceCoverageRatio: number;
	verticalDistance: number;
	role: LoopSurfaceAssignmentRole;
	score: number;
	qualityFlags: LoopSurfaceAssignmentQuality;
}

export interface LoopSurfaceAssignmentDiagnostics {
	loopsInspected: number;
	noiseLoopsSkipped: number;
	horizontalEvidenceInspected: number;
	planOverlapTests: number;
	assignmentsAccepted: number;
	lowerSupportCandidates: number;
	upperCoverCandidates: number;
	ambiguousAssignments: number;
	loopsWithNoAssignment: number;
	approximateOverlapAssignments: number;
	rejectedNonFiniteGeometry: number;
}

export interface LoopSurfaceAssignmentResult {
	assignments: LoopSurfaceAssignment[];
	diagnostics: LoopSurfaceAssignmentDiagnostics & {
		fingerprint?: string;
	};
}
