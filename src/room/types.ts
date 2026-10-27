export type Vec3 = [number, number, number];

export interface RoomPlane {
  label: string;
  pos: Vec3; // plane centre in the frame the room was scanned in
  quat?: [number, number, number, number]; // plane orientation (x, y, z, w)
  poly?: number[]; // outline in plane space, flat [x, z, x, z, ...] (for drawing only)
}

// A 3D model placed in a project. Real-world size: `scale` multiplies the file's own metres.
export interface RoomModel {
  id: string;
  name: string; // display name
  path: string; // "<user id>/<file>" in the Supabase "models" bucket, or "local:<file>" for public/models/
  pos: Vec3; // base centre of the model, in the room's frame
  yaw: number; // rotation about Y, radians
  scale: number;
}

// Our own room format; the Meta scan is only one possible source of `planes`.
export interface RoomScan {
  version: 1;
  savedAt: number;
  planes: RoomPlane[];
}

export interface Room {
  id: string;
  name: string;
  updatedAt: string;
  scan: RoomScan;
}

export interface Project {
  id: string;
  roomId: string;
  name: string;
  updatedAt: string;
  models: RoomModel[];
}
