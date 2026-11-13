import type { Annotation, Project, Room, RoomModel, RoomScan, Structure } from '../room/types';
import type { Backend } from './backend';
import { authenticate } from './auth';
import { currentUserEmail, supabase } from './supabase';

interface RoomRow {
  id: string;
  name: string;
  data: RoomScan;
  created_at: string | null;
  updated_at: string;
  place?: string | null;
}
interface ProjectRow {
  id: string;
  room_id: string | null; // the first room (kept for the foreign key)
  room_ids: string[] | null;
  name: string;
  models: RoomModel[];
  structures: Structure[] | null;
  annotations?: Annotation[] | null;
  tone?: number | null;
  updated_at: string;
}

const ROOM_COLS = 'id,name,data,created_at,updated_at,place';
const ROOM_COLS_NOPLACE = 'id,name,data,created_at,updated_at';
// Until supabase/schema.sql has been re-run the newer columns do not exist: read (and write) without them instead of failing.
// The lists go from the newest schema to the oldest; each step drops the most recent column.
const PROJECT_BASE = 'id,room_id,room_ids,name,models,updated_at';
const PROJECT_COLS = [`${PROJECT_BASE},structures,tone,annotations`, `${PROJECT_BASE},structures,tone`, `${PROJECT_BASE},structures`, PROJECT_BASE];
const ROOM_COLS_OLD = 'id,name,data,updated_at';
const missingColumn = (e: { message?: string } | null) => !!e && /column|schema cache/i.test(e.message ?? '');

const toRoom = (r: RoomRow): Room => ({ id: r.id, name: r.name, createdAt: r.created_at ?? r.updated_at, updatedAt: r.updated_at, scan: r.data, place: r.place ?? undefined });
const toProject = (r: ProjectRow): Project => {
  const roomIds = r.room_ids?.length ? r.room_ids : r.room_id ? [r.room_id] : [];
  return {
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
    roomIds,
    // Projects saved before multi-room had no roomId on their models.
    models: (r.models ?? []).map((m) => ({ ...m, roomId: m.roomId ?? roomIds[0] ?? '' })),
    structures: r.structures ?? [],
    annotations: r.annotations ?? [],
    tone: r.tone ?? undefined,
  };
};

// Message of a failed Edge Function call (the function answers { error } with a status; no function at all = not deployed).
async function fnMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const b = (await ctx.clone().json()) as { error?: string };
      if (b?.error) return b.error;
      if (ctx.status === 404) return 'Questa funzione non è ancora attiva: va pubblicata in Supabase (link-device).';
    } catch {
      /* not JSON */
    }
  }
  return /not found|failed to send|fetch/i.test((error as Error)?.message ?? '') ? 'Questa funzione non è ancora attiva: va pubblicata in Supabase (link-device).' : ((error as Error)?.message ?? 'Errore');
}

function client() {
  if (!supabase) throw new Error('Supabase non configurato (.env.local)');
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const now = () => new Date().toISOString();

export function createSupabaseBackend(): Backend {
  let link: { code: string; secret: string } | null = null; // the code the headset is waiting on
  return {
    email: currentUserEmail,
    signIn: authenticate,
    deviceLogin: {
      async start() {
        if (!supabase) return { ok: false as const, message: 'Supabase non configurato (.env.local)' };
        const { data, error } = await supabase.functions.invoke('link-device', { body: { action: 'start' } });
        if (error || !data?.code) return { ok: false as const, message: error ? await fnMessage(error) : 'Nessun codice ricevuto.' };
        link = { code: data.code as string, secret: data.secret as string };
        return { ok: true as const, code: link.code };
      },
      async poll() {
        if (!supabase || !link) return 'expired' as const;
        const { data, error } = await supabase.functions.invoke('link-device', { body: { action: 'poll', code: link.code, secret: link.secret } });
        if (error) return { error: await fnMessage(error) };
        if (data?.status === 'ok' && data.token_hash) {
          link = null;
          let r = await supabase.auth.verifyOtp({ token_hash: data.token_hash as string, type: 'magiclink' });
          if (r.error) r = await supabase.auth.verifyOtp({ token_hash: data.token_hash as string, type: 'email' });
          return r.error ? { error: r.error.message } : ('ok' as const);
        }
        if (data?.status === 'expired') link = null;
        return data?.status === 'expired' ? ('expired' as const) : ('wait' as const);
      },
      cancel() {
        link = null;
      },
    },
    emailCode: {
      async send(email) {
        if (!supabase) return { ok: false as const, message: 'Supabase non configurato (.env.local)' };
        // Only for accounts that exist: typing a wrong address must not create a new account.
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
        if (!error) return { ok: true as const };
        if (/signups? not allowed|not found|otp/i.test(error.message)) return { ok: false as const, message: 'Non c\'è nessun account con questa email.' };
        if (/rate|seconds|too many/i.test(error.message)) return { ok: false as const, message: 'Troppe richieste: aspetta un minuto e riprova.' };
        return { ok: false as const, message: error.message };
      },
      async verify(email, code) {
        if (!supabase) return { ok: false as const, message: 'Supabase non configurato (.env.local)' };
        const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.replace(/\s/g, ''), type: 'email' });
        return error ? { ok: false as const, message: /expired|invalid/i.test(error.message) ? 'Codice sbagliato o scaduto.' : error.message } : { ok: true as const };
      },
    },
    async pendingDeviceLinks() {
      if (!supabase) return [];
      const { data, error } = await supabase.functions.invoke('link-device', { body: { action: 'pending' } });
      if (error) return [];
      return ((data?.items ?? []) as { code: string; ageSec: number }[]).slice(0, 5);
    },
    async approveDeviceLink(code) {
      if (!supabase) return { ok: false as const, message: 'Supabase non configurato (.env.local)' };
      const { error } = await supabase.functions.invoke('link-device', { body: { action: 'approve', code } });
      return error ? { ok: false as const, message: await fnMessage(error) } : { ok: true as const };
    },
    async signInWith(provider) {
      if (!supabase) return { ok: false as const, message: 'Supabase non configurato (.env.local)' };
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}${location.pathname}` } });
      if (error) return { ok: false as const, message: /provider|unsupported|not enabled/i.test(error.message) ? 'Questo accesso non è ancora attivo (va abilitato in Supabase).' : error.message };
      return { ok: true as const }; // the page is already on its way to the provider
    },
    async signOut() {
      await supabase?.auth.signOut({ scope: 'local' }); // only this device: the default ('global') signs out every device of the account
    },
    async listRooms() {
      // newest schema first, each step drops the most recent column (place, then created_at)
      for (const cols of [ROOM_COLS, ROOM_COLS_NOPLACE, ROOM_COLS_OLD]) {
        const { data, error } = await client().from('rooms').select(cols).order('updated_at', { ascending: false });
        if (missingColumn(error)) continue;
        check(error);
        return (data as unknown as RoomRow[]).map(toRoom);
      }
      throw new Error('Impossibile leggere le stanze');
    },
    async createRoom(name, scan, place) {
      for (const cols of [ROOM_COLS, ROOM_COLS_NOPLACE, ROOM_COLS_OLD]) {
        const row: Record<string, unknown> = { name, data: scan };
        if (cols === ROOM_COLS && place) row.place = place;
        const { data, error } = await client().from('rooms').insert(row).select(cols).single();
        if (missingColumn(error)) continue;
        check(error);
        return toRoom(data as unknown as RoomRow);
      }
      throw new Error('Impossibile salvare la stanza');
    },
    async setRoomPlace(id, place) {
      const { error } = await client().from('rooms').update({ place, updated_at: now() }).eq('id', id);
      if (missingColumn(error)) throw new Error('Il luogo non si può salvare: va rieseguito supabase/schema.sql');
      check(error);
    },
    async sendReport(r) {
      const { error } = await client().from('reports').insert({ kind: r.kind ?? 'manual', note: r.note, app_version: r.appVersion, device: r.device, payload: r.payload });
      if (error) throw new Error(/reports/.test(error.message) && /schema cache|does not exist/i.test(error.message) ? 'manca la tabella delle segnalazioni: riesegui supabase/schema.sql' : error.message);
    },
    async listReports() {
      const { data, error } = await client().from('reports').select('id, created_at, kind, app_version, note').order('created_at', { ascending: false }).limit(30);
      check(error);
      return (data ?? []).map((x) => ({ id: x.id as string, createdAt: x.created_at as string, kind: (x.kind ?? 'manual') as 'manual' | 'auto' | 'pc', appVersion: (x.app_version ?? '') as string, note: (x.note ?? '') as string }));
    },
    async updateReportNote(id, note) {
      const { error } = await client().from('reports').update({ note }).eq('id', id);
      check(error);
    },
    async saveRoomData(id, scan) {
      const { error } = await client().from('rooms').update({ data: scan }).eq('id', id); // not `updated_at`: this is not a new scan
      check(error);
    },
    async renameRoom(id, name) {
      const { error } = await client().from('rooms').update({ name, updated_at: now() }).eq('id', id);
      check(error);
    },
    async updateRoomScan(id, scan, previous) {
      const { error } = await client().from('rooms').update({ data: scan, previous_data: previous, updated_at: now() }).eq('id', id);
      check(error);
    },
    async deleteRoom(id) {
      const { error } = await client().from('rooms').delete().eq('id', id);
      check(error);
    },
    async listProjects() {
      let last: { message: string } | null = null;
      for (const cols of PROJECT_COLS) {
        const { data, error } = await client().from('projects').select(cols).order('updated_at', { ascending: false });
        if (!missingColumn(error)) {
          check(error);
          return (data as unknown as ProjectRow[]).map(toProject);
        }
        last = error;
      }
      check(last);
      return [];
    },
    async createProject(name, roomIds, models, structures = [], tone, annotations = []) {
      const row = { name, room_id: roomIds[0] ?? null, room_ids: roomIds, models };
      const payloads: Record<string, unknown>[] = [{ ...row, structures, tone: tone ?? null, annotations }, { ...row, structures, tone: tone ?? null }, { ...row, structures }, row];
      let last: { message: string } | null = null;
      for (let i = 0; i < payloads.length; i++) {
        const { data, error } = await client().from('projects').insert(payloads[i]).select(PROJECT_COLS[i]).single();
        if (!missingColumn(error)) {
          check(error);
          return toProject(data as unknown as ProjectRow);
        }
        last = error;
      }
      check(last);
      throw new Error('createProject');
    },
    async saveProject(id, patch) {
      // Only the colour changing is not an edit of the project: its "last modified" stays.
      const row: Record<string, unknown> = Object.keys(patch).every((k) => k === 'tone') ? {} : { updated_at: now() };
      if (patch.tone !== undefined) row.tone = patch.tone;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.models !== undefined) row.models = patch.models;
      if (patch.structures !== undefined) row.structures = patch.structures;
      if (patch.annotations !== undefined) row.annotations = patch.annotations;
      if (patch.roomIds !== undefined) {
        row.room_ids = patch.roomIds;
        row.room_id = patch.roomIds[0] ?? null;
      }
      const skipped: string[] = [];
      let { error } = await client().from('projects').update(row).eq('id', id);
      // An older schema lacks some columns: save the rest and say what was left out.
      for (const col of ['annotations', 'tone', 'structures']) {
        if (!missingColumn(error) || !(col in row)) continue;
        delete row[col];
        skipped.push(col);
        ({ error } = Object.keys(row).length ? await client().from('projects').update(row).eq('id', id) : { error: null });
      }
      check(error);
      return skipped.length ? { skipped } : undefined;
    },
    async deleteProject(id) {
      const { error } = await client().from('projects').delete().eq('id', id);
      check(error);
    },
  };
}
