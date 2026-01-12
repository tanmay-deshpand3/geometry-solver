// Core Types for Geometry Solver
export type ID = string;

export interface Point {
    id: ID;
    x: number;
    y: number;
    label: string;
    childrenIds: ID[];
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

export type ToolType = 'SELECT' | 'POINT' | 'SEGMENT' | 'CIRCLE' | 'MEASURE';

export type MeasureHistoryItem = { type: 'point'; id: ID } | { type: 'arc'; circleId: ID; fromId: ID; toId: ID };

export interface GeometryState {
    points: Map<ID, Point>;
    segments: Map<ID, Segment>;
    circles: Map<ID, Circle>;
    selectedIds: ID[];
    activeTool: ToolType;
    measureHistory: MeasureHistoryItem[];
    zoom: number;
    offset: { x: number; y: number };
}
