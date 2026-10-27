import type { Project, Room, RoomModel, RoomScan } from '../room/types';

// Everything the app needs from the cloud. Supabase implements it (repo.ts);
// the UI test harness uses an in-memory one.
export interface Backend {
  email(): Promise<string | null>;
  signOut(): Promise<void>;
  listRooms(): Promise<Room[]>;
  createRoom(name: string, scan: RoomScan): Promise<Room>;
  renameRoom(id: string, name: string): Promise<void>;
  listProjects(roomId: string): Promise<Project[]>;
  createProject(roomId: string, name: string, models: RoomModel[]): Promise<Project>;
  saveProject(id: string, patch: { name?: string; models?: RoomModel[] }): Promise<void>;
  deleteProject(id: string): Promise<void>;
}
