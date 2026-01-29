import { Injectable, signal, WritableSignal } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type AnimMode = 'none' | 'mode1' | 'mode2' | 'mode3';
export type VisualStyle = 'styleA' | 'styleB' | 'styleC';

interface RingData {
  mesh: THREE.Mesh;
  direction: THREE.Vector3;
  step: number; // -2 to +2
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion; // Reference for animation
  phase: number;
  lineProgress: number; // 0.0 (start of line) to 1.0 (end of line)
  axisIndex: number; // 0 to 8
}

@Injectable({
  providedIn: 'root'
})
export class SceneService {
  private canvas!: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  
  private rings: RingData[] = [];
  private mainGroup = new THREE.Group();
  
  // Reusable geometry to optimize memory
  private sharedGeometry!: THREE.TorusGeometry;
  
  private animationId: number = 0;
  private clock = new THREE.Clock();

  // State signals
  // Default mode is 'none' (static), Default style is 'styleC' (Neon)
  public currentMode: WritableSignal<AnimMode> = signal('none');
  public currentStyle: WritableSignal<VisualStyle> = signal('styleC');

  init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // 1. Scene Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe5e5e5);

    // 2. Camera Setup
    const fov = 45;
    const aspect = window.innerWidth / window.innerHeight;
    const near = 0.1;
    const far = 100;
    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera.position.set(12, 12, 12);

    // 3. Renderer Setup
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: this.canvas, 
      antialias: true, 
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(10, 20, 15);
    this.scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0xaaccff, 0.5);
    backLight.position.set(-10, -5, -10);
    this.scene.add(backLight);

    // 5. Group
    this.scene.add(this.mainGroup);

    // 6. Build Geometry
    this.buildGeometry();

    // 7. Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = false;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 50;

    // 8. Initial Style
    this.applyStyle(this.currentStyle());

    // 9. Start Loop
    this.animate();

    // 10. Handle Resize
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private buildGeometry() {
    this.mainGroup.clear();
    this.rings = [];

    // Geometry parameters
    const RADIUS = 1.0;
    
    if (this.sharedGeometry) this.sharedGeometry.dispose();
    // Tube thickness 0.025 for a wireframe-like elegance
    this.sharedGeometry = new THREE.TorusGeometry(RADIUS, 0.025, 12, 96);

    // 9 Unique Axes (3 Cardinals + 6 Face Diagonals)
    const axes: THREE.Vector3[] = [
      // 3 Cardinals
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      // 2 XY Diagonals
      new THREE.Vector3(1, 1, 0).normalize(),
      new THREE.Vector3(1, -1, 0).normalize(),
      // 2 XZ Diagonals
      new THREE.Vector3(1, 0, 1).normalize(),
      new THREE.Vector3(1, 0, -1).normalize(),
      // 2 YZ Diagonals
      new THREE.Vector3(0, 1, 1).normalize(),
      new THREE.Vector3(0, 1, -1).normalize()
    ];

    const createRing = (pos: THREE.Vector3, dir: THREE.Vector3, step: number, axisIndex: number) => {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh(this.sharedGeometry, material);
      
      const zAxis = new THREE.Vector3(0, 0, 1);
      
      // Orientation Logic:
      // The user wants the ring plane to be perpendicular to the line from origin to ring center.
      if (dir.dot(zAxis) < -0.999) {
          mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      } else if (dir.dot(zAxis) > 0.999) {
          mesh.quaternion.identity();
      } else {
          mesh.quaternion.setFromUnitVectors(zAxis, dir);
      }
      
      mesh.position.copy(pos);
      this.mainGroup.add(mesh);
      
      const phase = Math.abs(step) * 0.5 + axisIndex * 0.2;

      // Calculate progress along the line (-2 to +2 range mapped to 0 to 1)
      // Step goes -2, -1, 0, 1, 2. Total spread is 4.
      const lineProgress = (step + 2) / 4.0;

      this.rings.push({
        mesh: mesh,
        direction: dir.clone(),
        step: step,
        basePosition: pos.clone(),
        baseQuaternion: mesh.quaternion.clone(),
        phase: phase,
        lineProgress: lineProgress,
        axisIndex: axisIndex
      });
    };

    // Generate rings for each of the 9 axes
    axes.forEach((axis, axisIndex) => {
      // 5 rings per axis: -2, -1, 0, +1, +2
      for (let step = -2; step <= 2; step++) {
        
        // Distance Calculation Logic:
        // Center (step 0): 0
        // Inner neighbors (step +/-1): 1 radius distance from center
        // Outer neighbors (step +/-2): 1.5 radius distance from inner neighbor (2.5 total)
        let distance = 0;
        const absStep = Math.abs(step);
        
        if (absStep === 1) distance = 1.0;
        if (absStep === 2) distance = 2.5; // 1.0 + 1.5
        
        // Apply direction sign
        if (step < 0) distance *= -1;

        const pos = axis.clone().multiplyScalar(distance);
        createRing(pos, axis, step, axisIndex);
      }
    });
  }

  private onWindowResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private animate() {
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    
    const time = this.clock.getElapsedTime();

    this.controls.update();
    
    this.applyAnimation(time);

    this.renderer.render(this.scene, this.camera);
  }

  private applyAnimation(time: number) {
    const mode = this.currentMode();
    
    // Automatic rotation disabled per user request
    // this.mainGroup.rotation.y = time * 0.05;

    // Base cycle for mode1 and mode3
    const omega = (Math.PI * 2) / 8.0; 
    const t = time * omega; 
    
    // Constants for Mode 2 sequence
    const LOOP_DURATION = 3.6; // Total cycle time for all 9 rows
    const WAVE_DURATION = 1.2; // Time for wave to travel down one axis
    const ROW_OFFSET = LOOP_DURATION / 9.0; // Stagger per row (0.4s)

    this.rings.forEach((r, i) => {
      // 1. Reset transform to base state (perpendicular to radius)
      // If mode is 'none', this remains the final state for the frame.
      r.mesh.position.copy(r.basePosition);
      r.mesh.quaternion.copy(r.baseQuaternion);
      
      if (mode === 'mode1') {
        // Mode 1: Breathing / Opening
        const breathe = Math.sin(t); 
        const tiltAmt = THREE.MathUtils.degToRad(35) * breathe;
        r.mesh.rotateX(tiltAmt);
      } 
      else if (mode === 'mode2') {
        // Mode 2: Sequential Axis Sweep
        // We stagger each axis by calculating a local time for that specific axis.
        const axisStartTime = r.axisIndex * ROW_OFFSET;
        
        // Calculate where we are in the 3.6s loop, offset by the row's start time
        let localT = (time - axisStartTime) % LOOP_DURATION;
        if (localT < 0) localT += LOOP_DURATION;
        
        // Check if the wave is currently passing through this axis
        if (localT < WAVE_DURATION) {
          // Normalize 0..WAVE_DURATION to 0..1
          const normTime = localT / WAVE_DURATION;
          
          // Map to physical line progress (-0.5 to 1.5 ensures wave enters and leaves fully)
          const scanPos = THREE.MathUtils.lerp(-0.5, 1.5, normTime);
          
          const dist = Math.abs(r.lineProgress - scanPos);
          
          // Create a bell curve influence
          const influence = Math.max(0, 1 - dist * 2.5); 
          const tiltAmt = THREE.MathUtils.degToRad(60) * influence;
          
          // Additional visual flair: slight scale up
          const scale = 1 + (0.3 * influence);
          r.mesh.scale.setScalar(scale);
          
          r.mesh.rotateX(tiltAmt);
        } else {
            // Reset scale if not active
            r.mesh.scale.setScalar(1);
        }
      } 
      else if (mode === 'mode3') {
        // Mode 3: Swarm / Random-ish
        const phaseOffset = i * (Math.PI / 12); 
        const maxTilt = THREE.MathUtils.degToRad(30);
        const tiltAngle = maxTilt * Math.sin(t + phaseOffset);
        
        // Tilt around a varied local axis
        const axisAngle = i * 0.5 + r.step; 
        const axis = new THREE.Vector3(Math.cos(axisAngle), Math.sin(axisAngle), 0).normalize();
        
        r.mesh.rotateOnAxis(axis, tiltAngle);
      }
    });
  }

  setAnimationMode(mode: AnimMode) {
    this.currentMode.set(mode);
  }

  setVisual(style: VisualStyle) {
    this.currentStyle.set(style);
    this.applyStyle(style);
  }

  private applyStyle(style: VisualStyle) {
    if (this.rings.length === 0) return;

    this.scene.background = new THREE.Color(0xe5e5e5);

    // Palette for 9 axes
    const axisColors = [
      0xf97316, // Orange
      0xeab308, // Yellow
      0x22c55e, // Green
      0x06b6d4, // Cyan
      0x3b82f6, // Blue
      0x6366f1, // Indigo
      0xa855f7, // Purple
      0xd946ef, // Fuchsia
      0xf43f5e  // Rose
    ];

    this.rings.forEach((r) => {
      if (Array.isArray(r.mesh.material)) {
        r.mesh.material.forEach(m => m.dispose());
      } else {
        r.mesh.material.dispose();
      }

      let newMat: THREE.Material;

      switch (style) {
        case 'styleA': 
          // Mono
          newMat = new THREE.MeshStandardMaterial({ 
            color: 0x222222, 
            roughness: 0.5,
            metalness: 0.1,
            side: THREE.DoubleSide
          });
          break;
          
        case 'styleB': 
          // Blue
          newMat = new THREE.MeshStandardMaterial({ 
            color: 0x2563eb,
            roughness: 0.3, 
            metalness: 0.3,
            side: THREE.DoubleSide
          });
          break;
          
        case 'styleC': 
          // Neon
          const colorHex = axisColors[r.axisIndex % axisColors.length];
          const c = new THREE.Color(colorHex);
          newMat = new THREE.MeshStandardMaterial({ 
            color: c,
            emissive: c,
            emissiveIntensity: 0.6,
            roughness: 0.4,
            metalness: 0.1,
            side: THREE.DoubleSide
          });
          break;
          
        default:
             newMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      }
      
      r.mesh.material = newMat;
    });
  }

  resetView() {
    // 1. Reset Camera
    if (this.camera && this.controls) {
      this.camera.position.set(12, 12, 12);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
    
    // 2. Reset Animation Time
    // Restarting the clock sets elapsedTime to 0.
    this.clock = new THREE.Clock(); 
    this.clock.start();

    // 3. Reset Mode to 'none' (static start)
    this.currentMode.set('none');
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    
    if (this.sharedGeometry) this.sharedGeometry.dispose();
    this.rings.forEach(r => {
      if (Array.isArray(r.mesh.material)) {
        r.mesh.material.forEach(m => m.dispose());
      } else {
        r.mesh.material.dispose();
      }
    });
    this.mainGroup.clear();
    this.renderer.dispose();
  }
}