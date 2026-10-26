import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

const DESKTOP_BG = 0x15171c;

// Renderer + scene + camera. Desktop: orbit view on a dark background.
// AR session: transparent clear colour so the Quest passthrough shows through.
export function createStage(optionalFeatures: string[] = []) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(DESKTOP_BG, 1);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 50);
  camera.position.set(0, 1.6, 1);
  scene.add(camera); // needed so camera children (HUD) render in XR

  scene.add(new AmbientLight(0xffffff, 0.8));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(2, 4, 1);
  scene.add(sun);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, -2);
  controls.update();

  renderer.xr.addEventListener('sessionstart', () => {
    renderer.setClearColor(0x000000, 0);
    controls.enabled = false;
  });
  renderer.xr.addEventListener('sessionend', () => {
    renderer.setClearColor(DESKTOP_BG, 1);
    controls.enabled = true;
  });

  document.body.appendChild(
    ARButton.createButton(renderer, { optionalFeatures: ['local-floor', ...optionalFeatures] }),
  );

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera };
}
