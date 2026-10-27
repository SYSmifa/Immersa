import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
} from 'three';

// FPS / frame-time / triangle readout: DOM overlay on desktop, a 3D panel
// attached to the camera inside XR (the DOM is not visible in the headset).
export function createStats(camera: PerspectiveCamera) {
  const dom = document.createElement('div');
  dom.style.cssText =
    'position:fixed;top:8px;left:8px;padding:6px 10px;background:#000a;color:#0f0;' +
    'font:14px monospace;white-space:pre;z-index:10;pointer-events:none';
  document.body.appendChild(dom);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  const panel = new Mesh(
    new PlaneGeometry(0.4, 0.15),
    new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  panel.renderOrder = 999;
  panel.position.set(-0.3, -0.2, -0.9);
  camera.add(panel);

  let info = '';
  let frames = 0;
  let last = performance.now();

  function draw(text: string) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f0';
    ctx.font = '40px monospace';
    text.split('\n').forEach((line, i) => ctx.fillText(line, 16, 56 + i * 52));
    texture.needsUpdate = true;
  }

  return {
    setInfo(text: string) {
      info = text;
    },
    // Call once per rendered frame; refreshes twice per second.
    // The 3D panel is only for the headset; on the PC the DOM readout is enough.
    tick(inXr = true) {
      panel.visible = inXr;
      frames++;
      const now = performance.now();
      const dt = now - last;
      if (dt < 500) return;
      const text = `${((frames * 1000) / dt).toFixed(0)} fps  ${(dt / frames).toFixed(1)} ms\n${info}`;
      frames = 0;
      last = now;
      dom.textContent = text;
      draw(text);
    },
  };
}
