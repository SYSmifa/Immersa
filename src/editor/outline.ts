import {
  Camera,
  Color,
  DoubleSide,
  FloatType,
  NearestFilter,
  Object3D,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  WebGLRenderTarget,
  type Material,
  type Mesh,
} from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

// Crisp opaque outline round every selected object, each with its own silhouette: an object lying on another selected
// one (a sofa on a floor) keeps its own outline. The selection is drawn flat into a mask (one id per object, nothing
// else, so the gizmo is never outlined); the edge is the ring of pixels whose neighbour belongs to something else.
const idMaterial = (id: number) =>
  new ShaderMaterial({
    uniforms: { id: { value: id } },
    vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform float id;void main(){gl_FragColor=vec4(id/255.0,0.0,0.0,1.0);}',
    side: DoubleSide,
  });

const compose = new ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null },
    tMask: { value: null },
    texel: { value: [1, 1] },
    reach: { value: 2 },
    edge: { value: new Color(0x8fdcff) },
  },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tMask; uniform vec2 texel; uniform float reach; uniform vec3 edge;
    varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      float c = texture2D(tMask, vUv).r;
      if (c > 0.0) {
        for (int i = 0; i < 8; i++) {
          float a = 0.7853982 * float(i);
          for (int k = 1; k <= 3; k++) {
            if (float(k) > reach) break;
            float n = texture2D(tMask, vUv + vec2(cos(a), sin(a)) * texel * float(k)).r;
            if (abs(n - c) > 0.001) { gl_FragColor = vec4(edge, 1.0); return; }
          }
        }
      }
      gl_FragColor = base;
    }`,
  depthTest: false,
  depthWrite: false,
});

export class SelectionOutlinePass extends Pass {
  selected: Object3D[] = [];
  ignore: Object3D[] = []; // never in the mask (the gizmo: it shows and hides its own handles every frame, so hide its root)
  private mask = new WebGLRenderTarget(1, 1, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter });
  private quad = new FullScreenQuad(compose);
  private ids: ShaderMaterial[] = [];

  constructor(
    private scene: Scene,
    private camera: Camera,
    colour = 0x8fdcff,
    private thickness = 2,
  ) {
    super();
    (compose.uniforms.edge.value as Color).set(colour);
  }

  setSize(width: number, height: number) {
    this.mask.setSize(width, height);
    compose.uniforms.texel.value = [1 / width, 1 / height];
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    if (this.selected.length) this.drawMask(renderer);
    compose.uniforms.tDiffuse.value = readBuffer.texture;
    compose.uniforms.tMask.value = this.mask.texture;
    compose.uniforms.reach.value = this.selected.length ? this.thickness : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  private drawMask(renderer: WebGLRenderer) {
    // Which meshes belong to which selected object.
    const owner = new Map<Object3D, number>();
    this.selected.forEach((o, i) => o.traverse((m) => (m as Mesh).isMesh && owner.set(m, i + 1)));
    while (this.ids.length < this.selected.length) this.ids.push(idMaterial(this.ids.length + 1));
    // Hide everything else, give the selected meshes their id colour, draw, put it all back.
    const restore: (() => void)[] = [];
    for (const g of this.ignore) {
      const was = g.visible;
      g.visible = false;
      restore.push(() => (g.visible = was));
    }
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (!(m.isMesh || (o as unknown as { isLine?: boolean }).isLine || (o as unknown as { isPoints?: boolean }).isPoints || (o as unknown as { isSprite?: boolean }).isSprite)) return;
      const id = owner.get(o);
      if (id === undefined) {
        if (o.visible) {
          o.visible = false;
          restore.push(() => (o.visible = true));
        }
      } else {
        const prev = m.material as Material | Material[];
        m.material = this.ids[id - 1];
        restore.push(() => (m.material = prev));
      }
    });
    const bg = this.scene.background;
    const clear = renderer.getClearColor(new Color());
    const alpha = renderer.getClearAlpha();
    const prevTarget = renderer.getRenderTarget();
    this.scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.mask);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(clear, alpha);
    this.scene.background = bg;
    restore.forEach((f) => f());
  }

  dispose() {
    this.mask.dispose();
    this.quad.dispose();
    this.ids.forEach((m) => m.dispose());
  }
}
