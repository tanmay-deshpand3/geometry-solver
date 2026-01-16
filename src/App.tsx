import { useEffect, useRef, useState, useCallback } from 'react';
import paper from 'paper';
import type {
  GeometryState,
  ToolType,
  Point,
  ID,
  Segment,
  Circle,
  Constraint,
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
  addVariable,
  addConstraint,
  generateId,
} from './state';
import { solve, validateConstraint } from './solver';
import './index.css';

// Zoom constraints
const MIN_SCALE = 2;
const MAX_SCALE = 50;
const ZOOM_STEP = 2;

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
  const [scale, setScale] = useState(10); // Zoom level
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 }); // Pan offset in screen pixels
  const [hudMode, setHudMode] = useState<'none' | 'radius' | 'circumference' | 'threepoint' | 'absAngle' | 'relAngle'>('none');
  const [hudInput, setHudInput] = useState<{ radius?: string; angle?: string; length?: string }>({});
  const [pendingCircleCenter, setPendingCircleCenter] = useState<ID | null>(null);
  const [pendingThreePoints, setPendingThreePoints] = useState<ID[]>([]);
  const [pendingSegmentStart, setPendingSegmentStart] = useState<ID | null>(null);
  const [pendingRefSegment, setPendingRefSegment] = useState<ID | null>(null);
  const [measureResult, setMeasureResult] = useState<{ type: 'length' | 'area'; value: number; isDetermined: boolean } | null>(null);

  // Panel visibility
  const [showVariablesPanel, setShowVariablesPanel] = useState(false);
  const [showEquationsPanel, setShowEquationsPanel] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarValue, setNewVarValue] = useState('');

  // Point selection popup for overlapping points
  const [pointSelectionPopup, setPointSelectionPopup] = useState<{
    points: Point[];
    screenX: number;
    screenY: number;
  } | null>(null);

  // Advanced constraint dialog
  const [constraintDialog, setConstraintDialog] = useState<{
    type: 'DISTANCE' | 'ANGLE' | 'EQUATION';
    pointIds: ID[];  // Selected points for the constraint
    expression: string;
  } | null>(null);

  const renderScene = useCallback(() => {
    if (!paper.project) return;
    paper.project.clear();

    // Apply pan offset by translating the view
    paper.view.matrix.reset();
    paper.view.matrix.translate(panOffset.x, panOffset.y);

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
        const c = new paper.Path.Circle(new paper.Point(center.x * scale, center.y * scale), radius * scale);
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
        const line = new paper.Path.Line(new paper.Point(p1.x * scale, p1.y * scale), new paper.Point(p2.x * scale, p2.y * scale));
        line.strokeColor = new paper.Color(COLORS.primary);
        line.strokeWidth = 2;
      }
    });

    // Draw Points
    points.forEach((pt) => {
      const isSelected = selectedIds.includes(pt.id);
      const dot = new paper.Path.Circle(new paper.Point(pt.x * scale, pt.y * scale), 6);

      if (pt.isFloating) {
        // Floating points have hollow/dashed appearance
        dot.fillColor = null;
        dot.strokeColor = new paper.Color(COLORS.highlight);
        dot.strokeWidth = 2;
        dot.dashArray = [3, 2];
      } else {
        dot.fillColor = new paper.Color(COLORS.highlight);
        dot.strokeColor = isSelected ? new paper.Color('#fff') : null;
        dot.strokeWidth = isSelected ? 2 : 0;
      }

      const label = new paper.PointText(new paper.Point(pt.x * scale + 10, pt.y * scale - 10));
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
              path.moveTo(new paper.Point(pt.x * scale, pt.y * scale));
            } else {
              path.lineTo(new paper.Point(pt.x * scale, pt.y * scale));
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
              // Use the click angle as the "through" point to determine which arc
              const throughX = center.x + radius * Math.cos(item.clickAngle);
              const throughY = center.y + radius * Math.sin(item.clickAngle);
              path.arcTo(
                new paper.Point(throughX * scale, throughY * scale),
                new paper.Point(toPt.x * scale, toPt.y * scale)
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
  }, [state, scale, panOffset]);

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
    let hasFloatingPoint = false; // Track if any point in measurement is floating

    for (let i = 0; i < measureHistory.length; i++) {
      const item = measureHistory[i];
      if (item.type === 'point') {
        const pt = points.get(item.id);
        if (pt) {
          // Track if this point is floating (not determined)
          if (pt.isFloating) hasFloatingPoint = true;
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
          // Track floating points
          if (fromPt.isFloating) hasFloatingPoint = true;
          if (toPt.isFloating) hasFloatingPoint = true;

          const center = getCircleCenter(circle, points);
          const radius = circle.radius || 0;
          if (center && radius > 0) {
            // Calculate arc angle and length based on click position
            const angle1 = Math.atan2(fromPt.y - center.y, fromPt.x - center.x);
            const angle2 = Math.atan2(toPt.y - center.y, toPt.x - center.x);
            const clickAngle = item.clickAngle;

            // Determine if clickAngle is on the "short" arc (from angle1 to angle2 counterclockwise)
            // or on the "long" arc (the other way around)
            let arcAngle: number;

            // Normalize angles to [0, 2π]
            const normalizeAngle = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            const a1 = normalizeAngle(angle1);
            const a2 = normalizeAngle(angle2);
            const ac = normalizeAngle(clickAngle);

            // Check if click is on the CCW arc from a1 to a2
            const isClickOnCCWArc = (a1 <= a2)
              ? (ac >= a1 && ac <= a2)
              : (ac >= a1 || ac <= a2);

            // Calculate CCW arc angle from a1 to a2
            let ccwArc = a2 - a1;
            if (ccwArc < 0) ccwArc += 2 * Math.PI;

            // Choose the arc based on where user clicked
            if (isClickOnCCWArc) {
              arcAngle = ccwArc;
            } else {
              arcAngle = 2 * Math.PI - ccwArc;
            }

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

    // isDetermined = true if NO floating points are involved
    const isDetermined = !hasFloatingPoint;

    if (coords.length === 2 && !hasArc) {
      // Simple 2-point distance
      const len = Math.sqrt((coords[1].x - coords[0].x) ** 2 + (coords[1].y - coords[0].y) ** 2);
      setMeasureResult({ type: 'length', value: len, isDetermined });
    } else if (coords.length === 2 && hasArc) {
      // Arc length between 2 points
      setMeasureResult({ type: 'length', value: totalLength, isDetermined });
    } else if (coords.length >= 3) {
      // Polygon area = shoelace + circular segment areas
      const polygonArea = shoelaceArea(coords);
      const totalArea = polygonArea + arcSegmentArea;
      setMeasureResult({ type: 'area', value: totalArea, isDetermined });
    } else {
      setMeasureResult(null);
    }
  }, [state.measureHistory, state.points, state.circles]);

  // Handle keyboard interaction
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const PAN_SPEED = 20;
      switch (e.key) {
        case 'ArrowUp':
          setPanOffset(prev => ({ ...prev, y: prev.y + PAN_SPEED }));
          break;
        case 'ArrowDown':
          setPanOffset(prev => ({ ...prev, y: prev.y - PAN_SPEED }));
          break;
        case 'ArrowLeft':
          setPanOffset(prev => ({ ...prev, x: prev.x + PAN_SPEED }));
          break;
        case 'ArrowRight':
          setPanOffset(prev => ({ ...prev, x: prev.x - PAN_SPEED }));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert screen coords to logical coords
    // Apply pan offset correction
    const screenX = e.clientX - rect.left - panOffset.x;
    const screenY = e.clientY - rect.top - panOffset.y;
    const x = screenX / scale;
    const y = screenY / scale;

    const newState = {
      ...state,
      points: new Map(state.points),
      segments: new Map(state.segments),
      circles: new Map(state.circles),
      arcs: new Map(state.arcs),
      variables: new Map(state.variables),
      constraints: [...state.constraints],
      selectedIds: [...state.selectedIds],
      measureHistory: [...state.measureHistory]
    };

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
              // Calculate click angle relative to circle center
              const center = getCircleCenter(hitCircle, newState.points);
              let clickAngle = 0;
              if (center) {
                clickAngle = Math.atan2(y - center.y, x - center.x);
              }
              // Start an arc from the last point - toId will be filled on next point click
              addToMeasureHistory(newState, { type: 'arc', circleId: hitCircle.id, fromId: lastItem.id, toId: '', clickAngle });
            }
          }
        }
        break;
      case 'CONSTRAINT':
        // Constraint tool: select point first, then target (segment/circle/arc)
        // Use findAllPointsAt to detect overlapping points
        const nearbyPoints = findAllPointsAt(newState, x, y);

        if (nearbyPoints.length > 1) {
          // Multiple points near click - show selection popup
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
            setPointSelectionPopup({
              points: nearbyPoints,
              screenX: e.clientX - rect.left,
              screenY: e.clientY - rect.top,
            });
          }
        } else if (nearbyPoints.length === 1) {
          const hitPoint = nearbyPoints[0];
          // Toggle selection of the point
          if (newState.selectedIds.includes(hitPoint.id)) {
            newState.selectedIds = newState.selectedIds.filter(id => id !== hitPoint.id);
          } else {
            newState.selectedIds = [...newState.selectedIds, hitPoint.id];

            // Check if we now have 2 points selected -> show constraint dialog
            if (newState.selectedIds.length === 2) {
              setConstraintDialog({
                type: 'DISTANCE',
                pointIds: [...newState.selectedIds],
                expression: '',
              });
            }
          }
        } else {
          // Check if clicked on a segment or circle to add constraint
          const hitSeg = findSegmentAt(newState, x, y);
          const hitCircle = findCircleAt(newState, x, y);

          if (newState.selectedIds.length === 1) {
            const selectedPointId = newState.selectedIds[0];
            const selectedPoint = newState.points.get(selectedPointId);

            if (selectedPoint && hitSeg) {
              // Check if point is on segment endpoints - don't constrain endpoint to its own segment
              if (hitSeg.p1 === selectedPointId || hitSeg.p2 === selectedPointId) {
                console.warn('Cannot constrain segment endpoint to its own segment');
                newState.selectedIds = [];
              } else {
                // Create POINT_ON_SEGMENT constraint
                const newConstraint: Constraint = {
                  id: generateId(),
                  type: 'POINT_ON_SEGMENT',
                  pointIds: [selectedPointId],
                  targetId: hitSeg.id,
                };

                // Trial solve to validate BEFORE marking as floating
                const wasFloating = selectedPoint.isFloating;
                selectedPoint.isFloating = true; // Temporarily set for validation

                if (validateConstraint(newState, newConstraint)) {
                  addConstraint(newState, newConstraint);
                  // Run solver to snap the point
                  solve(newState);
                } else {
                  // Revert floating status if validation failed
                  selectedPoint.isFloating = wasFloating;
                  console.warn('Constraint validation failed - impossible constraint');
                }
                newState.selectedIds = [];
              }
            } else if (selectedPoint && hitCircle) {
              // Check if point is the circle center - don't constrain center to its own circle
              if (hitCircle.centerId === selectedPointId || hitCircle.pointIds.includes(selectedPointId)) {
                console.warn('Cannot constrain circle defining point to its own circle');
                newState.selectedIds = [];
              } else {
                // Create POINT_ON_CIRCLE constraint
                const newConstraint: Constraint = {
                  id: generateId(),
                  type: 'POINT_ON_CIRCLE',
                  pointIds: [selectedPointId],
                  targetId: hitCircle.id,
                };

                // Trial solve to validate BEFORE marking as floating
                const wasFloating = selectedPoint.isFloating;
                selectedPoint.isFloating = true; // Temporarily set for validation

                if (validateConstraint(newState, newConstraint)) {
                  addConstraint(newState, newConstraint);
                  // Run solver to snap the point
                  solve(newState);
                } else {
                  // Revert floating status if validation failed
                  selectedPoint.isFloating = wasFloating;
                  console.warn('Constraint validation failed - impossible constraint');
                }
                newState.selectedIds = [];
              }
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
        {(['SELECT', 'POINT', 'SEGMENT', 'CIRCLE', 'MEASURE', 'CONSTRAINT'] as ToolType[]).map((tool) => (
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
        <div className="toggle-panels">
          <button
            className={showVariablesPanel ? 'active' : ''}
            onClick={() => setShowVariablesPanel(!showVariablesPanel)}
          >
            Variables
          </button>
          <button
            className={showEquationsPanel ? 'active' : ''}
            onClick={() => setShowEquationsPanel(!showEquationsPanel)}
          >
            Equations
          </button>
        </div>
        <div className="zoom-controls">
          <button
            onClick={() => setScale(Math.max(MIN_SCALE, scale - ZOOM_STEP))}
            disabled={scale <= MIN_SCALE}
          >−</button>
          <span className="zoom-level">{Math.round(scale * 10)}%</span>
          <button
            onClick={() => setScale(Math.min(MAX_SCALE, scale + ZOOM_STEP))}
            disabled={scale >= MAX_SCALE}
          >+</button>
        </div>
      </div>
      <div className="canvas-container">
        <canvas ref={canvasRef} id="geometry-canvas" onClick={handleCanvasClick} />

        {/* Select Tool Menu - shows when items are selected */}
        {state.activeTool === 'SELECT' && state.selectedIds.length > 0 && (
          <div className="select-menu">
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', padding: '8px' }}>
              {state.selectedIds.length} selected
            </span>
            <button
              className="delete"
              onClick={() => {
                const newState = {
                  ...state,
                  points: new Map(state.points),
                  segments: new Map(state.segments),
                  circles: new Map(state.circles),
                  arcs: new Map(state.arcs),
                  variables: new Map(state.variables),
                  constraints: [...state.constraints],
                  selectedIds: []
                };
                state.selectedIds.forEach(id => deleteEntity(newState, id));
                setState(newState);
              }}
            >
              Delete
            </button>
            <button onClick={() => setState({ ...state, selectedIds: [] })}>
              Deselect
            </button>
          </div>
        )}

        {/* Variables Panel */}
        {showVariablesPanel && (
          <div className="floating-panel variables">
            <div className="floating-panel-header">
              <h4>Variables</h4>
              <button onClick={() => setShowVariablesPanel(false)}>×</button>
            </div>
            <div className="floating-panel-content">
              {Array.from(state.variables.values()).map((v) => (
                <div key={v.name} className="variable-row">
                  <span className="var-name">{v.name}</span>
                  <span>=</span>
                  <input
                    type="number"
                    value={v.value}
                    onChange={(e) => {
                      const newState = { ...state, variables: new Map(state.variables) };
                      const variable = newState.variables.get(v.name);
                      if (variable) {
                        variable.value = parseFloat(e.target.value) || 0;
                      }
                      setState(newState);
                    }}
                    disabled={v.isDetermined}
                  />
                  <button
                    className={v.isDetermined ? 'determined-badge' : 'undetermined-badge'}
                    onClick={() => {
                      const newState = {
                        ...state,
                        variables: new Map(state.variables),
                        constraints: [...state.constraints]
                      };
                      const variable = newState.variables.get(v.name);
                      if (variable) {
                        variable.isDetermined = !variable.isDetermined;
                      }
                      // If now determined, run solver to find value
                      if (variable?.isDetermined && newState.constraints.length > 0) {
                        solve(newState);
                      }
                      setState(newState);
                    }}
                    title={v.isDetermined ? 'Click to fix value' : 'Click to let solver determine'}
                  >
                    {v.isDetermined ? 'auto' : 'fixed'}
                  </button>
                </div>
              ))}
              <div className="add-row">
                <input
                  type="text"
                  placeholder="name"
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value)}
                />
                <input
                  type="number"
                  placeholder="value"
                  value={newVarValue}
                  onChange={(e) => setNewVarValue(e.target.value)}
                />
                <button onClick={() => {
                  if (newVarName.trim()) {
                    const newState = {
                      ...state,
                      variables: new Map(state.variables),
                      constraints: [...state.constraints]
                    };
                    // Create as "determined" (auto) by default so solver will find value
                    addVariable(newState, newVarName.trim(), parseFloat(newVarValue) || 1.0, true);
                    setState(newState);
                    setNewVarName('');
                    setNewVarValue('');
                  }
                }}>+</button>
              </div>
            </div>
          </div>
        )}

        {/* Equations Panel */}
        {showEquationsPanel && (
          <div className="floating-panel equations">
            <div className="floating-panel-header">
              <h4>Constraints</h4>
              <button onClick={() => setShowEquationsPanel(false)}>×</button>
            </div>
            <div className="floating-panel-content">
              {state.constraints.length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>
                  No constraints yet. Use CONSTRAINT tool to add.
                </div>
              ) : (
                state.constraints.map((c) => (
                  <div key={c.id} className="constraint-row">
                    <span className="type">{c.type}</span>
                    <span>{c.expression || c.pointIds.join(', ')}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Point Selection Popup for overlapping points */}
        {pointSelectionPopup && (
          <div
            className="point-selection-popup"
            style={{
              left: pointSelectionPopup.screenX,
              top: pointSelectionPopup.screenY,
            }}
          >
            <div className="popup-header">Select Point</div>
            {pointSelectionPopup.points.map((pt) => (
              <button
                key={pt.id}
                className="popup-item"
                onClick={() => {
                  const newState = {
                    ...state,
                    points: new Map(state.points),
                    segments: new Map(state.segments),
                    circles: new Map(state.circles),
                    selectedIds: [...state.selectedIds],
                    arcs: new Map(state.arcs),
                    variables: new Map(state.variables),
                    constraints: [...state.constraints],
                  };
                  if (newState.selectedIds.includes(pt.id)) {
                    newState.selectedIds = newState.selectedIds.filter(id => id !== pt.id);
                  } else {
                    newState.selectedIds = [...newState.selectedIds, pt.id];
                  }
                  setState(newState);
                  setPointSelectionPopup(null);
                }}
              >
                {pt.label} {pt.isFloating ? '(floating)' : '(fixed)'}
              </button>
            ))}
            <button className="popup-cancel" onClick={() => setPointSelectionPopup(null)}>
              Cancel
            </button>
          </div>
        )}

        {/* Advanced Constraint Dialog */}
        {constraintDialog && (
          <div className="hud-modal constraint-dialog">
            <h3>Create Constraint</h3>
            <div className="constraint-type-select">
              <label>Type:</label>
              <select
                value={constraintDialog.type}
                onChange={(e) => setConstraintDialog({
                  ...constraintDialog,
                  type: e.target.value as 'DISTANCE' | 'ANGLE' | 'EQUATION'
                })}
              >
                <option value="DISTANCE">Distance</option>
                <option value="ANGLE">Angle</option>
                <option value="EQUATION">Equation</option>
              </select>
            </div>
            <div className="constraint-points">
              Points: {constraintDialog.pointIds.map(id => {
                const pt = state.points.get(id);
                return pt ? pt.label : id;
              }).join(' → ')}
            </div>
            <input
              type="text"
              placeholder={constraintDialog.type === 'DISTANCE'
                ? 'Distance value or expression (e.g., 10 or 2*x)'
                : constraintDialog.type === 'ANGLE'
                  ? 'Angle in degrees (e.g., 45 or 2*theta)'
                  : 'Equation left side = 0 (e.g., x + y - 10)'}
              value={constraintDialog.expression}
              onChange={(e) => setConstraintDialog({
                ...constraintDialog,
                expression: e.target.value
              })}
              autoFocus
            />
            <div className="constraint-dialog-buttons">
              <button onClick={() => {
                if (constraintDialog.expression.trim()) {
                  const newState = {
                    ...state,
                    points: new Map(state.points),
                    segments: new Map(state.segments),
                    circles: new Map(state.circles),
                    arcs: new Map(state.arcs),
                    variables: new Map(state.variables),
                    constraints: [...state.constraints],
                    selectedIds: []
                  };

                  const newConstraint: Constraint = {
                    id: generateId(),
                    type: constraintDialog.type,
                    pointIds: constraintDialog.pointIds,
                    expression: constraintDialog.expression.trim(),
                  };

                  // For DISTANCE/ANGLE, mark points as floating
                  constraintDialog.pointIds.forEach(id => {
                    const pt = newState.points.get(id);
                    if (pt) pt.isFloating = true;
                  });

                  if (validateConstraint(newState, newConstraint)) {
                    addConstraint(newState, newConstraint);
                    solve(newState);
                    setState(newState);
                    setConstraintDialog(null);
                  } else {
                    alert('Constraint validation failed - impossible or invalid constraint');
                  }
                }
              }}>Create</button>
              <button onClick={() => {
                setState({ ...state, selectedIds: [] });
                setConstraintDialog(null);
              }}>Cancel</button>
            </div>
          </div>
        )}

        {measureResult && (
          <div className="measurement-overlay">
            <div className="label">{measureResult.type === 'length' ? 'Length' : 'Area'}</div>
            <div className="value">
              {measureResult.isDetermined
                ? measureResult.value.toFixed(2)
                : <span style={{ color: 'var(--color-highlight)' }}>
                  not determined ({measureResult.value.toFixed(2)})
                </span>
              }
            </div>
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
// Thresholds are in logical units (screen pixels / scale)
function findPointAt(state: GeometryState, x: number, y: number, threshold = 0.8): Point | null {
  for (const pt of state.points.values()) {
    const dist = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
    if (dist <= threshold) return pt;
  }
  return null;
}

function findAllPointsAt(state: GeometryState, x: number, y: number, threshold = 0.8): Point[] {
  const result: Point[] = [];
  for (const pt of state.points.values()) {
    const dist = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
    if (dist <= threshold) result.push(pt);
  }
  return result;
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

function findCircleAt(state: GeometryState, x: number, y: number, threshold = 2): Circle | null {
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
