import { CanvasTexture, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry } from 'three';

// Multi-line monospace text on a 3D panel (the DOM is not visible in XR).
export function createTextPanel(parent: Object3D, x: number, y: number, z: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  const panel = new Mesh(
    new PlaneGeometry(0.5, 0.4),
    new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  panel.renderOrder = 999;
  panel.position.set(x, y, z);
  parent.add(panel);

  return {
    setText(text: string) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ff0';
      ctx.font = '26px monospace';
      text.split('\n').forEach((line, i) => ctx.fillText(line, 12, 34 + i * 32));
      texture.needsUpdate = true;
    },
  };
}
