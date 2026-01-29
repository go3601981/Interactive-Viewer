import { Injectable, signal, WritableSignal } from '@angular/core';
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

export type AnimMode = 'none' | 'mode1' | 'mode2' | 'mode3';
export type VisualStyle = 'styleA' | 'styleB' | 'styleC';
export type OrientationType = 'perpendicular' | 'coplanar' | 'faceOn';

interface RingData {
  mesh: THREE.Mesh;
  direction: THREE.Vector3;
  step: number; // -2 to +2
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion; // The active reference for animation
  quatPerpendicular: THREE.Quaternion; // Stored state: Facing the line
  quatCoplanar: THREE.Quaternion; // Stored state: Parallel to the line
  phase: number;
  lineProgress: number; // 0.0 (start of line) to 1.0 (end of line)
  axisIndex: number; // 0 to 15
  planeIndex: number; // 0 to 3
}

@Injectable({
  providedIn: 'root'
})
export class SceneService {
  private canvas!: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: TrackballControls;
  
  private rings: RingData[] = [];
  private mainGroup = new THREE.Group();
  
  // Reusable geometry to optimize memory
  private sharedGeometry!: THREE.TorusGeometry;
  
  private animationId: number = 0;
  private clock = new THREE.Clock();

  // State signals
  public currentMode: WritableSignal<AnimMode> = signal('none');
  public currentStyle: WritableSignal<VisualStyle> = signal('styleC');
  public volume: WritableSignal<number> = signal(0.5);
  public isMuted: WritableSignal<boolean> = signal(false);

  // Track number of axes for animation calculations
  private totalAxesCount: number = 0;

  // Audio handling
  private currentAudio: HTMLAudioElement | null = null;
  // Store preloaded audio objects
  private audioMap: Record<string, HTMLAudioElement> = {}; 
  private readonly audioUrls: Record<string, string> = {
    'mode1': 'https://www.expopass.com/reports/Rotate.mp3',
    'mode2': 'https://www.expopass.com/reports/Sync.mp3',
    'mode3': 'https://www.expopass.com/reports/Swarm.mp3'
  };

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
    // Default to Perpendicular view (Tunnel) with doubled zoom
    this.camera.position.set(0, 0, 15);

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

    // 7. Controls - TrackballControls allows indefinite rotation
    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 2.0;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;
    this.controls.noZoom = false;
    this.controls.noPan = false;
    this.controls.staticMoving = false; // Enable momentum
    this.controls.dynamicDampingFactor = 0.1;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 50;
    
    // Trackball uses target to orbit around
    this.controls.target.set(0, 0, 0);

    // 8. Preload Audio
    this.preloadAudio();

    // 9. Initial Style
    this.applyStyle(this.currentStyle());

    // 10. Start Loop
    this.animate();

    // 11. Handle Resize
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private preloadAudio() {
    Object.entries(this.audioUrls).forEach(([mode, url]) => {
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = this.volume();
      audio.muted = this.isMuted();
      audio.preload = 'auto'; // Force preloading
      this.audioMap[mode] = audio;
    });
  }

  // --- Audio Control Methods ---

  setVolume(val: number) {
    this.volume.set(val);
    Object.values(this.audioMap).forEach(audio => {
      audio.volume = val;
    });
  }

  toggleMute() {
    this.isMuted.update(m => !m);
    const muted = this.isMuted();
    Object.values(this.audioMap).forEach(audio => {
      audio.muted = muted;
    });
  }

  // -----------------------------

  private buildGeometry() {
    this.mainGroup.clear();
    this.rings = [];

    // Geometry parameters
    const RADIUS = 1.0;
    
    if (this.sharedGeometry) this.sharedGeometry.dispose();
    // Tube thickness 0.025 for a wireframe-like elegance
    this.sharedGeometry = new THREE.TorusGeometry(RADIUS, 0.025, 12, 96);

    // Explicitly define 4 Planes of 4 Axes each = 16 Axes total.
    // The Y-Axis (0,1,0) is shared (duplicated) in each plane to complete the visual group.
    
    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    
    const axes: { vec: THREE.Vector3, planeId: number }[] = [
      // --- Plane 1 (XY aligned) ---
      { vec: new THREE.Vector3(1, 0, 0), planeId: 0 },              // X
      { vec: Y_AXIS.clone(), planeId: 0 },                          // Y
      { vec: new THREE.Vector3(1, 1, 0).normalize(), planeId: 0 },  // XY1
      { vec: new THREE.Vector3(1, -1, 0).normalize(), planeId: 0 }, // XY2

      // --- Plane 2 (YZ aligned) ---
      { vec: new THREE.Vector3(0, 0, 1), planeId: 1 },              // Z
      { vec: Y_AXIS.clone(), planeId: 1 },                          // Y (Shared)
      { vec: new THREE.Vector3(0, 1, 1).normalize(), planeId: 1 },  // YZ1
      { vec: new THREE.Vector3(0, 1, -1).normalize(), planeId: 1 }, // YZ2

      // --- Plane 3 (Diagonal 1) ---
      { vec: new THREE.Vector3(1, 0, 1).normalize(), planeId: 2 },  // XZ1
      { vec: Y_AXIS.clone(), planeId: 2 },                          // Y (Shared)
      { vec: new THREE.Vector3(1, 1, 1).normalize(), planeId: 2 },  // SD1
      { vec: new THREE.Vector3(1, -1, 1).normalize(), planeId: 2 }, // SD3

      // --- Plane 4 (Diagonal 2) ---
      { vec: new THREE.Vector3(1, 0, -1).normalize(), planeId: 3 }, // XZ2
      { vec: Y_AXIS.clone(), planeId: 3 },                          // Y (Shared)
      { vec: new THREE.Vector3(1, 1, -1).normalize(), planeId: 3 }, // SD2
      { vec: new THREE.Vector3(1, -1, -1).normalize(), planeId: 3 } // SD4
    ];
    
    this.totalAxesCount = axes.length; // 16

    const createRing = (pos: THREE.Vector3, dir: THREE.Vector3, step: number, axisIndex: number, planeId: number) => {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh(this.sharedGeometry, material);
      
      const zAxis = new THREE.Vector3(0, 0, 1);
      
      // 1. Calculate Perpendicular Quaternion (Default)
      const qPerp = new THREE.Quaternion();
      if (dir.dot(zAxis) < -0.999) {
        qPerp.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      } else if (dir.dot(zAxis) > 0.999) {
        qPerp.identity();
      } else {
        qPerp.setFromUnitVectors(zAxis, dir);
      }

      // 2. Calculate Coplanar Quaternion
      const worldUp = new THREE.Vector3(0, 1, 0);
      const tangent = new THREE.Vector3();
      
      if (Math.abs(dir.dot(worldUp)) > 0.9) {
        tangent.crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
      } else {
        tangent.crossVectors(dir, worldUp).normalize();
      }
      const qCoplanar = new THREE.Quaternion().setFromUnitVectors(zAxis, tangent);

      mesh.quaternion.copy(qPerp);
      mesh.position.copy(pos);
      
      // Apply slight scale offset based on axisIndex to prevent Z-fighting on the overlapping Y-axes
      // The later indices will be slightly larger, enveloping the previous ones
      const scaleOffset = 1.0 + (axisIndex * 0.002); 
      mesh.scale.setScalar(scaleOffset);

      this.mainGroup.add(mesh);
      
      const phase = Math.abs(step) * 0.5 + axisIndex * 0.2;
      const lineProgress = (step + 2) / 4.0;

      this.rings.push({
        mesh: mesh,
        direction: dir.clone(),
        step: step,
        basePosition: pos.clone(),
        baseQuaternion: qPerp.clone(),
        quatPerpendicular: qPerp.clone(),
        quatCoplanar: qCoplanar.clone(),
        phase: phase,
        lineProgress: lineProgress,
        axisIndex: axisIndex,
        planeIndex: planeId
      });
    };

    // Generate rings for each of the axes
    axes.forEach((item, axisIndex) => {
      for (let step = -2; step <= 2; step++) {
        let distance = 0;
        const absStep = Math.abs(step);
        
        if (absStep === 1) distance = 1.0;
        if (absStep === 2) distance = 2.5; 
        
        if (step < 0) distance *= -1;

        const pos = item.vec.clone().multiplyScalar(distance);
        createRing(pos, item.vec, step, axisIndex, item.planeId);
      }
    });
  }

  private onWindowResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    if (this.controls) {
      this.controls.handleResize();
    }
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
    
    const omega = (Math.PI * 2) / 8.0; 
    const t = time * omega; 
    
    // Sync mode cycle duration
    const CYCLE_DURATION = 3.0; 

    this.rings.forEach((r, i) => {
      // Always reset to the currently active base orientation
      r.mesh.position.copy(r.basePosition);
      r.mesh.quaternion.copy(r.baseQuaternion);
      
      // Preserve base scale (including Z-fight fix)
      const baseScale = 1.0 + (r.axisIndex * 0.002);
      r.mesh.scale.setScalar(baseScale);
      
      if (mode === 'mode1') {
        const breathe = Math.sin(t + r.planeIndex); // Offset phase by plane
        const tiltAmt = THREE.MathUtils.degToRad(35) * breathe;
        r.mesh.rotateX(tiltAmt);
      } 
      else if (mode === 'mode2') {
        // "Sync" Mode
        // Pattern concentrated on the center (concentric layers based on distance/step)
        // No linear movement.
        // Full 360 degree rotation loops.
        
        const layer = Math.abs(r.step); // 0 (Center), 1 (Inner), 2 (Outer)
        
        // Delay phase by layer to create ripple/breathing effect from center
        const phaseDelay = layer * 0.5; 
        
        // Continuous rotation over the cycle
        const cycleProgress = ((time - phaseDelay) % CYCLE_DURATION) / CYCLE_DURATION;
        const angle = cycleProgress * Math.PI * 2;
        
        r.mesh.rotateX(angle);
      } 
      else if (mode === 'mode3') {
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
    if (this.currentMode() === mode) return;

    this.currentMode.set(mode);
    this.updateAudio(mode);
  }

  private updateAudio(mode: AnimMode) {
    // 1. Stop current audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }

    // 2. Play new audio from map if exists
    if (mode !== 'none' && this.audioMap[mode]) {
      this.currentAudio = this.audioMap[mode];
      // Sync properties just in case
      this.currentAudio.volume = this.volume();
      this.currentAudio.muted = this.isMuted();
      
      // Reset time again just to be safe if it was played before
      this.currentAudio.currentTime = 0;
      
      this.currentAudio.play().catch(err => {
        console.warn('Audio playback prevented by browser policy (user interaction required):', err);
      });
    }
  }

  setVisual(style: VisualStyle) {
    this.currentStyle.set(style);
    this.applyStyle(style);
  }

  private applyStyle(style: VisualStyle) {
    if (this.rings.length === 0) return;

    this.scene.background = new THREE.Color(0xe5e5e5);

    // Extended palette for 16 axes
    const axisColors = [
      0xf97316, 0xeab308, 0x22c55e, 0x06b6d4, // Plane 1 Colors
      0x3b82f6, 0x6366f1, 0xa855f7, 0xd946ef, // Plane 2 Colors
      0xf43f5e, 0xef4444, 0x84cc16, 0x14b8a6, // Plane 3 Colors
      0x64748b, 0xec4899, 0x8b5cf6, 0x10b981  // Plane 4 Colors
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
          newMat = new THREE.MeshStandardMaterial({ 
            color: 0x222222, 
            roughness: 0.5,
            metalness: 0.1,
            side: THREE.DoubleSide
          });
          break;
        case 'styleB': 
          newMat = new THREE.MeshStandardMaterial({ 
            color: 0x0ea5e9, // Bright Sky Blue (Water-like)
            emissive: 0x004488, // Subtle deep blue glow
            emissiveIntensity: 0.2,
            roughness: 0.08, // Very smooth/wet
            metalness: 0.1,
            side: THREE.DoubleSide
          });
          break;
        case 'styleC': 
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

  resetView(orientation: OrientationType) {
    // 1. Reset Camera
    if (this.camera && this.controls) {
      this.controls.reset(); 
      
      if (orientation === 'coplanar') {
        // Asterisk/Flower view - straight from Top (Y axis)
        this.camera.position.set(0, 15, 0.1);
        this.camera.up.set(0, 0, -1); 
      } else {
        // Default Z-axis view for Perpendicular and Face-On
        // Tunnel view - straight down Z axis
        this.camera.position.set(0, 0, 15);
        this.camera.up.set(0, 1, 0); 
      }
      
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
    
    // 2. Reset Animation Time
    this.clock = new THREE.Clock(); 
    this.clock.start();

    // 3. Update Orientation for all rings
    this.rings.forEach(r => {
      let targetQ: THREE.Quaternion;
      
      if (orientation === 'perpendicular') {
        targetQ = r.quatPerpendicular;
      } else if (orientation === 'coplanar') {
        targetQ = r.quatCoplanar;
      } else {
        // faceOn: aligns with XY plane (Identity for TorusGeometry)
        targetQ = new THREE.Quaternion().identity();
      }
      
      r.baseQuaternion.copy(targetQ);
      r.mesh.quaternion.copy(targetQ);
    });

    // 4. Reset Mode to 'none' and stop audio
    this.currentMode.set('none');
    this.updateAudio('none');
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    
    // Stop any playing audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    
    // Clean up preloaded audio
    Object.values(this.audioMap).forEach(audio => {
        audio.pause();
        audio.src = '';
    });
    this.audioMap = {};

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
    if (this.controls) this.controls.dispose();
  }
}