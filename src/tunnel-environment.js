const TWO_PI = Math.PI * 2;

export class TunnelEnvironment {
  constructor({ seed = 41, length = 58, crossSectionStep = 0.5 } = {}) {
    this.seed = seed >>> 0;
    this.length = length;
    this.crossSectionStep = crossSectionStep;
    this.random = createRandom(this.seed);
    this.obstacles = this.createObstacles();
    this.features = this.createFeatures();
  }

  getCrossSection(x) {
    const clampedX = Math.max(0, Math.min(this.length, x));
    const centerY = 0.62 * Math.sin(clampedX * 0.11) + 0.2 * Math.sin(clampedX * 0.29);
    const width = 3.75 + 0.18 * Math.sin(clampedX * 0.16)
      - 0.42 * gaussian(clampedX, 29, 2.8)
      + 0.3 * gaussian(clampedX, 44, 3.5);
    const height = 3.12 + 0.16 * Math.sin(clampedX * 0.13 + 0.7)
      - 0.22 * gaussian(clampedX, 31, 3.2)
      + 0.28 * gaussian(clampedX, 44, 3.5);
    return { x: clampedX, centerY, halfWidth: width / 2, height };
  }

  floorZ(x, y) {
    return 0.035 * Math.sin(x * 0.47) + 0.018 * Math.sin(y * 3.1 + x * 0.2);
  }

  wallY(side, x, z) {
    const section = this.getCrossSection(x);
    const bump = 0.32 * gaussian(x, 25.5, 1.8) * gaussian(z, 1.1, 0.82);
    return section.centerY + side * (section.halfWidth - bump);
  }

  ceilingZ(x, y) {
    const section = this.getCrossSection(x);
    return section.height - 0.025 * Math.sin(y * 2.2 + x * 0.17);
  }

  contains(point) {
    if (point.x < 0 || point.x > this.length) return false;
    const section = this.getCrossSection(point.x);
    const left = this.wallY(-1, point.x, point.z);
    const right = this.wallY(1, point.x, point.z);
    return point.y >= left && point.y <= right
      && point.z >= this.floorZ(point.x, point.y)
      && point.z <= this.ceilingZ(point.x, point.y)
      && Math.abs(point.y - section.centerY) <= section.halfWidth + 0.5;
  }

  surfaceAt(point) {
    const candidates = [
      { label: "floor", distance: Math.abs(point.z - this.floorZ(point.x, point.y)) },
      { label: "ceiling", distance: Math.abs(point.z - this.ceilingZ(point.x, point.y)) },
      { label: "left-wall", distance: Math.abs(point.y - this.wallY(-1, point.x, point.z)) },
      { label: "right-wall", distance: Math.abs(point.y - this.wallY(1, point.x, point.z)) }
    ];
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0].label;
  }

  castRay(origin, direction, maxRange = 20, { step = 0.18 } = {}) {
    const objectHit = this.castObstacleRay(origin, direction, maxRange);
    let boundaryHit = null;
    let previousDistance = 0;
    for (let distance = step; distance <= maxRange; distance += step) {
      const point = addScaled(origin, direction, distance);
      if (!this.contains(point)) {
        let low = previousDistance;
        let high = distance;
        for (let iteration = 0; iteration < 9; iteration++) {
          const middle = (low + high) / 2;
          if (this.contains(addScaled(origin, direction, middle))) low = middle;
          else high = middle;
        }
        const hitDistance = (low + high) / 2;
        const position = addScaled(origin, direction, hitDistance);
        boundaryHit = { distance: hitDistance, position, surfaceLabel: this.surfaceAt(position) };
        break;
      }
      previousDistance = distance;
    }

    if (objectHit && (!boundaryHit || objectHit.distance < boundaryHit.distance)) return objectHit;
    return boundaryHit;
  }

  nearestFeature(point, maxDistance = 0.65) {
    let nearest = null;
    let nearestDistance = maxDistance;
    for (const feature of this.features) {
      const distance = distance3(point, feature.position);
      if (distance < nearestDistance) {
        nearest = feature;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  createObstacles() {
    const section = (x) => this.getCrossSection(x);
    const rock = (id, x, offsetY, z, radius, radiusY = radius, radiusZ = radius) => ({
      id, kind: "rock", shape: "ellipsoid",
      center: { x, y: section(x).centerY + offsetY, z },
      radii: { x: radius, y: radiusY, z: radiusZ }
    });
    const box = (id, x, offsetY, half, angle = 0) => ({
      id, kind: "box", shape: "box",
      center: { x, y: section(x).centerY + offsetY, z: half.z },
      halfSize: half, yaw: angle
    });
    const rubbleCenter = { x: 20.5, y: section(20.5).centerY + 0.05, z: 0 };
    const rubble = Array.from({ length: 10 }, (_, index) => {
      const angle = index * TWO_PI / 10;
      const radius = 0.12 + this.random() * 0.2;
      const size = 0.1 + this.random() * 0.1;
      return {
        id: `rubble-${index + 1}`,
        kind: "rubble",
        shape: "ellipsoid",
        center: {
          x: rubbleCenter.x + Math.cos(angle) * radius,
          y: rubbleCenter.y + Math.sin(angle) * radius,
          z: this.floorZ(rubbleCenter.x, rubbleCenter.y) + size * 0.72
        },
        radii: { x: size * 1.25, y: size, z: size * 0.72 }
      };
    });
    const attachedX = 25.5;
    const attachedBoundary = this.wallY(-1, attachedX, 1.25);
    const attachedRock = {
      id: "wall-protrusion",
      kind: "rock",
      shape: "ellipsoid",
      center: { x: attachedX, y: attachedBoundary + 0.23, z: 1.25 },
      radii: { x: 0.52, y: 0.58, z: 0.48 },
      wallAttached: true
    };
    return [
      rock("rock-east-1", 8.5, 1.08, 0.42, 0.46, 0.4, 0.42),
      box("box-checkpoint-1", 13.2, -0.88, { x: 0.43, y: 0.48, z: 0.42 }, 0.12),
      rock("rock-center-1", 17.4, -0.18, 0.38, 0.39, 0.35, 0.38),
      ...rubble,
      attachedRock,
      rock("rock-west-2", 34.2, 1.05, 0.52, 0.56, 0.45, 0.5),
      box("box-checkpoint-2", 40.2, -0.62, { x: 0.58, y: 0.42, z: 0.52 }, -0.18),
      rock("rock-east-3", 48.6, -0.92, 0.36, 0.42, 0.36, 0.36)
    ];
  }

  createFeatures() {
    const make = (id, kind, x, side, z, color) => ({
      id, kind, color,
      position: { x, y: this.wallY(side, x, z) - side * 0.018, z },
      side,
      dimensions: kind === "crack" ? { width: 0.08, height: 0.9 } : { width: 0.8, height: 0.55 }
    });
    return [
      make("damp-seep-1", "damp", 7.2, -1, 1.55, "#428f91"),
      make("corrosion-1", "corrosion", 16.1, 1, 2.15, "#be7046"),
      make("crack-1", "crack", 23.2, -1, 1.85, "#d5c49c"),
      make("damp-seep-2", "damp", 33.2, 1, 1.05, "#428f91"),
      make("crack-2", "crack", 43.1, -1, 2.0, "#d5c49c"),
      make("corrosion-2", "corrosion", 51, 1, 1.7, "#be7046")
    ];
  }

  castObstacleRay(origin, direction, maxRange) {
    let nearest = null;
    for (const obstacle of this.obstacles) {
      const distance = obstacle.shape === "box"
        ? intersectBox(origin, direction, obstacle)
        : intersectEllipsoid(origin, direction, obstacle);
      if (distance === null || distance < 0 || distance > maxRange) continue;
      if (!nearest || distance < nearest.distance) {
        nearest = {
          distance,
          position: addScaled(origin, direction, distance),
          surfaceLabel: obstacle.kind,
          obstacleId: obstacle.id
        };
      }
    }
    return nearest;
  }
}

export function tunnelSampleX(environment, step = environment.crossSectionStep) {
  const sections = [];
  for (let x = 0; x <= environment.length; x += step) {
    const section = environment.getCrossSection(x);
    sections.push({
      x,
      centerY: section.centerY,
      leftY: environment.wallY(-1, x, 1.5),
      rightY: environment.wallY(1, x, 1.5),
      height: section.height
    });
  }
  return sections;
}

function intersectEllipsoid(origin, direction, obstacle) {
  const offset = {
    x: origin.x - obstacle.center.x,
    y: origin.y - obstacle.center.y,
    z: origin.z - obstacle.center.z
  };
  const { x: rx, y: ry, z: rz } = obstacle.radii;
  const ox = offset.x / rx; const oy = offset.y / ry; const oz = offset.z / rz;
  const dx = direction.x / rx; const dy = direction.y / ry; const dz = direction.z / rz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  return first >= 0 ? first : second >= 0 ? second : null;
}

function intersectBox(origin, direction, obstacle) {
  const { center, halfSize, yaw = 0 } = obstacle;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const dx = origin.x - center.x;
  const dy = origin.y - center.y;
  const localOrigin = { x: dx * cosine + dy * sine, y: -dx * sine + dy * cosine, z: origin.z - center.z };
  const localDirection = {
    x: direction.x * cosine + direction.y * sine,
    y: -direction.x * sine + direction.y * cosine,
    z: direction.z
  };
  let low = -Infinity;
  let high = Infinity;
  for (const axis of ["x", "y", "z"]) {
    if (Math.abs(localDirection[axis]) < 1e-8) {
      if (Math.abs(localOrigin[axis]) > halfSize[axis]) return null;
      continue;
    }
    const first = (-halfSize[axis] - localOrigin[axis]) / localDirection[axis];
    const second = (halfSize[axis] - localOrigin[axis]) / localDirection[axis];
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
    if (low > high) return null;
  }
  return low >= 0 ? low : high >= 0 ? high : null;
}

function addScaled(point, direction, scale) {
  return { x: point.x + direction.x * scale, y: point.y + direction.y * scale, z: point.z + direction.z * scale };
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function gaussian(value, center, sigma) {
  const ratio = (value - center) / sigma;
  return Math.exp(-0.5 * ratio * ratio);
}

function createRandom(seed) {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
