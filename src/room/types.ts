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
  links?: Record<string, RoomLink>; // where the other rooms of the same place are, by room id (see room/layout.ts)
}

// Where another room is, seen from this one: a point of the OTHER room's frame becomes a point of THIS room's frame through
// x' = c x - s z + tx, y' = y + ty, z' = s x + c z + tz with c = cos(yaw), s = sin(yaw) (the convention of Alignment in align.ts).
export interface RoomLink {
  yaw: number;
  tx: number;
  ty: number;
  tz: number;
  at: number; // when it was measured (ms since the epoch)
  src: 'meta' | 'manual'; // placed by the headset's own planes, or by touching two corners
  // How sure we are. A measure from the headset is only a guess until a second session measures the same (the headset can move
  // a whole room by a metre between two sessions and its planes still fit): `n` counts the sessions that agreed. Used only when
  // n >= 2, or by hand (see room/layout.ts).
  n?: number; // absent = 1
  sess?: string; // the session of the last measure (a session counts once)
  cand?: { yaw: number; tx: number; ty: number; tz: number; at: number; n: number; sess: string }; // a different measure of a link not confirmed yet
}

export interface Room {
  id: string;
  name: string;
  place?: string; // the place it belongs to (a house, a site...): a project only uses rooms of one place; absent = not assigned yet
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

// A note or a ruler left in a room (the PC editor and the headset both show them). Points are in the room's frame, like models.
// note: one point `a` with a short text. ruler: two points `a` and `b`; its length is shown, `text` is an optional label.
export interface Annotation {
  id: string;
  roomId: string; // the room whose frame the points are in ('' = free space)
  kind: 'note' | 'ruler';
  a: Vec3;
  b?: Vec3; // rulers only
  text: string;
  color: string; // '#rrggbb'
  scale?: number; // notes: size of the label (1 = normal)
}

// A project holds the models of one or more rooms (e.g. a whole house), each in its room's frame.
export interface Project {
  id: string;
  name: string;
  updatedAt: string;
  roomIds: string[];
  models: RoomModel[];
  structures: Structure[]; // walls and floors built in the editor
  annotations: Annotation[]; // notes and rulers
  tone?: number; // tile colour (index in the theme's tones), kept so that no two projects look alike
}
