import type { Annotation, Project, Room, RoomModel, RoomScan, Structure } from '../room/types';

// A report sent from the headset: what the user wrote, which build, which device, and the session's log and state.
export interface Report {
  kind?: 'manual' | 'auto' | 'pc'; // default 'manual'
  note: string;
  appVersion: string;
  device: string;
  payload: Record<string, unknown>;
}

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
  createRoom(name: string, scan: RoomScan, place?: string): Promise<Room>;
  setRoomPlace(id: string, place: string | null): Promise<void>; // null: no place
  saveRoomData(id: string, scan: RoomScan): Promise<void>; // rewrites the scan JSON (links to other rooms) without making a backup
  renameRoom(id: string, name: string): Promise<void>;
  updateRoomScan(id: string, scan: RoomScan, previous: RoomScan): Promise<void>; // keeps `previous` as a backup
  deleteRoom(id: string): Promise<void>; // also deletes its projects
  listProjects(): Promise<Project[]>;
  createProject(name: string, roomIds: string[], models: RoomModel[], structures?: Structure[], tone?: number, annotations?: Annotation[]): Promise<Project>;
  // `skipped`: what could not be saved because the cloud's schema is older (supabase/schema.sql has to be run again).
  saveProject(id: string, patch: { name?: string; roomIds?: string[]; models?: RoomModel[]; structures?: Structure[]; annotations?: Annotation[]; tone?: number }): Promise<{ skipped?: string[] } | void>;
  deleteProject(id: string): Promise<void>;
  sendReport(report: Report): Promise<void>;
  listReports(): Promise<ReportRow[]>; // the user's own, newest first
  updateReportNote(id: string, note: string): Promise<void>;
}

export interface ReportRow {
  id: string;
  createdAt: string;
  kind: 'manual' | 'auto' | 'pc';
  appVersion: string;
  note: string;
}
