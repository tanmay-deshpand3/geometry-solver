// Core Types for Geometry Solver
export type ID = string;

export interface Point {
    id: ID;
    x: number;
    y: number;
    label: string;
    childrenIds: ID[];
    isFloating: boolean; // If true, position is determined by solver
}

export type SegmentType = 'TWO_POINTS' | 'ABS_ANGLE' | 'REL_ANGLE';

export interface Segment {
    id: ID;
    p1: ID;
    p2: ID;
    type: SegmentType;
    length?: number;
    angle?: number;
    refSegmentId?: ID;
    childrenIds: ID[];
}

export type CircleType = 'RADIUS' | 'THREE_POINTS';

export interface Circle {
    id: ID;
    type: CircleType;
    centerId?: ID;
    radius?: number;
    pointIds: ID[];
    childrenIds: ID[];
}

// Arc: defined by circle + two boundary points (CCW order: startId -> endId)
export interface Arc {
    id: ID;
    circleId: ID;
    startId: ID; // Point ID for arc start
    endId: ID;   // Point ID for arc end (CCW direction)
    childrenIds: ID[];
}

// Variable: a named value that can be determined by the solver
export interface Variable {
    name: string;
    value: number;
    isDetermined: boolean; // If true, solver finds the value; if false, user sets it
}

// Constraint types
export type ConstraintType =
    | 'DISTANCE'           // Distance between two points = expression
    | 'POINT_ON_SEGMENT'   // Point lies on a segment
    | 'POINT_ON_CIRCLE'    // Point lies on a circle
    | 'POINT_ON_ARC'       // Point lies on an arc
    | 'ANGLE'              // Angle of segment = expression (degrees)
    | 'EQUATION';          // Generic equation: expression = 0

export interface Constraint {
    id: ID;
    type: ConstraintType;
    pointIds: ID[];        // Points involved (e.g., [P1, P2] for DISTANCE)
    targetId?: ID;         // Reference to Segment/Circle/Arc for ON_* constraints
    expression?: string;   // Mathematical expression (uses variable names)
}

export type ToolType = 'SELECT' | 'POINT' | 'SEGMENT' | 'CIRCLE' | 'MEASURE' | 'CONSTRAINT';

export type MeasureHistoryItem = { type: 'point'; id: ID } | { type: 'arc'; circleId: ID; fromId: ID; toId: ID; clickAngle: number };

export interface GeometryState {
    points: Map<ID, Point>;
    segments: Map<ID, Segment>;
    circles: Map<ID, Circle>;
    arcs: Map<ID, Arc>;
    variables: Map<string, Variable>;
    constraints: Constraint[];
    selectedIds: ID[];
    activeTool: ToolType;
    measureHistory: MeasureHistoryItem[];
    zoom: number;
    offset: { x: number; y: number };
}
