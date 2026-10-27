export type Vec3 = [number, number, number];

export interface RoomPlane {
  label: string;
  pos: Vec3; // plane centre in the frame the room was captured in
  quat?: [number, number, number, number]; // plane orientation (x, y, z, w)
  poly?: number[]; // outline in plane space, flat [x, z, x, z, ...] (for drawing only)
}

export interface RoomItem {
  id: string;
  pos: Vec3; // same frame as the planes
}

// A 3D model placed in the room. Real-world size: `scale` multiplies the file's own metres.
export interface RoomModel {
  id: string;
  name: string; // display name
  path: string; // "<user id>/<file>" in the Supabase "models" bucket, or "local:<file>" for public/models/
  pos: Vec3; // base centre of the model, same frame as the planes
  yaw: number; // rotation about Y, radians
  scale: number;
}

// Our own room format; the Meta scan is only one possible source of `planes`.
export interface RoomFile {
  version: 1;
  savedAt: number;
  planes: RoomPlane[];
  items: RoomItem[];
  models: RoomModel[];
}
