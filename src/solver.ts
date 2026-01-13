// Constraint Solver using Levenberg-Marquardt Algorithm
// Solves geometric constraints by minimizing residual errors

import type { GeometryState, ID, Constraint } from './types';
import { evaluateExpression } from './expression';

// ============ SOLVER CONFIGURATION ============
const MAX_ITERATIONS = 100;
const CONVERGENCE_THRESHOLD = 1e-4;
const LAMBDA_INITIAL = 0.01;
const LAMBDA_UP = 10;
const LAMBDA_DOWN = 0.1;
const NUMERICAL_EPSILON = 1e-6;
const SINGULARITY_EPSILON = 1e-6; // For handling coincident points

// ============ PARAMETER EXTRACTION ============
interface SolverParams {
    pointCoords: { pointId: ID; coord: 'x' | 'y'; value: number }[];
    variableValues: { name: string; value: number }[];
}

/**
 * Extract free parameters from the state.
 * - Floating points (isFloating = true) have their coords as free params
 * - Variables with isDetermined = true are free params (solver finds them)
 */
function extractFreeParams(state: GeometryState): SolverParams {
    const pointCoords: SolverParams['pointCoords'] = [];
    const variableValues: SolverParams['variableValues'] = [];

    for (const point of state.points.values()) {
        if (point.isFloating) {
            pointCoords.push({ pointId: point.id, coord: 'x', value: point.x });
            pointCoords.push({ pointId: point.id, coord: 'y', value: point.y });
        }
    }

    for (const variable of state.variables.values()) {
        if (variable.isDetermined) {
            variableValues.push({
                name: variable.name,
                value: variable.value,
            });
        }
    }

    return { pointCoords, variableValues };
}

/**
 * Apply parameter values back to the state.
 */
function applyParams(state: GeometryState, params: SolverParams): void {
    for (const { pointId, coord, value } of params.pointCoords) {
        const point = state.points.get(pointId);
        if (point) {
            point[coord] = value;
        }
    }

    for (const { name, value } of params.variableValues) {
        const variable = state.variables.get(name);
        if (variable) {
            variable.value = value;
        }
    }
}

/**
 * Flatten params into a 1D array for the solver.
 */
function flattenParams(params: SolverParams): number[] {
    return [
        ...params.pointCoords.map(p => p.value),
        ...params.variableValues.map(v => v.value),
    ];
}

/**
 * Unflatten a 1D array back into params structure.
 */
function unflattenParams(flat: number[], template: SolverParams): SolverParams {
    const pointCoords = template.pointCoords.map((p, i) => ({
        ...p,
        value: flat[i],
    }));
    const variableValues = template.variableValues.map((v, i) => ({
        ...v,
        value: flat[template.pointCoords.length + i],
    }));
    return { pointCoords, variableValues };
}

// ============ GEOMETRY HELPERS ============

/**
 * Get circle center and radius from state.
 */
function getCircleCenterRadius(state: GeometryState, circleId: ID): { cx: number; cy: number; r: number } | null {
    const circle = state.circles.get(circleId);
    if (!circle) return null;

    if (circle.type === 'RADIUS' && circle.centerId && circle.radius) {
        const center = state.points.get(circle.centerId);
        if (!center) return null;
        return { cx: center.x, cy: center.y, r: circle.radius };
    } else if (circle.type === 'THREE_POINTS' && circle.pointIds.length === 3) {
        const [p1, p2, p3] = circle.pointIds.map(id => state.points.get(id));
        if (!p1 || !p2 || !p3) return null;

        // Calculate circumcircle from three points
        const ax = p1.x, ay = p1.y;
        const bx = p2.x, by = p2.y;
        const cx = p3.x, cy = p3.y;

        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(d) < 1e-10) return null;

        const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
        const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
        const r = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);

        return { cx: ux, cy: uy, r };
    }

    return null;
}

/**
 * Distance from point to line segment (for POINT_ON_SEGMENT).
 */
function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < SINGULARITY_EPSILON) {
        // Segment is essentially a point
        return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Check if angle is within arc range (CCW from start to end).
 */
function isAngleInArcRange(angle: number, startAngle: number, endAngle: number): boolean {
    // Normalize all angles to [0, 2π)
    const normalize = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const a = normalize(angle);
    const s = normalize(startAngle);
    const e = normalize(endAngle);

    if (s <= e) {
        return a >= s && a <= e;
    } else {
        // Arc crosses 0 angle
        return a >= s || a <= e;
    }
}

// ============ RESIDUAL COMPUTATION ============

/**
 * Compute the residual for a single constraint.
 */
function computeResidual(constraint: Constraint, state: GeometryState): number {
    switch (constraint.type) {
        case 'DISTANCE': {
            if (constraint.pointIds.length !== 2 || !constraint.expression) return 0;
            const [p1Id, p2Id] = constraint.pointIds;
            const p1 = state.points.get(p1Id);
            const p2 = state.points.get(p2Id);
            if (!p1 || !p2) return 0;

            const targetValue = evaluateExpression(constraint.expression, state.variables);
            if (targetValue === null) return 0;

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const actualDist = Math.sqrt(dx * dx + dy * dy);
            return actualDist - targetValue;
        }

        case 'ANGLE': {
            if (constraint.pointIds.length !== 2 || !constraint.expression) return 0;
            const [p1Id, p2Id] = constraint.pointIds;
            const p1 = state.points.get(p1Id);
            const p2 = state.points.get(p2Id);
            if (!p1 || !p2) return 0;

            const targetValue = evaluateExpression(constraint.expression, state.variables);
            if (targetValue === null) return 0;

            const actualAngle = Math.atan2(-(p2.y - p1.y), p2.x - p1.x) * 180 / Math.PI;
            let diff = actualAngle - targetValue;
            while (diff > 180) diff -= 360;
            while (diff < -180) diff += 360;
            return diff;
        }

        case 'POINT_ON_SEGMENT': {
            if (constraint.pointIds.length !== 1 || !constraint.targetId) return 0;
            const floatPt = state.points.get(constraint.pointIds[0]);
            const segment = state.segments.get(constraint.targetId);
            if (!floatPt || !segment) return 0;

            const p1 = state.points.get(segment.p1);
            const p2 = state.points.get(segment.p2);
            if (!p1 || !p2) return 0;

            return pointToSegmentDistance(floatPt.x, floatPt.y, p1.x, p1.y, p2.x, p2.y);
        }

        case 'POINT_ON_CIRCLE': {
            if (constraint.pointIds.length !== 1 || !constraint.targetId) return 0;
            const floatPt = state.points.get(constraint.pointIds[0]);
            const circleData = getCircleCenterRadius(state, constraint.targetId);
            if (!floatPt || !circleData) return 0;

            const distToCenter = Math.sqrt((floatPt.x - circleData.cx) ** 2 + (floatPt.y - circleData.cy) ** 2);
            return Math.abs(distToCenter - circleData.r);
        }

        case 'POINT_ON_ARC': {
            if (constraint.pointIds.length !== 1 || !constraint.targetId) return 0;
            const floatPt = state.points.get(constraint.pointIds[0]);
            const arc = state.arcs.get(constraint.targetId);
            if (!floatPt || !arc) return 0;

            const circleData = getCircleCenterRadius(state, arc.circleId);
            if (!circleData) return 0;

            const startPt = state.points.get(arc.startId);
            const endPt = state.points.get(arc.endId);
            if (!startPt || !endPt) return 0;

            // Distance from circle perimeter
            const distToCenter = Math.sqrt((floatPt.x - circleData.cx) ** 2 + (floatPt.y - circleData.cy) ** 2);
            const radialError = Math.abs(distToCenter - circleData.r);

            // Angular penalty for being outside arc range
            const pointAngle = Math.atan2(floatPt.y - circleData.cy, floatPt.x - circleData.cx);
            const startAngle = Math.atan2(startPt.y - circleData.cy, startPt.x - circleData.cx);
            const endAngle = Math.atan2(endPt.y - circleData.cy, endPt.x - circleData.cx);

            let angularPenalty = 0;
            if (!isAngleInArcRange(pointAngle, startAngle, endAngle)) {
                // Calculate angular distance to nearest endpoint
                const normalize = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
                const pa = normalize(pointAngle);
                const sa = normalize(startAngle);
                const ea = normalize(endAngle);
                const distToStart = Math.min(Math.abs(pa - sa), 2 * Math.PI - Math.abs(pa - sa));
                const distToEnd = Math.min(Math.abs(pa - ea), 2 * Math.PI - Math.abs(pa - ea));
                angularPenalty = Math.min(distToStart, distToEnd) * circleData.r; // Convert to arc length
            }

            return radialError + angularPenalty;
        }

        case 'EQUATION': {
            // Generic equation: expression should evaluate to 0
            if (!constraint.expression) return 0;
            const value = evaluateExpression(constraint.expression, state.variables);
            return value ?? 0;
        }

        default:
            return 0;
    }
}

/**
 * Compute residual vector for all constraints.
 */
function computeResiduals(state: GeometryState): number[] {
    return state.constraints.map(c => computeResidual(c, state));
}

// ============ JACOBIAN COMPUTATION ============

/**
 * Compute the Jacobian matrix numerically using finite differences.
 */
function computeJacobian(state: GeometryState, params: SolverParams): number[][] {
    const flatParams = flattenParams(params);
    const numParams = flatParams.length;
    const numConstraints = state.constraints.length;

    if (numParams === 0 || numConstraints === 0) {
        return [];
    }

    const jacobian: number[][] = [];

    // Get baseline residuals
    applyParams(state, params);
    const baseResiduals = computeResiduals(state);

    // Compute partial derivatives for each parameter
    for (let i = 0; i < numParams; i++) {
        const perturbedFlat = [...flatParams];
        // Use epsilon direction for singularity handling
        const epsilon = Math.max(NUMERICAL_EPSILON, Math.abs(flatParams[i]) * NUMERICAL_EPSILON);
        perturbedFlat[i] += epsilon;
        const perturbedParams = unflattenParams(perturbedFlat, params);
        applyParams(state, perturbedParams);
        const perturbedResiduals = computeResiduals(state);

        const column: number[] = [];
        for (let j = 0; j < numConstraints; j++) {
            const derivative = (perturbedResiduals[j] - baseResiduals[j]) / epsilon;
            // Handle NaN/Inf from singularities
            column.push(isFinite(derivative) ? derivative : 0);
        }
        jacobian.push(column);
    }

    // Restore original params
    applyParams(state, params);

    return jacobian;
}

// ============ LINEAR ALGEBRA HELPERS ============

function matMulTranspose(J: number[][]): number[][] {
    const n = J.length;
    if (n === 0) return [];
    const m = J[0].length;

    const result: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            let sum = 0;
            for (let k = 0; k < m; k++) {
                sum += J[i][k] * J[j][k];
            }
            result[i][j] = sum;
        }
    }

    return result;
}

function matVecMulTranspose(J: number[][], r: number[]): number[] {
    const n = J.length;
    if (n === 0) return [];
    const result: number[] = Array(n).fill(0);

    for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = 0; k < r.length; k++) {
            sum += J[i][k] * r[k];
        }
        result[i] = sum;
    }

    return result;
}

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
    const n = A.length;
    if (n === 0) return [];

    const aug: number[][] = A.map((row, i) => [...row, b[i]]);

    for (let i = 0; i < n; i++) {
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) {
                maxRow = k;
            }
        }
        [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];

        if (Math.abs(aug[i][i]) < 1e-12) {
            continue;
        }

        for (let k = i + 1; k < n; k++) {
            const c = aug[k][i] / aug[i][i];
            for (let j = i; j <= n; j++) {
                aug[k][j] -= c * aug[i][j];
            }
        }
    }

    const x: number[] = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        if (Math.abs(aug[i][i]) < 1e-12) continue;
        x[i] = aug[i][n];
        for (let j = i + 1; j < n; j++) {
            x[i] -= aug[i][j] * x[j];
        }
        x[i] /= aug[i][i];
    }

    return x;
}

function vecNorm(v: number[]): number {
    return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
}

function vecAdd(a: number[], b: number[]): number[] {
    return a.map((x, i) => x + b[i]);
}

function vecScale(v: number[], s: number): number[] {
    return v.map(x => x * s);
}

// ============ MAIN SOLVER ============

export interface SolverResult {
    success: boolean;
    iterations: number;
    finalError: number;
}

/**
 * Run the Levenberg-Marquardt solver to satisfy all constraints.
 */
export function solve(state: GeometryState): SolverResult {
    if (state.constraints.length === 0) {
        return { success: true, iterations: 0, finalError: 0 };
    }

    let params = extractFreeParams(state);
    let flatParams = flattenParams(params);
    const numParams = flatParams.length;

    if (numParams === 0) {
        applyParams(state, params);
        const residuals = computeResiduals(state);
        const error = vecNorm(residuals);
        return { success: error < CONVERGENCE_THRESHOLD, iterations: 0, finalError: error };
    }

    let lambda = LAMBDA_INITIAL;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        applyParams(state, params);
        const residuals = computeResiduals(state);
        const error = vecNorm(residuals);

        if (error < CONVERGENCE_THRESHOLD) {
            return { success: true, iterations: iter, finalError: error };
        }

        const J = computeJacobian(state, params);
        if (J.length === 0) break;

        const JtJ = matMulTranspose(J);
        const Jtr = matVecMulTranspose(J, residuals);

        for (let i = 0; i < numParams; i++) {
            JtJ[i][i] += lambda * Math.max(JtJ[i][i], 1e-6);
        }

        const negJtr = vecScale(Jtr, -1);
        const delta = solveLinearSystem(JtJ, negJtr);
        if (!delta) break;

        const newFlatParams = vecAdd(flatParams, delta);
        const newParams = unflattenParams(newFlatParams, params);
        applyParams(state, newParams);
        const newResiduals = computeResiduals(state);
        const newError = vecNorm(newResiduals);

        if (newError < error) {
            flatParams = newFlatParams;
            params = newParams;
            lambda *= LAMBDA_DOWN;
        } else {
            lambda *= LAMBDA_UP;
            applyParams(state, params);
        }
    }

    const finalResiduals = computeResiduals(state);
    return {
        success: false,
        iterations: MAX_ITERATIONS,
        finalError: vecNorm(finalResiduals),
    };
}

/**
 * Validate if a constraint can be satisfied (trial solve).
 * Returns true if the solver converges, false if impossible.
 */
export function validateConstraint(state: GeometryState, newConstraint: Constraint): boolean {
    // Clone the state for trial
    const trialState: GeometryState = {
        points: new Map(Array.from(state.points.entries()).map(([id, p]) => [id, { ...p }])),
        segments: new Map(state.segments),
        circles: new Map(state.circles),
        arcs: new Map(state.arcs),
        variables: new Map(Array.from(state.variables.entries()).map(([name, v]) => [name, { ...v }])),
        constraints: [...state.constraints, newConstraint],
        selectedIds: [],
        activeTool: state.activeTool,
        measureHistory: [],
        zoom: state.zoom,
        offset: state.offset,
    };

    const result = solve(trialState);
    return result.success;
}
