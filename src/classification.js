const CLUSTER_CELL_M = 0.42;
const SURFACE_TOLERANCE_M = 0.19;

const CLASS_COLORS = Object.freeze({
  wall: "#83958d",
  floor: "#c5ae80",
  ceiling: "#687f87",
  rock: "#ef8a55",
  rubble: "#d7b26a",
  box: "#64b9d1",
  unknown: "#e5d7c6"
});

export function classifyScan(scan, environment) {
  const points = [];
  const candidates = [];
  for (const reading of scan.returns) {
    if (!reading.valid || !reading.pointWorld) continue;
    const point = {
      scanId: reading.scanId,
      timestampSeconds: reading.timestampSeconds,
      azimuthDeg: reading.azimuthDeg,
      elevationDeg: reading.elevationDeg,
      distanceM: reading.distanceM,
      intensity: reading.intensity,
      position: reading.pointWorld,
      className: null,
      confidence: 0,
      clusterId: null
    };
    const surface = nearestNominalSurface(point.position, environment);
    if (surface && surface.distance <= SURFACE_TOLERANCE_M) {
      point.className = surface.className;
      point.confidence = Math.max(0.55, 1 - surface.distance / (SURFACE_TOLERANCE_M * 2));
      points.push(point);
    } else {
      candidates.push(point);
      points.push(point);
    }
  }

  const pointClusters = groupNearby(candidates);
  const clusters = [];
  for (const [index, clusterPoints] of pointClusters.entries()) {
    const clusterId = `scan-${scan.scanId}-cluster-${index + 1}`;
    const result = classifyCluster(clusterPoints, environment);
    for (const point of clusterPoints) {
      point.className = result.className;
      point.confidence = result.confidence;
      point.clusterId = clusterId;
    }
    clusters.push({
      ...result,
      id: clusterId,
      points: clusterPoints,
      pointCount: clusterPoints.length
    });
  }

  const validation = evaluateGroundTruth(scan.returns, points);
  return {
    scanId: scan.scanId,
    timestampSeconds: scan.timestampSeconds,
    pose: scan.pose,
    sensorOrigin: scan.sensorOrigin,
    options: scan.options,
    points,
    clusters,
    detections: clusters.map((cluster) => ({
      id: cluster.id,
      className: cluster.className,
      confidence: cluster.confidence,
      pointCount: cluster.pointCount,
      center: cluster.center,
      extent: cluster.extent,
      wallAttached: cluster.wallAttached,
      note: cluster.className === "unknown"
        ? cluster.wallAttached ? "Wall-attached shape; LiDAR alone cannot reliably separate it from wall roughness." : "Shape is uncertain with this scan."
        : null
    })),
    validation
  };
}

function nearestNominalSurface(point, environment) {
  if (point.x < 0 || point.x > environment.length) return null;
  const floorDistance = Math.abs(point.z - environment.floorZ(point.x, point.y));
  const ceilingDistance = Math.abs(point.z - environment.ceilingZ(point.x, point.y));
  const leftDistance = Math.abs(point.y - environment.wallY(-1, point.x, point.z));
  const rightDistance = Math.abs(point.y - environment.wallY(1, point.x, point.z));
  const candidates = [
    { className: "floor", distance: floorDistance },
    { className: "ceiling", distance: ceilingDistance },
    { className: "wall", distance: leftDistance },
    { className: "wall", distance: rightDistance }
  ];
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0];
}

function groupNearby(points) {
  const buckets = new Map();
  for (const point of points) {
    const key = cellKey(point.position);
    const bucket = buckets.get(key) || [];
    bucket.push(point);
    buckets.set(key, bucket);
  }
  const unvisited = new Set(points);
  const clusters = [];
  while (unvisited.size) {
    const seed = unvisited.values().next().value;
    unvisited.delete(seed);
    const queue = [seed];
    const cluster = [];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      cluster.push(current);
      for (const key of neighborKeys(current.position)) {
        for (const neighbor of buckets.get(key) || []) {
          if (!unvisited.has(neighbor) || distance3(current.position, neighbor.position) > CLUSTER_CELL_M * 1.65) continue;
          unvisited.delete(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (cluster.length >= 2) clusters.push(cluster);
    else {
      seed.className = "unknown";
      seed.confidence = 0.28;
    }
  }
  return clusters;
}

function classifyCluster(points, environment) {
  const center = centroid(points);
  const bounds = extents(points);
  const minimumZ = Math.min(...points.map((point) => point.position.z));
  const maximumZ = Math.max(...points.map((point) => point.position.z));
  const width = Math.max(bounds.x, bounds.y);
  const height = bounds.z;
  const nearFloor = minimumZ < 0.34;
  const section = environment.getCrossSection(center.x);
  const distanceToSideWall = Math.min(
    Math.abs(center.y - environment.wallY(-1, center.x, center.z)),
    Math.abs(center.y - environment.wallY(1, center.x, center.z))
  );
  const wallAttached = distanceToSideWall < 0.52;

  if (wallAttached && section.halfWidth > 0) {
    return { className: "unknown", confidence: 0.43, wallAttached: true, center, extent: bounds };
  }
  const sorted = [bounds.x, bounds.y, bounds.z].sort((a, b) => b - a);
  const boxLike = points.length >= 14 && height > 0.3
    && sorted[0] / Math.max(sorted[2], 0.08) > 1.85
    && sorted[0] / Math.max(sorted[2], 0.08) < 2.5
    && sorted[1] / Math.max(sorted[2], 0.08) > 0.65;
  if (boxLike) return { className: "box", confidence: 0.68, wallAttached: false, center, extent: bounds };
  if (nearFloor && height < 0.32 && width < 0.68) {
    return { className: "rubble", confidence: 0.72, wallAttached: false, center, extent: bounds };
  }
  if (points.length >= 3 && height > 0.2 && width > 0.2) {
    return { className: "rock", confidence: 0.66, wallAttached: false, center, extent: bounds };
  }
  return { className: "unknown", confidence: 0.35, wallAttached: false, center, extent: bounds };
}

function evaluateGroundTruth(readings, classifiedPoints) {
  const truth = readings.filter((reading) => reading.valid && reading.groundTruthSurface);
  const pointByKey = new Map(classifiedPoints.map((point) => [returnKey(point), point]));
  const counts = { correct: 0, total: 0, confusion: {} };
  for (const reading of truth) {
    const point = pointByKey.get(returnKey(reading));
    if (!point) continue;
    const expected = normalizeTruth(reading.groundTruthSurface);
    const predicted = point.className || "unknown";
    counts.total++;
    if (expected === predicted) counts.correct++;
    const row = counts.confusion[expected] || {};
    row[predicted] = (row[predicted] || 0) + 1;
    counts.confusion[expected] = row;
  }
  return {
    correct: counts.correct,
    total: counts.total,
    agreement: counts.total ? counts.correct / counts.total : 0,
    confusion: counts.confusion
  };
}

function normalizeTruth(label) {
  if (label === "left-wall" || label === "right-wall") return "wall";
  if (label === "box") return "box";
  if (label === "rock") return "rock";
  if (label === "rubble") return "rubble";
  return label === "floor" || label === "ceiling" ? label : "unknown";
}

function returnKey(point) {
  return `${point.scanId}:${point.azimuthDeg}:${point.elevationDeg}`;
}

function cellKey(point) {
  return `${Math.floor(point.x / CLUSTER_CELL_M)}:${Math.floor(point.y / CLUSTER_CELL_M)}:${Math.floor(point.z / CLUSTER_CELL_M)}`;
}

function neighborKeys(point) {
  const [x, y, z] = cellKey(point).split(":").map(Number);
  const keys = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) keys.push(`${x + dx}:${y + dy}:${z + dz}`);
    }
  }
  return keys;
}

function centroid(points) {
  const sum = points.reduce((total, point) => ({
    x: total.x + point.position.x,
    y: total.y + point.position.y,
    z: total.z + point.position.z
  }), { x: 0, y: 0, z: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

function extents(points) {
  const values = points.map((point) => point.position);
  return {
    x: Math.max(...values.map((point) => point.x)) - Math.min(...values.map((point) => point.x)),
    y: Math.max(...values.map((point) => point.y)) - Math.min(...values.map((point) => point.y)),
    z: Math.max(...values.map((point) => point.z)) - Math.min(...values.map((point) => point.z))
  };
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export { CLASS_COLORS };
