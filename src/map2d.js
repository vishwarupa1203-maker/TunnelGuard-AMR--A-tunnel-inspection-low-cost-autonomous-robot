const MAX_TRAJECTORY = 1200;
const MAX_OBSTACLES = 1500;

const POINT_COLORS = Object.freeze({
  wall: "#879990",
  floor: "#c5ae80",
  ceiling: "#708892",
  rock: "#ef8a55",
  rubble: "#d7b26a",
  box: "#64b9d1",
  unknown: "#e5d7c6"
});

export class Map2D {
  constructor(canvas, { onHintChange } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.onHintChange = onHintChange;
    this.trajectory = [];
    this.obstacles = [];
    this.zoom = 1;
    this.offset = { x: 0, y: 0 };
    this.followPosition = true;
    this.isDemo = false;
    this.demoFrame = null;
    this.drag = null;
    this.deviceScale = 1;
    this.installInteractions();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setData(telemetry, { source, trajectory, obstacles } = {}) {
    this.isDemo = source === "demo";
    if (trajectory && source === "demo") {
      this.trajectory = trajectory.slice(-MAX_TRAJECTORY);
      this.obstacles = (obstacles || []).slice(-MAX_OBSTACLES);
    } else if (source === "live" && telemetry?.position &&
        Number.isFinite(telemetry.position.x) && Number.isFinite(telemetry.position.y)) {
      const x = telemetry.position.x / 100;
      const y = telemetry.position.y / 100;
      this.currentPose = {
        position: { x, y },
        headingDeg: telemetry.headingDeg
      };
      const last = this.trajectory[this.trajectory.length - 1];
      if (!last || Math.hypot(last.x - x, last.y - y) > 0.005) {
        this.trajectory.push({ x, y });
        if (this.trajectory.length > MAX_TRAJECTORY) this.trajectory.shift();
      }
      const direction = telemetry.obstacleDirection;
      const distance = telemetry.distanceCm?.[direction];
      const directionOffset = direction === "left" ? 90 : direction === "right" ? -90 : 0;
      if (telemetry.obstacle === true && ["front", "left", "right"].includes(direction) &&
          Number.isFinite(distance) && distance > 0 && distance <= 300 &&
          Number.isFinite(telemetry.headingDeg)) {
        const angle = (telemetry.headingDeg + directionOffset) * Math.PI / 180;
        const point = {
          x: x + Math.cos(angle) * distance / 100,
          y: y + Math.sin(angle) * distance / 100,
          direction
        };
        const previous = this.obstacles[this.obstacles.length - 1];
        if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.04) this.obstacles.push(point);
      }
      if (this.obstacles.length > MAX_OBSTACLES) this.obstacles.splice(0, this.obstacles.length - MAX_OBSTACLES);
    }
    this.draw(source === "live" ? this.currentPose : telemetry);
  }

  setDemoFrame(frame) {
    this.isDemo = true;
    this.demoFrame = frame;
    this.currentPose = null;
    this.trajectory = frame.trajectory;
    this.draw(frame.telemetry);
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    this.deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(bounds.width * this.deviceScale));
    this.canvas.height = Math.max(1, Math.round(bounds.height * this.deviceScale));
    this.draw();
  }

  clearCurrentPose() {
    this.currentPose = null;
  }

  resetView() {
    this.zoom = 1;
    this.offset = { x: 0, y: 0 };
    this.followPosition = true;
    this.draw();
  }

  clear() {
    this.trajectory = [];
    this.obstacles = [];
    this.demoFrame = null;
    this.currentPose = null;
    this.isDemo = false;
    this.resetView();
    this.draw();
  }

  resetHistory() {
    this.trajectory = [];
    this.obstacles = [];
    this.draw();
  }

  zoomBy(factor) {
    this.zoom = Math.max(0.35, Math.min(5, this.zoom * factor));
    this.draw();
  }

  installInteractions() {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.drag = { x: event.clientX, y: event.clientY, offsetX: this.offset.x, offsetY: this.offset.y };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.drag) return;
      this.followPosition = false;
      this.offset.x = this.drag.offsetX + event.clientX - this.drag.x;
      this.offset.y = this.drag.offsetY + event.clientY - this.drag.y;
      this.draw();
    });
    this.canvas.addEventListener("pointerup", () => { this.drag = null; });
    this.canvas.addEventListener("pointercancel", () => { this.drag = null; });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoomBy(event.deltaY < 0 ? 1.1 : 0.9);
    }, { passive: false });
  }

  draw(telemetry = this.currentPose) {
    if (!this.context || !this.canvas.width || !this.canvas.height) return;
    const ctx = this.context;
    const scale = this.deviceScale;
    const width = this.canvas.width / scale;
    const height = this.canvas.height / scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#101719";
    ctx.fillRect(0, 0, width, height);
    const baseScale = this.demoFrame
      ? Math.min(width / 23, height / 7.2) * this.zoom
      : Math.min(width, height) * 0.21 * this.zoom;
    const center = { x: width / 2 + this.offset.x, y: height / 2 + this.offset.y };
    const pose = this.demoFrame?.pose;
    const lastPosition = this.trajectory[this.trajectory.length - 1];
    const worldOrigin = this.followPosition
      ? (pose || telemetry?.position || lastPosition || { x: 0, y: 0 })
      : { x: 0, y: 0 };
    const toScreen = (point) => ({
      x: center.x + (point.x - worldOrigin.x) * baseScale,
      y: center.y - (point.y - worldOrigin.y) * baseScale
    });
    this.drawGrid(ctx, width, height, center, baseScale);
    if (this.demoFrame) this.drawDemoTunnel(ctx, width, height, toScreen);
    else if (this.isDemo) this.drawLegacyTunnel(ctx, width, height, center, baseScale, worldOrigin);

    if (this.trajectory.length > 1) {
      ctx.beginPath();
      this.trajectory.forEach((point, index) => {
        const screenPoint = toScreen(point);
        if (index === 0) ctx.moveTo(screenPoint.x, screenPoint.y);
        else ctx.lineTo(screenPoint.x, screenPoint.y);
      });
      ctx.strokeStyle = "rgba(98, 199, 157, .76)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.demoFrame) this.drawClassifiedPoints(ctx, width, height, toScreen);
    else this.drawAutoPoints(ctx, toScreen);

    if (pose && Number.isFinite(pose.headingRad)) {
      this.drawRobot(ctx, toScreen(pose), -pose.headingRad);
      this.onHintChange?.("");
    } else if (telemetry?.position && Number.isFinite(telemetry.headingDeg)) {
      const robot = toScreen(telemetry.position);
      this.drawRobot(ctx, robot, -telemetry.headingDeg * Math.PI / 180);
      this.onHintChange?.("");
    } else {
      this.onHintChange?.(this.demoFrame ? "" : "Waiting for position data");
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawDemoTunnel(ctx, width, height, toScreen) {
    const poseX = this.demoFrame.pose.x;
    const startX = Math.max(0, poseX - 11.5);
    const endX = Math.min(this.demoFrame.environment.length, poseX + 11.5);
    const sections = [];
    for (let x = startX; x <= endX; x += 0.2) {
      sections.push({
        x,
        leftY: this.demoFrame.environment.wallY(-1, x, 1.5),
        rightY: this.demoFrame.environment.wallY(1, x, 1.5)
      });
    }
    if (sections.length < 2) return;
    ctx.fillStyle = "rgba(39, 49, 45, .34)";
    ctx.beginPath();
    for (const [index, section] of sections.entries()) {
      const point = toScreen({ x: section.x, y: section.leftY });
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    for (const section of [...sections].reverse()) {
      const point = toScreen({ x: section.x, y: section.rightY });
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fill();

    this.drawTunnelBoundary(ctx, sections, toScreen, "leftY");
    this.drawTunnelBoundary(ctx, sections, toScreen, "rightY");
    ctx.fillStyle = "rgba(131, 149, 141, .75)";
    ctx.font = "9px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText("NOMINAL TUNNEL PROFILE · CLASSIFIED SCAN RETURNS", 12, 18);
    ctx.fillStyle = "rgba(145, 162, 156, .68)";
    ctx.fillText("X · ALONG TUNNEL", width - 122, height - 12);
  }

  drawTunnelBoundary(ctx, sections, toScreen, key) {
    ctx.beginPath();
    sections.forEach((section, index) => {
      const point = toScreen({ x: section.x, y: section[key] });
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(131, 149, 141, .48)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawClassifiedPoints(ctx, width, height, toScreen) {
    for (const point of this.demoFrame.mappedPoints) {
      const screenPoint = toScreen(point.position);
      if (screenPoint.x < -5 || screenPoint.x > width + 5 || screenPoint.y < -5 || screenPoint.y > height + 5) continue;
      ctx.fillStyle = POINT_COLORS[point.className] || POINT_COLORS.unknown;
      ctx.globalAlpha = Math.max(0.45, Math.min(1, point.confidence));
      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, point.className === "wall" ? 1.7 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawAutoPoints(ctx, toScreen) {
    ctx.strokeStyle = "#ffb56f";
    ctx.fillStyle = "#ffb56f";
    for (const point of this.obstacles) {
      const screenPoint = toScreen(point);
      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, 6, 0, Math.PI * 2);
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawRobot(ctx, robot, angle) {
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(angle);
    ctx.fillStyle = "#9ce5ba";
    ctx.strokeStyle = "#e0f7e4";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawGrid(ctx, width, height, center, scale) {
    const spacing = Math.max(14, Math.min(48, scale * 0.5));
    ctx.strokeStyle = "rgba(158, 187, 176, .08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ((center.x % spacing) + spacing) % spacing; x < width; x += spacing) {
      ctx.moveTo(x, 0); ctx.lineTo(x, height);
    }
    for (let y = ((center.y % spacing) + spacing) % spacing; y < height; y += spacing) {
      ctx.moveTo(0, y); ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  drawLegacyTunnel(ctx, width, height, center, scale, worldOrigin) {
    ctx.strokeStyle = "rgba(110, 150, 135, .45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const x of [-2, 2]) {
      const screenX = center.x + (x - worldOrigin.x) * scale;
      ctx.moveTo(screenX, center.y - (12 - worldOrigin.y) * scale);
      ctx.lineTo(screenX, center.y - (-12 - worldOrigin.y) * scale);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(143, 176, 157, .6)";
    ctx.font = "8px Consolas, monospace";
    ctx.textAlign = "right";
    ctx.fillText("SYNTHETIC TUNNEL", width - 10, 15);
  }
}
