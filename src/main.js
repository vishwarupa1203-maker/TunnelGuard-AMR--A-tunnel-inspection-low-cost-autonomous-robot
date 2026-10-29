import "./style.css";
import { Esp32Connection } from "./esp32.js";
import { DemoSimulation } from "./demo-data.js";
import { Map2D } from "./map2d.js";
import { EventHistory, SpeedChart } from "./charts.js";
import { renderCameraFrame } from "./camera-renderer.js";

const STALE_AFTER_MS = 1500;
const SPEED_MAX_CM_S = 60;
const MANUAL_COMMAND_INTERVAL_MS = 200;
const SPEED_PWM_BY_LEVEL = Object.freeze([110, 150, 190]);
const WEBSOCKET_URL_STORAGE_KEY = "tunnelguard.esp32.websocketUrl";
const knownStates = new Set([
  "FORWARD", "TURNING_LEFT", "TURNING_RIGHT", "BLOCKED", "STOPPED",
  "MANUAL_FORWARD", "MANUAL_REVERSE", "MANUAL_LEFT", "MANUAL_RIGHT",
  "EMERGENCY_STOP", "CLIENT_DISCONNECTED", "WIFI_DISCONNECTED",
  "MANUAL_COMMAND_TIMEOUT", "AUTO_FORWARD", "AUTO_FORWARD_SLOW", "AUTO_TURN_LEFT",
  "AUTO_TURN_RIGHT", "AUTO_OBSTACLE_STOP", "AUTO_BLOCKED", "AUTO_BYPASS_FORWARD",
  "AUTO_BYPASS_BLOCKED", "AUTO_RECHECK_FRONT", "AUTO_FRONT_SENSOR_FAULT"
]);
const elements = {
  mode: document.querySelector("#modeSelect"),
  websocketForm: document.querySelector("#connectionForm"),
  websocketUrl: document.querySelector("#websocketUrl"),
  connectionBox: document.querySelector("#connectionBox"),
  connectionDot: document.querySelector("#connectionDot"),
  connectionText: document.querySelector("#connectionText"),
  wifiStatusDot: document.querySelector("#wifiStatusDot"),
  wifiStatusText: document.querySelector("#wifiStatusText"),
  telemetryStatusDot: document.querySelector("#telemetryStatusDot"),
  telemetryStatusText: document.querySelector("#telemetryStatusText"),
  disconnect: document.querySelector("#disconnectButton"),
  connectionError: document.querySelector("#connectionErrorValue"),
  esp32Ip: document.querySelector("#esp32IpValue"),
  wifiRssi: document.querySelector("#wifiRssiValue"),
  sequence: document.querySelector("#sequenceValue"),
  telemetryAge: document.querySelector("#telemetryAgeValue"),
  safetyBanner: document.querySelector("#safetyBanner"),
  staleBanner: document.querySelector("#staleBanner"),
  demoBanner: document.querySelector("#demoBanner"),
  reconnect: document.querySelector("#reconnectButton"),
  stop: document.querySelector("#stopButton"),
  manualStop: document.querySelector("#manualStopButton"),
  manualStopInline: document.querySelector("#manualStopInlineButton"),
  manualPanel: document.querySelector("#manualPanel"),
  manualButtons: document.querySelectorAll("[data-manual-action]"),
  startAuto: document.querySelector("#startAutoButton"),
  stopAuto: document.querySelector("#stopAutoButton"),
  resetStop: document.querySelector("#resetStopButton"),
  dataTag: document.querySelector("#dataTag"),
  gaugeProgress: document.querySelector("#gaugeProgress"),
  gaugeTicks: document.querySelector("#gaugeTicks"),
  speedValue: document.querySelector("#speedValue"),
  speedKmh: document.querySelector("#speedKmh"),
  speedLevel: document.querySelector("#speedLevel"),
  levelIndicator: document.querySelector("#levelIndicator"),
  robotState: document.querySelector("#robotState"),
  stateCaption: document.querySelector("#stateCaption"),
  commandNote: document.querySelector("#commandNote"),
  heading: document.querySelector("#headingValue"),
  position: document.querySelector("#positionValue"),
  mpu: document.querySelector("#mpuValue"),
  wifi: document.querySelector("#wifiValue"),
  ledDot: document.querySelector("#ledDot"),
  ledStatus: document.querySelector("#ledStatus"),
  chartSource: document.querySelector("#chartSource"),
  lastPacket: document.querySelector("#lastPacketText"),
  mapHint: document.querySelector("#mapHint"),
  mapDataStatus: document.querySelector("#mapDataStatus"),
  mapResetPosition: document.querySelector("#resetPositionButton"),
  resetMap: document.querySelector("#resetMapButton"),
  sensorWarning: document.querySelector("#sensorWarning"),
  tunnelPanel: document.querySelector("#tunnelPanel"),
  tunnelUnavailable: document.querySelector("#tunnelUnavailable"),
  mapPage: document.querySelector("#mapPage"),
  scanSummary: document.querySelector("#scanSummary"),
  scanValidation: document.querySelector("#scanValidation"),
  detectionList: document.querySelector("#detectionList"),
  cameraCanvas: document.querySelector("#inspectionCameraCanvas"),
  cameraTimestamp: document.querySelector("#cameraTimestamp"),
  cameraFindings: document.querySelector("#cameraFindings"),
  simulationToggle: document.querySelector("#simulationToggle"),
  simulationSpeed: document.querySelector("#simulationSpeed"),
  lidarResolution: document.querySelector("#lidarResolution"),
  scanRate: document.querySelector("#scanRate"),
  events: document.querySelector("#eventList"),
  eventCount: document.querySelector("#eventCount"),
  toastContainer: document.querySelector("#toastContainer")
};

const map = new Map2D(document.querySelector("#mapCanvas"), {
  onHintChange: (text) => {
    elements.mapHint.textContent = text;
    elements.mapHint.classList.toggle("hidden", !text);
  }
});
const speedChart = new SpeedChart(document.querySelector("#speedChart"));
const eventHistory = new EventHistory(elements.events, elements.eventCount);
const demo = new DemoSimulation();
let tunnelViewer = null;
let renderedScanId = -1;
let renderedCameraFrameId = -1;
let renderedMapScanId = -1;

let mode = "auto";
let connectionStatus = "disconnected";
let telemetryStatus = "disconnected";
let latestTelemetry = null;
let lastReceivedTelemetry = null;
let lastPacketAt = 0;
let lastTelemetryAt = 0;
let connectedAt = 0;
let stale = true;
let previousState = null;
let previousObstacle = false;
let previousConnectionStatus = null;
let lastDemoTick = performance.now();
let lastError = "";
let lastErrorAt = 0;
let activeManualAction = null;
let manualCommandTimer = null;
let selectedSpeedLevel = 1;
let emergencyStopRequested = false;
let resetStopPending = false;

const esp32 = new Esp32Connection({
  onStatus: handleConnectionStatus,
  onTelemetry: handleTelemetry,
  onError: (message) => {
    const now = Date.now();
    if (isLiveMode() && (message !== lastError || now - lastErrorAt > 10000)) {
      showToast(message, "warning");
      lastError = message;
      lastErrorAt = now;
      elements.connectionError.textContent = `Last connection error: ${message}`;
      elements.connectionError.classList.remove("hidden");
    }
  }
});

createGaugeTicks();
const savedWebSocketUrl = readSavedWebSocketUrl();
if (savedWebSocketUrl && isWebSocketUrl(savedWebSocketUrl)) {
  elements.websocketUrl.value = savedWebSocketUrl;
}
bindControls();
applyPageNavigation();
updateAutomaticState();
setConnectionDisplay(connectionStatus);
updatePhysicalControls();
if (savedWebSocketUrl && mode !== "demo") esp32.connect(savedWebSocketUrl);
requestAnimationFrame(animationLoop);

function bindControls() {
  elements.mode.addEventListener("change", () => switchMode(elements.mode.value));
  elements.websocketForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = elements.websocketUrl.value.trim();
    if (!isWebSocketUrl(url)) {
      showToast("Enter a valid ws:// or wss:// ESP32 URL.", "warning");
      elements.websocketUrl.focus();
      return;
    }
    saveWebSocketUrl(url);
    if (!isLiveMode()) {
      elements.mode.value = "auto";
      switchMode("auto", url);
    } else {
      esp32.reconnect(url);
    }
  });
  elements.reconnect.addEventListener("click", () => {
    const url = elements.websocketUrl.value.trim();
    if (!isLiveMode() || !isWebSocketUrl(url)) {
      showToast("Enter a valid ESP32 WebSocket URL and select a live mode first.", "warning");
      return;
    }
    saveWebSocketUrl(url);
    esp32.reconnect(url);
  });
  elements.disconnect.addEventListener("click", () => {
    stopManualDrive();
    esp32.disconnect();
  });
  elements.stop.addEventListener("click", sendEmergencyStop);
  elements.manualStop.addEventListener("click", sendManualStop);
  elements.manualStopInline.addEventListener("click", sendManualStop);
  elements.startAuto.addEventListener("click", () => sendSupportedCommand({ command: "START_AUTO" }, "Autonomous start"));
  elements.stopAuto.addEventListener("click", sendAutomaticStop);
  elements.resetStop.addEventListener("click", () => sendSupportedCommand({ command: "RESET_STOP" }, "Stop reset"));
  elements.manualButtons.forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      startManualAction(button.dataset.manualAction);
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(eventName, stopManualDrive);
    }
    button.addEventListener("keydown", (event) => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat) {
        event.preventDefault();
        startManualAction(button.dataset.manualAction);
      }
    });
    button.addEventListener("keyup", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        stopManualDrive();
      }
    });
  });
  window.addEventListener("blur", stopManualDrive);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopManualDrive();
  });
  document.querySelectorAll(".speed-option").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isLiveMode() || !isTelemetryFresh() || latestTelemetry?.wifiConnected === false ||
          validState(latestTelemetry?.state) === "EMERGENCY_STOP") return;
      const level = Number(button.dataset.level);
      if (!Number.isInteger(level) || level < 1 || level > SPEED_PWM_BY_LEVEL.length) return;
      if (esp32.send({ command: "SET_SPEED", level })) {
        selectedSpeedLevel = level;
        for (const option of document.querySelectorAll(".speed-option")) {
          const selected = Number(option.dataset.level) === level;
          option.classList.toggle("selected", selected);
          option.setAttribute("aria-pressed", String(selected));
        }
        eventHistory.add("info", `Speed level ${level} command sent; awaiting telemetry confirmation`);
        elements.commandNote.textContent = `Level ${level} command sent; telemetry confirmation pending.`;
      } else {
        showToast("Speed command not sent: ESP32 is disconnected.", "warning");
      }
    });
  });
  elements.resetMap.addEventListener("click", () => {
    map.resetHistory();
    if (mode === "demo") map.setDemoFrame(demo.frame);
    updateMapDataStatus();
  });
  document.querySelector("#zoomInButton").addEventListener("click", () => map.zoomBy(1.2));
  document.querySelector("#zoomOutButton").addEventListener("click", () => map.zoomBy(0.83));
  elements.mapResetPosition.addEventListener("click", () => {
    if (!isTelemetryFresh() || !esp32.send({ command: "RESET_POSITION" })) {
      showToast("Position reset not sent: fresh telemetry and an open ESP32 connection are required.", "warning");
      return;
    }
    eventHistory.add("info", "RESET_POSITION command sent; awaiting telemetry");
  });
  document.querySelector("#clearEventsButton").addEventListener("click", () => eventHistory.clear());
  elements.simulationToggle.addEventListener("click", () => {
    demo.setPlaying(!demo.playing);
    elements.simulationToggle.textContent = demo.playing ? "Pause" : "Play";
    eventHistory.add("info", `Synthetic simulation ${demo.playing ? "resumed" : "paused"}`);
  });
  elements.simulationSpeed.addEventListener("change", () => demo.setSpeed(Number(elements.simulationSpeed.value)));
  const configureLidar = () => {
    try {
      demo.configureScanner({
        angularResolutionDeg: Number(elements.lidarResolution.value),
        updateRateHz: Number(elements.scanRate.value)
      });
      renderedScanId = -1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update simulated LiDAR settings.";
      showToast(message, "warning");
    }
  };
  elements.lidarResolution.addEventListener("change", configureLidar);
  elements.scanRate.addEventListener("change", configureLidar);
  document.querySelector("#resetCameraButton").addEventListener("click", () => tunnelViewer?.resetCamera());
  window.addEventListener("hashchange", applyPageNavigation);
}

function applyPageNavigation() {
  const pages = ["dashboard", "map", "3d-view"];
  const selectedPage = pages.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard";
  for (const page of pages) {
    const active = page === selectedPage;
    document.querySelector(`#${page === "dashboard" ? "dashboard" : page === "map" ? "map" : "threeD"}Page`).classList.toggle("hidden", !active);
    const link = document.querySelector(`[data-page-link="${page}"]`);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (selectedPage === "map") {
    map.resize();
    if (mode === "demo") {
      map.setDemoFrame(demo.frame);
      renderedMapScanId = demo.frame.scan.scanId;
    }
    else {
      if (isTelemetryFresh()) map.draw();
      else {
        map.clearCurrentPose();
        map.draw(null);
        setUnavailableMapHint();
      }
    }
    updateMapDataStatus();
  }
  if (selectedPage === "3d-view") tunnelViewer?.resize();
}

function switchMode(nextMode, connectionUrl) {
  if (!["auto", "manual", "demo"].includes(nextMode)) return;
  if (mode === nextMode) return;
  const previousMode = mode;
  stopManualDrive();
  if (isLiveMode(previousMode) && nextMode === "demo") esp32.disconnect();
  if (previousMode === "auto" && nextMode === "manual" && connectionStatus === "connected") {
    if (esp32.send({ command: "STOP" })) {
      eventHistory.add("stop", "STOP command sent while entering Manual Mode");
    } else {
      showToast("Could not send STOP while changing modes; automatic mode may remain active until telemetry or firmware stops it.", "warning");
    }
  }
  mode = nextMode;
  if ((previousMode === "demo") !== (nextMode === "demo")) {
    latestTelemetry = null;
    lastPacketAt = 0;
    connectedAt = 0;
    stale = true;
    telemetryStatus = connectionStatus === "connected" ? "waiting" : "disconnected";
    previousState = null;
    previousObstacle = false;
    speedChart.clear();
    map.clear();
    renderedMapScanId = -1;
  }
  eventHistory.add("connection", nextMode === "demo"
    ? "Demo Mode selected; no physical commands will be sent"
    : `${nextMode === "auto" ? "Automatic" : "Manual"} Mode selected; waiting for fresh ESP32 telemetry`);
  if (mode === "demo") {
    demo.reset();
    elements.simulationToggle.textContent = "Pause";
    elements.chartSource.textContent = "Synthetic demo";
    elements.tunnelPanel.classList.remove("hidden");
    elements.demoBanner.classList.remove("hidden");
    elements.safetyBanner.classList.add("hidden");
    elements.staleBanner.classList.add("hidden");
    setConnectionDisplay("demo");
    elements.dataTag.textContent = "SYNTHETIC DEMO DATA";
    void activateDemoViewer();
  } else {
    elements.tunnelPanel.classList.add("hidden");
    elements.demoBanner.classList.add("hidden");
    elements.chartSource.textContent = "No samples";
    elements.dataTag.textContent = "WAITING FOR TELEMETRY";
    if (connectionUrl) {
      elements.websocketUrl.value = connectionUrl;
      saveWebSocketUrl(connectionUrl);
    }
    if (elements.websocketUrl.value.trim()) esp32.connect(connectionUrl || elements.websocketUrl.value.trim());
    else {
      connectionStatus = "disconnected";
      telemetryStatus = "disconnected";
      elements.lastPacket.textContent = "No telemetry received";
    }
  }

  async function activateDemoViewer() {
    if (tunnelViewer || mode !== "demo") return;
    try {
      const { TunnelViewer } = await import("./tunnel3d.js");
      if (mode === "demo" && !tunnelViewer) {
        tunnelViewer = new TunnelViewer(document.querySelector("#tunnelCanvas"), demo.environment);
        tunnelViewer.updateFrame(demo.frame);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The 3D tunnel viewer could not be initialized.";
      eventHistory.add("fault", `3D viewer unavailable: ${message}`);
      showToast("The 3D tunnel viewer could not be initialized in this browser.", "warning");
    }
  }
  updateAutomaticState();
  updateMapDataStatus();
  updatePhysicalControls();
  renderUnavailable();
}

function handleConnectionStatus(status) {
  connectionStatus = status;
  if (mode === "demo") {
    setConnectionDisplay("demo");
    updatePhysicalControls();
    return;
  }
  if (status === "connecting") {
    lastPacketAt = 0;
    telemetryStatus = "waiting";
    elements.lastPacket.textContent = "Waiting for telemetry from this connection";
  }
  if (status !== "connected" && activeManualAction) stopManualDrive();
  if (status === "connected") {
    connectedAt = Date.now();
    telemetryStatus = "waiting";
    stale = false;
  }
  else if (status === "connecting") connectedAt = 0;
  if (status !== "connected") {
    telemetryStatus = status === "connecting" ? "waiting" : "disconnected";
    latestTelemetry = null;
  }
  setConnectionDisplay(status);
  elements.safetyBanner.classList.toggle("hidden", status !== "disconnected");
  elements.staleBanner.classList.toggle("hidden", status !== "connected" || telemetryStatus !== "stale");
  if (previousConnectionStatus !== status) {
    const text = status === "connected" ? "ESP32 WebSocket connected; waiting for telemetry" : status === "connecting" ? "Connecting to ESP32" : "ESP32 disconnected; physical rover state is unknown";
    eventHistory.add("connection", text);
    previousConnectionStatus = status;
  }
  if (status !== "connected") {
    stale = true;
    elements.dataTag.textContent = status === "connecting" ? "WAITING FOR TELEMETRY" : "LINK DISCONNECTED";
    elements.dataTag.classList.remove("is-stale");
    renderUnavailable();
  } else if (!isTelemetryFresh()) {
    elements.dataTag.textContent = "WAITING FOR TELEMETRY";
    elements.commandNote.textContent = "Connected; waiting for fresh telemetry before enabling physical controls.";
  }
  updateMapDataStatus();
}

function handleTelemetry(telemetry) {
  if (!isLiveMode() || connectionStatus !== "connected") return;
  const reportedState = validState(telemetry.state);
  if (reportedState === "EMERGENCY_STOP") {
    emergencyStopRequested = true;
    resetStopPending = false;
  }
  else if (resetStopPending) {
    emergencyStopRequested = false;
    resetStopPending = false;
  }
  if (telemetry.wifiConnected === false && activeManualAction) stopManualDrive();
  latestTelemetry = telemetry;
  lastPacketAt = Date.now();
  lastTelemetryAt = lastPacketAt;
  lastReceivedTelemetry = telemetry;
  stale = false;
  telemetryStatus = "live";
  setConnectionDisplay("connected");
  elements.dataTag.classList.remove("is-stale");
  elements.staleBanner.classList.add("hidden");
  updateDashboard(telemetry, "live");
  elements.safetyBanner.classList.add("hidden");
  elements.staleBanner.classList.add("hidden");
  elements.dataTag.textContent = "LIVE DATA";
  elements.lastPacket.textContent = `Last packet ${new Date(lastPacketAt).toLocaleTimeString()}`;
  speedChart.add(telemetry.speedCmS, lastPacketAt);
  elements.chartSource.textContent = "Live ESP32";
  updatePhysicalControls();
  addTelemetryEvents(telemetry);
}

function animationLoop(now) {
  if (mode === "demo") {
    const delta = Math.max(0, (now - lastDemoTick) / 1000);
    lastDemoTick = now;
    const telemetry = demo.tick(delta);
    latestTelemetry = telemetry;
    stale = false;
    updateDashboard(telemetry, "demo");
    updateDemoVisualizations(demo.frame);
    elements.dataTag.textContent = "SYNTHETIC DEMO DATA";
    elements.dataTag.classList.remove("is-stale");
    elements.lastPacket.textContent = "Synthetic data · local simulation";
    if (demo.playing) {
      speedChart.add(telemetry.speedCmS, now);
      addTelemetryEvents(telemetry);
    }
    updatePhysicalControls();
  } else {
    const freshnessAnchor = lastPacketAt || connectedAt;
    if (connectionStatus === "connected" && freshnessAnchor
        && Date.now() - freshnessAnchor > STALE_AFTER_MS && telemetryStatus !== "stale") {
      stopManualDrive();
      stale = true;
      telemetryStatus = "stale";
      latestTelemetry = null;
      elements.staleBanner.classList.remove("hidden");
      setConnectionDisplay("connected");
      elements.dataTag.textContent = "TELEMETRY STALE";
      elements.dataTag.classList.add("is-stale");
      eventHistory.add("connection", "Telemetry stale; live readings no longer current");
      renderUnavailable();
      updateMapDataStatus();
    }
    updateTelemetryAge();
    updatePhysicalControls();
  }
  requestAnimationFrame(animationLoop);
}

function updateDashboard(telemetry, source) {
  if (!telemetry) return;
  const speed = Number.isFinite(telemetry.speedCmS) ? telemetry.speedCmS : null;
  const level = Number.isInteger(telemetry.speedLevel) && telemetry.speedLevel >= 1 && telemetry.speedLevel <= 3 ? telemetry.speedLevel : null;
  if (source === "live" && level !== null) selectedSpeedLevel = level;
  const speedRatio = speed === null ? 0 : Math.min(Math.abs(speed) / SPEED_MAX_CM_S, 1);
  const circumference = 352;
  elements.gaugeProgress.style.strokeDasharray = `${circumference * speedRatio} ${circumference}`;
  elements.gaugeProgress.classList.remove("slow", "medium", "fast");
  elements.gaugeProgress.classList.add(level === 1 ? "slow" : level === 2 ? "medium" : level === 3 ? "fast" : "slow");
  elements.speedValue.textContent = speed === null ? "--" : speed.toFixed(1);
  elements.speedKmh.textContent = speed === null ? "-- km/h" : `${(speed * 0.036).toFixed(2)} km/h`;
  elements.speedLevel.innerHTML = level === null ? `-- <small>/ 3</small>` : `${level} <small>/ 3</small>`;
  elements.levelIndicator.className = `level-indicator ${level ? `level-${level}` : ""}`;
  for (const button of document.querySelectorAll(".speed-option")) {
    const selected = Number(button.dataset.level) === level;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  elements.robotState.textContent = validState(telemetry.state);
  elements.robotState.className = `state-value ${stateClass(telemetry.state)}`;
  elements.stateCaption.textContent = source === "demo" ? "Synthetic rover status" : "Reported by ESP32";
  for (const direction of ["front", "left", "right"]) {
    updateSensorCard(direction, telemetry.distanceCm?.[direction]);
  }
  elements.heading.innerHTML = Number.isFinite(telemetry.headingDeg) ? `${normaliseHeading(telemetry.headingDeg).toFixed(1)}<small>°</small>` : `--<small>°</small>`;
  elements.position.innerHTML = Number.isFinite(telemetry.position?.x) && Number.isFinite(telemetry.position?.y)
    ? `${(telemetry.position.x / 100).toFixed(2)}, ${(telemetry.position.y / 100).toFixed(2)}<small> m</small>` : `--, --<small> m</small>`;
  elements.mpu.textContent = typeof telemetry.mpuPresent === "boolean" ? (telemetry.mpuPresent ? "PRESENT" : "MISSING") : "UNKNOWN";
  elements.mpu.className = typeof telemetry.mpuPresent === "boolean" ? (telemetry.mpuPresent ? "good-value" : "bad-value") : "muted-value";
  elements.wifi.textContent = source === "demo" ? "SIMULATED"
    : typeof telemetry.wifiConnected === "boolean" ? (telemetry.wifiConnected ? "CONNECTED" : "OFFLINE") : "UNKNOWN";
  elements.esp32Ip.textContent = source === "demo" || telemetry.wifiConnected === false
    ? "--" : telemetry.ip || "--";
  elements.wifiRssi.textContent = source === "demo" || telemetry.wifiConnected !== true ||
    !Number.isFinite(telemetry.wifiRssi) || telemetry.wifiRssi >= 0
    ? "--" : `${telemetry.wifiRssi} dBm`;
  elements.sequence.textContent = source === "demo" || !Number.isFinite(telemetry.seq) ? "--" : String(telemetry.seq);
  if (source === "demo") {
    elements.sensorWarning.textContent = "Demo Mode uses synthetic sensors; these are not physical measurements.";
    elements.telemetryAge.textContent = "SIMULATED";
  }
  if (source === "live") {
    const frontValid = Number.isFinite(telemetry.distanceCm?.front);
    const sideSensorsValid = Number.isFinite(telemetry.distanceCm?.left) &&
      Number.isFinite(telemetry.distanceCm?.right);
    elements.sensorWarning.textContent = !frontValid
      ? "FRONT SENSOR UNAVAILABLE — automatic start is disabled; never treat this reading as clear space."
      : !sideSensorsValid
        ? "SIDE SENSOR WARNING — automatic avoidance may stop if it cannot confirm a clear turn."
        : "Live sensor readings received. Automatic behavior is firmware-controlled; test in a clear area.";
    setConnectionDisplay(connectionStatus);
  }
  updateLedInference(telemetry);
  if (source === "demo") {
    if (window.location.hash === "#map" && demo.frame.scan.scanId !== renderedMapScanId) {
      map.setDemoFrame(demo.frame);
      renderedMapScanId = demo.frame.scan.scanId;
    }
  } else {
    map.setData(telemetry, { source: "live" });
  }
  if (source === "demo") {
    for (const button of document.querySelectorAll(".speed-option")) button.disabled = true;
    elements.commandNote.textContent = "Synthetic simulation only. Physical speed controls are disabled.";
    elements.mapResetPosition.classList.add("hidden");
    elements.startAuto.disabled = true;
    elements.resetStop.disabled = true;
    elements.manualButtons.forEach((button) => { button.disabled = true; });
    elements.manualStop.disabled = true;
  }
  updateMapDataStatus();
}

function updateDemoVisualizations(frame) {
  if (!frame) return;
  tunnelViewer?.updateFrame(frame);
  if (frame.scan && frame.scan.scanId !== renderedScanId) {
    const scan = frame.scan;
    const validCount = scan.points.length;
    const totalCount = scan.options.verticalLayersDeg.length
      * (Math.floor(scan.options.fieldOfViewDeg / scan.options.angularResolutionDeg) + 1);
    elements.scanSummary.textContent =
      `SCAN ${String(scan.scanId).padStart(3, "0")} · ${validCount}/${totalCount} valid returns · ${scan.options.fieldOfViewDeg}° FOV · ${scan.options.verticalLayersDeg.length} layers · ${scan.options.maxRangeM} m max`;
    const agreement = Math.round(scan.validation.agreement * 100);
    elements.scanValidation.textContent =
      `SIMULATION VALIDATION ONLY · ${agreement}% agreement with hidden synthetic ground truth (${scan.validation.correct}/${scan.validation.total} classified returns). This is not a real-world accuracy score.`;
    renderDetections(elements.detectionList, scan.detections);
    renderedScanId = scan.scanId;
  }
  if (frame.cameraFrame && frame.cameraFrame.frameId !== renderedCameraFrameId) {
    const cameraFrame = frame.cameraFrame;
    renderCameraFrame(elements.cameraCanvas, cameraFrame);
    elements.cameraTimestamp.textContent = `FRAME ${String(cameraFrame.frameId).padStart(3, "0")} · SIMULATED`;
    renderCameraFindings(elements.cameraFindings, cameraFrame.observations);
    renderedCameraFrameId = cameraFrame.frameId;
  }
}

function renderDetections(container, detections) {
  container.replaceChildren();
  if (!detections.length) {
    const empty = document.createElement("span");
    empty.className = "empty-detections";
    empty.textContent = "No separate object clusters in the latest scan.";
    container.append(empty);
    return;
  }
  for (const detection of detections.slice(0, 5)) {
    const row = document.createElement("div");
    row.className = `detection-row class-${detection.className}`;
    const label = document.createElement("strong");
    label.textContent = `${displayClass(detection.className)} · ${Math.round(detection.confidence * 100)}%`;
    const detail = document.createElement("small");
    detail.textContent = `${detection.pointCount} points · X ${detection.center.x.toFixed(1)} m, Y ${detection.center.y.toFixed(1)} m${detection.note ? ` · ${detection.note}` : ""}`;
    row.append(label, detail);
    container.append(row);
  }
}

function renderCameraFindings(container, observations) {
  container.replaceChildren();
  if (!observations.length) {
    const empty = document.createElement("span");
    empty.className = "empty-detections";
    empty.textContent = "No surface findings visible in the current camera frame.";
    container.append(empty);
    return;
  }
  for (const finding of observations.slice(0, 4)) {
    const row = document.createElement("div");
    row.className = `camera-finding ${finding.className}`;
    row.textContent = `${displayClass(finding.className)} · ${finding.distanceM.toFixed(1)} m · ${Math.round(finding.confidence * 100)}%`;
    container.append(row);
  }
}

function displayClass(className) {
  return className.charAt(0).toUpperCase() + className.slice(1);
}

function updateSensorCard(direction, distance) {
  const card = document.querySelector(`[data-sensor="${direction}"]`);
  const valid = Number.isFinite(distance) && distance >= 0;
  card.classList.remove("clear", "nearby", "critical", "unknown");
  const status = card.querySelector(".sensor-status");
  const value = card.querySelector(".sensor-value");
  if (!valid) {
    card.classList.add("unknown");
    status.textContent = "UNAVAILABLE";
    value.textContent = "--";
    return;
  }
  const condition = distance < 20 ? "critical" : distance < 50 ? "nearby" : "clear";
  card.classList.add(condition);
  status.textContent = condition === "clear" ? "CLEAR" : condition === "nearby" ? "NEAR" : "CRITICAL";
  value.textContent = Number.isInteger(distance) ? String(distance) : distance.toFixed(1);
}

function updateLedInference(telemetry) {
  const state = validState(telemetry.state);
  let color = "unknown";
  let text = "Unknown state";
  if (state.includes("BLOCKED") || state.includes("FAULT")) { color = "red"; text = "Red · inferred fault/blocked state"; }
  else if (state === "STOPPED") { color = "blue"; text = "Blue · inferred stopped state"; }
  else if (state.includes("TURNING") || state === "MANUAL_LEFT" || state === "MANUAL_RIGHT") { color = "amber"; text = "Amber · inferred turning state"; }
  else if (state.includes("FORWARD")) { color = "green"; text = "Green · inferred forward state"; }
  elements.ledDot.className = `led-dot ${color}`;
  elements.ledStatus.textContent = text;
}

function renderUnavailable() {
  if (!isLiveMode()) return;
  elements.gaugeProgress.style.strokeDasharray = `0 ${352}`;
  elements.levelIndicator.className = "level-indicator";
  for (const button of document.querySelectorAll(".speed-option")) {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  }
  elements.speedValue.textContent = "--";
  elements.speedKmh.textContent = "-- km/h";
  elements.speedLevel.innerHTML = `-- <small>/ 3</small>`;
  elements.robotState.textContent = "UNKNOWN";
  elements.robotState.className = "state-value unknown";
  elements.stateCaption.textContent = connectionStatus === "connected" ? "Waiting for fresh status" : "Physical rover state is unknown";
  elements.heading.innerHTML = `--<small>°</small>`;
  elements.position.innerHTML = `--, --<small> m</small>`;
  elements.mpu.textContent = "UNKNOWN";
  elements.mpu.className = "muted-value";
  elements.wifi.textContent = telemetryStatus === "stale" ? "STALE" : "--";
  elements.esp32Ip.textContent = lastReceivedTelemetry?.wifiConnected === false
    ? "--" : lastReceivedTelemetry?.ip || "--";
  elements.wifiRssi.textContent = lastReceivedTelemetry?.wifiConnected === true &&
    Number.isFinite(lastReceivedTelemetry.wifiRssi) && lastReceivedTelemetry.wifiRssi < 0
    ? `${lastReceivedTelemetry.wifiRssi} dBm` : "--";
  elements.sequence.textContent = Number.isFinite(lastReceivedTelemetry?.seq)
    ? String(lastReceivedTelemetry.seq) : "--";
  elements.telemetryAge.textContent = lastTelemetryAt
    ? `${((Date.now() - lastTelemetryAt) / 1000).toFixed(1)} s ago` : "--";
  elements.ledDot.className = "led-dot unknown";
  elements.ledStatus.textContent = "Unknown — telemetry unavailable";
  for (const direction of ["front", "left", "right"]) updateSensorCard(direction, undefined);
  map.clearCurrentPose();
  map.draw();
  setUnavailableMapHint();
  elements.commandNote.textContent = connectionStatus === "connected"
    ? "Waiting for fresh telemetry before enabling physical controls."
    : "Speed controls unavailable while the ESP32 is disconnected.";
  elements.sensorWarning.textContent = "Sensor readings are unavailable; they must never be treated as clear space.";
  updatePhysicalControls();
}

function updatePhysicalControls() {
  const liveAvailable = isTelemetryFresh() && latestTelemetry?.wifiConnected !== false;
  const firmwareStopped = validState(latestTelemetry?.state) === "EMERGENCY_STOP";
  const stopped = emergencyStopRequested || firmwareStopped;
  const frontValid = Number.isFinite(latestTelemetry?.distanceCm?.front);
  for (const button of document.querySelectorAll(".speed-option")) button.disabled = !liveAvailable || stopped;
  elements.startAuto.classList.toggle("hidden", mode !== "auto");
  elements.startAuto.disabled = mode !== "auto" || !liveAvailable || !frontValid || stopped;
  elements.stopAuto.classList.toggle("hidden", mode !== "auto");
  elements.stopAuto.disabled = mode !== "auto" || connectionStatus !== "connected";
  elements.resetStop.classList.toggle("hidden", !isLiveMode() || !stopped);
  elements.resetStop.disabled = !liveAvailable || !stopped || resetStopPending;
  elements.manualButtons.forEach((button) => {
    button.disabled = mode !== "manual" || !liveAvailable || stopped;
  });
  elements.manualStop.disabled = mode !== "manual" || connectionStatus !== "connected";
  elements.manualStopInline.classList.toggle("hidden", mode !== "manual");
  elements.manualStopInline.disabled = mode !== "manual" || connectionStatus !== "connected";
  elements.stop.disabled = !isLiveMode() || connectionStatus !== "connected";
  elements.mapResetPosition.classList.toggle("hidden", !isLiveMode());
  elements.mapResetPosition.disabled = !liveAvailable;
  elements.disconnect.disabled = connectionStatus === "disconnected";
}

function sendSupportedCommand(command, label) {
  const invalidFrontForAuto = command.command === "START_AUTO" &&
    !Number.isFinite(latestTelemetry?.distanceCm?.front);
  if (!isTelemetryFresh() || latestTelemetry?.wifiConnected === false ||
      invalidFrontForAuto || !esp32.send(command)) {
    if (invalidFrontForAuto) {
      showToast("Automatic start blocked: the front ultrasonic reading is unavailable.", "warning");
      return;
    }
    showToast(`${label} command not sent: fresh telemetry and an open ESP32 connection are required.`, "warning");
    return;
  }
  if (command.command === "RESET_STOP") resetStopPending = true;
  eventHistory.add("info", `${command.command} command sent; awaiting telemetry confirmation`);
  updatePhysicalControls();
}

function sendAutomaticStop() {
  stopManualDrive();
  if (mode !== "auto" || connectionStatus !== "connected" ||
      !esp32.send({ command: "STOP" })) {
    showToast("Stop command not sent: the ESP32 WebSocket is disconnected.", "warning");
    return;
  }
  eventHistory.add("stop", "STOP command sent; awaiting telemetry confirmation");
}

function sendEmergencyStop() {
  if (!isLiveMode()) {
    showToast("Demo Mode is active. No physical STOP command was sent.", "warning");
    return;
  }
  stopManualDrive();
  if (!esp32.send({ command: "EMERGENCY_STOP" })) {
    showToast("STOP command could not be sent: ESP32 is disconnected. The rover may still be moving.", "warning");
    eventHistory.add("stop", "STOP could not be sent; ESP32 disconnected, rover state unknown");
    return;
  }
  emergencyStopRequested = true;
  resetStopPending = false;
  updatePhysicalControls();
  showToast("EMERGENCY_STOP sent to the ESP32; awaiting telemetry confirmation.", "warning", 7000);
  eventHistory.add("stop", "EMERGENCY_STOP command sent; awaiting telemetry confirmation");
}

function startManualAction(action) {
  if (activeManualAction === action || !isManualControlAvailable()) return;
  if (activeManualAction) stopManualDrive();
  if (!sendManualAction(action)) return;
  activeManualAction = action;
  manualCommandTimer = window.setInterval(() => {
    if (!isManualControlAvailable()) {
      showToast("Manual drive stopped because fresh telemetry or the WebSocket connection was lost.", "warning");
      stopManualDrive();
    } else if (!sendManualAction(action)) {
      stopManualDrive();
    }
  }, MANUAL_COMMAND_INTERVAL_MS);
}

function sendManualAction(action) {
  if (!isManualControlAvailable()) return false;
  const speed = SPEED_PWM_BY_LEVEL[selectedSpeedLevel - 1];
  if (!esp32.send({ command: "MANUAL", action, speed })) {
    showToast("Manual command was not sent; the ESP32 WebSocket is unavailable.", "warning");
    return false;
  }
  return true;
}

function stopManualDrive() {
  if (manualCommandTimer !== null) window.clearInterval(manualCommandTimer);
  manualCommandTimer = null;
  const wasDriving = activeManualAction !== null;
  activeManualAction = null;
  if (wasDriving && isLiveMode() && connectionStatus === "connected") {
    const sent = esp32.send({ command: "MANUAL", action: "STOP", speed: 0 });
    if (!sent) showToast("Manual STOP could not be sent; the firmware lease will stop motion if the link is lost.", "warning");
    return sent;
  }
  return true;
}

function sendManualStop() {
  const wasDriving = activeManualAction !== null;
  const stopSent = stopManualDrive();
  if (wasDriving && !stopSent) return;
  if (!wasDriving) {
    if (mode !== "manual" || connectionStatus !== "connected" ||
        !esp32.send({ command: "MANUAL", action: "STOP", speed: 0 })) {
      showToast("Manual STOP was not sent: the ESP32 WebSocket is disconnected.", "warning");
      return;
    }
  }
  eventHistory.add("stop", "Manual STOP command sent; awaiting telemetry confirmation");
}

function isManualControlAvailable() {
  return mode === "manual" && isTelemetryFresh() &&
    latestTelemetry?.wifiConnected !== false &&
    validState(latestTelemetry?.state) !== "EMERGENCY_STOP";
}

function addTelemetryEvents(telemetry) {
  const state = validState(telemetry.state);
  if (state !== previousState && state !== "UNKNOWN") {
    if (state === "TURNING_LEFT" || state === "TURNING_RIGHT") eventHistory.add("turn", `Robot state: ${state}`);
    else if (state === "STOPPED" || state === "BLOCKED") eventHistory.add("stop", `Robot state: ${state}`);
    previousState = state;
  }
  if (typeof telemetry.obstacle === "boolean" && telemetry.obstacle !== previousObstacle) {
    if (telemetry.obstacle) eventHistory.add("obstacle", "Obstacle detected by rover");
    previousObstacle = telemetry.obstacle;
  }
  const faulty = ["front", "left", "right"].filter((key) => !Number.isFinite(telemetry.distanceCm?.[key]) || telemetry.distanceCm[key] < 0);
  const faultKey = faulty.join(",");
  if (faultKey !== addTelemetryEvents.lastFaultKey) {
    if (faultKey) eventHistory.add("fault", `Sensor reading unavailable: ${faulty.join(", ")}`);
    addTelemetryEvents.lastFaultKey = faultKey;
  }
}

function setConnectionDisplay(status) {
  const labels = {
    connected: "CONNECTED",
    connecting: "CONNECTING",
    disconnected: "DISCONNECTED",
    demo: "DEMO · OFFLINE"
  };
  elements.connectionText.textContent = labels[status] || "DISCONNECTED";
  elements.connectionDot.className = `status-dot ${status}`;
  elements.connectionBox.classList.toggle("is-demo", status === "demo");
  const wifiConnected = latestTelemetry?.wifiConnected;
  const wifiLabel = mode === "demo" ? "SIMULATED"
    : telemetryStatus === "stale" ? "STALE"
      : typeof wifiConnected === "boolean" ? (wifiConnected ? "CONNECTED" : "OFFLINE") : "UNKNOWN";
  elements.wifiStatusText.textContent = wifiLabel;
  elements.wifiStatusDot.className = `status-dot ${mode === "demo" ? "demo" : wifiLabel === "CONNECTED" ? "connected" : wifiLabel === "OFFLINE" ? "disconnected" : ""}`;
  const telemetryLabels = {
    live: "LIVE DATA",
    stale: "TELEMETRY STALE",
    waiting: "WAITING",
    disconnected: "DISCONNECTED"
  };
  const telemetryLabel = mode === "demo" ? "SIMULATED" : telemetryLabels[telemetryStatus] || "DISCONNECTED";
  elements.telemetryStatusText.textContent = telemetryLabel;
  elements.telemetryStatusDot.className = `status-dot ${mode === "demo" ? "demo" : telemetryStatus === "live" ? "connected" : telemetryStatus === "stale" ? "connecting" : "disconnected"}`;
  elements.safetyBanner.classList.toggle("hidden", !isLiveMode() || status !== "disconnected");
}

function showToast(message, type = "info", duration = 4200) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastContainer.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}

function isTelemetryFresh() {
  return isLiveMode() && connectionStatus === "connected" && telemetryStatus === "live" &&
    lastPacketAt > 0 && Date.now() - lastPacketAt <= STALE_AFTER_MS;
}

function isLiveMode(selectedMode = mode) {
  return selectedMode === "auto" || selectedMode === "manual";
}

function updateTelemetryAge() {
  if (mode === "demo") {
    elements.telemetryAge.textContent = "SIMULATED";
    return;
  }
  if (!lastTelemetryAt) {
    elements.telemetryAge.textContent = "--";
    return;
  }
  const ageSeconds = Math.max(0, (Date.now() - lastTelemetryAt) / 1000);
  elements.telemetryAge.textContent = `${ageSeconds.toFixed(1)} s ago`;
  elements.lastPacket.textContent = `Last valid telemetry ${new Date(lastTelemetryAt).toLocaleTimeString()} · ${ageSeconds.toFixed(1)} s ago`;
}

function isWebSocketUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "ws:" || url.protocol === "wss:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function readSavedWebSocketUrl() {
  try {
    return window.localStorage.getItem(WEBSOCKET_URL_STORAGE_KEY) || "";
  } catch (error) {
    showToast("Browser storage is unavailable; enter the ESP32 URL again next time.", "warning");
    return "";
  }
}

function saveWebSocketUrl(url) {
  try {
    window.localStorage.setItem(WEBSOCKET_URL_STORAGE_KEY, url);
  } catch (error) {
    showToast("The ESP32 URL could not be saved in browser storage.", "warning");
  }
}

function updateMapDataStatus() {
  if (mode === "demo") {
    elements.mapDataStatus.textContent = "DEMO · SYNTHETIC MAP";
    return;
  }
  if (connectionStatus === "disconnected") {
    elements.mapDataStatus.textContent = "DISCONNECTED · HISTORY ONLY";
  } else if (connectionStatus === "connecting") {
    elements.mapDataStatus.textContent = "CONNECTING · NO LIVE DATA";
  } else if (stale) {
    elements.mapDataStatus.textContent = "TELEMETRY STALE · HISTORY ONLY";
  } else if (!lastPacketAt) {
    elements.mapDataStatus.textContent = "CONNECTED · WAITING FOR DATA";
  } else {
    elements.mapDataStatus.textContent = isTelemetryFresh() ? "LIVE TELEMETRY" : "TELEMETRY STALE · HISTORY ONLY";
  }
}

function setUnavailableMapHint() {
  elements.mapHint.textContent = lastPacketAt
    ? "Telemetry unavailable · showing map history only"
    : map.trajectory.length || map.obstacles.length
      ? "No current telemetry · showing map history only"
      : "Waiting for valid live telemetry";
  elements.mapHint.classList.remove("hidden");
}

function validState(value) {
  const state = typeof value === "string" ? value.toUpperCase() : "";
  return knownStates.has(state) ? state : state || "UNKNOWN";
}

function stateClass(value) {
  const state = validState(value);
  if (state === "FORWARD" || state === "MANUAL_FORWARD" ||
      state === "AUTO_FORWARD" || state === "AUTO_FORWARD_SLOW" ||
      state === "AUTO_BYPASS_FORWARD") return "forward";
  if (state === "MANUAL_REVERSE") return "reverse";
  if (state.startsWith("TURNING") || state.startsWith("AUTO_TURN_") ||
      state === "MANUAL_LEFT" || state === "MANUAL_RIGHT") return "turning";
  if (state.includes("BLOCKED") || state.includes("FAULT") || state.includes("DISCONNECTED") ||
      state.includes("TIMEOUT") || state === "EMERGENCY_STOP") return "blocked";
  return state === "STOPPED" ? "stopped" : "unknown";
}

function normaliseHeading(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function createGaugeTicks() {
  for (let index = 0; index <= 12; index++) {
    const angle = (-135 + index * 270 / 12) * Math.PI / 180;
    const inner = index % 3 === 0 ? 91 : 96;
    const outer = 104;
    const x1 = 140 + Math.cos(angle) * inner;
    const y1 = 151 + Math.sin(angle) * inner;
    const x2 = 140 + Math.cos(angle) * outer;
    const y2 = 151 + Math.sin(angle) * outer;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1.toFixed(2));
    line.setAttribute("y1", y1.toFixed(2));
    line.setAttribute("x2", x2.toFixed(2));
    line.setAttribute("y2", y2.toFixed(2));
    line.setAttribute("class", "gauge-tick");
    elements.gaugeTicks.append(line);
  }
}

function updateAutomaticState() {
  const isAuto = mode === "auto";
  const isDemo = mode === "demo";
  const isLive = isLiveMode();
  elements.mode.value = mode;
  elements.mapPage.classList.toggle("auto-mode", isLive);
  elements.tunnelPanel.classList.toggle("hidden", !isDemo);
  elements.tunnelUnavailable.classList.toggle("hidden", isDemo);
  elements.demoBanner.classList.toggle("hidden", !isDemo);
  elements.manualPanel.classList.toggle("hidden", mode !== "manual");
  elements.stop.disabled = !isLive || connectionStatus !== "connected";
  if (isLive) {
    setConnectionDisplay(connectionStatus);
  } else {
    setConnectionDisplay("demo");
    elements.dataTag.classList.remove("is-stale");
    elements.safetyBanner.classList.add("hidden");
    elements.staleBanner.classList.add("hidden");
  }
  updatePhysicalControls();
}
