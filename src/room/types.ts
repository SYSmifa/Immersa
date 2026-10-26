export type Vec3 = [number, number, number];

export interface RoomPlane {
  label: string;
  pos: Vec3; // plane centre in the frame the room was captured in
}

export interface RoomItem {
  id: string;
  pos: Vec3; // same frame as the planes
}

// Our own room format; the Meta scan is only one possible source of `planes`.
export interface RoomFile {
  version: 1;
  savedAt: number;
  planes: RoomPlane[];
  items: RoomItem[];
}
