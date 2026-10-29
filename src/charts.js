const MAX_SAMPLES = 90;
const MAX_EVENTS = 80;

export class SpeedChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.samples = [];
    this.scale = Math.min(window.devicePixelRatio || 1, 2);
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(canvas);
  }

  add(speed, timestamp = Date.now()) {
    if (!Number.isFinite(speed)) return;
    this.samples.push({ speed, timestamp });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    this.draw();
  }

  clear() {
    this.samples = [];
    this.draw();
  }

  draw() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    this.scale = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * this.scale));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.scale));
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < 3; i++) {
      const y = (height - 10) * i / 2 + 5;
      ctx.strokeStyle = "rgba(168, 189, 180, .09)";
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    if (!this.samples.length) return;
    const max = Math.max(30, ...this.samples.map((item) => Math.abs(item.speed))) * 1.1;
    const baseline = height / 2;
    const points = this.samples.map((sample, index) => ({
      x: 2 + index * (width - 4) / Math.max(1, this.samples.length - 1),
      y: baseline - sample.speed / max * (height / 2 - 6)
    }));
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(92, 207, 151, .2)");
    gradient.addColorStop(1, "rgba(92, 207, 151, 0)");
    ctx.beginPath();
    ctx.moveTo(points[0].x, baseline);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, baseline);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.strokeStyle = "#72d69b";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, baseline);
    ctx.lineTo(width, baseline);
    ctx.strokeStyle = "rgba(168, 189, 180, .28)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export class EventHistory {
  constructor(container, counter) {
    this.container = container;
    this.counter = counter;
    this.events = [];
  }

  add(type, message, timestamp = new Date()) {
    this.events.unshift({ type, message, timestamp });
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
    this.render();
  }

  clear() {
    this.events = [];
    this.render();
  }

  render() {
    this.container.replaceChildren();
    if (!this.events.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Events will appear here as telemetry arrives.";
      this.container.append(empty);
    }
    for (const event of this.events) {
      const row = document.createElement("div");
      row.className = "event-row";
      const icon = document.createElement("span");
      icon.className = `event-icon ${event.type}`;
      icon.textContent = eventIcon(event.type);
      const copy = document.createElement("span");
      copy.className = "event-copy";
      const message = document.createElement("strong");
      message.textContent = event.message;
      const time = document.createElement("small");
      time.textContent = event.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      copy.append(message, time);
      row.append(icon, copy);
      this.container.append(row);
    }
    this.counter.textContent = `${this.events.length} event${this.events.length === 1 ? "" : "s"}`;
  }
}

function eventIcon(type) {
  return ({ obstacle: "!", turn: "↻", stop: "■", connection: "↔", fault: "⚠", info: "•" })[type] || "•";
}
