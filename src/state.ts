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

export const addCircleThreePoints = (state: GeometryState, p1Id: ID, p2Id: ID, p3Id: ID): { circle: Circle; centerPoint: Point } | null => {
    const p1 = state.points.get(p1Id);
    const p2 = state.points.get(p2Id);
    const p3 = state.points.get(p3Id);
    if (!p1 || !p2 || !p3) return null;

    const { cx, cy, r } = calculateCircumcircle(p1, p2, p3);
    if (isNaN(cx) || isNaN(cy) || isNaN(r)) return null;

    // Create center point automatically
    const centerPoint = addPoint(state, cx, cy);

    const id = generateId();
    const circle: Circle = { id, type: 'THREE_POINTS', centerId: centerPoint.id, radius: r, pointIds: [p1Id, p2Id, p3Id], childrenIds: [] };
    state.circles.set(id, circle);
    p1.childrenIds.push(id);
    p2.childrenIds.push(id);
    p3.childrenIds.push(id);
    centerPoint.childrenIds.push(id);
    return { circle, centerPoint };
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

// ============ INTERSECTION DETECTION ============

const EPSILON = 0.001; // Tolerance for considering points as same location

// Check if a point already exists at given coordinates
const pointExistsAt = (state: GeometryState, x: number, y: number): boolean => {
    for (const pt of state.points.values()) {
        if (Math.abs(pt.x - x) < EPSILON && Math.abs(pt.y - y) < EPSILON) {
            return true;
        }
    }
    return false;
};

// Segment-Segment intersection
const segmentSegmentIntersection = (
    ax1: number, ay1: number, ax2: number, ay2: number,
    bx1: number, by1: number, bx2: number, by2: number
): { x: number; y: number } | null => {
    const dx1 = ax2 - ax1, dy1 = ay2 - ay1;
    const dx2 = bx2 - bx1, dy2 = by2 - by1;
    const denom = dx1 * dy2 - dy1 * dx2;

    if (Math.abs(denom) < 1e-10) return null; // Parallel

    const t = ((bx1 - ax1) * dy2 - (by1 - ay1) * dx2) / denom;
    const u = ((bx1 - ax1) * dy1 - (by1 - ay1) * dx1) / denom;

    // Check if intersection is within both segments (excluding endpoints)
    if (t > EPSILON && t < 1 - EPSILON && u > EPSILON && u < 1 - EPSILON) {
        return { x: ax1 + t * dx1, y: ay1 + t * dy1 };
    }
    return null;
};

// Segment-Circle intersection
const segmentCircleIntersections = (
    x1: number, y1: number, x2: number, y2: number,
    cx: number, cy: number, r: number
): { x: number; y: number }[] => {
    const dx = x2 - x1, dy = y2 - y1;
    const fx = x1 - cx, fy = y1 - cy;

    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];

    const results: { x: number; y: number }[] = [];
    const sqrtDisc = Math.sqrt(discriminant);

    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);

    if (t1 > EPSILON && t1 < 1 - EPSILON) {
        results.push({ x: x1 + t1 * dx, y: y1 + t1 * dy });
    }
    if (t2 > EPSILON && t2 < 1 - EPSILON && Math.abs(t2 - t1) > EPSILON) {
        results.push({ x: x1 + t2 * dx, y: y1 + t2 * dy });
    }

    return results;
};

// Circle-Circle intersection
const circleCircleIntersections = (
    cx1: number, cy1: number, r1: number,
    cx2: number, cy2: number, r2: number
): { x: number; y: number }[] => {
    const d = Math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2);

    // No intersection or infinite intersections
    if (d > r1 + r2 || d < Math.abs(r1 - r2) || d < EPSILON) return [];

    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));

    const px = cx1 + a * (cx2 - cx1) / d;
    const py = cy1 + a * (cy2 - cy1) / d;

    const results: { x: number; y: number }[] = [];

    if (h < EPSILON) {
        // One intersection point
        results.push({ x: px, y: py });
    } else {
        // Two intersection points
        results.push({
            x: px + h * (cy2 - cy1) / d,
            y: py - h * (cx2 - cx1) / d
        });
        results.push({
            x: px - h * (cy2 - cy1) / d,
            y: py + h * (cx2 - cx1) / d
        });
    }

    return results;
};

// Get circle center and radius
const getCircleCenterRadius = (circle: Circle, points: Map<ID, Point>): { cx: number; cy: number; r: number } | null => {
    if (circle.centerId) {
        const cp = points.get(circle.centerId);
        if (cp && circle.radius) return { cx: cp.x, cy: cp.y, r: circle.radius };
    }
    return null;
};

// Main function: find and create all intersection points
export const findAllIntersections = (state: GeometryState): Point[] => {
    const newPoints: Point[] = [];
    const segments = Array.from(state.segments.values());
    const circles = Array.from(state.circles.values());

    // Segment-Segment intersections
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const s1 = segments[i], s2 = segments[j];
            const p1a = state.points.get(s1.p1), p1b = state.points.get(s1.p2);
            const p2a = state.points.get(s2.p1), p2b = state.points.get(s2.p2);
            if (!p1a || !p1b || !p2a || !p2b) continue;

            const intersection = segmentSegmentIntersection(
                p1a.x, p1a.y, p1b.x, p1b.y,
                p2a.x, p2a.y, p2b.x, p2b.y
            );

            if (intersection && !pointExistsAt(state, intersection.x, intersection.y)) {
                const pt = addPoint(state, intersection.x, intersection.y);
                newPoints.push(pt);
            }
        }
    }

    // Segment-Circle intersections
    for (const seg of segments) {
        const p1 = state.points.get(seg.p1), p2 = state.points.get(seg.p2);
        if (!p1 || !p2) continue;

        for (const circle of circles) {
            const circleData = getCircleCenterRadius(circle, state.points);
            if (!circleData) continue;

            const intersections = segmentCircleIntersections(
                p1.x, p1.y, p2.x, p2.y,
                circleData.cx, circleData.cy, circleData.r
            );

            for (const pt of intersections) {
                if (!pointExistsAt(state, pt.x, pt.y)) {
                    newPoints.push(addPoint(state, pt.x, pt.y));
                }
            }
        }
    }

    // Circle-Circle intersections
    for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
            const c1Data = getCircleCenterRadius(circles[i], state.points);
            const c2Data = getCircleCenterRadius(circles[j], state.points);
            if (!c1Data || !c2Data) continue;

            const intersections = circleCircleIntersections(
                c1Data.cx, c1Data.cy, c1Data.r,
                c2Data.cx, c2Data.cy, c2Data.r
            );

            for (const pt of intersections) {
                if (!pointExistsAt(state, pt.x, pt.y)) {
                    newPoints.push(addPoint(state, pt.x, pt.y));
                }
            }
        }
    }

    return newPoints;
};
