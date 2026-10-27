export type Vec3 = [number, number, number];

export interface RoomPlane {
  label: string;
  pos: Vec3; // plane centre in the frame the room was scanned in
  quat?: [number, number, number, number]; // plane orientation (x, y, z, w)
  poly?: number[]; // outline in plane space, flat [x, z, x, z, ...] (for drawing only)
}

// A furniture-like volume reported by the headset (table, couch, ...): an oriented box.
export interface RoomBox {
  label: string;
  pos: Vec3; // origin of the box's own frame, in the scan's frame
  quat: [number, number, number, number];
  min: Vec3; // corners of the box in its own frame
  max: Vec3;
}

// A 3D model placed in a project. Real-world size: `scale` multiplies the file's own metres.
export interface RoomModel {
  id: string;
  roomId: string; // the room whose frame `pos` and `yaw` are in
  name: string; // display name
  path: string; // "<user id>/<file>" in the Supabase "models" bucket, or "local:<file>" for public/models/
  pos: Vec3; // base centre of the model, in that room's frame
  yaw: number; // rotation about Y, radians
  scale: number;
}

// Our own room format; the Meta scan is only one possible source of `planes`.
export interface RoomScan {
  version: 1;
  savedAt: number;
  planes: RoomPlane[];
  boxes?: RoomBox[]; // absent in scans saved by older versions
}

export interface Room {
  id: string;
  name: string;
  updatedAt: string;
  scan: RoomScan;
}

// A project holds the models of one or more rooms (e.g. a whole house), each in its room's frame.
export interface Project {
  id: string;
  name: string;
  updatedAt: string;
  roomIds: string[];
  models: RoomModel[];
}
