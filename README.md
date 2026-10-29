# TunnelGuard AMR dashboard

A Vite dashboard for the TunnelGuard autonomous tunnel inspection rover. The UI is plain JavaScript, HTML, and CSS; Three.js is loaded locally when Demo Mode is opened.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- A modern browser with Canvas and WebGL support for the 3D demo

## Install and run

From the project directory:

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Dependency files are local after installation; the dashboard does not load fonts, scripts, or stylesheets from a CDN. Internet is not needed to use Demo Mode after installation.

To create and preview a production build:

```powershell
npm run build
npm run preview
```

## Dashboard pages

Use the **Dashboard**, **Map**, and **3D view** tabs below the header to move between the compact rover status overview, a full-width 2D map, and the tunnel visualization. The dashboard overview is arranged to fit common laptop screens; smaller windows can scroll as needed. The map and 3D view have dedicated space so their visualizations are easier to inspect.

## Demo Mode

Choose **Demo Mode** in the top bar. The browser builds a seeded, 58 m synthetic tunnel and advances a simulated rover at 0.42 m/s. The environment has a curved centerline, changing width and height, an uneven wall, floor and ceiling, ellipsoid rocks, a wall-attached rock, rubble, boxes, and synthetic damp, crack, and corrosion patches. Resetting Demo Mode returns to the same generated environment and scanner noise sequence.

### Shared map and simulated sensors

The simulation uses metres in one right-handed world frame: **X** runs along the tunnel, **Y** runs across it, and **Z** is height. Robot position and heading, tunnel surfaces, obstacles, camera rays, and LiDAR returns share this frame. The Map page accumulates classified scan returns and trajectory; the 3D view renders the same environment and robot pose with the accumulated point cloud. Its walls and obstacles are the simulation's ground-truth geometry, while the point cloud shows what the simulated scanner has observed.

The simulated multi-layer LiDAR defaults to a 270° horizontal field of view, 2.5° angular step, five vertical layers (-18°, -9°, 0°, 9°, 18°), 14 m maximum range, 8 mm measurement noise, a 1.2% invalid-return probability, and 4 scans per second. Rays intersect the generated tunnel surfaces and ellipsoid/box obstacle geometry. Each raw return records angle, range, sensor- and world-frame coordinates, timestamp, intensity, and internal ground truth. The user-facing classified points do not include those ground-truth labels.

Adjust **LiDAR step** and **scan rate** in the 3D view. Other scanner settings can be configured through `LidarScanner` in `src/lidar.js` (`fieldOfViewDeg`, `verticalLayersDeg`, `maxRangeM`, `measurementNoiseM`, and `invalidRate`); invalid values raise a `RangeError`.

### Classification and camera-like inspection

The classifier first compares each return with the generated nominal floor, ceiling, and continuous wall surfaces. Returns outside the surface tolerance are grouped by 3D proximity and assigned a tentative geometric class: rock, low rubble, box-like artificial obstacle, or unknown. Confidence is shown with detections. A protrusion close to a wall is deliberately marked **unknown** with a warning that LiDAR alone may not separate it from wall roughness. The 2D and 3D legends use the same wall, floor, ceiling, rock, rubble, box, and unknown colors. Regions without returned points remain unobserved; the map's dashed tunnel outline is a profile reference, not a sensor observation.

The forward camera-like panel is rendered by casting a low-resolution image grid into that same environment. It shows synthetic surface materials and reports visible damp, corrosion, and crack patches with range and confidence. This is a deterministic simulation/illustration, not a real camera, trained vision model, or hardware scan. The displayed ground-truth agreement is an internal simulation validation metric only; it is not real-world detection accuracy.

The simulation provides play/pause, 0.5×/1×/2× speed, LiDAR resolution/rate controls, orbit, pan, zoom, and reset-camera controls. **No physical motor, sensor, or ESP32 commands are used by Demo Mode.**

The 3D view page is available only in Demo Mode. Automatic Mode continues to use the existing ESP32 WebSocket telemetry and control path; it does not use or display the simulated LiDAR/camera as live sensor data.

## Connect to the ESP32

The supplied firmware uses Wi-Fi station mode and connects to the configured hotspot/router; it does not create an ESP32 access point. Connect the laptop and ESP32 to the same reachable 2.4 GHz network. In the Serial Monitor, copy the firmware's printed WebSocket URL (the current IP followed by `:81`) into the always-visible **ESP32 CONNECTION** field, then press **Connect**. There is no fixed IP default. The dashboard saves the entered URL in browser local storage. **Disconnect** disables reconnect attempts; **Connect** or **Reconnect** starts a fresh socket attempt.

The header separately reports the browser-to-ESP32 WebSocket, the ESP32's reported Wi-Fi association, and telemetry freshness. **CONNECTED** means only that the WebSocket opened. **LIVE DATA** appears only after valid telemetry; data becomes **TELEMETRY STALE** after 1.5 seconds without a valid update. The WebSocket can remain connected while the ESP32 Wi-Fi status or telemetry is unavailable. The dashboard shows the firmware-reported IP and RSSI, last valid update/age, and the most recent connection error. It never substitutes Demo Mode data in live modes.

### Operating modes and map

- **Automatic Mode** sends `START_AUTO` only after fresh telemetry and a valid front range. It offers normal **Stop**, **Emergency Stop**, and reset-after-emergency controls. Automatic movement/avoidance runs in the ESP32 firmware, not in the browser. The browser displays the firmware's reported state and warns if the front or side sensors are unavailable.
- **Manual Mode** sends a direction immediately on press, refreshes the command approximately every 200 ms while held, and sends a stop on release or when telemetry becomes stale. Movement controls are disabled when telemetry is stale, the socket closes, Wi-Fi reports offline, or the firmware reports an emergency stop. The firmware's 700 ms manual command lease is a backup, not the dashboard's normal stop mechanism.
- **Demo Mode** remains a local simulation; no ESP32 telemetry or movement commands are used. Its 2D and 3D tunnel visualizations are synthetic. The 3D page is Demo-only; live Automatic and Manual modes use the 2D top-down map only.

The live map uses firmware telemetry only. Firmware `position.x` and `position.y` are in centimetres and are converted to metres for display; heading is in degrees. Its trajectory is approximate encoder/IMU odometry, not SLAM. A sensor-estimated obstacle marker is added only when firmware reports `obstacle: true` and a valid `obstacleDirection`/range. Its position uses the robot pose and sensor direction, without a measured sensor mounting offset. **Reset map** clears only the displayed history; **Reset position** sends `RESET_POSITION` to the firmware. This is not a safety-rated navigation system.

### Telemetry schema emitted by the supplied firmware

The dashboard validates the core `mode`, `state`, `speedLevel`, `speedCmS`, `distanceCm`, `headingDeg`, and `position.x/y` fields. It also reads `obstacle`, `obstacleDirection`, `mpuPresent`, `wifiConnected`, `ip`, `wifiRssi`, `telemetryMs`, and `seq`. Speed is reported in cm/s and can be negative while reversing. Position is reported in centimetres. Invalid or negative ultrasonic values (firmware uses `-1` for no return) are displayed as unavailable and are never treated as clear space. Missing/invalid optional values are shown as unknown/unavailable.

### Exact firmware command protocol

The dashboard sends these JSON text frames over WebSocket port 81, using the command strings handled by the supplied firmware:

```json
{"command":"MANUAL","action":"FORWARD","speed":110}
{"command":"MANUAL","action":"REVERSE","speed":110}
{"command":"MANUAL","action":"LEFT","speed":110}
{"command":"MANUAL","action":"RIGHT","speed":110}
{"command":"MANUAL","action":"STOP","speed":0}
{"command":"SET_SPEED","level":1}
{"command":"SET_SPEED","level":2}
{"command":"SET_SPEED","level":3}
{"command":"START_AUTO"}
{"command":"STOP"}
{"command":"EMERGENCY_STOP"}
{"command":"RESET_STOP"}
{"command":"RESET_POSITION"}
```

Speed levels map to requested PWM values 110 (Slow), 150 (Medium), and 190 (Fast). Manual movement includes the selected PWM in its `speed` field and is refreshed while held. `STOP` disarms/stops without latching; `EMERGENCY_STOP` latches until `RESET_STOP`. `START_AUTO` starts the firmware's timed obstacle-avoidance state machine if the front sensor is valid. `RESET_POSITION` zeros firmware position and heading. A successful WebSocket send confirms only that the browser handed a frame to the socket, not that motors physically responded. Neither dashboard stop control replaces a hardware emergency-stop circuit.

The supplied firmware configures the front/left/right HC-SR04 sensors, MPU6050, wheel encoders, L298N driver and WS2812B strip from its source pin definitions. Hardware wiring, sensor-level shifting, calibration, safe motor behavior and actual network/control behavior still require on-robot verification.

The WS2812B display on the dashboard is inferred from telemetry state, not measured LED feedback.

## Validation

Run `npm run build` to validate the production bundle. Demo Mode can be used without hardware. A successful build or browser-side socket check does not verify physical Wi-Fi, telemetry, movement, sensor calibration, or the firmware's safety behavior; test with the rover secured and at low speed.
