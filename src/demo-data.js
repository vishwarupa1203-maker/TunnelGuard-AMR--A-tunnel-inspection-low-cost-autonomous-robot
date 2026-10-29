import { classifyScan } from "./classification.js";
import { InspectionCamera } from "./inspection-camera.js";
import { LidarScanner } from "./lidar.js";
import { TunnelEnvironment } from "./tunnel-environment.js";

const MAP_POINT_LIMIT = 14000;
const ROBOT_SPEED_M_S = 0.42;
const ROBOT_HALF_WIDTH_M = 0.24;

export class DemoSimulation {
  constructor({ seed = 41, environment, scanner, camera } = {}) {
    this.seed = seed;
    this.environment = environment || new TunnelEnvironment({ seed });
    this.scanner = scanner || new LidarScanner({ seed: seed + 888 });
    this.camera = camera || new InspectionCamera();
    this.speedMultiplier = 1;
    this.playing = true;
    this.reset();
  }

  tick(deltaSeconds) {
    if (!this.playing) return this.current;
    let remaining = Math.min(Math.max(deltaSeconds, 0), 0.1) * this.speedMultiplier;
    while (remaining > 0) {
      const timeToScan = Math.max(0.001, this.nextScanAt - this.elapsed);
      const step = Math.min(remaining, 0.05, timeToScan);
      this.elapsed += step;
      this.updateRobot(step);
      remaining -= step;
      if (this.elapsed >= this.nextScanAt) this.collectScan();
      if (this.elapsed >= this.nextCameraAt) {
        this.cameraFrame = this.camera.capture(this.environment, this.pose, this.elapsed);
        this.nextCameraAt = this.elapsed + 0.75;
      }
    }
    this.current = this.getTelemetry();
    this.frame = this.createFrame();
    return this.current;
  }

  setPlaying(playing) {
    this.playing = playing;
  }

  setSpeed(multiplier) {
    this.speedMultiplier = multiplier;
  }

  configureScanner(options) {
    this.scanner.configure(options);
    this.collectScan();
    this.current = this.getTelemetry();
    this.frame = this.createFrame();
  }

  reset() {
    this.scanner.reset();
    this.elapsed = 0;
    this.speedMultiplier = this.speedMultiplier || 1;
    this.playing = true;
    this.positionHistory = [];
    this.pointMap = new Map();
    this.avoidanceSide = 0;
    this.avoidanceRemaining = 0;
    this.lastPoseAt = 0;
    const section = this.environment.getCrossSection(2.4);
    this.pose = {
      x: 2.4,
      y: section.centerY,
      z: this.environment.floorZ(2.4, section.centerY),
      headingRad: this.centerlineHeading(2.4)
    };
    this.positionHistory.push({ x: this.pose.x, y: this.pose.y });
    this.nextScanAt = 0;
    this.nextCameraAt = 0;
    this.lastScan = null;
    this.classifiedScan = null;
    this.cameraFrame = null;
    this.pointMap.clear();
    this.mappedPointsSnapshot = [];
    this.collectScan();
    this.cameraFrame = this.camera.capture(this.environment, this.pose, this.elapsed);
    this.nextCameraAt = this.elapsed + 0.75;
    this.current = this.getTelemetry();
    this.frame = this.createFrame();
  }

  updateRobot(deltaSeconds) {
    const atEnd = this.pose.x >= this.environment.length - 1.4;
    if (atEnd) return;
    const frontDistance = readRange(this.classifiedScan, 0, 9);
    if (this.avoidanceRemaining <= 0 && frontDistance < 1.65) {
      const leftClearance = readRange(this.classifiedScan, 64, 15);
      const rightClearance = readRange(this.classifiedScan, -64, 15);
      this.avoidanceSide = leftClearance >= rightClearance ? 1 : -1;
      this.avoidanceRemaining = 2.2;
    }
    if (this.avoidanceRemaining > 0) this.avoidanceRemaining = Math.max(0, this.avoidanceRemaining - deltaSeconds);

    const section = this.environment.getCrossSection(this.pose.x);
    const targetOffset = this.avoidanceRemaining > 0
      ? this.avoidanceSide * Math.min(0.68, section.halfWidth - ROBOT_HALF_WIDTH_M - 0.22)
      : 0;
    const targetY = section.centerY + targetOffset;
    const lookAhead = Math.max(1.2, 2.8 * Math.cos(this.pose.headingRad - this.centerlineHeading(this.pose.x)));
    const pathHeading = this.centerlineHeading(Math.min(this.environment.length, this.pose.x + lookAhead));
    const desiredHeading = pathHeading + Math.atan2(targetOffset, lookAhead);
    const headingError = normalizeAngle(desiredHeading - this.pose.headingRad);
    const headingRate = Math.max(-1.25, Math.min(1.25, headingError * 2.2));
    this.pose.headingRad += headingRate * deltaSeconds;
    this.pose.x += Math.cos(this.pose.headingRad) * ROBOT_SPEED_M_S * deltaSeconds;
    this.pose.y += Math.sin(this.pose.headingRad) * ROBOT_SPEED_M_S * deltaSeconds;
    const minimumY = this.environment.wallY(-1, this.pose.x, this.pose.z) + ROBOT_HALF_WIDTH_M + 0.08;
    const maximumY = this.environment.wallY(1, this.pose.x, this.pose.z) - ROBOT_HALF_WIDTH_M - 0.08;
    this.pose.y = Math.max(minimumY, Math.min(maximumY, this.pose.y));
    this.pose.z = this.environment.floorZ(this.pose.x, this.pose.y);
    if (this.elapsed - this.lastPoseAt >= 0.12) {
      this.positionHistory.push({ x: this.pose.x, y: this.pose.y });
      if (this.positionHistory.length > 1200) this.positionHistory.shift();
      this.lastPoseAt = this.elapsed;
    }
  }

  collectScan() {
    this.lastScan = this.scanner.scan(this.environment, this.pose, this.elapsed);
    this.classifiedScan = classifyScan(this.lastScan, this.environment);
    for (const point of this.classifiedScan.points) {
      const key = `${Math.floor(point.position.x / 0.14)}:${Math.floor(point.position.y / 0.14)}:${Math.floor(point.position.z / 0.14)}`;
      if (!this.pointMap.has(key) && this.pointMap.size >= MAP_POINT_LIMIT) {
        this.pointMap.delete(this.pointMap.keys().next().value);
      }
      this.pointMap.set(key, point);
    }
    this.mappedPointsSnapshot = [...this.pointMap.values()];
    this.nextScanAt = this.elapsed + this.scanner.scanPeriodSeconds;
  }

  getTelemetry() {
    const front = readRange(this.classifiedScan, 0, 9);
    const left = readRange(this.classifiedScan, 90, 14);
    const right = readRange(this.classifiedScan, -90, 14);
    const atEnd = this.pose.x >= this.environment.length - 1.4;
    const obstacle = front < 1.65;
    return {
      mode: "DEMO",
      state: atEnd ? "STOPPED" : obstacle ? (this.avoidanceSide > 0 ? "TURNING_LEFT" : "TURNING_RIGHT") : "FORWARD",
      speedLevel: 2,
      speedCmS: atEnd ? 0 : ROBOT_SPEED_M_S * 100,
      distanceCm: {
        front: Number.isFinite(front) ? Math.round(front * 100) : -1,
        left: Number.isFinite(left) ? Math.round(left * 100) : -1,
        right: Number.isFinite(right) ? Math.round(right * 100) : -1
      },
      headingDeg: (this.pose.headingRad * 180 / Math.PI + 360) % 360,
      position: { x: this.pose.x, y: this.pose.y, z: this.pose.z },
      obstacle,
      mpuPresent: true
    };
  }

  createFrame() {
    return {
      environment: this.environment,
      pose: { ...this.pose },
      scan: this.classifiedScan,
      mappedPoints: this.mappedPointsSnapshot,
      trajectory: this.positionHistory,
      cameraFrame: this.cameraFrame,
      telemetry: this.current
    };
  }

  centerlineHeading(x) {
    const before = this.environment.getCrossSection(Math.max(0, x - 0.05)).centerY;
    const after = this.environment.getCrossSection(Math.min(this.environment.length, x + 0.05)).centerY;
    return Math.atan2(after - before, Math.min(this.environment.length, x + 0.05) - Math.max(0, x - 0.05));
  }
}

function readRange(scan, centerDeg, toleranceDeg) {
  if (!scan) return Infinity;
  const readings = scan.points.filter((reading) => reading.position
    && reading.elevationDeg === 0
    && Math.abs(reading.azimuthDeg - centerDeg) <= toleranceDeg);
  return readings.length ? Math.min(...readings.map((reading) => reading.distanceM)) : Infinity;
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
