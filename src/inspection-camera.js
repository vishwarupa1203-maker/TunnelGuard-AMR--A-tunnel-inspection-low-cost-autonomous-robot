import { sensorDirectionToWorld, sensorPosition } from "./lidar.js";

const WIDTH = 72;
const HEIGHT = 40;
const HORIZONTAL_FOV_DEG = 78;
const VERTICAL_FOV_DEG = 48;
const CAMERA_RANGE_M = 10;

const MATERIAL_COLORS = Object.freeze({
  "left-wall": [95, 106, 101],
  "right-wall": [101, 111, 104],
  floor: [72, 81, 77],
  ceiling: [69, 78, 76],
  rock: [132, 112, 91],
  rubble: [148, 113, 76],
  box: [105, 123, 123]
});

const FEATURE_COLORS = Object.freeze({
  damp: [43, 125, 128],
  corrosion: [177, 91, 48],
  crack: [199, 186, 152]
});

export class InspectionCamera {
  constructor({ width = WIDTH, height = HEIGHT, horizontalFovDeg = HORIZONTAL_FOV_DEG, verticalFovDeg = VERTICAL_FOV_DEG, rangeM = CAMERA_RANGE_M } = {}) {
    this.width = width;
    this.height = height;
    this.horizontalFovDeg = horizontalFovDeg;
    this.verticalFovDeg = verticalFovDeg;
    this.rangeM = rangeM;
    this.frameId = 0;
  }

  capture(environment, pose, timestampSeconds) {
    const origin = sensorPosition({ ...pose, z: pose.z + 0.24 });
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    for (let py = 0; py < this.height; py++) {
      const elevationDeg = ((0.5 - (py + 0.5) / this.height) * this.verticalFovDeg);
      for (let px = 0; px < this.width; px++) {
        const azimuthDeg = ((px + 0.5) / this.width - 0.5) * this.horizontalFovDeg;
        const directionSensor = directionFromAngles(azimuthDeg, elevationDeg);
        const directionWorld = sensorDirectionToWorld(directionSensor, pose.headingRad);
        const hit = environment.castRay(origin, directionWorld, this.rangeM, { step: 0.24 });
        const feature = hit && hit.surfaceLabel.includes("wall")
          ? environment.nearestFeature(hit.position, 0.38)
          : null;
        const color = feature ? FEATURE_COLORS[feature.kind] : MATERIAL_COLORS[hit?.surfaceLabel] || [17, 25, 27];
        const texture = deterministicTexture(px, py);
        const offset = (py * this.width + px) * 4;
        data[offset] = clampColor(color[0] + texture);
        data[offset + 1] = clampColor(color[1] + texture);
        data[offset + 2] = clampColor(color[2] + texture);
        data[offset + 3] = 255;
      }
    }

    return {
      frameId: ++this.frameId,
      timestampSeconds,
      width: this.width,
      height: this.height,
      imageData: data,
      observations: this.observeFeatures(environment, pose, origin),
      simulated: true
    };
  }

  observeFeatures(environment, pose, origin) {
    const observations = [];
    for (const feature of environment.features) {
      const dx = feature.position.x - origin.x;
      const dy = feature.position.y - origin.y;
      const dz = feature.position.z - origin.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > this.rangeM) continue;
      const local = worldDeltaToSensor(dx, dy, dz, pose.headingRad);
      const azimuthDeg = Math.atan2(local.y, local.x) * 180 / Math.PI;
      const elevationDeg = Math.atan2(local.z, Math.hypot(local.x, local.y)) * 180 / Math.PI;
      if (Math.abs(azimuthDeg) > this.horizontalFovDeg / 2 || Math.abs(elevationDeg) > this.verticalFovDeg / 2) continue;
      const direction = normalize({ x: dx, y: dy, z: dz });
      const occluder = environment.castRay(origin, direction, distance + 0.1, { step: 0.2 });
      if (occluder && occluder.distance < distance - 0.28) continue;
      observations.push({
        id: feature.id,
        className: feature.kind,
        confidence: Math.max(0.52, 0.92 - distance * 0.035),
        distanceM: distance,
        worldPosition: { ...feature.position },
        source: "simulated-camera"
      });
    }
    return observations.sort((a, b) => a.distanceM - b.distanceM);
  }
}

function directionFromAngles(azimuthDeg, elevationDeg) {
  const azimuth = azimuthDeg * Math.PI / 180;
  const elevation = elevationDeg * Math.PI / 180;
  return {
    x: Math.cos(elevation) * Math.cos(azimuth),
    y: Math.cos(elevation) * Math.sin(azimuth),
    z: Math.sin(elevation)
  };
}

function worldDeltaToSensor(dx, dy, dz, headingRad) {
  const cosine = Math.cos(headingRad);
  const sine = Math.sin(headingRad);
  return { x: dx * cosine + dy * sine, y: -dx * sine + dy * cosine, z: dz };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function deterministicTexture(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (value - Math.floor(value) - 0.5) * 18;
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
