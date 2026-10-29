export const DEFAULT_WEBSOCKET_URL = "";

export class Esp32Connection {
  constructor({ onStatus, onTelemetry, onError, url = DEFAULT_WEBSOCKET_URL }) {
    this.url = url;
    this.onStatus = onStatus;
    this.onTelemetry = onTelemetry;
    this.onError = onError;
    this.socket = null;
    this.retryTimer = null;
    this.shouldReconnect = false;
  }

  connect(url = this.url) {
    this.shouldReconnect = true;
    if (this.socket && this.url === url &&
        (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    this.clearRetry();
    if (this.socket) {
      const previousSocket = this.socket;
      this.socket = null;
      previousSocket.close();
    }
    this.url = url;
    this.onStatus("connecting");
    try {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.addEventListener("open", () => {
        if (this.socket === socket) this.onStatus("connected");
      });
      socket.addEventListener("message", (event) => {
        if (this.socket !== socket) return;
        try {
          const telemetry = JSON.parse(event.data);
          const validatedTelemetry = validateTelemetry(telemetry);
          if (!validatedTelemetry) throw new Error("Telemetry did not match the expected ESP32 message format.");
          this.onTelemetry(validatedTelemetry);
        } catch (error) {
          this.onError(error instanceof Error ? error.message : "Unable to read ESP32 telemetry.");
        }
      });
      socket.addEventListener("error", () => {
        if (this.socket === socket) this.onError("WebSocket connection error.");
      });
      socket.addEventListener("close", () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.onStatus("disconnected");
        if (this.shouldReconnect) this.retryTimer = window.setTimeout(() => this.connect(), 2500);
      });
    } catch (error) {
      this.socket = null;
      this.onStatus("disconnected");
      this.onError(error instanceof Error ? error.message : "Unable to open WebSocket connection.");
      if (this.shouldReconnect) this.retryTimer = window.setTimeout(() => this.connect(), 2500);
    }
  }

  reconnect(url = this.url) {
    this.shouldReconnect = false;
    this.clearRetry();
    const previousSocket = this.socket;
    this.socket = null;
    if (previousSocket) previousSocket.close();
    this.connect(url);
  }

  disconnect() {
    this.shouldReconnect = false;
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.close();
    this.onStatus("disconnected");
  }

  get isOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  send(command) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(command));
      return true;
    } catch (error) {
      this.onError(error instanceof Error ? error.message : "The ESP32 command could not be sent.");
      return false;
    }
  }

  clearRetry() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

export function validateTelemetry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.mode !== "string" || typeof value.state !== "string" ||
      !Number.isInteger(value.speedLevel) || value.speedLevel < 1 || value.speedLevel > 3 ||
      !Number.isFinite(value.speedCmS) ||
      !value.distanceCm || typeof value.distanceCm !== "object" || Array.isArray(value.distanceCm) ||
      !Number.isFinite(value.headingDeg) ||
      !value.position || typeof value.position !== "object" || Array.isArray(value.position) ||
      !Number.isFinite(value.position.x) || !Number.isFinite(value.position.y)) return null;

  const telemetry = {
    ...value,
    distanceCm: {
      front: validDistance(value.distanceCm.front),
      left: validDistance(value.distanceCm.left),
      right: validDistance(value.distanceCm.right)
    },
    obstacle: typeof value.obstacle === "boolean" ? value.obstacle : undefined,
    obstacleDirection: ["front", "left", "right", "none"].includes(value.obstacleDirection)
      ? value.obstacleDirection : undefined,
    mpuPresent: typeof value.mpuPresent === "boolean" ? value.mpuPresent : undefined,
    wifiConnected: typeof value.wifiConnected === "boolean" ? value.wifiConnected : undefined,
    ip: typeof value.ip === "string" ? value.ip : undefined,
    wifiRssi: Number.isFinite(value.wifiRssi) ? value.wifiRssi : undefined,
    telemetryMs: Number.isFinite(value.telemetryMs) ? value.telemetryMs : undefined,
    seq: Number.isFinite(value.seq) ? value.seq : undefined
  };
  return telemetry;
}

function validDistance(value) {
  return Number.isFinite(value) && value >= 2 && value <= 300 ? value : undefined;
}
