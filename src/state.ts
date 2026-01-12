// Geometry State Manager with DFS Cascading Delete
import type { GeometryState, Point, Segment, Circle, ID, ToolType, MeasureHistoryItem } from './types';

let labelCounter = 0;
const getNextLabel = (): string => {
    const label = String.fromCharCode(65 + (labelCounter % 26));
    const suffix = Math.floor(labelCounter / 26);
    labelCounter++;
    return suffix > 0 ? `${label}${suffix}` : label;
};

export const createInitialState = (): GeometryState => ({
    points: new Map(),
    segments: new Map(),
    circles: new Map(),
    selectedIds: [],
    activeTool: 'SELECT',
    measureHistory: [],
    zoom: 1,
    offset: { x: 0, y: 0 },
});

let idCounter = 0;
export const generateId = (): ID => `id_${++idCounter}`;

export const addPoint = (state: GeometryState, x: number, y: number): Point => {
    const id = generateId();
    const point: Point = { id, x, y, label: getNextLabel(), childrenIds: [] };
    state.points.set(id, point);
    return point;
};

export const addSegmentTwoPoints = (state: GeometryState, p1Id: ID, p2Id: ID): Segment | null => {
    const p1 = state.points.get(p1Id);
    const p2 = state.points.get(p2Id);
    if (!p1 || !p2) return null;

    const id = generateId();
    const segment: Segment = { id, p1: p1Id, p2: p2Id, type: 'TWO_POINTS', childrenIds: [] };
    state.segments.set(id, segment);
    p1.childrenIds.push(id);
    p2.childrenIds.push(id);
    return segment;
};

export const addSegmentAbsAngle = (state: GeometryState, p1Id: ID, angle: number, length: number): { segment: Segment; newPoint: Point } | null => {
    const p1 = state.points.get(p1Id);
    if (!p1) return null;

    // Standard math convention: 0=right, positive=counterclockwise (up in screen coords)
    // Negate Y because screen Y is inverted
    const x2 = p1.x + length * Math.cos(angle * Math.PI / 180);
    const y2 = p1.y - length * Math.sin(angle * Math.PI / 180);
    const p2 = addPoint(state, x2, y2);

    const id = generateId();
    const segment: Segment = { id, p1: p1Id, p2: p2.id, type: 'ABS_ANGLE', angle, length, childrenIds: [] };
    state.segments.set(id, segment);
    p1.childrenIds.push(id);
    p2.childrenIds.push(id);
    return { segment, newPoint: p2 };
};

export const addSegmentRelAngle = (state: GeometryState, p1Id: ID, refSegmentId: ID, relAngle: number, length: number): { segment: Segment; newPoint: Point } | null => {
    const p1 = state.points.get(p1Id);
    const refSeg = state.segments.get(refSegmentId);
    if (!p1 || !refSeg) return null;

    const refAngle = getSegmentAngle(state, refSeg);
    if (refAngle === null) return null;

    const finalAngle = refAngle + relAngle;
    // Standard math convention: negate Y for screen coords
    const x2 = p1.x + length * Math.cos(finalAngle * Math.PI / 180);
    const y2 = p1.y - length * Math.sin(finalAngle * Math.PI / 180);
    const p2 = addPoint(state, x2, y2);

    const id = generateId();
    const segment: Segment = { id, p1: p1Id, p2: p2.id, type: 'REL_ANGLE', angle: relAngle, length, refSegmentId, childrenIds: [] };
    state.segments.set(id, segment);
    p1.childrenIds.push(id);
    p2.childrenIds.push(id);
    refSeg.childrenIds.push(id);
    return { segment, newPoint: p2 };
};

export const getSegmentAngle = (state: GeometryState, segment: Segment): number | null => {
    const p1 = state.points.get(segment.p1);
    const p2 = state.points.get(segment.p2);
    if (!p1 || !p2) return null;
    // Standard math convention: negate dy for screen coords
    return Math.atan2(-(p2.y - p1.y), p2.x - p1.x) * 180 / Math.PI;
};


export const addCircleRadius = (state: GeometryState, centerId: ID, radius: number): Circle | null => {
    const center = state.points.get(centerId);
    if (!center) return null;

    const id = generateId();
    const circle: Circle = { id, type: 'RADIUS', centerId, radius, pointIds: [], childrenIds: [] };
    state.circles.set(id, circle);
    center.childrenIds.push(id);
    return circle;
};

export const addCircleCircumference = (state: GeometryState, centerId: ID, circumPointId: ID): Circle | null => {
    const center = state.points.get(centerId);
    const circumPoint = state.points.get(circumPointId);
    if (!center || !circumPoint) return null;

    const radius = Math.sqrt((circumPoint.x - center.x) ** 2 + (circumPoint.y - center.y) ** 2);
    const id = generateId();
    const circle: Circle = { id, type: 'RADIUS', centerId, radius, pointIds: [circumPointId], childrenIds: [] };
    state.circles.set(id, circle);
    center.childrenIds.push(id);
    circumPoint.childrenIds.push(id);
    return circle;
};

export const addCircleThreePoints = (state: GeometryState, p1Id: ID, p2Id: ID, p3Id: ID): Circle | null => {
    const p1 = state.points.get(p1Id);
    const p2 = state.points.get(p2Id);
    const p3 = state.points.get(p3Id);
    if (!p1 || !p2 || !p3) return null;

    const { cx, cy, r } = calculateCircumcircle(p1, p2, p3);
    if (isNaN(cx) || isNaN(cy) || isNaN(r)) return null;

    const id = generateId();
    const circle: Circle = { id, type: 'THREE_POINTS', radius: r, pointIds: [p1Id, p2Id, p3Id], childrenIds: [] };
    state.circles.set(id, circle);
    p1.childrenIds.push(id);
    p2.childrenIds.push(id);
    p3.childrenIds.push(id);
    return circle;
};

const calculateCircumcircle = (p1: Point, p2: Point, p3: Point): { cx: number; cy: number; r: number } => {
    const ax = p1.x, ay = p1.y;
    const bx = p2.x, by = p2.y;
    const cx = p3.x, cy = p3.y;

    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-10) return { cx: NaN, cy: NaN, r: NaN };

    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);

    return { cx: ux, cy: uy, r };
};

export const deleteEntity = (state: GeometryState, id: ID): void => {
    const point = state.points.get(id);
    if (point) {
        [...point.childrenIds].forEach(childId => deleteEntity(state, childId));
        state.points.delete(id);
        return;
    }
    const segment = state.segments.get(id);
    if (segment) {
        [...segment.childrenIds].forEach(childId => deleteEntity(state, childId));
        removeFromParentChildren(state, segment.p1, id);
        removeFromParentChildren(state, segment.p2, id);
        state.segments.delete(id);
        return;
    }
    const circle = state.circles.get(id);
    if (circle) {
        [...circle.childrenIds].forEach(childId => deleteEntity(state, childId));
        if (circle.centerId) removeFromParentChildren(state, circle.centerId, id);
        circle.pointIds.forEach(pId => removeFromParentChildren(state, pId, id));
        state.circles.delete(id);
    }
};

const removeFromParentChildren = (state: GeometryState, parentId: ID, childId: ID): void => {
    const point = state.points.get(parentId);
    if (point) {
        point.childrenIds = point.childrenIds.filter(c => c !== childId);
    }
};

export const setActiveTool = (state: GeometryState, tool: ToolType): void => {
    state.activeTool = tool;
    state.selectedIds = [];
    state.measureHistory = [];
};

export const addToMeasureHistory = (state: GeometryState, item: MeasureHistoryItem): void => {
    state.measureHistory.push(item);
};

export const clearMeasureHistory = (state: GeometryState): void => {
    state.measureHistory = [];
};
