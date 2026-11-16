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
  canvas.height = 288;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false });
  const panel = new Mesh(
    new PlaneGeometry(0.4, 0.225),
    material,
  );
  panel.renderOrder = 999;
  panel.position.set(-0.3, -0.2, -0.9);
  camera.add(panel);

  let enabled = true;
  let info = '';
  let frames = 0;
  let last = performance.now();
  let lastFrame = performance.now();
  let worst = 0; // the longest gap between two frames in this window (ms)
  let late = 0; // frames that took more than 1.5 times the usual
  const gaps: number[] = [];
  const sections: Record<string, number> = {}; // the longest time of each part of the frame in this window (ms)

  // The first two lines big, the longest times of the parts of the frame small (two to a line), the last line the info.
  function draw(lines: string[], small: string[], info: string) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f0';
    let y = 50;
    ctx.font = '40px monospace';
    for (const l of lines) {
      ctx.fillText(l, 16, y);
      y += 46;
    }
    ctx.font = '26px monospace';
    for (const l of small) {
      ctx.fillText(l, 16, y);
      y += 30;
    }
    ctx.font = '34px monospace';
    ctx.fillText(info, 16, y + 8);
    texture.needsUpdate = true;
  }

  return {
    // How long a part of the frame took (our code, the drawing): the longest in each window is shown.
    section(name: string, ms: number) {
      sections[name] = Math.max(sections[name] ?? 0, ms);
    },
    setInfo(text: string) {
      info = text;
    },
    setEnabled(on: boolean) {
      dom.style.display = on ? '' : 'none';
      enabled = on;
    },
    // Call once per rendered frame; refreshes twice per second.
    // The 3D panel is only for the headset; on the PC the DOM readout is enough.
    tick(inXr = true) {
      panel.visible = inXr && enabled;
      frames++;
      const now = performance.now();
      const gap = now - lastFrame;
      lastFrame = now;
      gaps.push(gap);
      worst = Math.max(worst, gap);
      const dt = now - last;
      if (dt < 500) return;
      // A steady run has gaps all alike; a late frame is one clearly longer than the middle one (that is what shakes the picture).
      const sorted = [...gaps].sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)] || 1;
      late = gaps.filter((g) => g > mid * 1.5).length;
      const top = Object.entries(sections)
        .sort((p, q) => q[1] - p[1])
        .slice(0, 6)
        .map(([k, v]) => `${k} ${v.toFixed(1)}`);
      const small: string[] = [];
      for (let i = 0; i < top.length; i += 2) small.push(top.slice(i, i + 2).join('  '));
      const big = [`${((frames * 1000) / dt).toFixed(0)} fps  ${(dt / frames).toFixed(1)} ms`, `max ${worst.toFixed(0)} ms  lenti ${late}/${gaps.length}`];
      const text = [...big, ...small, info].join('\n');
      for (const k of Object.keys(sections)) sections[k] = 0;
      frames = 0;
      worst = 0;
      gaps.length = 0;
      last = now;
      dom.textContent = text;
      draw(big, small, info);
    },
  };
}
