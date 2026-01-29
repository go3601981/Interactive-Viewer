import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SceneService, AnimMode, VisualStyle } from './services/scene.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styles: [],
  changeDetection: 1 // OnPush
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasContainer') canvasRef!: ElementRef<HTMLCanvasElement>;
  
  private sceneService = inject(SceneService);

  // Expose signals to template
  activeMode = this.sceneService.currentMode;
  activeStyle = this.sceneService.currentStyle;

  ngAfterViewInit() {
    if (this.canvasRef) {
      this.sceneService.init(this.canvasRef.nativeElement);
    }
  }

  ngOnDestroy() {
    this.sceneService.dispose();
  }

  setMode(mode: AnimMode) {
    this.sceneService.setAnimationMode(mode);
  }

  setStyle(style: VisualStyle) {
    this.sceneService.setVisual(style);
  }

  reset() {
    this.sceneService.resetView();
  }
}