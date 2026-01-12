import { useEffect, useRef, useState, useCallback } from 'react';
import paper from 'paper';
import type {
  GeometryState,
  ToolType,
  Point,
  ID,
  Segment,
  Circle,
} from './types';
import {
  createInitialState,
  addPoint,
  addSegmentTwoPoints,
  addSegmentAbsAngle,
  addSegmentRelAngle,
  addCircleRadius,
  addCircleCircumference,
  addCircleThreePoints,
  deleteEntity,
  setActiveTool,
  addToMeasureHistory,
  clearMeasureHistory,
  findAllIntersections,
} from './state';
import './index.css';

// Scale factor: multiply logical units by this to get screen pixels
// For 5-100 unit range, scale up significantly
const SCALE = 10;

const COLORS = {
  bg: '#61707d',
  primary: '#40f99b',
  highlight: '#e85d75',
  area: 'rgba(157, 105, 163, 0.2)',
  areaBorder: '#9d69a3',
  text: '#f5fbef',
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<GeometryState>(createInitialState);
  const [hudMode, setHudMode] = useState<'none' | 'radius' | 'circumference' | 'threepoint' | 'absAngle' | 'relAngle'>('none');
  const [hudInput, setHudInput] = useState<{ radius?: string; angle?: string; length?: string }>({});
  const [pendingCircleCenter, setPendingCircleCenter] = useState<ID | null>(null);
  const [pendingThreePoints, setPendingThreePoints] = useState<ID[]>([]);
  const [pendingSegmentStart, setPendingSegmentStart] = useState<ID | null>(null);
  const [pendingRefSegment, setPendingRefSegment] = useState<ID | null>(null);
  const [measureResult, setMeasureResult] = useState<{ type: 'length' | 'area'; value: number } | null>(null);

  const renderScene = useCallback(() => {
    if (!paper.project) return;
    paper.project.clear();

    const { points, segments, circles, selectedIds, activeTool, measureHistory } = state;

    // Draw Circles
    circles.forEach((circle) => {
      let center: { x: number; y: number } | undefined;
      let radius = circle.radius || 0;

      if (circle.type === 'RADIUS' && circle.centerId) {
        const cp = points.get(circle.centerId);
        if (cp) center = { x: cp.x, y: cp.y };
      } else if (circle.type === 'THREE_POINTS' && circle.pointIds.length === 3) {
        const [p1, p2, p3] = circle.pointIds.map((id) => points.get(id)).filter(Boolean) as Point[];
        if (p1 && p2 && p3) {
          const { cx, cy, r } = calcCircumcircle(p1, p2, p3);
          center = { x: cx, y: cy };
          radius = r;
        }
      }

      if (center && radius > 0) {
        const c = new paper.Path.Circle(new paper.Point(center.x * SCALE, center.y * SCALE), radius * SCALE);
        c.strokeColor = new paper.Color(COLORS.primary);
        c.strokeWidth = 2;
        c.fillColor = null;
      }
    });

    // Draw Segments
    segments.forEach((seg) => {
      const p1 = points.get(seg.p1);
      const p2 = points.get(seg.p2);
      if (p1 && p2) {
        const line = new paper.Path.Line(new paper.Point(p1.x * SCALE, p1.y * SCALE), new paper.Point(p2.x * SCALE, p2.y * SCALE));
        line.strokeColor = new paper.Color(COLORS.primary);
        line.strokeWidth = 2;
      }
    });

    // Draw Points
    points.forEach((pt) => {
      const isSelected = selectedIds.includes(pt.id);
      const dot = new paper.Path.Circle(new paper.Point(pt.x * SCALE, pt.y * SCALE), 6);
      dot.fillColor = new paper.Color(isSelected ? COLORS.highlight : COLORS.highlight);
      dot.strokeColor = isSelected ? new paper.Color('#fff') : null;
      dot.strokeWidth = isSelected ? 2 : 0;

      const label = new paper.PointText(new paper.Point(pt.x * SCALE + 10, pt.y * SCALE - 10));
      label.content = pt.label;
      label.fillColor = new paper.Color(COLORS.text);
      label.fontSize = 14;
      label.fontWeight = 'bold';
    });

    // Draw Measure Path (supports arcs as boundaries)
    if (activeTool === 'MEASURE' && measureHistory.length > 0) {
      const path = new paper.Path();
      path.strokeColor = new paper.Color(COLORS.areaBorder);
      path.strokeWidth = 2;
      path.dashArray = [5, 5];

      let pointCount = 0;
      for (let i = 0; i < measureHistory.length; i++) {
        const item = measureHistory[i];
        if (item.type === 'point') {
          const pt = points.get(item.id);
          if (pt) {
            if (path.segments.length === 0) {
              path.moveTo(new paper.Point(pt.x * SCALE, pt.y * SCALE));
            } else {
              path.lineTo(new paper.Point(pt.x * SCALE, pt.y * SCALE));
            }
            pointCount++;
          }
        } else if (item.type === 'arc' && item.toId) {
          // Draw an arc from fromId to toId along the circle
          const fromPt = points.get(item.fromId);
          const toPt = points.get(item.toId);
          const circle = circles.get(item.circleId);
          if (fromPt && toPt && circle) {
            const center = getCircleCenter(circle, points);
            const radius = circle.radius || 0;
            if (center && radius > 0) {
              // Use Paper.js arcTo with "through" point on the circle
              const midAngle = (Math.atan2(fromPt.y - center.y, fromPt.x - center.x) +
                Math.atan2(toPt.y - center.y, toPt.x - center.x)) / 2;
              const throughX = center.x + radius * Math.cos(midAngle);
              const throughY = center.y + radius * Math.sin(midAngle);
              path.arcTo(
                new paper.Point(throughX * SCALE, throughY * SCALE),
                new paper.Point(toPt.x * SCALE, toPt.y * SCALE)
              );
              pointCount++;
            }
          }
        }
      }

      if (pointCount >= 3) {
        path.closed = true;
        path.fillColor = new paper.Color(COLORS.area);
      }
    }

    paper.view.update();
  }, [state]);

  useEffect(() => {
    if (canvasRef.current) {
      paper.setup(canvasRef.current);
      paper.view.viewSize = new paper.Size(canvasRef.current.offsetWidth, canvasRef.current.offsetHeight);
    }
  }, []);

  useEffect(() => {
    renderScene();
  }, [renderScene]);

  useEffect(() => {
    // Calculate measurement results
    const { measureHistory, points, circles } = state;
    if (measureHistory.length < 1) {
      setMeasureResult(null);
      return;
    }

    // Count unique coordinates and calculate measurements
    let totalLength = 0;
    let hasArc = false;
    const coords: { x: number; y: number }[] = [];
    let arcSegmentArea = 0; // Area of circular segments from arcs

    for (let i = 0; i < measureHistory.length; i++) {
      const item = measureHistory[i];
      if (item.type === 'point') {
        const pt = points.get(item.id);
        if (pt) {
          // Add straight line distance from previous point
          if (coords.length > 0) {
            const prev = coords[coords.length - 1];
            totalLength += Math.sqrt((pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2);
          }
          coords.push({ x: pt.x, y: pt.y });
        }
      } else if (item.type === 'arc' && item.toId) {
        hasArc = true;
        const fromPt = points.get(item.fromId);
        const toPt = points.get(item.toId);
        const circle = circles.get(item.circleId);
        if (fromPt && toPt && circle) {
          const center = getCircleCenter(circle, points);
          const radius = circle.radius || 0;
          if (center && radius > 0) {
            // Calculate arc angle and length
            const angle1 = Math.atan2(fromPt.y - center.y, fromPt.x - center.x);
            const angle2 = Math.atan2(toPt.y - center.y, toPt.x - center.x);
            let arcAngle = angle2 - angle1;
            // Normalize to [0, 2π] - take shorter arc
            if (arcAngle < 0) arcAngle += 2 * Math.PI;
            if (arcAngle > Math.PI) arcAngle = 2 * Math.PI - arcAngle;

            const arcLength = radius * arcAngle;
            totalLength += arcLength;

            // Calculate circular segment area (for polygon area adjustment)
            // Segment area = (r²/2)(θ - sin(θ))
            const segmentArea = (radius * radius / 2) * (arcAngle - Math.sin(arcAngle));
            arcSegmentArea += segmentArea;

            // Add the endpoint to coords for polygon calculation
            coords.push({ x: toPt.x, y: toPt.y });
          }
        }
      }
    }

    if (coords.length === 2 && !hasArc) {
      // Simple 2-point distance
      const len = Math.sqrt((coords[1].x - coords[0].x) ** 2 + (coords[1].y - coords[0].y) ** 2);
      setMeasureResult({ type: 'length', value: len });
    } else if (coords.length === 2 && hasArc) {
      // Arc length between 2 points
      setMeasureResult({ type: 'length', value: totalLength });
    } else if (coords.length >= 3) {
      // Polygon area = shoelace + circular segment areas
      const polygonArea = shoelaceArea(coords);
      const totalArea = polygonArea + arcSegmentArea;
      setMeasureResult({ type: 'area', value: totalArea });
    } else {
      setMeasureResult(null);
    }
  }, [state.measureHistory, state.points, state.circles]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert screen coords to logical coords
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const x = screenX / SCALE;
    const y = screenY / SCALE;

    const newState = { ...state, points: new Map(state.points), segments: new Map(state.segments), circles: new Map(state.circles), selectedIds: [...state.selectedIds], measureHistory: [...state.measureHistory] };

    const hitPoint = findPointAt(newState, x, y);

    switch (state.activeTool) {
      case 'POINT':
        addPoint(newState, x, y);
        break;
      case 'SELECT':
        if (hitPoint) {
          newState.selectedIds = [hitPoint.id];
        } else {
          newState.selectedIds = [];
        }
        break;
      case 'SEGMENT':
        if (hitPoint) {
          if (pendingSegmentStart === null) {
            setPendingSegmentStart(hitPoint.id);
          } else {
            addSegmentTwoPoints(newState, pendingSegmentStart, hitPoint.id);
            setPendingSegmentStart(null);
          }
        } else {
          // Clicked on empty space - check if we can find a segment for relative angle
          const hitSeg = findSegmentAt(newState, x, y);
          if (hitSeg && pendingSegmentStart && hudMode === 'none') {
            setPendingRefSegment(hitSeg.id);
            setHudMode('relAngle');
          }
        }
        break;
      case 'CIRCLE':
        if (hudMode === 'none') {
          if (hitPoint) {
            setPendingCircleCenter(hitPoint.id);
            setHudMode('circumference'); // Start in circumference mode - can click another point or enter radius
          }
        } else if (hudMode === 'circumference') {
          // In circumference mode - clicking a point creates circle with that radius
          if (hitPoint && pendingCircleCenter && hitPoint.id !== pendingCircleCenter) {
            addCircleCircumference(newState, pendingCircleCenter, hitPoint.id);
            setPendingCircleCenter(null);
            setHudMode('none');
          }
        } else if (hudMode === 'threepoint') {
          if (hitPoint) {
            const newPending = [...pendingThreePoints, hitPoint.id];
            setPendingThreePoints(newPending);
            if (newPending.length === 3) {
              addCircleThreePoints(newState, newPending[0], newPending[1], newPending[2]);
              setPendingThreePoints([]);
              setHudMode('none');
            }
          }
        }
        break;
      case 'MEASURE':
        if (hitPoint) {
          // Check if we're completing an arc: last item was a circle with pending fromId
          const lastItem = newState.measureHistory[newState.measureHistory.length - 1];
          if (lastItem && lastItem.type === 'arc' && lastItem.toId === '') {
            // Complete the arc with this point as the end
            const completedArc = { ...lastItem, toId: hitPoint.id };
            newState.measureHistory[newState.measureHistory.length - 1] = completedArc;
          } else {
            // Normal point selection
            addToMeasureHistory(newState, { type: 'point', id: hitPoint.id });
          }
        } else {
          // Check if we clicked on a circle (for arc selection)
          const hitCircle = findCircleAt(newState, x, y);
          if (hitCircle) {
            // Get the last point from history to use as arc start
            const lastItem = newState.measureHistory[newState.measureHistory.length - 1];
            if (lastItem && lastItem.type === 'point') {
              // Start an arc from the last point - toId will be filled on next point click
              addToMeasureHistory(newState, { type: 'arc', circleId: hitCircle.id, fromId: lastItem.id, toId: '' });
            }
          }
        }
        break;
    }

    // Automatically detect and create intersection points
    findAllIntersections(newState);

    setState(newState);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedIds.length > 0) {
        const newState = { ...state, points: new Map(state.points), segments: new Map(state.segments), circles: new Map(state.circles), selectedIds: [], measureHistory: [...state.measureHistory] };
        state.selectedIds.forEach((id) => deleteEntity(newState, id));
        setState(newState);
      }
    } else if (e.key === 'Escape') {
      setPendingSegmentStart(null);
      setPendingCircleCenter(null);
      setPendingThreePoints([]);
      setPendingRefSegment(null);
      setHudMode('none');
      const newState = { ...state };
      clearMeasureHistory(newState);
      setState(newState);
    } else if (e.key === 'a' || e.key === 'A') {
      // Open absolute angle HUD if we have a pending segment start
      if (pendingSegmentStart && hudMode === 'none') {
        e.preventDefault();
        setHudMode('absAngle');
      }
    } else if (e.key === 'r' || e.key === 'R') {
      // Switch from circumference mode to radius input
      if (pendingCircleCenter && hudMode === 'circumference') {
        e.preventDefault();
        setHudMode('radius');
      }
    }
  }, [state, pendingSegmentStart, pendingCircleCenter, hudMode]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleToolClick = (tool: ToolType) => {
    const newState = { ...state };
    setActiveTool(newState, tool);
    setState(newState);
    setPendingSegmentStart(null);
    setPendingCircleCenter(null);
    setPendingThreePoints([]);
    setPendingRefSegment(null);
    setHudMode('none');
    setMeasureResult(null);
  };

  const handleRadiusSubmit = () => {
    if (pendingCircleCenter && hudInput.radius) {
      const r = parseFloat(hudInput.radius);
      if (!isNaN(r) && r > 0) {
        const newState = { ...state, points: new Map(state.points), segments: new Map(state.segments), circles: new Map(state.circles), selectedIds: [...state.selectedIds], measureHistory: [...state.measureHistory] };
        addCircleRadius(newState, pendingCircleCenter, r);
        findAllIntersections(newState);
        setState(newState);
      }
    }
    setHudMode('none');
    setPendingCircleCenter(null);
    setHudInput({});
  };

  const handleAbsAngleSubmit = () => {
    if (pendingSegmentStart && hudInput.angle && hudInput.length) {
      const angle = parseFloat(hudInput.angle);
      const length = parseFloat(hudInput.length);
      if (!isNaN(angle) && !isNaN(length) && length > 0) {
        const newState = { ...state, points: new Map(state.points), segments: new Map(state.segments), circles: new Map(state.circles), selectedIds: [...state.selectedIds], measureHistory: [...state.measureHistory] };
        addSegmentAbsAngle(newState, pendingSegmentStart, angle, length);
        findAllIntersections(newState);
        setState(newState);
      }
    }
    setHudMode('none');
    setPendingSegmentStart(null);
    setHudInput({});
  };

  const handleRelAngleSubmit = () => {
    if (pendingSegmentStart && pendingRefSegment && hudInput.angle && hudInput.length) {
      const angle = parseFloat(hudInput.angle);
      const length = parseFloat(hudInput.length);
      if (!isNaN(angle) && !isNaN(length) && length > 0) {
        const newState = { ...state, points: new Map(state.points), segments: new Map(state.segments), circles: new Map(state.circles), selectedIds: [...state.selectedIds], measureHistory: [...state.measureHistory] };
        addSegmentRelAngle(newState, pendingSegmentStart, pendingRefSegment, angle, length);
        findAllIntersections(newState);
        setState(newState);
      }
    }
    setHudMode('none');
    setPendingSegmentStart(null);
    setPendingRefSegment(null);
    setHudInput({});
  };

  const startThreePointCircle = () => {
    setHudMode('threepoint');
    setPendingCircleCenter(null);
    setPendingThreePoints([]);
  };

  return (
    <div className="app-container">
      <div className="toolbar">
        {(['SELECT', 'POINT', 'SEGMENT', 'CIRCLE', 'MEASURE'] as ToolType[]).map((tool) => (
          <button
            key={tool}
            className={state.activeTool === tool ? 'active' : ''}
            onClick={() => handleToolClick(tool)}
          >
            {tool}
          </button>
        ))}
        <button onClick={startThreePointCircle} style={{ marginLeft: 'auto' }}>
          3-Point Circle
        </button>
      </div>
      <div className="canvas-container">
        <canvas ref={canvasRef} id="geometry-canvas" onClick={handleCanvasClick} />
        {measureResult && (
          <div className="measurement-overlay">
            <div className="label">{measureResult.type === 'length' ? 'Length' : 'Area'}</div>
            <div className="value">{measureResult.value.toFixed(2)}</div>
          </div>
        )}
        {hudMode === 'radius' && (
          <div className="hud-modal">
            <h3>Enter Radius</h3>
            <input
              type="number"
              placeholder="Radius"
              value={hudInput.radius || ''}
              onChange={(e) => setHudInput({ radius: e.target.value })}
              autoFocus
            />
            <button onClick={handleRadiusSubmit}>Create Circle</button>
          </div>
        )}
        {hudMode === 'circumference' && (
          <div className="measurement-overlay">
            <div className="label">Circle Mode</div>
            <div className="value">Click circumference point or press R for radius input</div>
          </div>
        )}
        {hudMode === 'threepoint' && (
          <div className="measurement-overlay">
            <div className="label">Select 3 Points</div>
            <div className="value">{pendingThreePoints.length} / 3</div>
          </div>
        )}
        {hudMode === 'absAngle' && (
          <div className="hud-modal">
            <h3>Absolute Angle Segment</h3>
            <input
              type="number"
              placeholder="Angle (degrees)"
              value={hudInput.angle || ''}
              onChange={(e) => setHudInput({ ...hudInput, angle: e.target.value })}
              autoFocus
            />
            <input
              type="number"
              placeholder="Length"
              value={hudInput.length || ''}
              onChange={(e) => setHudInput({ ...hudInput, length: e.target.value })}
            />
            <button onClick={handleAbsAngleSubmit}>Create Segment</button>
          </div>
        )}
        {hudMode === 'relAngle' && (
          <div className="hud-modal">
            <h3>Relative Angle Segment</h3>
            <input
              type="number"
              placeholder="Angle offset (degrees)"
              value={hudInput.angle || ''}
              onChange={(e) => setHudInput({ ...hudInput, angle: e.target.value })}
              autoFocus
            />
            <input
              type="number"
              placeholder="Length"
              value={hudInput.length || ''}
              onChange={(e) => setHudInput({ ...hudInput, length: e.target.value })}
            />
            <button onClick={handleRelAngleSubmit}>Create Segment</button>
          </div>
        )}
        {pendingSegmentStart && hudMode === 'none' && (
          <div className="measurement-overlay">
            <div className="label">Segment Mode</div>
            <div className="value">Click P2 or press A for angle</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper functions
// Thresholds are in logical units (screen pixels / SCALE)
function findPointAt(state: GeometryState, x: number, y: number, threshold = 1.5): Point | null {
  for (const pt of state.points.values()) {
    const dist = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
    if (dist <= threshold) return pt;
  }
  return null;
}

function findSegmentAt(state: GeometryState, x: number, y: number, threshold = 1): Segment | null {
  for (const seg of state.segments.values()) {
    const p1 = state.points.get(seg.p1);
    const p2 = state.points.get(seg.p2);
    if (!p1 || !p2) continue;

    // Distance from point to line segment
    const dist = pointToSegmentDist(x, y, p1.x, p1.y, p2.x, p2.y);
    if (dist <= threshold) return seg;
  }
  return null;
}

function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function findCircleAt(state: GeometryState, x: number, y: number, threshold = 1): Circle | null {
  for (const circle of state.circles.values()) {
    let center: { x: number; y: number } | null = null;
    let radius = circle.radius || 0;

    if (circle.type === 'RADIUS' && circle.centerId) {
      const cp = state.points.get(circle.centerId);
      if (cp) center = { x: cp.x, y: cp.y };
    } else if (circle.type === 'THREE_POINTS' && circle.pointIds.length === 3) {
      const [p1, p2, p3] = circle.pointIds.map((id) => state.points.get(id)).filter(Boolean) as Point[];
      if (p1 && p2 && p3) {
        const { cx, cy, r } = calcCircumcircle(p1, p2, p3);
        center = { x: cx, y: cy };
        radius = r;
      }
    }

    if (center && radius > 0) {
      // Check if click is near the circle's perimeter
      const distToCenter = Math.sqrt((x - center.x) ** 2 + (y - center.y) ** 2);
      const distToPerimeter = Math.abs(distToCenter - radius);
      if (distToPerimeter <= threshold) return circle;
    }
  }
  return null;
}

function getCircleCenter(circle: Circle, points: Map<ID, Point>): { x: number; y: number } | null {
  if (circle.type === 'RADIUS' && circle.centerId) {
    const cp = points.get(circle.centerId);
    if (cp) return { x: cp.x, y: cp.y };
  } else if (circle.type === 'THREE_POINTS' && circle.pointIds.length === 3) {
    const [p1, p2, p3] = circle.pointIds.map((id) => points.get(id)).filter(Boolean) as Point[];
    if (p1 && p2 && p3) {
      const { cx, cy } = calcCircumcircle(p1, p2, p3);
      return { x: cx, y: cy };
    }
  }
  return null;
}

function calcCircumcircle(p1: Point, p2: Point, p3: Point): { cx: number; cy: number; r: number } {
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-10) return { cx: NaN, cy: NaN, r: NaN };

  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);

  return { cx: ux, cy: uy, r };
}

function shoelaceArea(coords: { x: number; y: number }[]): number {
  let sum = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += coords[i].x * coords[j].y;
    sum -= coords[j].x * coords[i].y;
  }
  return Math.abs(sum) / 2;
}

export default App;
