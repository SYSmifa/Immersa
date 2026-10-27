import { Quaternion, Vector3 } from 'three';
import type { Backend } from '../cloud/backend';
import type { Project, Room, RoomModel, RoomPlane, RoomScan } from '../room/types';

// In-memory backend + synthetic rooms for the UI test harness (?uitest).
const q = (axis: [number, number, number], angle: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(...axis), angle).toArray() as [number, number, number, number];

// A box-shaped room: floor, ceiling, four walls and a table, centred on x/z = 0.
export function boxRoom(w: number, d: number, h: number): RoomPlane[] {
  const rect = (a: number, b: number) => [-a / 2, -b / 2, a / 2, -b / 2, a / 2, b / 2, -a / 2, b / 2];
  return [
    { label: 'floor', pos: [0, 0, 0], quat: q([0, 1, 0], 0), poly: rect(w, d) },
    { label: 'ceiling', pos: [0, h, 0], quat: q([0, 1, 0], 0), poly: rect(w, d) },
    { label: 'wall', pos: [0, h / 2, -d / 2], quat: q([1, 0, 0], Math.PI / 2), poly: rect(w, h) },
    { label: 'wall', pos: [0, h / 2, d / 2], quat: q([1, 0, 0], -Math.PI / 2), poly: rect(w, h) },
    { label: 'wall', pos: [-w / 2, h / 2, 0], quat: q([0, 0, 1], -Math.PI / 2), poly: rect(h, d) },
    { label: 'wall', pos: [w / 2, h / 2, 0], quat: q([0, 0, 1], Math.PI / 2), poly: rect(h, d) },
    { label: 'table', pos: [w * 0.2, 0.75, d * 0.1], quat: q([0, 1, 0], 0), poly: rect(1.2, 0.7) },
    { label: 'door', pos: [w / 2 - 0.01, 1, -d / 4], quat: q([0, 0, 1], Math.PI / 2), poly: rect(2, 0.9) },
  ];
}

// The same planes as the headset would report them in a new session: rotated, moved, a little noise.
export function asLive(planes: RoomPlane[], yaw: number, tx: number, ty: number, tz: number): RoomPlane[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return planes.map((p, i) => ({
    label: p.label,
    pos: [c * p.pos[0] + s * p.pos[2] + tx + 0.004 * Math.sin(i), p.pos[1] + ty, -s * p.pos[0] + c * p.pos[2] + tz],
    quat: p.quat && (turn.clone().multiply(new Quaternion(...p.quat)).toArray() as [number, number, number, number]),
    poly: p.poly,
  }));
}

export function createFakeBackend(): Backend & { rooms: Room[]; projects: Project[] } {
  const now = () => new Date().toISOString();
  let n = 0;
  const model = (name: string, x: number, z: number): RoomModel => ({
    id: `m${n++}`,
    name,
    path: 'local:smoke.glb',
    pos: [x, 0, z],
    yaw: 0.4,
    scale: 1,
  });
  const rooms: Room[] = [
    { id: 'r1', name: 'Salotto', updatedAt: now(), scan: { version: 1, savedAt: 1, planes: boxRoom(5, 4, 2.6) } },
    { id: 'r2', name: 'Cucina', updatedAt: now(), scan: { version: 1, savedAt: 1, planes: boxRoom(3.2, 2.8, 2.5) } },
  ];
  const projects: Project[] = [
    { id: 'p1', roomId: 'r1', name: 'Allestimento A', updatedAt: now(), models: [model('Macchina', 0.5, -0.5), model('Banco', -1, 1)] },
    { id: 'p2', roomId: 'r1', name: 'Allestimento B', updatedAt: now(), models: [model('Macchina', 1, 1)] },
    { id: 'p3', roomId: 'r2', name: 'Cucina nuova', updatedAt: now(), models: [] },
  ];
  return {
    rooms,
    projects,
    email: async () => 'test@immersa.dev',
    signOut: async () => undefined,
    listRooms: async () => rooms.map((r) => ({ ...r })),
    async createRoom(name: string, scan: RoomScan) {
      const room = { id: `r${rooms.length + 1}`, name, updatedAt: now(), scan };
      rooms.push(room);
      return room;
    },
    async renameRoom(id, name) {
      const r = rooms.find((x) => x.id === id);
      if (r) r.name = name;
    },
    async deleteRoom(id) {
      rooms.splice(rooms.findIndex((x) => x.id === id), 1);
      for (let i = projects.length - 1; i >= 0; i--) if (projects[i].roomId === id) projects.splice(i, 1);
    },
    listProjects: async (roomId) => projects.filter((p) => !roomId || p.roomId === roomId),
    async createProject(roomId, name, models) {
      const p = { id: `p${projects.length + 1}`, roomId, name, updatedAt: now(), models };
      projects.push(p);
      return p;
    },
    async saveProject(id, patch) {
      const p = projects.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    },
    async deleteProject(id) {
      projects.splice(projects.findIndex((x) => x.id === id), 1);
    },
  };
}
