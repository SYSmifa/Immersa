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
  name: string; // display name (unique in the project)
  source?: string; // the file it was imported from, with its extension (the GLB in the cloud is a conversion of it)
  path: string; // "<user id>/<file>" in the Supabase "models" bucket, or "local:<file>" for public/models/
  pos: Vec3; // base centre of the model, in that room's frame
  yaw: number; // rotation about Y, radians
  tilt?: [number, number]; // also turned about X and Z (radians); the orientation is Ry(yaw) * Rx(tilt[0]) * Rz(tilt[1])
  scale: number;
  color?: string; // '#rrggbb' tint replacing the colour of every material (textures stay); absent: the file's own colours
  materialColors?: Record<string, string>; // per material (index in the model's material list): overrides `color`
  finish?: { roughness?: number; metalness?: number }; // 0..1, every material
  materialFinish?: Record<string, { roughness?: number; metalness?: number }>; // per material: overrides `finish`
  parts?: Record<string, PartEdit>; // changes to single components (parts of the file), by path (see room/parts.ts)
}

// A component of a model changed on its own. Offsets are in the model's own frame at scale 1 (they follow the model
// when it is moved, turned or scaled); yaw and scale act about the component's pivot (centre of its footprint, at its bottom).
export interface PartEdit {
  d?: Vec3; // moved from where it was in the file
  yaw?: number; // turned about Y, radians
  scale?: number; // 1 = as in the file
  color?: string; // tint of the whole component
  finish?: { roughness?: number; metalness?: number };
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
  createdAt: string;
  updatedAt: string;
  scan: RoomScan;
}

// A wall or a floor slab drawn in the PC editor (build mode), in its room's frame, on the room's floor level `y`.
// wall: from point a to point b (x, z), `height` m tall and `thickness` m thick. floor: the rectangle with corners a and b.
export interface Structure {
  id: string;
  roomId: string;
  kind: 'wall' | 'floor';
  a: [number, number];
  b: [number, number];
  y: number;
  height: number; // walls only
  thickness: number;
  color?: string; // tint (plain colour when there is no texture)
  texture?: string; // id in the texture catalogue (room/textures.ts)
  // wall: which side of the line a -> b the wall stands on ('left' = the line is its right face; undefined = centred, as the first walls were)
  align?: 'left' | 'center' | 'right';
  // floor: the corners (x, z) of its outline, any number >= 3; undefined = the rectangle with corners a and b
  pts?: [number, number][];
  finish?: { roughness?: number; metalness?: number }; // 0..1
  // Moved / turned / scaled in the headset, about the centre of its footprint (see room/structures.ts `effective`); the
  // PC editor takes it in as the new shape when it opens the project.
  xf?: { d?: [number, number]; yaw?: number; scale?: number };
}

// A project holds the models of one or more rooms (e.g. a whole house), each in its room's frame.
export interface Project {
  id: string;
  name: string;
  updatedAt: string;
  roomIds: string[];
  models: RoomModel[];
  structures: Structure[]; // walls and floors built in the editor
  tone?: number; // tile colour (index in the theme's tones), kept so that no two projects look alike
}
