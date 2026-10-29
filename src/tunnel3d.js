import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CLASS_COLORS } from "./classification.js";

const SCENE_COLORS = Object.freeze({
  rock: "#806d58",
  rubble: "#96724e",
  box: "#627476",
  wall: "#505b56",
  floor: "#384541",
  ceiling: "#3d4948"
});

export class TunnelViewer {
  constructor(canvas, environment) {
    this.canvas = canvas;
    this.environment = environment;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#101719");
    this.scene.fog = new THREE.Fog("#101719", 24, 72);
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 32;
    this.controls.maxPolarAngle = Math.PI * 0.88;
    this.frame = null;
    this.lastScanId = -1;
    this.addLighting();
    this.buildTunnel();
    this.addRover();
    this.addLidarPointCloud();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.resetCamera();
    this.animate();
  }

  addLighting() {
    this.scene.add(new THREE.HemisphereLight("#d5e6db", "#1a2526", 2));
    const light = new THREE.DirectionalLight("#e0f2df", 2.1);
    light.position.set(-5, 12, 4);
    this.scene.add(light);
    for (const x of [6, 18, 30, 42, 54]) {
      const section = this.environment.getCrossSection(x);
      const lamp = new THREE.PointLight("#b5ecc9", 16, 8);
      lamp.position.set(x, section.height - 0.25, section.centerY);
      this.scene.add(lamp);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: "#b5ecc9" }));
      bulb.position.copy(lamp.position);
      this.scene.add(bulb);
    }
  }

  buildTunnel() {
    const surfaceMaterial = (color, roughness = 0.94) => new THREE.MeshStandardMaterial({
      color,
      roughness,
      side: THREE.DoubleSide,
      metalness: 0.03
    });
    this.addSurfaceGrid(
      (x, lateral) => {
        const section = this.environment.getCrossSection(x);
        const y = section.centerY + (lateral * 2 - 1) * section.halfWidth;
        return toThree(x, this.environment.floorZ(x, y), y);
      },
      120, 12, surfaceMaterial(SCENE_COLORS.floor)
    );
    this.addSurfaceGrid(
      (x, lateral) => {
        const section = this.environment.getCrossSection(x);
        const y = section.centerY + (lateral * 2 - 1) * section.halfWidth;
        return toThree(x, this.environment.ceilingZ(x, y), y);
      },
      120, 12, surfaceMaterial(SCENE_COLORS.ceiling)
    );
    for (const side of [-1, 1]) {
      this.addSurfaceGrid(
        (x, vertical) => {
          const section = this.environment.getCrossSection(x);
          const z = this.environment.floorZ(x, section.centerY) + vertical * (section.height - 0.05);
          const y = this.environment.wallY(side, x, z);
          return toThree(x, z, y);
        },
        120, 14, surfaceMaterial(SCENE_COLORS.wall)
      );
    }
    this.addTunnelFrames();
    this.addEnvironmentObstacles();
    this.addSurfaceFeatures();
    this.addFloorGrid();
  }

  addSurfaceGrid(getPoint, columns, rows, material) {
    const positions = [];
    const indices = [];
    for (let row = 0; row <= rows; row++) {
      const v = row / rows;
      for (let column = 0; column <= columns; column++) {
        const u = column / columns;
        positions.push(...getPoint(this.environment.length * u, v).toArray());
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const topLeft = row * (columns + 1) + column;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + columns + 1;
        const bottomRight = bottomLeft + 1;
        indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geometry, material));
  }

  addTunnelFrames() {
    const material = new THREE.MeshStandardMaterial({ color: "#75827a", metalness: 0.42, roughness: 0.52 });
    for (let x = 3; x < this.environment.length; x += 5) {
      const section = this.environment.getCrossSection(x);
      const left = this.environment.wallY(-1, x, 0);
      const right = this.environment.wallY(1, x, 0);
      const height = section.height;
      const group = new THREE.Group();
      const postGeometry = new THREE.CylinderGeometry(0.045, 0.045, height, 8);
      const leftPost = new THREE.Mesh(postGeometry, material);
      leftPost.position.set(0, height / 2, 0);
      const rightPost = leftPost.clone();
      group.add(leftPost, rightPost);
      leftPost.position.set(0, height / 2, 0);
      rightPost.position.set(0, height / 2, right - left);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, right - left), material);
      beam.position.set(0, height - 0.05, (right - left) / 2);
      group.position.set(x, 0, left);
      this.scene.add(group);
    }
  }

  addEnvironmentObstacles() {
    for (const obstacle of this.environment.obstacles) {
      let geometry;
      const material = new THREE.MeshStandardMaterial({
        color: SCENE_COLORS[obstacle.kind],
        roughness: obstacle.kind === "box" ? 0.76 : 0.98,
        metalness: obstacle.kind === "box" ? 0.12 : 0
      });
      if (obstacle.shape === "box") {
        const { halfSize } = obstacle;
        geometry = new THREE.BoxGeometry(halfSize.x * 2, halfSize.z * 2, halfSize.y * 2);
      } else {
        geometry = new THREE.SphereGeometry(1, 18, 12);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(toThree(obstacle.center.x, obstacle.center.z, obstacle.center.y));
      if (obstacle.shape === "box") mesh.rotation.y = -obstacle.yaw;
      else mesh.scale.set(obstacle.radii.x, obstacle.radii.z, obstacle.radii.y);
      this.scene.add(mesh);
      if (obstacle.wallAttached) {
        mesh.material = material.clone();
        mesh.material.color.set("#92795f");
      }
    }
  }

  addSurfaceFeatures() {
    for (const feature of this.environment.features) {
      const material = new THREE.MeshBasicMaterial({
        color: feature.color,
        transparent: true,
        opacity: feature.kind === "crack" ? 0.9 : 0.72,
        side: THREE.DoubleSide
      });
      let geometry;
      if (feature.kind === "crack") {
        const points = [
          toThree(feature.position.x, feature.position.z - 0.45, feature.position.y),
          toThree(feature.position.x + 0.12, feature.position.z - 0.12, feature.position.y),
          toThree(feature.position.x - 0.1, feature.position.z + 0.1, feature.position.y),
          toThree(feature.position.x + 0.06, feature.position.z + 0.45, feature.position.y)
        ];
        geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 14, 0.025, 5, false);
        this.scene.add(new THREE.Mesh(geometry, material));
        continue;
      }
      geometry = new THREE.PlaneGeometry(feature.dimensions.width, feature.dimensions.height);
      const patch = new THREE.Mesh(geometry, material);
      patch.position.copy(toThree(feature.position.x, feature.position.z, feature.position.y));
      if (feature.side > 0) patch.rotation.y = Math.PI;
      this.scene.add(patch);
    }
  }

  addFloorGrid() {
    const positions = [];
    for (let x = 0; x <= this.environment.length; x += 1) {
      const section = this.environment.getCrossSection(x);
      positions.push(toThree(x, this.environment.floorZ(x, section.centerY) + 0.008, section.centerY));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(positions);
    this.scene.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#566761", transparent: true, opacity: 0.42 })));
  }

  addRover() {
    this.rover = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.3, 0.82),
      new THREE.MeshStandardMaterial({ color: "#7bc99c", metalness: 0.18, roughness: 0.48 })
    );
    body.position.set(0, 0.28, 0);
    this.rover.add(body);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: "#1d2827" });
    for (const x of [-0.24, 0.24]) {
      for (const z of [-0.28, 0.28]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 14), wheelMaterial);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.15, z);
        this.rover.add(wheel);
      }
    }
    const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), new THREE.MeshBasicMaterial({ color: "#9ce5ba" }));
    sensor.position.set(0.22, 0.43, 0);
    this.rover.add(sensor);
    this.scene.add(this.rover);
  }

  addLidarPointCloud() {
    this.pointGeometry = new THREE.BufferGeometry();
    this.pointMaterial = new THREE.PointsMaterial({ size: 0.065, vertexColors: true, sizeAttenuation: true });
    this.pointCloud = new THREE.Points(this.pointGeometry, this.pointMaterial);
    this.scene.add(this.pointCloud);
  }

  updateFrame(frame) {
    if (!frame) return;
    if (this.frame) {
      const shift = toThree(
        frame.pose.x - this.frame.pose.x,
        frame.pose.z - this.frame.pose.z,
        frame.pose.y - this.frame.pose.y
      );
      this.camera.position.add(shift);
      this.controls.target.add(shift);
    }
    this.frame = frame;
    this.rover.position.copy(toThree(frame.pose.x, frame.pose.z, frame.pose.y));
    this.rover.rotation.y = -frame.pose.headingRad;
    if (frame.scan?.scanId !== this.lastScanId) {
      this.updatePointCloud(frame.mappedPoints);
      this.lastScanId = frame.scan?.scanId;
    }
  }

  updatePointCloud(points) {
    const positions = [];
    const colors = [];
    for (const point of points) {
      positions.push(point.position.x, point.position.z, point.position.y);
      const color = new THREE.Color(CLASS_COLORS[point.className] || CLASS_COLORS.unknown);
      colors.push(color.r, color.g, color.b);
    }
    this.pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.pointGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.pointGeometry.computeBoundingSphere();
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  resetCamera() {
    const pose = this.frame?.pose || { x: 2.4, y: 0, z: 0, headingRad: 0 };
    const target = toThree(pose.x + 7, pose.z + 1.05, pose.y);
    this.controls.target.copy(target);
    this.camera.position.set(pose.x - 2.2, pose.z + 1.65, pose.y + 0.3);
    this.controls.update();
  }

  animate() {
    this.frameHandle = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

function toThree(x, z, y) {
  return new THREE.Vector3(x, z, y);
}
