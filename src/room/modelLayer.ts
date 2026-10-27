import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { modelUrl } from '../cloud/models';
import { createGltfLoader } from '../scene/gltf';
import type { RoomModel } from './types';

// Keeps scene objects in step with `room.models`: loads each GLB once (cached per
// path), keeps its real size, centres it on x/z with its base on y=0, and applies
// position / yaw / scale. Shared by the PC editor and the headset view.
export function createModelLayer(parent: Object3D, onError: (text: string) => void) {
  const holders = new Map<string, Group>();
  const assets = new Map<string, Promise<Object3D>>();
  const loader = createGltfLoader();

  function asset(path: string): Promise<Object3D> {
    let p = assets.get(path);
    if (!p) {
      p = modelUrl(path)
        .then((url) => loader.loadAsync(url))
        .then((gltf) => {
          const box = new Box3().setFromObject(gltf.scene);
          const c = box.getCenter(new Vector3());
          const wrapper = new Group();
          gltf.scene.position.set(-c.x, -box.min.y, -c.z);
          wrapper.add(gltf.scene);
          return wrapper;
        });
      p.catch(() => assets.delete(path)); // allow a retry on the next sync
      assets.set(path, p);
    }
    return p;
  }

  function attach(holder: Group, m: RoomModel) {
    asset(m.path)
      .then((obj) => holder.add(obj.clone(true)))
      .catch((e: Error) => {
        onError(`${m.name}: ${e.message}`);
        holder.add(new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color: 0xff3030, wireframe: true })));
      });
  }

  return {
    holders,
    // Call after any change to the list or to a model's transform.
    sync(models: RoomModel[]) {
      const ids = new Set(models.map((m) => m.id));
      for (const [id, h] of holders) {
        if (!ids.has(id)) {
          parent.remove(h);
          holders.delete(id);
        }
      }
      for (const m of models) {
        let h = holders.get(m.id);
        if (!h) {
          h = new Group();
          h.userData.modelId = m.id;
          parent.add(h);
          holders.set(m.id, h);
          attach(h, m);
        }
        h.position.set(...m.pos);
        h.rotation.set(0, m.yaw, 0);
        h.scale.setScalar(m.scale);
      }
    },
  };
}
