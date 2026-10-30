# TunnelGuard AMR
### Autonomous Mobile Robot for Tunnel and Confined-Space Inspection

TunnelGuard AMR is a low-cost autonomous inspection rover designed to assist in monitoring tunnels and confined industrial spaces. It uses an ESP32-based embedded control system, ultrasonic sensors, wheel encoders and an MPU6050 IMU to detect nearby obstacles, estimate movement and navigate through an environment.

The robot communicates wirelessly with a browser-based dashboard, allowing users to monitor its status, view sensor readings, control movement and visualize its estimated path.

---

## 1. Problem Statement

Inspecting tunnels and confined industrial environments can be challenging because of:

- Safety risks associated with sending personnel into restricted or hazardous areas.
- Difficulty accessing narrow or confined spaces.
- Time-consuming manual inspection procedures.
- Limited real-time visibility of obstacles and environmental conditions.
- Difficulty monitoring the robot's movement and operating status remotely.

### Our Proposed Solution

TunnelGuard AMR aims to provide an affordable robotic platform for remote inspection and basic autonomous navigation in confined spaces.

The rover can:
- Navigate using an ESP32-based control system.
- Detect nearby obstacles using multiple ultrasonic sensors.
- Estimate its movement and heading using wheel encoders and an IMU.
- Avoid obstacles using an onboard automatic movement algorithm.
- Transmit live telemetry to a laptop dashboard over Wi-Fi.
- Support manual remote operation and automatic navigation modes.

The current prototype focuses on obstacle detection, basic navigation, telemetry and remote monitoring. Advanced tunnel mapping and surface-defect detection are potential future extensions.

---

## 2. System Architecture

The system consists of three main layers:

1. **Hardware Layer:** Sensors, motors, motor driver, battery and ESP32.
2. **Embedded Control Layer:** Sensor acquisition, motor control, obstacle avoidance and telemetry generation.
3. **Dashboard Layer:** Wireless communication, robot monitoring, manual controls and visualization.

### Overall Architecture

```text
             TUNNELGUARD AMR
                    |
          +---------+---------+
          |                   |
      HARDWARE             SOFTWARE
          |                   |
     +----+----+        +-----+------+
     |         |        |            |
  Sensors   Motors   ESP32 Firmware  Dashboard
     |         |        |            |
     |         |   Sensor Processing |
     |         |   Motor Control    |
     |         |   Obstacle Avoid.  |
     |         |   Telemetry        |
     |         |        |            |
     +----+----+        |            |
          |             |            |
        ESP32 <---- Wi-Fi / WebSocket ----> Laptop
                                         |
                                   Browser Dashboard
                                         |
                               Status / Map / Controls
```

### Hardware Architecture

The ESP32 acts as the main controller of the rover.

**Input and sensing subsystem**
- Three HC-SR04 ultrasonic sensors mounted at the front, left and right to measure obstacle distances.
- Two wheel encoders to estimate wheel rotation and travelled distance.
- MPU6050 accelerometer and gyroscope to estimate orientation and heading.

**Motor and output subsystem**
- L298N dual H-bridge motor driver.
- Four BO geared DC motors arranged as a four-wheel drive rover.
- WS2812B RGB LED strip for visual status indication.
- Buzzer for audible alerts.

**Power subsystem**
- 7.4 V, 2,200 mAh rechargeable 2S Li-ion battery pack.
- Battery protection circuitry, if fitted in the pack.
- Regulated supply for the ESP32 and low-voltage electronics.

The battery provides power to the motor and electronics power paths. Appropriate voltage regulation and common grounding are required for reliable operation.

---

## 3. Hardware Components

| Component | Function |
|---|---|
| ESP32 | Main controller, Wi-Fi communication and embedded processing |
| 4 BO geared motors | Rover movement |
| L298N motor driver | Controls motor direction and speed |
| 3 HC-SR04 ultrasonic sensors | Front, left and right obstacle detection |
| 2 wheel encoders | Wheel rotation and distance estimation |
| MPU6050 IMU | Acceleration and angular velocity measurement |
| WS2812B RGB LEDs | Visual status indication |
| Buzzer | Audible alerts |
| 7.4 V, 2,200 mAh Li-ion battery | Main power source |

---

## 4. Software Architecture

The software is divided into two major components.

### A. ESP32 Firmware

The ESP32 firmware is responsible for real-time hardware interaction and robot control.

Main functions:
- Reading distance measurements from the three ultrasonic sensors.
- Reading wheel encoder pulses.
- Communicating with the MPU6050 over I2C.
- Controlling four DC motors through the L298N driver.
- Implementing manual movement and automatic obstacle avoidance.
- Estimating robot position and heading using encoder/IMU data.
- Sending periodic telemetry to the dashboard.
- Receiving movement and operating-mode commands over Wi-Fi.

Automatic obstacle avoidance runs on the ESP32. It does not depend on the laptop dashboard to make movement decisions.

### B. Web-Based Dashboard

The dashboard is developed using:

- HTML
- CSS
- JavaScript
- Vite development and build tooling
- Three.js for the local 3D simulation

The dashboard runs in a modern web browser and communicates with the ESP32 through WebSocket connections.

It provides a graphical interface for monitoring the robot, controlling movement and visualizing its estimated trajectory.

---

## 5. Communication Architecture

TunnelGuard AMR uses Wi-Fi and WebSocket communication between the ESP32 and the laptop dashboard.

### Communication Workflow

1. The ESP32 connects to an available 2.4 GHz Wi-Fi router or hotspot using Wi-Fi station mode.
2. The laptop running the dashboard connects to the same reachable network.
3. The ESP32 starts a WebSocket server on port `81`.
4. The dashboard connects to the ESP32 using its current IP address and port.
5. The ESP32 continuously sends telemetry data to the dashboard.
6. The dashboard sends control commands back to the ESP32 when the user interacts with the interface.

**Connection format:**

```text
ws://ESP32_IP_ADDRESS:81
```

For example:

```text
ws://192.168.0.105:81
```

The actual IP address is assigned by the network and must be checked in the ESP32 Serial Monitor.

### Data Communication

**ESP32 → Dashboard**

The ESP32 transmits JSON telemetry containing information such as:

- Operating mode and robot state.
- Selected speed level and measured speed.
- Front, left and right ultrasonic distances.
- Estimated heading.
- Estimated X and Y position.
- Obstacle detection status and direction.
- MPU6050 availability.
- Wi-Fi connection status, IP address and signal strength.
- Telemetry timestamp and sequence number.

Example telemetry structure:

```json
{
  "mode": "AUTO",
  "state": "AUTO_CRUISE",
  "speedLevel": 2,
  "speedCmS": 12.5,
  "distanceCm": {
    "front": 45,
    "left": 80,
    "right": 65
  },
  "headingDeg": 90,
  "position": {
    "x": 120,
    "y": 25
  },
  "obstacle": false,
  "obstacleDirection": "NONE",
  "mpuPresent": true,
  "wifiConnected": true
}
```

The values above are illustrative and not a recorded robot measurement.

**Dashboard → ESP32**

The dashboard sends JSON commands for manual movement, speed selection and operating modes.

Supported command types include:

| Command | Function |
|---|---|
| `MANUAL` | Manual movement control |
| `SET_SPEED` | Select speed level |
| `START_AUTO` | Start automatic navigation |
| `STOP` | Stop normal movement |
| `EMERGENCY_STOP` | Trigger latched emergency stop |
| `RESET_STOP` | Reset the emergency-stop state |
| `RESET_POSITION` | Reset estimated position and heading |

Three speed levels are available:

| Speed level | PWM value | Setting |
|---|---:|---|
| 1 | 110 | Slow |
| 2 | 150 | Medium |
| 3 | 190 | Fast |

PWM values are requested motor-control values, not calibrated physical speed measurements.

---

## 6. Dashboard Features

The browser-based dashboard provides three main visualization tabs.

### Dashboard Overview

- Robot connection status.
- Operating mode and current movement state.
- Selected speed level.
- Front, left and right obstacle distances.
- Heading and estimated position.
- Wi-Fi connection and signal information.
- Telemetry freshness and connection errors.

### 2D Map

- Top-down visualization of the robot's estimated movement.
- Approximate trajectory based on encoder and IMU odometry.
- Estimated obstacle markers using available sensor measurements.
- Reset map and reset position controls.

The live map is based on firmware telemetry. It is not a SLAM-generated map or a complete reconstruction of the tunnel.

### 3D Tunnel View — Demo Mode

The dashboard also provides a simulated 3D tunnel environment.

Features include:
- Synthetic tunnel geometry.
- Simulated multi-layer LiDAR scanning.
- 3D point-cloud visualization.
- Simulated rocks, rubble and box-like obstacles.
- Illustrative damp, crack and corrosion patches.
- Camera-like visualization.
- Adjustable scan resolution and scan rate.
- Play, pause, speed and camera controls.

**Important:** The 3D tunnel, LiDAR scans and camera-like inspection are software simulations. They do not represent readings from a physical LiDAR sensor, camera or actual tunnel inspection.

---

## 7. Operating Modes

### Manual Mode
The user controls the rover through dashboard movement buttons:
- Forward
- Reverse
- Left
- Right
- Stop

Movement commands are sent to the ESP32 through WebSocket communication.

### Automatic Mode
The ESP32 executes its onboard obstacle-avoidance state machine.

The current firmware includes states such as:
- `AUTO_CRUISE`
- `AUTO_TURN_AWAY`
- `AUTO_BYPASS`
- `AUTO_TURN_BACK`

The robot uses front and side ultrasonic measurements to make basic movement and obstacle-avoidance decisions.

### Demo Mode
A local browser simulation that demonstrates the dashboard's tunnel visualization, synthetic scanner, point cloud and classification features.

Demo Mode does not communicate with physical motors or sensors.

---

## 8. Installation and Setup

### Requirements

- Node.js 20.19+ or 22.12+
- npm
- Modern web browser with Canvas and WebGL support for 3D Demo Mode
- ESP32 firmware and hardware for live robot operation

### Run the Dashboard

Clone the repository:

```bash
git clone <YOUR_REPOSITORY_URL>
```

Navigate to the dashboard project directory:

```bash
cd <DASHBOARD_DIRECTORY>
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL displayed by Vite, normally:

```text
http://localhost:5173
```

### Build for Production

```bash
npm run build
npm run preview
```

Dashboard dependencies are installed locally. The application does not require external CDN resources to run after installation.

### Connect the Physical Robot

1. Power on the TunnelGuard rover.
2. Connect the ESP32 and laptop to the same reachable 2.4 GHz Wi-Fi network.
3. Open the ESP32 Serial Monitor.
4. Copy the WebSocket URL printed by the firmware.
5. Enter the URL in the dashboard's ESP32 Connection field.
6. Press Connect.
7. Verify that valid telemetry is being received before operating the motors.

---

## 9. Safety and Limitations

- Ultrasonic sensors provide basic distance measurements and may be affected by surface angle, material and environmental conditions.
- Encoder and IMU-based odometry provides approximate position and heading estimates. Errors can accumulate due to wheel slip and gyroscope drift.
- The current live map is not a SLAM-based navigation map.
- The simulated LiDAR and camera features are available only in Demo Mode.
- Real-time corrosion, crack or dampness detection using a physical camera has not been implemented in the current prototype.
- Battery runtime depends on motor load, speed, surface conditions and battery health.
- The dashboard's emergency-stop command is a software control and does not replace a dedicated hardware emergency-stop circuit.
- Physical movement, sensor calibration, electrical protection and network reliability must be verified on the actual rover.

Always test the rover in a controlled environment and at low speed before attempting autonomous operation.

---

## 10. Future Scope

Potential future improvements include:

- Integration of a physical 2D LiDAR sensor for tunnel scanning.
- SLAM-based mapping and improved autonomous navigation.
- Camera integration for tunnel surface inspection.
- Computer vision for identifying cracks, corrosion and surface deterioration.
- Improved localization using sensor fusion.
- Battery voltage, current and state-of-charge monitoring.
- Inspection data logging and report generation.
- Longer-range wireless communication for industrial environments.

---

## Project Summary

TunnelGuard AMR demonstrates the integration of embedded systems, robotics, wireless communication, sensor-based obstacle avoidance and web-based monitoring in an affordable mobile inspection platform.

The project establishes a foundation for future development into a more capable autonomous tunnel inspection system.

**Technologies:** ESP32 · Embedded C/C++ · Ultrasonic Sensing · MPU6050 · Wheel Encoders · L298N · Wi-Fi · WebSockets · HTML · CSS · JavaScript · Vite · Three.js

**Project:** TunnelGuard AMR  
**Category:** Robotics · Autonomous Systems · Industrial Inspection
