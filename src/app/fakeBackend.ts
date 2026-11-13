import { Quaternion, Vector3 } from 'three';
import type { Backend } from '../cloud/backend';
import type { Project, Room, RoomBox, RoomModel, RoomPlane, RoomScan } from '../room/types';

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

// A couch, a cabinet and the table (matching the table plane of boxRoom) as volumes.
export function boxRoomBoxes(w: number, d: number): RoomBox[] {
  return [
    { label: 'couch', pos: [-w / 2 + 0.6, 0.4, d / 2 - 0.5], quat: q([0, 1, 0], 0), min: [-0.9, -0.4, -0.45], max: [0.9, 0.4, 0.45] },
    { label: 'table', pos: [w * 0.2, 0.375, d * 0.1], quat: q([0, 1, 0], 0), min: [-0.6, -0.375, -0.35], max: [0.6, 0.375, 0.35] },
    { label: 'storage', pos: [w / 2 - 0.3, 0.9, -d / 4], quat: q([0, 1, 0], 0.3), min: [-0.25, -0.9, -0.5], max: [0.25, 0.9, 0.5] },
  ];
}

export function asLiveBoxes(boxes: RoomBox[], yaw: number, tx: number, ty: number, tz: number): RoomBox[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return boxes.map((b) => ({
    ...b,
    pos: [c * b.pos[0] + s * b.pos[2] + tx, b.pos[1] + ty, -s * b.pos[0] + c * b.pos[2] + tz],
    quat: turn.clone().multiply(new Quaternion(...b.quat)).toArray() as RoomBox['quat'],
  }));
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

export function createFakeBackend(signedOut = false): Backend & { rooms: Room[]; projects: Project[] } {
  const now = () => new Date().toISOString();
  let n = 0;
  const model = (name: string, x: number, z: number, roomId = 'r1'): RoomModel => ({
    id: `m${n++}`,
    roomId,
    name,
    path: 'local:smoke.glb',
    pos: [x, 0, z],
    yaw: 0.4,
    scale: 1,
  });
  const rooms: Room[] = [
    { id: 'r1', name: 'Salotto', createdAt: '2026-03-14T10:00:00Z', updatedAt: now(), scan: { version: 1, savedAt: 1, planes: boxRoom(5, 4, 2.6), boxes: boxRoomBoxes(5, 4) } },
    { id: 'r2', name: 'Cucina', createdAt: '2026-05-02T16:30:00Z', updatedAt: now(), scan: { version: 1, savedAt: 1, planes: boxRoom(3.2, 2.8, 2.5), boxes: boxRoomBoxes(3.2, 2.8) } },
  ];
  const reports: import('../cloud/backend').ReportRow[] = [];
  const projects: Project[] = [
    { id: 'p1', roomIds: ['r1'], name: 'Allestimento A', updatedAt: now(), structures: [], annotations: [
        { id: 'n1', roomId: 'r1', kind: 'note', a: [0.5, 0.95, -0.5], text: 'Passa il cavo qui', color: '#ffb020' },
        { id: 'n2', roomId: 'r1', kind: 'ruler', a: [-1, 0.02, 1.4], b: [0.5, 0.02, 0.4], text: '', color: '#2dd4bf' },
      ], models: [model('Macchina', 0.5, -0.5), model('Banco', -1, 1)] },
    { id: 'p2', roomIds: ['r1'], name: 'Allestimento B', updatedAt: now(), structures: [], annotations: [], models: [model('Macchina', 1, 1)] },
    { id: 'p3', roomIds: ['r2'], name: 'Cucina nuova', updatedAt: now(), models: [], structures: [], annotations: [] },
    // A whole house: models in two rooms, each in its own room's frame.
    // A plan from a CAD drawing: walls and a floor in the free space, no scanned room (can be visited virtually).
    {
      id: 'p5',
      roomIds: [],
      name: 'Casa CAD',
      updatedAt: now(),
      models: [],
      annotations: [],
      structures: [
        { id: 'w1', roomId: '', kind: 'floor', a: [-4, -2.5], b: [4, 2.5], y: 0, height: 2.7, thickness: 0.05, pts: [[-4, -2.5], [4, -2.5], [4, 2.5], [-4, 2.5]] },
        { id: 'w2', roomId: '', kind: 'wall', a: [-4, -2.5], b: [4, -2.5], y: 0, height: 2.7, thickness: 0.2, align: 'center' },
        { id: 'w3', roomId: '', kind: 'wall', a: [4, -2.5], b: [4, 2.5], y: 0, height: 2.7, thickness: 0.2, align: 'center' },
        { id: 'w4', roomId: '', kind: 'wall', a: [4, 2.5], b: [-4, 2.5], y: 0, height: 2.7, thickness: 0.2, align: 'center' },
        { id: 'w5', roomId: '', kind: 'wall', a: [-4, 2.5], b: [-4, -2.5], y: 0, height: 2.7, thickness: 0.2, align: 'center' },
      ],
    },
    { id: 'p4', roomIds: ['r1', 'r2'], name: 'Casa', updatedAt: now(), structures: [], annotations: [], models: [model('Divano', 0.5, -0.5, 'r1'), model('Frigo', 0.3, 0.2, 'r2')] },
  ];
  return {
    rooms,
    projects,
    email: async () => (signedOut ? null : 'test@immersa.dev'),
    signOut: async () => undefined,
    async signIn(_email: string, password: string) {
      if (password !== 'secret') return { ok: false as const, message: 'Invalid login credentials' };
      signedOut = false;
      return { ok: true as const };
    },
    signInWith: async () => ({ ok: false as const, message: 'Google non è disponibile nella prova.' }),
    // The email code, faked: any email gets a code, and the code is 123456.
    emailCode: {
      send: async () => ({ ok: true as const }),
      verify: async (_email: string, code: string) => (code === '123456' ? ((signedOut = false), { ok: true as const }) : { ok: false as const, message: 'Codice sbagliato o scaduto.' }),
    },
    // The code flow, faked: the code is ABC234 and the headset is signed in after a few polls.
    deviceLogin: (() => {
      let polls = 0;
      return {
        start: async () => ((polls = 0), { ok: true as const, code: 'ABC234' }),
        poll: async () => (++polls >= 3 ? ((signedOut = false), 'ok' as const) : ('wait' as const)),
        cancel: () => undefined,
      };
    })(),
    pendingDeviceLinks: async () => [{ code: 'ABC234', ageSec: 12 }],
    approveDeviceLink: async (code: string) => (code === 'ABC234' ? { ok: true as const } : { ok: false as const, message: 'Codice non valido o scaduto.' }),
    listRooms: async () => rooms.map((r) => ({ ...r })),
    async createRoom(name: string, scan: RoomScan, place?: string) {
      const room: Room = { id: `r${rooms.length + 1}`, name, createdAt: now(), updatedAt: now(), scan, place };
      rooms.push(room);
      return room;
    },
    async renameRoom(id, name) {
      const r = rooms.find((x) => x.id === id);
      if (r) r.name = name;
    },
    async setRoomPlace(id, place) {
      const r = rooms.find((x) => x.id === id);
      if (r) r.place = place ?? undefined;
    },
    async sendReport(r) {
      reports.unshift({ id: `rep${reports.length + 1}`, createdAt: now(), kind: r.kind ?? 'manual', appVersion: r.appVersion, note: r.note });
      (window as unknown as { __reports?: unknown[] }).__reports = [...((window as unknown as { __reports?: unknown[] }).__reports ?? []), r]; // test hook
    },
    async listReports() {
      return reports.map((x) => ({ ...x }));
    },
    async updateReportNote(id, note) {
      const r = reports.find((x) => x.id === id);
      if (r) r.note = note;
    },
    async saveRoomData(id, scan) {
      const r = rooms.find((x) => x.id === id);
      if (r) r.scan = scan;
    },
    async updateRoomScan(id, scan) {
      const r = rooms.find((x) => x.id === id);
      if (r) r.scan = scan;
    },
    async deleteRoom(id) {
      rooms.splice(rooms.findIndex((x) => x.id === id), 1);
      // like the database: projects stay, with a stale room id
    },
    listProjects: async () => projects.map((p) => ({ ...p })),
    async createProject(name, roomIds, models, structures = [], tone, annotations = []) {
      const p = { id: `p${projects.length + 1}`, roomIds, name, updatedAt: now(), models, structures, annotations, tone };
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
