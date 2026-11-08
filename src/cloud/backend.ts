import type { Project, Room, RoomModel, RoomScan, Structure } from '../room/types';

// Everything the app needs from the cloud. Supabase implements it (repo.ts);
// the UI test harness uses an in-memory one.
export interface Backend {
  email(): Promise<string | null>;
  signOut(): Promise<void>;
  signIn(email: string, password: string, signUp: boolean): Promise<{ ok: true } | { ok: false; message: string }>;
  // Sign in through an identity provider (the page goes to its site and comes back signed in). Optional.
  signInWith?(provider: 'google' | 'azure'): Promise<{ ok: true } | { ok: false; message: string }>;
  // Sign in the headset with a code approved on the PC (Edge Function "link-device"). Optional.
  deviceLogin?: {
    start(): Promise<{ ok: true; code: string } | { ok: false; message: string }>;
    poll(): Promise<'wait' | 'ok' | 'expired' | { error: string }>; // 'ok' = signed in
    cancel(): void;
  };
  // Sign in with a code sent by email (for an account that already exists). Optional.
  emailCode?: {
    send(email: string): Promise<{ ok: true } | { ok: false; message: string }>;
    verify(email: string, code: string): Promise<{ ok: true } | { ok: false; message: string }>;
  };
  approveDeviceLink?(code: string): Promise<{ ok: true } | { ok: false; message: string }>; // on the PC, signed in
  // The headsets waiting for approval that asked from the same network as this PC (so nothing has to be typed).
  pendingDeviceLinks?(): Promise<{ code: string; ageSec: number }[]>;
  listRooms(): Promise<Room[]>;
  createRoom(name: string, scan: RoomScan): Promise<Room>;
  renameRoom(id: string, name: string): Promise<void>;
  updateRoomScan(id: string, scan: RoomScan, previous: RoomScan): Promise<void>; // keeps `previous` as a backup
  deleteRoom(id: string): Promise<void>; // also deletes its projects
  listProjects(): Promise<Project[]>;
  createProject(name: string, roomIds: string[], models: RoomModel[], structures?: Structure[], tone?: number): Promise<Project>;
  saveProject(id: string, patch: { name?: string; roomIds?: string[]; models?: RoomModel[]; structures?: Structure[]; tone?: number }): Promise<void>;
  deleteProject(id: string): Promise<void>;
}
