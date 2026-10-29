const DEFAULT_OPTIONS = Object.freeze({
  fieldOfViewDeg: 270,
  angularResolutionDeg: 2.5,
  verticalLayersDeg: [-18, -9, 0, 9, 18],
  maxRangeM: 14,
  measurementNoiseM: 0.008,
  invalidRate: 0.012,
  updateRateHz: 4
});

export class LidarScanner {
  constructor(options = {}) {
    const { seed = 929, ...configuration } = options;
    this.seed = seed >>> 0 || 1;
    this.options = { ...DEFAULT_OPTIONS, verticalLayersDeg: [...DEFAULT_OPTIONS.verticalLayersDeg] };
    this.configure(configuration);
    this.scanId = 0;
    this.random = createRandom(this.seed);
    this.lastScanAt = -Infinity;
  }

  reset() {
    this.scanId = 0;
    this.random = createRandom(this.seed);
    this.lastScanAt = -Infinity;
  }

  configure(options) {
    const next = { ...this.options, ...options };
    if (!Number.isFinite(next.fieldOfViewDeg) || next.fieldOfViewDeg < 30 || next.fieldOfViewDeg > 360) {
      throw new RangeError("LiDAR field of view must be between 30 and 360 degrees.");
    }
    if (!Number.isFinite(next.angularResolutionDeg) || next.angularResolutionDeg < 0.5 || next.angularResolutionDeg > 15) {
      throw new RangeError("LiDAR angular resolution must be between 0.5 and 15 degrees.");
    }
    if (!Array.isArray(next.verticalLayersDeg) || !next.verticalLayersDeg.length
      || next.verticalLayersDeg.some((angle) => !Number.isFinite(angle) || Math.abs(angle) > 60)) {
      throw new RangeError("LiDAR vertical layers must be a non-empty list of angles within ±60 degrees.");
    }
    if (!Number.isFinite(next.maxRangeM) || next.maxRangeM < 1 || next.maxRangeM > 50) {
      throw new RangeError("LiDAR maximum range must be between 1 and 50 metres.");
    }
    if (!Number.isFinite(next.measurementNoiseM) || next.measurementNoiseM < 0 || next.measurementNoiseM > 0.5) {
      throw new RangeError("LiDAR measurement noise must be between 0 and 0.5 metres.");
    }
    if (!Number.isFinite(next.invalidRate) || next.invalidRate < 0 || next.invalidRate > 0.5) {
      throw new RangeError("LiDAR invalid-return rate must be between 0 and 0.5.");
    }
    if (!Number.isFinite(next.updateRateHz) || next.updateRateHz < 0.2 || next.updateRateHz > 20) {
      throw new RangeError("LiDAR update rate must be between 0.2 and 20 Hz.");
    }
    this.options = { ...next, verticalLayersDeg: [...next.verticalLayersDeg] };
  }

  get scanPeriodSeconds() {
    return 1 / this.options.updateRateHz;
  }

  scan(environment, pose, timestampSeconds) {
    const scanId = ++this.scanId;
    const returns = [];
    const sensorOrigin = sensorPosition(pose);
    const startAngle = -this.options.fieldOfViewDeg / 2;
    const angleCount = Math.floor(this.options.fieldOfViewDeg / this.options.angularResolutionDeg) + 1;
    for (const elevationDeg of this.options.verticalLayersDeg) {
      const elevation = degreesToRadians(elevationDeg);
      for (let index = 0; index < angleCount; index++) {
        const azimuthDeg = startAngle + index * this.options.angularResolutionDeg;
        const azimuth = degreesToRadians(azimuthDeg);
        const directionSensor = {
          x: Math.cos(elevation) * Math.cos(azimuth),
          y: Math.cos(elevation) * Math.sin(azimuth),
          z: Math.sin(elevation)
        };
        const directionWorld = sensorDirectionToWorld(directionSensor, pose.headingRad);
        const rayHit = this.random() < this.options.invalidRate
          ? null
          : environment.castRay(sensorOrigin, directionWorld, this.options.maxRangeM);
        if (!rayHit) {
          returns.push({
            scanId, timestampSeconds, azimuthDeg, elevationDeg,
            directionSensor, directionWorld, valid: false, distanceM: null,
            pointSensor: null, pointWorld: null, intensity: 0, groundTruthSurface: null
          });
          continue;
        }
        const noise = (this.random() + this.random() + this.random() - 1.5) * 2 * this.options.measurementNoiseM;
        const distanceM = Math.max(0, Math.min(this.options.maxRangeM, rayHit.distance + noise));
        returns.push({
          scanId,
          timestampSeconds,
          azimuthDeg,
          elevationDeg,
          directionSensor,
          directionWorld,
          valid: true,
          distanceM,
          pointSensor: {
            x: directionSensor.x * distanceM,
            y: directionSensor.y * distanceM,
            z: directionSensor.z * distanceM
          },
          pointWorld: {
            x: sensorOrigin.x + directionWorld.x * distanceM,
            y: sensorOrigin.y + directionWorld.y * distanceM,
            z: sensorOrigin.z + directionWorld.z * distanceM
          },
          intensity: surfaceIntensity(rayHit.surfaceLabel, this.random),
          groundTruthSurface: rayHit.surfaceLabel,
          obstacleId: rayHit.obstacleId || null
        });
      }
    }
    this.lastScanAt = timestampSeconds;
    return {
      scanId,
      timestampSeconds,
      pose: { ...pose },
      sensorOrigin,
      options: { ...this.options, verticalLayersDeg: [...this.options.verticalLayersDeg] },
      returns
    };
  }
}

export function sensorPosition(pose) {
  return {
    x: pose.x + Math.cos(pose.headingRad) * 0.18,
    y: pose.y + Math.sin(pose.headingRad) * 0.18,
    z: pose.z + 0.34
  };
}

export function sensorDirectionToWorld(direction, headingRad) {
  const cosine = Math.cos(headingRad);
  const sine = Math.sin(headingRad);
  return {
    x: direction.x * cosine - direction.y * sine,
    y: direction.x * sine + direction.y * cosine,
    z: direction.z
  };
}

function surfaceIntensity(surface, random) {
  const base = surface === "floor" ? 0.72 : surface === "ceiling" ? 0.58 : surface.includes("wall") ? 0.64 : 0.86;
  return Math.max(0.1, Math.min(1, base + (random() - 0.5) * 0.18));
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function createRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
