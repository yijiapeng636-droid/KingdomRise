import { describe, expect, it } from 'vitest';
import { CAMERA_CONFIG, clampCameraZoom } from '../src/core/config/cameraConfig';
import { constrainCameraScroll, zoomAroundPoint } from '../src/presentation/camera/cameraGeometry';
import { calculatePanelPlacement, clampFloatingPosition } from '../src/presentation/ui/FloatingPanel';

describe('camera interaction geometry', () => {
  it('keeps every zoom request inside the configured range', () => {
    expect(clampCameraZoom(0.2)).toBe(CAMERA_CONFIG.minZoom);
    expect(clampCameraZoom(1.25)).toBe(1.25);
    expect(clampCameraZoom(3)).toBe(CAMERA_CONFIG.maxZoom);
  });

  it('keeps the world point under the pointer stable while zooming', () => {
    const camera = { viewportWidth: 960, viewportHeight: 640, scrollX: 0, scrollY: 120, zoom: 1 };
    const pointer = { x: 720, y: 180 };
    const scroll = zoomAroundPoint(camera, 1.5, pointer);
    const before = {
      x: camera.scrollX + 480 + (pointer.x - 480) / camera.zoom,
      y: camera.scrollY + 320 + (pointer.y - 320) / camera.zoom,
    };
    const after = {
      x: scroll.x + 480 + (pointer.x - 480) / 1.5,
      y: scroll.y + 320 + (pointer.y - 320) / 1.5,
    };

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('constrains panning and centers axes smaller than the viewport', () => {
    const bounds = { x: 0, y: 0, width: 960, height: 960 };

    expect(constrainCameraScroll({ x: -999, y: 999 }, { width: 960, height: 640 }, 2, bounds))
      .toEqual({ x: -240, y: 480 });
    expect(constrainCameraScroll({ x: 999, y: 0 }, { width: 960, height: 640 }, 0.75, bounds).x)
      .toBe(0);
  });
});

describe('floating panel geometry', () => {
  it('keeps dragging inside the visible game area', () => {
    expect(clampFloatingPosition({ x: -100, y: 900 }, { width: 960, height: 640 }))
      .toEqual({ x: 12, y: 576 });
  });

  it('opens away from the nearest right and bottom edges', () => {
    const placement = calculatePanelPlacement(
      { x: 896, y: 576 },
      52,
      { width: 250, height: 260 },
      { width: 960, height: 640 },
    );

    expect(placement).toEqual({ x: 636, y: 368, horizontal: 'left', vertical: 'above' });
  });
});
