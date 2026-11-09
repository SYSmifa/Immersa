import '@fontsource/sen/latin-500.css';
import '@fontsource/sen/latin-700.css';
import { TEXTURES, textureCanvas } from '../room/textures';
import { hexToHsv, hsvToHex } from '../ui3d/color';
import { drawLoader } from '../ui3d/loader';
import { MODEL_ACCEPT, type Unit } from './importer';
import { AURA } from '../ui3d/theme';
import { PLAN_UNIT_M, plausibleSize, type PlanInfo, type PlanOptions, type PlanUnit } from './dxfImport';
import { HEAVY_TRIANGLES } from './simplify';

// DOM UI of the PC editor, in the same "Aura" look as the headset menu: ink gradient, white cards, turquoise accent, font Sen.
// Layout: left sidebar (home: open / new project / my rooms; then the project settings; login at the bottom),
// centre-top toolbar, top-right outline of the scene with the details of the selection under it, toast at the bottom.
export type BuildKind = 'floor' | 'wall';
export type Gizmo = 'translate' | 'rotate' | 'scale';
export type View = 'home' | 'projects' | 'rooms' | 'models' | 'new' | 'project';

// A file of the model library (the user's cloud storage) and where it is used.
const HEAVY = HEAVY_TRIANGLES;
export interface LibraryItem {
  path: string;
  name: string;
  sub: string;
  usedIn: string[];
  triangles?: number; // known after the library has looked inside the file
}

export interface LookEdit {
  target?: 'all' | number; // which material; omitted with `reset`
  color?: string | null; // null = back to the file's colour
  roughness?: number;
  metalness?: number;
  reset?: boolean; // every colour and finish back to the file's own
}
export interface StructureEdit {
  height?: number;
  thickness?: number;
  color?: string | null;
  texture?: string | null; // null = plain colour
  align?: 'left' | 'center' | 'right'; // walls: which side of the drawn line they stand on
  roughness?: number;
  metalness?: number;
}

export interface EditorHandlers {
  onOpenProject(id: string): void;
  onCreateProject(name: string, roomIds: string[]): void;
  projectNameError(name: string, exceptId?: string): string; // '' when the name is free (names are unique, caps and edge spaces ignored)
  onCloseProject(): void;
  onRenameProject(): void;
  onDeleteProject(): void;
  onProjectRoom(id: string): void;
  onRoomVisible(id: string): void;
  onAddRoom(id: string): void;
  onRemoveRoom(): void;
  onUpload(files: File[]): void;
  onImportPlan(file: File): void;
  onRenameRoom(id: string): void;
  onDeleteRoom(id: string): void;
  onOpenModels(): void;
  onLinkVisor(code: string): void;
  listVisors(): Promise<{ code: string; ageSec: number }[]>; // headsets waiting on this network
  onDeleteModel(path: string): void;
  onReplaceFromFile(oldPath: string, files: File[]): void;
  onMissingFromFile(files: File[]): void;
  onMissingFromLibrary(path: string): void;
  onReplaceFromLibrary(oldPath: string, newPath: string): void;
  onSimplifyModel(path: string): void;
  onPruneModels(): void;
  onSave(): void;
  // toolbar
  onBuild(kind: BuildKind | null): void;
  onGizmo(mode: Gizmo): void;
  onOrtho(on: boolean): void;
  onSnapGrid(on: boolean): void;
  onSnapVertex(on: boolean): void;
  onLocal(on: boolean): void;
  onMeasures(mode: MeasureMode): void;
  onUndo(): void;
  onRedo(): void;
  // outline + details
  onPick(key: string, additive: boolean): void;
  onModelScale(value: number, commit: boolean): void;
  onModelYaw(deg: number, commit: boolean): void;
  onModelTilt(axis: 'x' | 'z', deg: number, commit: boolean): void;
  onModelName(name: string): void;
  onModelLook(edit: LookEdit, commit: boolean): void;
  onStructure(edit: StructureEdit, commit: boolean): void;
  onDeleteSelection(): void;
  // a chosen component of a model
  onPartScale(value: number, commit: boolean): void;
  onPartYaw(deg: number, commit: boolean): void;
  onPartLook(edit: { color?: string | null; roughness?: number; metalness?: number }, commit: boolean): void;
  onPartReset(): void;
  onPartExit(): void;
}

export interface OutlineItem {
  key: string; // 'm:<id>' model, 's:<id>' structure
  name: string;
  kind: 'model' | BuildKind;
}
export interface MaterialRow {
  name: string;
  color: string;
  roughness: number;
  metalness: number;
}
export type Details =
  | { kind: 'multi'; count: number }
  | {
      kind: 'model';
      key: string;
      name: string;
      source?: string; // the file it was imported from
      missing?: Option[]; // its file cannot be loaded: the library files it could be replaced with
      scale: number;
      yawDeg: number;
      tiltDeg: [number, number]; // about X and Z
      size: [number, number, number] | null;
      color: string | null; // the colour given to every material, if any
      finish: { roughness: number; metalness: number }; // for 'every material'
      materials: MaterialRow[];
    }
  | {
      kind: 'part';
      key: string;
      name: string; // the component
      model: string; // the model it belongs to
      scale: number;
      yawDeg: number;
      color: string;
      tinted: boolean; // has a colour of its own
      finish: { roughness: number; metalness: number };
      moved: boolean; // not where / as it is in the file
    }
  | { kind: 'structure'; key: string; count?: number; type: BuildKind; height: number; thickness: number; color: string | null; texture: string | null; align?: 'left' | 'center' | 'right'; finish: { roughness: number; metalness: number }; measure: string };
// What the measure button shows: nothing, the selected objects only, or the sizes of everything.
export type MeasureMode = 'off' | 'sel' | 'all';
export interface MeasureLabel {
  x: number; // px, in the page
  y: number;
  text: string;
  kind: 'dim' | 'gap' | 'label';
}

export interface ToolbarState {
  build: BuildKind | null;
  gizmo: Gizmo;
  ortho: boolean;
  grid: boolean;
  vertex: boolean;
  local: boolean;
  measures: MeasureMode;
  canUndo: boolean;
  canRedo: boolean;
}

export type Option = { id: string; name: string; sub?: string; hidden?: boolean; tone?: number; uses?: string[] };

const A = AURA;
const CSS = `
.ed{--ink:${A.bgStops[0][1]};--ink2:${A.bgStops[1][1]};--ink3:${A.bgStops[2][1]};--acc:${A.accent[0]};--acc2:${A.accent[1]};--tint:${A.surfaceHover};
  font-family:'Sen',system-ui,sans-serif;font-size:14px;color:#fff}
.ed *{box-sizing:border-box;font-family:inherit}
.ed button,.ed select,.ed input{font-size:14px}
.ed-panel{background:linear-gradient(160deg,var(--ink),var(--ink2) 55%,var(--ink3));box-shadow:0 10px 40px #0008;border-radius:22px}
.ed-side{position:fixed;top:12px;left:12px;bottom:12px;width:310px;z-index:10;display:flex;flex-direction:column;gap:10px;padding:14px}
.ed-body{flex:1;overflow:auto;display:flex;flex-direction:column;gap:10px;min-height:0}
.ed-brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;letter-spacing:.02em}
.ed-brand i{width:12px;height:12px;border-radius:4px;background:linear-gradient(135deg,var(--acc),var(--acc2));box-shadow:0 0 12px var(--acc)}
.ed-title{color:#8b95a7;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:6px 4px 0}
.ed-ver{color:#5d6678;font-size:11px;padding:0 4px;text-align:center}
.ed-footer{border-top:1px solid #ffffff1a;padding-top:10px}
.ed-link{width:100%;justify-content:center;gap:8px;margin-bottom:10px}
.ed-card{background:#fff;color:#12151c;border-radius:16px;padding:10px;display:flex;flex-direction:column;gap:8px}
.ed-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ed-row.sp{justify-content:space-between;flex-wrap:nowrap}
.ed-card select,.ed-card input[type=number],.ed-card input[type=text]{width:100%;padding:8px 10px;border-radius:10px;border:1px solid #d9dee8;background:#f4f6fa;color:#12151c;outline:none}
.ed-card input[type=number]{width:96px}
.ed-card select:focus,.ed-card input:focus{border-color:var(--acc)}
.ed-card input[type=color]{width:34px;height:28px;padding:0;border:1px solid #d9dee8;border-radius:8px;background:none;cursor:pointer}
.ed-card input[type=range]{width:100%;accent-color:var(--acc)}
.ed-pill{border:0;border-radius:999px;padding:8px 14px;background:#e8ecf3;color:#12151c;cursor:pointer;font-weight:500;transition:.12s;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.ed-pill:hover:not(:disabled){background:var(--tint)}
.ed-pill:disabled{opacity:.4;cursor:default}
.ed-pill.acc{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#04211d;font-weight:700}
.ed-pill.bad:hover:not(:disabled){background:#ef4444;color:#fff}
.ed-big{display:flex;align-items:center;gap:12px;width:100%;padding:16px;border:0;border-radius:16px;background:#fff;color:#12151c;font-weight:700;font-size:15px;
  cursor:pointer;text-align:left;transition:.12s}
.ed-big:hover{background:var(--tint)}
.ed-big svg{width:24px;height:24px;color:var(--acc)}
.ed-big small{display:block;font-weight:500;color:#667085;font-size:12px;margin-top:2px}
.ed-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:#fff;color:#12151c;cursor:pointer;border:2px solid transparent;
  text-align:left;width:100%;font-weight:500;transition:.12s}
.ed-item:hover{background:var(--tint)}
.ed-item.on{border-color:var(--acc);background:var(--tint)}
.ed-ini{width:34px;height:34px;border-radius:11px;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-style:normal;font-weight:700;font-size:17px}
.ed-item.off span{opacity:.45}
.ed-eye{border:0;background:#0000;padding:4px;border-radius:8px;cursor:pointer;color:#475467;display:flex}
.ed-eye:hover{background:#0001}
.ed-item .ed-eye svg{width:20px;height:20px;color:#475467}
.ed-item svg{width:18px;height:18px;flex:none;color:#0f9488}
.ed-item span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ed-item small{color:#667085;font-weight:500}
.ed-check{display:flex;gap:8px;align-items:center;color:#cfd6e4;padding:0 4px;cursor:pointer}
.ed-card .ed-check{color:#12151c;padding:4px}
.ed-check input{accent-color:var(--acc)}
.ed-file{color:#cfd6e4;font-size:12px}
.ed-file::file-selector-button{border:0;border-radius:999px;padding:7px 12px;margin-right:8px;background:#ffffff1f;color:#fff;cursor:pointer;font-family:inherit}
.ed-back{align-self:flex-start;background:#ffffff14;color:#fff}
.ed-back:hover:not(:disabled){background:#ffffff26}
.ed-h{font-weight:700;font-size:16px;padding:0 4px}
.ed-top{position:fixed;top:12px;left:340px;right:324px;z-index:9;display:none;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.ed-top>*{pointer-events:auto}
.ed-tools{display:flex;gap:2px;align-items:center;padding:6px;border-radius:999px;background:linear-gradient(160deg,var(--ink),var(--ink3));box-shadow:0 6px 24px #0007}
.ed-ib{width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:#cfd6e4;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.12s}
.ed-ib svg{width:21px;height:21px}
.ed-ib:hover:not(:disabled){background:#ffffff1f}
.ed-ib:disabled{opacity:.3;cursor:default}
.ed-measures{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:1}
.ed-mlabel{position:absolute;left:0;top:0;padding:2px 7px;border-radius:9px;background:#10131ad9;color:#fff;font:600 12px/1.3 Sen,system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 4px #0006}
.ed-mlabel.gap{background:#14b8a6;color:#04211d}
.ed-ib.on,.ed-ib.on:hover:not(:disabled){background:linear-gradient(135deg,var(--acc),var(--acc2));color:#04211d}
.ed-sep{width:1px;height:24px;background:#ffffff26;margin:0 6px}
.ed-save{padding:0 16px;height:40px;margin-left:4px;background:#ffffff14;color:#cfd6e4;border-radius:999px;border:0;cursor:pointer;font-weight:500}
.ed-save.dirty{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#04211d;font-weight:700}
.ed-save:disabled{opacity:.4}
.ed-hint{padding:7px 16px;border-radius:999px;background:linear-gradient(160deg,var(--ink),var(--ink3));box-shadow:0 6px 24px #0007;color:#cfd6e4;font-size:13px;display:none}
.ed-right{position:fixed;right:12px;top:12px;bottom:12px;width:300px;z-index:9;display:none;flex-direction:column;gap:10px;pointer-events:none}
.ed-right>*{pointer-events:auto}
.ed-outline{padding:14px;display:flex;flex-direction:column;gap:6px;max-height:34vh;min-height:0}
.ed-outline .ed-list{overflow:auto;display:flex;flex-direction:column;gap:5px}
.ed-details{padding:14px;display:none;flex-direction:column;gap:8px;overflow:auto;min-height:0}
.ed-meta{color:#667085;font-size:12px}
.ed-pick{display:flex;flex-direction:column;align-items:center;gap:8px;padding:4px 0}
.ed-wheel{position:relative;width:168px;height:168px;touch-action:none;cursor:crosshair}
.ed-wheel canvas{width:100%;height:100%;border-radius:50%;box-shadow:0 2px 10px #0003}
.ed-wheel i{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1.5px #0007,0 2px 6px #0006;pointer-events:none}
.ed-pickrow{display:flex;gap:10px;align-items:center;width:100%}
.ed-chipc{width:34px;height:34px;border-radius:10px;border:1px solid #0002;flex:none}
.ed-hex{font-weight:700;letter-spacing:.04em;color:#344054;font-size:13px}
.ed-bright{flex:1;height:14px;-webkit-appearance:none;appearance:none;border-radius:999px;outline:none;border:1px solid #0002}
.ed-bright::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:#fff;border:3px solid #14b8a6;box-shadow:0 1px 5px #0005;cursor:pointer}
.ed-presets{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;width:100%}
.ed-presets button{width:24px;height:24px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #0003;cursor:pointer;padding:0}
.ed-presets button.orig{width:auto;border-radius:999px;padding:0 10px;background:#e8ecf3;font-size:12px;color:#12151c;font-weight:500;box-shadow:none;border:0}
.ed-sw{width:18px;height:18px;border-radius:6px;border:1px solid #0003;flex:none}
.ed-sub{color:#667085;font-size:12px;font-weight:500;padding:2px 2px 0}
.ed-fin{display:grid;grid-template-columns:76px 1fr 34px;gap:8px;align-items:center;font-size:13px;color:#344054;font-weight:500}
.ed-fin input{width:100%;height:14px;-webkit-appearance:none;appearance:none;border-radius:999px;outline:none;cursor:pointer;
  background:linear-gradient(90deg,var(--acc),var(--acc2)) 0/var(--v,50%) 100% no-repeat,#e3e8f0;box-shadow:inset 0 1px 2px #0002}
.ed-fin input::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:#fff;border:3px solid var(--acc);box-shadow:0 2px 6px #0004}
.ed-fin input::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid var(--acc);box-shadow:0 2px 6px #0004}
.ed-fin span:last-child{color:#667085;font-size:12px}
.ed-tex{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.ed-texbtn{position:relative;height:58px;border-radius:12px;border:2px solid transparent;background-size:cover;background-position:center;cursor:pointer;overflow:hidden;padding:0;
  box-shadow:0 0 0 1px #0002 inset}
.ed-texbtn.none{background:repeating-conic-gradient(#d0d5dd 0 25%,#fff 0 50%) 50%/12px 12px}
.ed-texbtn.on{border-color:var(--acc);box-shadow:0 0 0 2px #14b8a655}
.ed-texbtn span{position:absolute;left:0;right:0;bottom:0;padding:2px 0;background:#000a;color:#fff;font-size:11px;font-weight:500}
.ed-loading{position:fixed;left:50%;top:46%;transform:translate(-50%,-50%);z-index:30;width:300px;padding:10px 18px 20px;border-radius:26px;text-align:center;
  background:linear-gradient(160deg,#0b0d12e6,#1d222de6);box-shadow:0 14px 50px #000a;backdrop-filter:blur(6px);pointer-events:none;display:none;flex-direction:column;align-items:center;gap:2px}
.ed-loading canvas{width:170px;height:150px}
.ed-loading b{font-size:17px}
.ed-loading span{color:#aeb7c8;font-size:13px;min-height:1.2em}
.ed-loading i{display:block;width:70%;height:8px;border-radius:4px;background:#ffffff29;margin-top:10px;overflow:hidden}
.ed-loading i u{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--acc),var(--acc2));transition:width .15s}
.ed-modal{position:fixed;inset:0;z-index:40;background:#05070bb0;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
.ed-modal .ed-panel{width:380px;padding:20px;display:flex;flex-direction:column;gap:12px}
.ed-modal h3{margin:0;font-size:18px}
.ed-modal .ed-card{gap:10px}
.ed-warn{color:#b45309;font-size:12px;font-weight:500}
.ed-modal .ed-login{width:420px;padding:30px 28px 24px;gap:14px}
.ed-login .ed-brand{justify-content:center;font-size:22px}
.ed-login h3{text-align:center;font-size:20px}
.ed-login .ed-sub{text-align:center;color:#9aa4b8;font-size:13px;margin-top:-6px}
.ed-login input{width:100%;padding:11px 12px;border-radius:12px;border:1px solid #d9dee8;background:#f4f6fa;color:#12151c;outline:none;font-size:15px}
.ed-login input:focus{border-color:var(--acc)}
.ed-login .ed-pill{width:100%;justify-content:center;padding:11px 14px;font-size:15px}
.ed-login .ed-err{color:#fca5a5;font-size:13px;min-height:16px;text-align:center}
.ed-visor{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;background:#fff;color:#12151c;border-radius:14px;padding:10px 12px;font-weight:600}
.ed-visor small{color:#6b7488;font-weight:500;grid-column:1}
.ed-visor .ed-pill{grid-column:2;grid-row:1 / span 2;width:auto !important;padding:9px 16px !important}
.ed-waiting{display:flex;flex-direction:column;gap:8px}
.ed-or{display:flex;align-items:center;gap:10px;color:#7d879c;font-size:12px}
.ed-or:before,.ed-or:after{content:"";flex:1;height:1px;background:#2a3140}
.ed-login .ed-sso{background:#fff;color:#12151c;display:flex;gap:10px;align-items:center}
.ed-login .ed-sso svg{width:20px;height:20px;flex:none}
.ed-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:11;max-width:min(640px,50vw);padding:11px 20px;border-radius:999px;
  background:linear-gradient(160deg,var(--ink),var(--ink3));box-shadow:0 6px 24px #0008;color:#fff;text-align:center;white-space:pre-wrap;transition:opacity .2s}
.ed-toast:empty{opacity:0}
`;

const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
// Sign-in providers shown on the login card. Microsoft ('azure') is ready but waits for an Entra tenant to register the app in.
const SSO_ENABLED: ('google' | 'azure')[] = ['google'];

const ICON = {
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  room: svg('<path d="M4 20V8l8-4 8 4v12M4 20h16M9 20v-6h6v6"/>'),
  floor: svg('<path d="M3 14l9 5 9-5-9-5zM3 14v-2l9-5 9 5v2"/>'),
  wall: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 12h18M9 5v7M15 12v7"/>'),
  persp: svg('<path d="M12 3l8 4v10l-8 4-8-4V7zM12 11v10M4 7l8 4 8-4"/>'),
  ortho: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16"/>'),
  grid: svg('<path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>'),
  // a square with a dot on each corner: snap to vertices
  magnet: svg('<rect x="6" y="6" width="12" height="12" rx="0.5"/><circle cx="6" cy="6" r="2.4" fill="currentColor"/><circle cx="18" cy="6" r="2.4" fill="currentColor"/><circle cx="6" cy="18" r="2.4" fill="currentColor"/><circle cx="18" cy="18" r="2.4" fill="currentColor"/>'),
  world: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  ruler: svg('<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
  local: svg('<path d="M5 19V4M5 19h15M5 19l7-7"/><path d="M3 6l2-2 2 2M18 17l2 2-2 2"/>'),
  undo: svg('<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>'),
  move: svg('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/>'),
  scale: svg('<path d="M4 20L20 4M14 4h6v6M4 14v6h6"/>'),
  visor: svg('<path d="M3 9a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-2.500l-1.500-2h-4l-1.500 2H6a3 3 0 0 1-3-3z"/><circle cx="8" cy="11.500" r="1"/><circle cx="16" cy="11.500" r="1"/>'),
  cube: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
};

export function createEditorUi(h: EditorHandlers) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'ed';
  document.body.appendChild(root);

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const row = (...children: HTMLElement[]) => {
    const r = el('div', '', 'ed-row');
    r.append(...children);
    return r;
  };
  const pill = (label: string, onClick: () => void, cls = '') => {
    const b = el('button', label, `ed-pill ${cls}`.trim());
    b.onclick = onClick;
    return b;
  };
  const card = (...children: HTMLElement[]) => {
    const c = el('div', '', 'ed-card');
    c.append(...children);
    return c;
  };
  const title = (t: string) => el('div', t, 'ed-title');
  const select = (onChange?: (id: string) => void) => {
    const s = el('select');
    if (onChange) s.onchange = () => onChange(s.value);
    return s;
  };
  const fill = (s: HTMLSelectElement, items: Option[], selected: string | null, placeholder: string) => {
    s.replaceChildren(
      Object.assign(el('option', placeholder), { value: '' }),
      ...items.map((i) => Object.assign(el('option', i.name), { value: i.id })),
    );
    s.value = selected ?? '';
  };
  const big = (icon: string, label: string, sub: string, onClick: () => void) => {
    const b = el('button', '', 'ed-big');
    b.innerHTML = `${icon}<div>${label}<small>${sub}</small></div>`;
    b.onclick = onClick;
    return b;
  };
  const back = (label: string, to: () => void) => {
    const b = el('button', '', 'ed-pill ed-back');
    b.innerHTML = `<span style="width:16px;height:16px;display:inline-flex">${ICON.back}</span>${label}`;
    b.onclick = to;
    return b;
  };

  // ---- sidebar ----
  const side = el('div', '', 'ed-panel ed-side');
  const brand = el('div', '', 'ed-brand');
  brand.append(el('i'), document.createTextNode('Immersa'));
  const body = el('div', '', 'ed-body');
  const footer = el('div', '', 'ed-footer');
  // "Collega un visore" sits above the account (email / Esci) that the login box adds to the footer.
  const linkBtn = el('button', '', 'ed-pill ed-link');
  linkBtn.innerHTML = `<span style="width:16px;height:16px;display:inline-flex">${ICON.visor}</span>Collega un visore`;
  linkBtn.onclick = () => openLinkCard();
  footer.append(linkBtn);
  const version = el('div', `Versione ${__BUILD_ID__}`, 'ed-ver'); // to tell which build is online
  side.append(brand, body, footer, version);

  let view: View = 'home';
  let projectItems: Option[] = [];
  let openId: string | null = null;
  let roomItems: Option[] = [];
  let projectRoomItems: Option[] = [];
  let currentRoomId: string | null = null;
  let addableItems: Option[] = [];
  let projectName = '';
  let hasRoom = false;
  let hasProject = false;

  const goHome = () => setView('home');

  function renderHome() {
    body.replaceChildren(
      big(ICON.folder, 'Apri progetto', 'La lista dei tuoi progetti', () => setView('projects')),
      big(ICON.plus, 'Nuovo progetto', 'Nome e stanze', () => setView('new')),
      big(ICON.room, 'Le mie stanze', 'Stanze scansionate dal visore', () => setView('rooms')),
      big(ICON.cube, 'I miei modelli', 'File caricati nel cloud', () => {
        setView('models');
        h.onOpenModels();
      }),
    );
  }

  function renderProjects() {
    const list = projectItems.map((p) => {
      const b = el('button', '', 'ed-item');
      // Like the headset's project list: the initial on a tile whose colour depends on the name (same rule: name length).
      const tone = A.tones[(p.tone ?? 0) % A.tones.length];
      b.innerHTML = '<i class="ed-ini"></i><span></span>';
      const ini = b.querySelector('.ed-ini') as HTMLElement;
      ini.textContent = (p.name.trim()[0] ?? '?').toUpperCase();
      ini.style.background = `linear-gradient(135deg,${tone[0]},${tone[1]})`;
      b.querySelector('span')!.textContent = p.name;
      b.onclick = () => h.onOpenProject(p.id);
      return b;
    });
    body.replaceChildren(
      back('Indietro', goHome),
      el('div', 'Apri progetto', 'ed-h'),
      ...(list.length ? list : [el('div', 'Nessun progetto: creane uno con "Nuovo progetto".', 'ed-title')]),
    );
  }

  function renderNew() {
    const name = el('input');
    name.type = 'text';
    name.placeholder = 'Nome del progetto';
    const nameError = el('div', '', 'ed-warn');
    const checks = roomItems.map((r) => {
      const c = el('input');
      c.type = 'checkbox';
      c.value = r.id;
      const l = el('label', '', 'ed-check');
      l.append(c, document.createTextNode(r.name));
      return l;
    });
    const create = pill('Crea progetto', () => {
      const n = name.value.trim();
      if (!n) return name.focus();
      const bad = h.projectNameError(n);
      if (bad) {
        nameError.textContent = bad;
        name.focus();
        name.select();
        return;
      }
      const ids = checks.map((l) => l.firstChild as HTMLInputElement).filter((c) => c.checked).map((c) => c.value);
      h.onCreateProject(n, ids);
    }, 'acc');
    name.onkeydown = (e) => {
      if (e.key === 'Enter') create.click(); // (returning false from this handler would cancel every other key)
    };
    body.replaceChildren(
      back('Indietro', goHome),
      el('div', 'Nuovo progetto', 'ed-h'),
      card(name, nameError),
      title('Stanze del progetto (facoltative)'),
      card(...(checks.length ? checks : [el('div', 'Nessuna stanza salvata: scansionala dal visore (tab Scan).', 'ed-meta')]), el('div', 'Senza stanza hai solo la griglia: i modelli li ritrovi davanti a te nel visore.', 'ed-meta')),
      create,
    );
    name.focus();
  }

  function renderRooms() {
    const cards = roomItems.map((r) => {
      const t = el('div', r.name);
      t.style.fontWeight = '700';
      return card(t, ...(r.sub ? [el('div', r.sub, 'ed-meta')] : []), el('div', r.uses?.length ? `Usata in: ${r.uses.join(', ')}` : 'Non usata da nessun progetto', 'ed-meta'), row(pill('Rinomina', () => h.onRenameRoom(r.id)), pill('Elimina', () => h.onDeleteRoom(r.id), 'bad')));
    });
    body.replaceChildren(
      back('Indietro', goHome),
      el('div', 'Le mie stanze', 'ed-h'),
      ...(cards.length ? cards : [el('div', 'Nessuna stanza: scansionala e salvala dal visore (tab Scan).', 'ed-title')]),
    );
  }

  // Link a headset: a card in the middle of the screen (like the login one). The code the headset shows is typed here, on the
  // signed-in PC, and the headset gets in.
  let linkNoteEl: HTMLElement | null = null; // the message of the open card
  const showLinkNote = (text: string, ok: boolean) => {
    if (!linkNoteEl) return;
    linkNoteEl.textContent = text;
    linkNoteEl.style.color = ok ? '#5eead4' : '#fca5a5';
  };
  function openLinkCard() {
    if (linkNoteEl) return; // already open
    const overlay = el('div', '', 'ed-modal');
    const panel = el('div', '', 'ed-panel ed-login');
    const brand = el('div', '', 'ed-brand');
    brand.append(el('i'), document.createTextNode('Immersa'));
    const code = el('input');
    code.type = 'text';
    code.placeholder = 'ABC 234';
    code.maxLength = 7;
    code.autocomplete = 'off';
    code.style.cssText = 'text-transform:uppercase;letter-spacing:.25em;font-size:24px;text-align:center';
    const note = el('div', '', 'ed-err');
    linkNoteEl = note;
    // The headsets that are waiting on this network, found without typing anything: one click connects.
    const waiting = el('div', '', 'ed-waiting');
    const showWaiting = (items: { code: string; ageSec: number }[]) => {
      waiting.replaceChildren();
      if (!items.length) {
        waiting.append(el('div', 'Nessun visore in attesa su questa rete. Nel visore premi "Accedi con un codice dal PC".', 'ed-sub'));
        return;
      }
      for (const it of items) {
        const row = el('div', '', 'ed-visor');
        const spell = `${it.code.slice(0, 3)} ${it.code.slice(3)}`;
        row.append(el('div', `Visore in attesa · codice ${spell}`), el('small', `chiesto ${it.ageSec < 60 ? `${it.ageSec} s` : `${Math.round(it.ageSec / 60)} min`} fa`));
        const go = pill('Collega', () => {
          showLinkNote('Collego…', true);
          h.onLinkVisor(it.code);
        }, 'acc');
        row.append(go);
        waiting.append(row);
      }
      waiting.append(el('div', 'Collega solo se hai appena premuto il pulsante nel tuo visore.', 'ed-sub'));
    };
    const refresh = () => void h.listVisors().then((items) => linkNoteEl && showWaiting(items));
    refresh();
    const timer = window.setInterval(refresh, 3000);
    const close = () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', key, true);
      overlay.remove();
      linkNoteEl = null;
    };
    const go = pill('Collega con il codice', () => {
      const v = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v.length < 6) {
        showLinkNote('Il codice ha 6 caratteri.', false);
        return code.focus();
      }
      showLinkNote('Collego…', true);
      h.onLinkVisor(v);
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && document.activeElement === code) go.click();
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    panel.append(
      brand,
      el('h3', 'Collega un visore'),
      waiting,
      el('div', 'oppure scrivi il codice', 'ed-or'),
      el('div', "Serve se il visore è su un'altra rete (per esempio l'hotspot del telefono).", 'ed-sub'),
      card(code),
      note,
      go,
      pill('Chiudi', close),
    );
    overlay.append(panel);
    root.append(overlay);
  }

  let libraryItems: LibraryItem[] | null = null; // null = loading
  let libraryNote = '';
  let replacing: string | null = null; // the library file whose replacement is being chosen
  const replaceInput = el('input', '', 'ed-file');
  replaceInput.type = 'file';
  replaceInput.accept = MODEL_ACCEPT;
  replaceInput.multiple = true;
  replaceInput.onchange = () => {
    const old = replacing;
    replacing = null;
    if (old && replaceInput.files?.length) h.onReplaceFromFile(old, [...replaceInput.files]);
    replaceInput.value = '';
  };
  function renderModels() {
    const items = libraryItems;
    const unused = items?.filter((i) => !i.usedIn.length) ?? [];
    const cards = (items ?? []).map((i) => {
      const t = el('div', i.name);
      t.style.fontWeight = '700';
      const del = pill('Elimina', () => h.onDeleteModel(i.path), 'bad');
      del.disabled = i.usedIn.length > 0;
      const info = [t, el('div', i.triangles === undefined ? i.sub : `${i.sub} · ${i.triangles > HEAVY * 3 ? 'molto pesante per il visore' : i.triangles > HEAVY ? 'pesante per il visore' : 'leggero'}`, 'ed-meta'), el('div', i.usedIn.length ? `Usato in: ${i.usedIn.join(', ')}` : 'Non usato da nessun progetto', 'ed-meta')];
      if (replacing === i.path) {
        // Choosing the replacement: another file of the library, or a new one from the PC.
        const others = select();
        fill(others, (items ?? []).filter((o) => o.path !== i.path).map((o) => ({ id: o.path, name: `${o.name} · ${o.sub.split(' · ')[0]}` })), null, '— dalla libreria —');
        return card(
          ...info,
          el('div', 'Sostituisci con:', 'ed-title'),
          row(others, pill('Usa questo', () => {
            if (!others.value) return;
            replacing = null;
            h.onReplaceFromLibrary(i.path, others.value);
          }, 'acc')),
          row(pill('Da file…', () => replaceInput.click()), pill('Annulla', () => {
            replacing = null;
            renderModels();
          })),
        );
      }
      const rep = pill('Sostituisci', () => {
        replacing = i.path;
        renderModels();
      });
      rep.disabled = !i.usedIn.length;
      const simp = pill('Semplifica', () => h.onSimplifyModel(i.path));
      simp.disabled = !i.usedIn.length || (i.triangles !== undefined && i.triangles <= HEAVY); // unused: deleted anyway; light: nothing to gain
      if (i.triangles !== undefined && i.triangles <= HEAVY) simp.title = 'Già leggero';
      return card(...info, row(rep, simp, del));
    });
    const clean = pill(`Elimina i non usati (${unused.length})`, h.onPruneModels, 'bad');
    clean.disabled = !unused.length;
    body.replaceChildren(
      back('Indietro', goHome),
      el('div', 'I miei modelli', 'ed-h'),
      ...(libraryNote ? [el('div', libraryNote, 'ed-meta')] : []),
      ...(items === null ? [el('div', 'Carico la lista...', 'ed-title')] : items.length ? [clean, ...cards] : [el('div', 'Nessun modello nel cloud: caricane uno da un progetto.', 'ed-title')]),
    );
  }

  const fileInput = el('input', '', 'ed-file');
  fileInput.type = 'file';
  fileInput.accept = MODEL_ACCEPT;
  fileInput.multiple = true; // an OBJ comes with its MTL and textures, a GLTF with its BIN
  fileInput.onchange = () => {
    if (fileInput.files?.length) h.onUpload([...fileInput.files]);
    fileInput.value = '';
  };

  const missingInput = el('input', '', 'ed-file');
  missingInput.type = 'file';
  missingInput.accept = MODEL_ACCEPT;
  missingInput.multiple = true;
  missingInput.onchange = () => {
    if (missingInput.files?.length) h.onMissingFromFile([...missingInput.files]);
    missingInput.value = '';
  };
  // A model whose file is gone (or cannot be read): replace it from a new file or from the library.
  function missingBlock(options: Option[]): HTMLElement[] {
    const pick = select();
    fill(pick, options, null, options.length ? '— dalla libreria —' : '(libreria vuota)');
    pick.disabled = !options.length;
    const warn = el('div', 'Il file di questo modello non si carica (forse non esiste più). Sostituiscilo: posizione, rotazione e scala restano.', 'ed-meta');
    warn.style.color = '#ef4444';
    return [warn, row(pick, pill('Usa questo', () => pick.value && h.onMissingFromLibrary(pick.value), 'acc')), row(pill('Da file…', () => missingInput.click()))];
  }

  const planInput = el('input', '', 'ed-file');
  planInput.type = 'file';
  planInput.accept = '.dxf';
  planInput.onchange = () => {
    if (planInput.files?.length) h.onImportPlan(planInput.files[0]);
    planInput.value = '';
  };

  function renderProject() {
    const name = el('div', projectName);
    name.style.cssText = 'font-weight:700;font-size:16px';
    const rooms = projectRoomItems.map((r) => {
      const wrap = el('div', '', `ed-item${r.id === currentRoomId ? ' on' : ''}${r.hidden ? ' off' : ''}`);
      wrap.innerHTML = `${ICON.room}<span></span><button class="ed-eye" title="Nascondi / mostra la scansione di questa stanza">${r.hidden ? ICON.eyeOff : ICON.eye}</button>`;
      wrap.querySelector('span')!.textContent = r.name;
      (wrap.querySelector('.ed-eye') as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        h.onRoomVisible(r.id);
      };
      wrap.onclick = () => h.onProjectRoom(r.id);
      return wrap;
    });
    const addable = select();
    fill(addable, addableItems, null, addableItems.length ? '— aggiungi una stanza —' : "(nessun'altra stanza)");
    addable.disabled = !addableItems.length;
    const add = pill('Aggiungi', () => addable.value && h.onAddRoom(addable.value));
    add.disabled = !addableItems.length;
    const remove = pill('Togli la stanza dal progetto', h.onRemoveRoom, 'bad');
    remove.disabled = !hasRoom;
    fileInput.disabled = !hasProject; // also without rooms: models then go in the free space
    body.replaceChildren(
      back('Chiudi progetto', h.onCloseProject),
      card(name, row(pill('Rinomina', h.onRenameProject), pill('Elimina', h.onDeleteProject, 'bad'))),
      title('Stanze del progetto'),
      ...(rooms.length ? rooms : [el('div', 'Nessuna stanza: carica i modelli nello spazio libero, o aggiungine una.', 'ed-meta')]),
      card(row(addable, add), remove),
      title('Aggiungi un modello (.glb)'),
      fileInput,
      title('Pianta CAD (.dxf): pareti e pavimenti'),
      card(el('div', 'Crea le pareti e i pavimenti da una pianta, in un progetto senza stanze scansionate: ci puoi camminare dentro col visore.', 'ed-meta'), pill('Importa pianta…', () => planInput.click())),
    );
  }

  function render() {
    ({ home: renderHome, projects: renderProjects, new: renderNew, rooms: renderRooms, models: renderModels, project: renderProject })[view]();
  }
  function setView(v: View) {
    view = v;
    render();
    syncChrome();
  }

  // ---- toolbar ----
  const top = el('div', '', 'ed-top');
  const tools = el('div', '', 'ed-tools');
  const ib = (icon: string, tip: string, onClick: () => void) => {
    const b = el('button', '', 'ed-ib');
    b.innerHTML = icon;
    b.title = tip;
    b.onclick = onClick;
    return b;
  };
  const sep = () => el('div', '', 'ed-sep');
  let state: ToolbarState = { build: null, gizmo: 'translate', ortho: false, grid: true, vertex: true, local: false, measures: 'sel', canUndo: false, canRedo: false };
  const bFloor = ib(ICON.floor, 'Pavimento: trascina sul pavimento per disegnarlo', () => h.onBuild(state.build === 'floor' ? null : 'floor'));
  const bWall = ib(ICON.wall, 'Parete: trascina sul pavimento per disegnarla', () => h.onBuild(state.build === 'wall' ? null : 'wall'));
  const bMove = ib(ICON.move, 'Sposta (W)', () => h.onGizmo('translate'));
  const bRotate = ib(ICON.rotate, 'Ruota (E)', () => h.onGizmo('rotate'));
  const bScale = ib(ICON.scale, 'Scala (R)', () => h.onGizmo('scale'));
  const bOrtho = ib(ICON.persp, 'Camera: prospettiva / ortogonale dall\'alto (pianta)', () => h.onOrtho(!state.ortho));
  const bGrid = ib(ICON.grid, 'Snap alla griglia (5 cm, rotazione a 15°)', () => h.onSnapGrid(!state.grid));
  const bVertex = ib(ICON.magnet, 'Snap ai vertici di pareti e pavimenti', () => h.onSnapVertex(!state.vertex));
  const bLocal = ib(ICON.world, 'Pivot: mondo / relativo all\'oggetto', () => h.onLocal(!state.local));
  const NEXT: Record<MeasureMode, MeasureMode> = { off: 'sel', sel: 'all', all: 'off' };
  const bMeasure = ib(ICON.ruler, 'Misure e distanze: spente / oggetto selezionato / dimensioni di tutto (clic per cambiare)', () => h.onMeasures(NEXT[state.measures]));
  const bUndo = ib(ICON.undo, 'Annulla (Ctrl+Z)', h.onUndo);
  const bRedo = ib(ICON.redo, 'Ripeti (Ctrl+Y)', h.onRedo);
  const save = el('button', 'Salva', 'ed-save');
  save.onclick = h.onSave;
  tools.append(bOrtho, sep(), bFloor, bWall, sep(), bMove, bRotate, bScale, sep(), bGrid, bVertex, bLocal, bMeasure, sep(), bUndo, bRedo, save);
  const hint = el('div', '', 'ed-hint');
  top.append(tools, hint);

  // ---- outline + details ----
  const right = el('div', '', 'ed-right');
  const outline = el('div', '', 'ed-panel ed-outline');
  outline.append(el('div', 'Scena', 'ed-h'));
  const outlineList = el('div', '', 'ed-list');
  outline.append(outlineList);
  const details = el('div', '', 'ed-panel ed-details');
  right.append(outline, details);

  const toast = el('div', '', 'ed-toast');

  // The headset's loading card (animated wireframe cube, title, line, bar), for anything that takes a while.
  const loading = el('div', '', 'ed-loading');
  const cube = el('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cube.width = 170 * dpr;
  cube.height = 150 * dpr;
  const cctx = cube.getContext('2d')!;
  const lTitle = el('b');
  const lSub = el('span');
  const lBar = el('i');
  const lFill = el('u');
  lBar.append(lFill);
  loading.append(cube, lTitle, lSub, lBar);
  let loadingOn = false;
  let loadingTimer = 0;
  const spin = () => {
    if (!loadingOn) return;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, 170, 150);
    drawLoader(cctx, 85, 75, 140, performance.now() / 1000, 1);
    requestAnimationFrame(spin);
  };
  // Labels of the measures, pooled, placed by the editor every frame (under the panels, never in the way of the mouse).
  const measureLayer = el('div', '', 'ed-measures');
  const labelPool: HTMLElement[] = [];
  root.append(measureLayer, side, top, right, toast, loading);

  function syncChrome() {
    const on = view === 'project' && hasProject;
    top.style.display = on ? 'flex' : 'none';
    right.style.display = on ? 'flex' : 'none';
  }

  const numberField = (value: number, step: string, min: string | null, onInput: (v: number, commit: boolean) => void) => {
    const i = el('input');
    i.type = 'number';
    i.step = step;
    if (min !== null) i.min = min;
    i.value = String(Number(value.toFixed(3)));
    i.oninput = () => i.value !== '' && Number.isFinite(Number(i.value)) && onInput(Number(i.value), false);
    i.onchange = () => i.value !== '' && Number.isFinite(Number(i.value)) && onInput(Number(i.value), true);
    return i;
  };
  const PRESETS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#eceff1', '#424242'];
  // The headset's colour page, in DOM: a hue / saturation wheel, a brightness bar and preset dots.
  const picker = (hex: string, onInput: (hex: string, commit: boolean) => void, onOriginal?: () => void) => {
    let [hh, ss, vv] = hexToHsv(hex);
    const box = el('div', '', 'ed-pick');
    const wheel = el('div', '', 'ed-wheel');
    const canvas = el('canvas');
    const N = 168;
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N - 0.5;
        const dy = (y + 0.5) / N - 0.5;
        const r = Math.hypot(dx, dy) * 2;
        const o = (y * N + x) * 4;
        if (r > 1) continue;
        const c = hsvToHex(((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1, r, 1);
        img.data[o] = parseInt(c.slice(1, 3), 16);
        img.data[o + 1] = parseInt(c.slice(3, 5), 16);
        img.data[o + 2] = parseInt(c.slice(5, 7), 16);
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    const mark = el('i');
    wheel.append(canvas, mark);
    const chip = el('div', '', 'ed-chipc');
    const label = el('span', '', 'ed-hex');
    const bright = el('input', '', 'ed-bright');
    bright.type = 'range';
    bright.min = '0';
    bright.max = '1';
    bright.step = '0.01';
    const paint = () => {
      const now = hsvToHex(hh, ss, vv);
      const ang = hh * 2 * Math.PI;
      mark.style.left = `${(0.5 + (Math.cos(ang) * ss) / 2) * 100}%`;
      mark.style.top = `${(0.5 + (Math.sin(ang) * ss) / 2) * 100}%`;
      mark.style.background = now;
      chip.style.background = now;
      label.textContent = now.toUpperCase();
      bright.value = String(vv);
      bright.style.background = `linear-gradient(90deg,#000,${hsvToHex(hh, ss, 1)})`;
      return now;
    };
    paint();
    const fromPointer = (e: PointerEvent, commit: boolean) => {
      const r = wheel.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width - 0.5;
      const fy = (e.clientY - r.top) / r.height - 0.5;
      hh = ((Math.atan2(fy, fx) / (2 * Math.PI)) + 1) % 1;
      ss = Math.min(1, Math.hypot(fx, fy) * 2);
      onInput(paint(), commit);
    };
    let down = false;
    wheel.onpointerdown = (e) => {
      down = true;
      wheel.setPointerCapture(e.pointerId);
      fromPointer(e, false);
    };
    wheel.onpointermove = (e) => down && fromPointer(e, false);
    wheel.onpointerup = (e) => {
      down = false;
      fromPointer(e, true);
    };
    bright.oninput = () => {
      vv = Number(bright.value);
      onInput(paint(), false);
    };
    bright.onchange = () => onInput(paint(), true);
    const presets = el('div', '', 'ed-presets');
    if (onOriginal) {
      const o = el('button', 'Originale', 'orig');
      o.onclick = onOriginal;
      presets.append(o);
    }
    for (const c of PRESETS) {
      const b = el('button');
      b.style.background = c;
      b.title = c;
      b.onclick = () => {
        [hh, ss, vv] = hexToHsv(c);
        onInput(paint(), true);
      };
      presets.append(b);
    }
    const info = el('div', '', 'ed-pickrow');
    info.append(chip, label, bright);
    box.append(wheel, info, presets);
    return box;
  };
  const finishRow = (name: string, value: number, onInput: (v: number, commit: boolean) => void) => {
    const r = el('input');
    r.type = 'range';
    r.min = '0';
    r.max = '1';
    r.step = '0.01';
    r.value = String(value);
    r.style.setProperty('--v', `${value * 100}%`); // the filled part of the track
    const num = el('span', value.toFixed(2));
    r.oninput = () => {
      r.style.setProperty('--v', `${Number(r.value) * 100}%`);
      num.textContent = Number(r.value).toFixed(2);
      onInput(Number(r.value), false);
    };
    r.onchange = () => onInput(Number(r.value), true);
    const row = el('div', '', 'ed-fin');
    row.append(el('span', name), r, num);
    return row;
  };

  // The catalogue as a grid of small previews; the first tile is "no texture" (plain colour).
  const textureGrid = (current: string | null, onPick: (id: string | null) => void) => {
    const grid = el('div', '', 'ed-tex');
    const tile = (id: string | null, name: string) => {
      const b = el('button', '', `ed-texbtn${id === current ? ' on' : ''}`);
      b.title = name;
      if (id) b.style.backgroundImage = `url(${textureCanvas(id)!.toDataURL('image/jpeg', 0.7)})`;
      else b.classList.add('none');
      const l = el('span', name);
      b.append(l);
      b.onclick = () => onPick(id);
      return b;
    };
    grid.append(tile(null, 'Nessuna'), ...TEXTURES.map((t) => tile(t.id, t.name)));
    return grid;
  };

  let matTarget: 'all' | number = 'all';
  let lastKey = '';
  // The model's name: changed when you leave the field or press Enter.
  const nameField = (value: string) => {
    const i = el('input');
    i.type = 'text';
    i.value = value;
    i.onchange = () => h.onModelName(i.value);
    i.onkeydown = (e) => {
      if (e.key === 'Enter') i.blur();
      e.stopPropagation(); // no shortcuts while typing
    };
    return i;
  };

  let lastSig = '';
  let pending: Details | null | undefined;
  let interacting = false;
  details.addEventListener('pointerdown', () => (interacting = true));
  window.addEventListener('pointerup', () => {
    if (!interacting) return;
    interacting = false;
    // A refresh that arrived during a drag is applied now.
    setTimeout(() => pending !== undefined && api.setDetails(pending), 0);
  });
  function renderDetails(d: Details | null) {
    details.style.display = d ? 'flex' : 'none';
    if (!d) return;
    const del = pill('Elimina', h.onDeleteSelection, 'bad');
    if (d.kind === 'multi') {
      details.replaceChildren(el('div', `${d.count} oggetti selezionati`, 'ed-h'), card(el('div', 'Il gizmo li muove e li ruota insieme.', 'ed-meta'), del));
      return;
    }
    if (d.key !== lastKey) {
      lastKey = d.key;
      matTarget = 'all';
    }
    if (d.kind === 'part') {
      details.replaceChildren(
        el('div', d.name, 'ed-h'),
        el('div', `Componente di ${d.model}`, 'ed-sub'),
        card(
          row(el('span', 'Scala'), numberField(d.scale, '0.01', '0.05', (v, c) => h.onPartScale(v, c))),
          row(el('span', 'Rotazione °'), numberField(d.yawDeg, '1', null, (v, c) => h.onPartYaw(v, c))),
          pill('Riposiziona dov\'era', h.onPartReset),
        ),
        el('div', 'Colore', 'ed-h'),
        card(
          picker(d.color, (c, commit) => h.onPartLook({ color: c }, commit), d.tinted ? () => h.onPartLook({ color: null }, true) : undefined),
          finishRow('Rugosità', d.finish.roughness, (v, c) => h.onPartLook({ roughness: v }, c)),
          finishRow('Metallico', d.finish.metalness, (v, c) => h.onPartLook({ metalness: v }, c)),
        ),
        card(pill('Esci dal componente (Esc)', h.onPartExit)),
      );
      return;
    }
    if (d.kind === 'model') {
      const size = el('div', d.size ? `Dimensioni reali ${d.size.map((n) => n.toFixed(2)).join(' × ')} m` : 'carico...', 'ed-meta');
      if (typeof matTarget === 'number' && matTarget >= d.materials.length) matTarget = 'all';
      const items: { name: string; color: string | null; t: 'all' | number }[] = [
        { name: 'Tutti i materiali', color: d.color, t: 'all' },
        ...d.materials.map((m, i) => ({ name: m.name, color: m.color, t: i as number | 'all' })),
      ];
      const targets = items.map((it) => {
        const b = el('button', '', `ed-item${it.t === matTarget ? ' on' : ''}`);
        b.innerHTML = '<i class="ed-sw"></i><span></span>';
        (b.querySelector('.ed-sw') as HTMLElement).style.background = it.color ?? 'repeating-conic-gradient(#d0d5dd 0 25%,#fff 0 50%) 50%/10px 10px';
        b.querySelector('span')!.textContent = it.name;
        b.onclick = () => {
          matTarget = it.t;
          renderDetails(d);
        };
        return b;
      });
      const cur = matTarget === 'all' ? null : d.materials[matTarget];
      const hex = cur ? cur.color : (d.color ?? d.materials[0]?.color ?? '#ffffff');
      const fin = cur ? { roughness: cur.roughness, metalness: cur.metalness } : d.finish;
      const t = matTarget;
      const colour = d.materials.length
        ? card(
            picker(hex, (c, commit) => h.onModelLook({ target: t, color: c }, commit), () => h.onModelLook(t === 'all' ? { target: 'all', color: null } : { target: t, color: null }, true)),
            finishRow('Rugosità', fin.roughness, (v, c) => h.onModelLook({ target: t, roughness: v }, c)),
            finishRow('Metallico', fin.metalness, (v, c) => h.onModelLook({ target: t, metalness: v }, c)),
            pill('Tutti i colori originali', () => h.onModelLook({ reset: true }, true)),
          )
        : card(el('div', 'carico...', 'ed-meta'));
      details.replaceChildren(
        el('div', 'Modello', 'ed-h'),
        card(
          nameField(d.name),
          ...(d.source ? [el('div', `Importato da ${d.source}`, 'ed-meta')] : []),
          ...(d.missing ? missingBlock(d.missing) : []),
          row(el('span', 'Scala'), numberField(d.scale, '0.01', '0.001', (v, c) => h.onModelScale(v, c))),
          row(el('span', 'Rotazione ° (Y)'), numberField(d.yawDeg, '1', null, (v, c) => h.onModelYaw(v, c))),
          row(el('span', 'Inclina ° (X)'), numberField(d.tiltDeg[0], '1', null, (v, c) => h.onModelTilt('x', v, c))),
          row(el('span', 'Inclina ° (Z)'), numberField(d.tiltDeg[1], '1', null, (v, c) => h.onModelTilt('z', v, c))),
          size,
        ),
        el('div', 'Colore e materiali', 'ed-h'),
        el('div', '', 'ed-list-mini'),
        ...targets,
        colour,
        card(del),
      );
      details.querySelector('.ed-list-mini')?.remove();
      return;
    }
    const rows: HTMLElement[] = [];
    if (d.type === 'wall') rows.push(row(el('span', 'Altezza (m)'), numberField(d.height, '0.1', '0.05', (v, c) => h.onStructure({ height: v }, c))));
    rows.push(row(el('span', 'Spessore (m)'), numberField(d.thickness, '0.01', '0.01', (v, c) => h.onStructure({ thickness: v }, c))));
    if (d.type === 'wall' && d.align) {
      const seg = row();
      for (const [v, label] of [['left', 'Sinistra'], ['center', 'Centro'], ['right', 'Destra']] as ['left' | 'center' | 'right', string][]) {
        seg.append(pill(label, () => h.onStructure({ align: v }, true), v === d.align ? 'acc' : ''));
      }
      rows.push(el('div', 'Il muro sta sulla linea disegnata, a:', 'ed-meta'), seg);
    }
    details.replaceChildren(
      el('div', d.count && d.count > 1 ? `${d.count} ${d.type === 'wall' ? 'pareti' : 'pavimenti'}` : d.type === 'wall' ? 'Parete' : 'Pavimento', 'ed-h'),
      ...(d.count && d.count > 1 ? [el('div', 'Le modifiche valgono per tutti quelli selezionati', 'ed-sub')] : []),
      card(...rows, el('div', d.measure, 'ed-meta')),
      el('div', 'Texture', 'ed-h'),
      card(textureGrid(d.texture, (id) => h.onStructure({ texture: id }, true))),
      el('div', d.texture ? 'Tinta' : 'Colore', 'ed-h'),
      card(
        picker(d.color ?? (d.texture ? '#ffffff' : d.type === 'wall' ? '#e9ecf2' : '#c7cdd9'), (c, commit) => h.onStructure({ color: c }, commit)),
        finishRow('Rugosità', d.finish.roughness, (v, c) => h.onStructure({ roughness: v }, c)),
        finishRow('Metallico', d.finish.metalness, (v, c) => h.onStructure({ metalness: v }, c)),
      ),
      card(del),
    );
  }

  render();

  const setState = (project: boolean, room: boolean) => {
    hasProject = project;
    hasRoom = room;
    syncChrome();
    if (view === 'project') renderProject();
  };

  const api = {
    footer,
    setStatus(text: string) {
      toast.textContent = text;
    },
    // The dialog shown when a file needs a decision: its unit and which axis is up. Resolves null when cancelled.
    // The CAD plan dialog: which layers are walls and floors, how the walls are drawn, size and unit. `preview` says what the
    // choices would build, live.
    askPlan(info: PlanInfo, start: PlanOptions, preview: (o: PlanOptions) => string) {
      return new Promise<PlanOptions | null>((resolve) => {
        const o: PlanOptions = { ...start, wallLayers: [...start.wallLayers], floorLayers: [...start.floorLayers] };
        const overlay = el('div', '', 'ed-modal');
        const panel = el('div', '', 'ed-panel');
        const summary = el('div', '', 'ed-meta');
        const sizeLine = el('div', '', 'ed-meta');
        const unitNote = el('div', '', 'ed-meta');
        const refresh = () => {
          summary.textContent = preview(o);
          const w = info.size[0] * PLAN_UNIT_M[o.unit];
          const d = info.size[1] * PLAN_UNIT_M[o.unit];
          sizeLine.textContent = `Con questa unità il disegno misura ${w.toFixed(1)} × ${d.toFixed(1)} m.`;
          const odd = !plausibleSize(Math.max(w, d));
          sizeLine.style.color = odd ? '#ef4444' : '';
          unitNote.textContent = odd ? 'Misure improbabili per una casa: prova un\'altra unità (di solito mm o cm).' : info.unitKnown ? "L'unità è scritta nel file." : "L'unità non è nel file (o non è credibile): l'ho stimata dalle dimensioni, controllala.";
        };
        const layerList = (picked: string[], label: string) => {
          const box = card(el('div', label, 'ed-title'));
          for (const l of info.layers) {
            const c = el('input');
            c.type = 'checkbox';
            c.checked = picked.includes(l.name);
            c.onchange = () => {
              const i = picked.indexOf(l.name);
              if (c.checked && i < 0) picked.push(l.name);
              if (!c.checked && i >= 0) picked.splice(i, 1);
              refresh();
            };
            const lab = el('label', '', 'ed-check');
            lab.append(c, document.createTextNode(`${l.name} · ${l.lines} linee${l.closed ? `, ${l.closed} chiuse` : ''}`));
            box.append(lab);
          }
          return box;
        };
        const choice = <T extends string>(items: [T, string][], get: () => T, set: (v: T) => void) => {
          const r = row();
          const btns = new Map<T, HTMLButtonElement>();
          const paint = () => btns.forEach((b, k) => b.classList.toggle('acc', k === get()));
          for (const [k, label] of items) {
            const b = pill(label, () => {
              set(k);
              paint();
              refresh();
            });
            btns.set(k, b);
            r.append(b);
          }
          paint();
          return r;
        };
        const num = (label: string, value: number, step: string, apply: (v: number) => void) => {
          const i = el('input');
          i.type = 'number';
          i.step = step;
          i.min = '0';
          i.value = String(value);
          i.oninput = () => {
            const v = Number(i.value);
            if (v > 0) apply(v);
            refresh();
          };
          return row(el('span', label), i);
        };
        const done = (v: PlanOptions | null) => {
          window.removeEventListener('keydown', key, true);
          overlay.remove();
          resolve(v);
        };
        const key = (e: KeyboardEvent) => {
          if (e.key === 'Escape') done(null);
          e.stopPropagation();
        };
        window.addEventListener('keydown', key, true);
        const boxFloor = el('input');
        boxFloor.type = 'checkbox';
        boxFloor.checked = o.boxFloor;
        boxFloor.onchange = () => {
          o.boxFloor = boxFloor.checked;
          refresh();
        };
        const boxLabel = el('label', '', 'ed-check');
        boxLabel.append(boxFloor, document.createTextNode('Senza livello pavimenti: un pavimento sotto tutto'));
        panel.append(
          el('h3', 'Importa la pianta (DXF)'),
          card(
            sizeLine,
            unitNote,
            choice<PlanUnit>([['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['in', 'pollici'], ['ft', 'piedi']], () => o.unit, (v) => (o.unit = v)),
          ),
          layerList(o.wallLayers, 'Livelli delle pareti'),
          card(
            el('div', 'Come sono disegnate le pareti', 'ed-title'),
            choice<'double' | 'axis'>([['double', 'Doppia linea'], ['axis', 'Una linea (asse)']], () => o.mode, (v) => (o.mode = v)),
            num('Spessore (m) se una linea sola', o.thickness, '0.01', (v) => (o.thickness = v)),
            num('Altezza (m)', o.height, '0.05', (v) => (o.height = v)),
          ),
          layerList(o.floorLayers, 'Livelli dei pavimenti (polilinee chiuse)'),
          card(boxLabel),
          summary,
          row(pill('Crea', () => done(o), 'acc'), pill('Annulla', () => done(null))),
        );
        overlay.append(panel);
        root.append(overlay);
        refresh();
      });
    },

    // Not signed in: a card in the middle of the screen (email and password, or Google / Microsoft). Reloads the page when it works.
    askLogin(h: {
      signIn(email: string, password: string, signUp: boolean): Promise<{ ok: true } | { ok: false; message: string }>;
      signInWith?(provider: 'google' | 'azure'): Promise<{ ok: true } | { ok: false; message: string }>;
      notice?: string; // why a sign-in that just ended did not work (the provider sent the page back with an error)
    }) {
      const overlay = el('div', '', 'ed-modal');
      const panel = el('div', '', 'ed-panel ed-login');
      const brand = el('div', '', 'ed-brand');
      brand.append(el('i'), document.createTextNode('Immersa'));
      const err = el('div', h.notice ?? '', 'ed-err');
      const email = el('input');
      email.type = 'email';
      email.placeholder = 'Email';
      email.autocomplete = 'username';
      const password = el('input');
      password.type = 'password';
      password.placeholder = 'Password';
      password.autocomplete = 'current-password';
      const busy = (on: boolean) => panel.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = on));
      const run = async (signUp: boolean) => {
        if (!email.value.trim() || !password.value) {
          err.textContent = 'Scrivi email e password.';
          return;
        }
        err.textContent = '';
        busy(true);
        const res = await h.signIn(email.value, password.value, signUp);
        if (res.ok) return location.reload();
        busy(false);
        err.textContent = res.message;
      };
      const sso = (label: string, icon: string, provider: 'google' | 'azure') => {
        const b = el('button', '', 'ed-pill ed-sso');
        b.innerHTML = `${icon}<span>${label}</span>`;
        b.onclick = async () => {
          err.textContent = '';
          busy(true);
          const res = await (h.signInWith?.(provider) ?? Promise.resolve({ ok: false as const, message: 'Accesso non disponibile.' }));
          if (!res.ok) {
            busy(false);
            err.textContent = res.message;
          }
        };
        return b;
      };
      const GOOGLE = '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.6H2.2v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.700 7.300 9.100 5.400 12 5.400z"/></svg>';
      const MICROSOFT = '<svg viewBox="0 0 24 24"><path fill="#F25022" d="M2 2h9.500v9.500H2z"/><path fill="#7FBA00" d="M12.500 2H22v9.500h-9.500z"/><path fill="#00A4EF" d="M2 12.500h9.500V22H2z"/><path fill="#FFB900" d="M12.500 12.500H22V22h-9.500z"/></svg>';
      const submit = (e: KeyboardEvent) => {
        if (e.key === 'Enter') void run(false);
      };
      email.onkeydown = password.onkeydown = submit;
      panel.append(
        brand,
        el('h3', 'Accedi'),
        el('div', "Usa lo stesso account del visore.", 'ed-sub'),
        card(email, password),
        err,
        pill('Accedi', () => void run(false), 'acc'),
        pill('Crea un account', () => void run(true)),
        el('div', 'oppure', 'ed-or'),
        ...SSO_ENABLED.map((id) => (id === 'google' ? sso('Continua con Google', GOOGLE, 'google') : sso('Continua con Microsoft', MICROSOFT, 'azure'))),
      );
      overlay.append(panel);
      root.append(overlay);
      email.focus();
    },

    // Before saving: the models too heavy for the headset. For each one: simplify it (the default) or keep it as it is. How much
    // is decided by the editor. With `intro` (the library's single model) there is nothing to choose: OK or cancel.
    // Resolves with true = simplify, per model id, or null if the user cancels.
    askSimplify(items: { id: string; name: string; triangles: number }[], limit: number, intro?: { title: string; text: string; ok: string }) {
      return new Promise<Map<string, boolean> | null>((resolve) => {
        const chosen = new Map<string, boolean>(items.map((i) => [i.id, true]));
        const overlay = el('div', '', 'ed-modal');
        const panel = el('div', '', 'ed-panel');
        const cards = intro
          ? []
          : items.map((it) => {
              const yes = pill('Semplifica', () => {
                chosen.set(it.id, true);
                refresh();
              });
              const no = pill('Mantieni originale', () => {
                chosen.set(it.id, false);
                refresh();
              });
              const refresh = () => {
                yes.classList.toggle('acc', chosen.get(it.id) === true);
                no.classList.toggle('acc', chosen.get(it.id) === false);
              };
              refresh();
              const heavy = it.triangles > limit * 3;
              return card(el('div', it.name), el('div', heavy ? 'Molto pesante: nel visore andrebbe a scatti' : 'Pesante: nel visore potrebbe rallentare', heavy ? 'ed-warn' : 'ed-meta'), row(yes, no));
            });
        const done = (v: Map<string, boolean> | null) => {
          window.removeEventListener('keydown', key, true);
          overlay.remove();
          resolve(v);
        };
        const key = (e: KeyboardEvent) => {
          if (e.key === 'Escape') done(null);
          e.stopPropagation();
        };
        window.addEventListener('keydown', key, true);
        panel.append(
          el('h3', intro?.title ?? 'Modelli troppo pesanti per il visore'),
          el('div', intro?.text ?? 'Questi modelli sono particolarmente pesanti e potrebbero rallentare le prestazioni del visore: semplificali per alleggerirli senza perderne la qualità.', 'ed-meta'),
          ...cards,
          row(pill(intro?.ok ?? 'Salva', () => done(chosen), 'acc'), pill('Annulla', () => done(null))),
        );
        overlay.append(panel);
        root.append(overlay);
      });
    },
    askImport(info: { name: string; format: string; triangles: number; fixedUnit: boolean; unit: Unit; zUp: boolean; dims(unit: Unit, zUp: boolean): string }) {
      return new Promise<{ unit: Unit; zUp: boolean } | null>((resolve) => {
        let unit = info.unit;
        let zUp = info.zUp;
        const overlay = el('div', '', 'ed-modal');
        const panel = el('div', '', 'ed-panel');
        const dims = el('div', '', 'ed-meta');
        const units = row();
        const unitBtns = new Map<Unit, HTMLButtonElement>();
        const refresh = () => {
          dims.textContent = `Dimensioni: ${info.dims(unit, zUp)}`;
          for (const [u, b] of unitBtns) b.classList.toggle('acc', u === unit);
        };
        for (const [u, label] of [['mm', 'Millimetri'], ['cm', 'Centimetri'], ['m', 'Metri'], ['in', 'Pollici']] as [Unit, string][]) {
          const b = pill(label, () => {
            unit = u;
            refresh();
          });
          unitBtns.set(u, b);
          units.append(b);
        }
        const z = el('input');
        z.type = 'checkbox';
        z.checked = zUp;
        z.onchange = () => {
          zUp = z.checked;
          refresh();
        };
        const zLabel = el('label', '', 'ed-check');
        zLabel.append(z, document.createTextNode("La Z è l'alto (tipico dei CAD e dell'STL)"));
        const done = (v: { unit: Unit; zUp: boolean } | null) => {
          window.removeEventListener('keydown', key, true);
          overlay.remove();
          resolve(v);
        };
        const key = (e: KeyboardEvent) => {
          if (e.key === 'Escape') done(null);
          else if (e.key === 'Enter') done({ unit, zUp });
          e.stopPropagation();
        };
        window.addEventListener('keydown', key, true);
        const heavy = info.triangles > 300000;
        panel.append(
          el('h3', 'Importa il modello'),
          card(
            el('div', info.name),
            el('div', `${info.format} · ${info.triangles.toLocaleString('it-IT')} triangoli`, 'ed-meta'),
            ...(heavy ? [el('div', 'Molti triangoli: nel visore potrebbe essere pesante.', 'ed-warn')] : []),
            ...(info.fixedUnit ? [el('div', "L'unità di misura è nel file: le dimensioni sono già in metri.", 'ed-meta')] : [units]),
            zLabel,
            dims,
          ),
          row(pill('Importa', () => done({ unit, zUp }), 'acc'), pill('Annulla', () => done(null))),
        );
        overlay.append(panel);
        root.append(overlay);
        refresh();
        if (info.fixedUnit) for (const b of unitBtns.values()) b.classList.remove('acc');
      });
    },
    // Shows / updates the loading card (null hides it). It appears only if the wait lasts a moment, so quick things do not flash.
    setLoading(info: { title: string; sub?: string; value?: number } | null) {
      if (!info) {
        window.clearTimeout(loadingTimer);
        loadingTimer = 0;
        loadingOn = false;
        loading.style.display = 'none';
        return;
      }
      lTitle.textContent = info.title;
      lSub.textContent = info.sub ?? '';
      lBar.style.display = info.value === undefined ? 'none' : 'block';
      lFill.style.width = `${Math.round(Math.min(1, Math.max(0, info.value ?? 0)) * 100)}%`;
      if (loadingOn || loadingTimer) return;
      loadingTimer = window.setTimeout(() => {
        loadingTimer = 0;
        loadingOn = true;
        loading.style.display = 'flex';
        spin();
      }, 250);
    },
    setView,
    getView: () => view,
    setProjects(items: Option[], selected: string | null) {
      projectItems = items;
      openId = selected;
      if (view === 'projects') renderProjects();
    },
    // The model library: null while loading; `note` = a message at the top (e.g. an error).
    setLibrary(items: LibraryItem[] | null, note = '') {
      libraryItems = items;
      libraryNote = note;
      if (view === 'models') renderModels();
    },
    // The answer to a headset code typed in the "Collega un visore" page.
    setLinkResult(text: string, ok: boolean) {
      showLinkNote(text, ok);
    },
    setRooms(items: Option[]) {
      roomItems = items;
      if (view === 'rooms') renderRooms();
    },
    // The project being edited: its name, rooms, the open room, and the account rooms it could still use.
    setProject(name: string, rooms: Option[], currentId: string | null, addable: Option[]) {
      projectName = name;
      projectRoomItems = rooms;
      currentRoomId = currentId;
      addableItems = addable;
      if (view === 'project') renderProject();
    },
    setState,
    setDirty(dirty: boolean) {
      save.classList.toggle('dirty', dirty);
      save.textContent = dirty ? 'Salva *' : 'Salva';
    },
    setMeasureLabels(labels: MeasureLabel[]) {
      while (labelPool.length < labels.length) {
        const d = el('div', '', 'ed-mlabel');
        measureLayer.append(d);
        labelPool.push(d);
      }
      labelPool.forEach((d, i) => {
        const l = labels[i];
        d.style.display = l ? 'block' : 'none';
        if (!l) return;
        if (d.textContent !== l.text) d.textContent = l.text;
        d.className = `ed-mlabel ${l.kind}`;
        d.style.transform = `translate(-50%,-50%) translate(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px)`;
      });
    },
    setToolbar(s: ToolbarState) {
      state = s;
      const on = (b: HTMLElement, v: boolean) => b.classList.toggle('on', v);
      on(bFloor, s.build === 'floor');
      on(bWall, s.build === 'wall');
      on(bMove, s.gizmo === 'translate');
      on(bRotate, s.gizmo === 'rotate');
      on(bScale, s.gizmo === 'scale');
      on(bOrtho, s.ortho);
      bOrtho.innerHTML = s.ortho ? ICON.ortho : ICON.persp;
      on(bGrid, s.grid);
      on(bVertex, s.vertex);
      on(bLocal, s.local);
      bLocal.innerHTML = s.local ? ICON.local : ICON.world;
      on(bMeasure, s.measures !== 'off');
      bMeasure.title = `Misure: ${s.measures === 'off' ? 'spente' : s.measures === 'sel' ? 'oggetto selezionato' : 'dimensioni di tutto'} (clic per cambiare)`;
      bUndo.disabled = !s.canUndo;
      bRedo.disabled = !s.canRedo;
      hint.style.display = s.build ? 'block' : 'none';
      hint.textContent =
        (s.build === 'wall' ? 'Parete: trascina sul pavimento' : 'Pavimento: trascina sul pavimento') +
        ' · tieni premuto Maiusc per crearne altri: rilasciandolo si esce · Esc per uscire';
    },
    setOutline(items: OutlineItem[], selected: Set<string>) {
      outlineList.replaceChildren(
        ...(items.length
          ? items.map((it) => {
              const b = el('button', '', `ed-item${selected.has(it.key) ? ' on' : ''}`);
              b.innerHTML = `${it.kind === 'model' ? ICON.cube : ICON[it.kind]}<span></span>`;
              b.querySelector('span')!.textContent = it.name;
              b.onclick = (e) => h.onPick(it.key, e.shiftKey || e.ctrlKey || e.metaKey);
              return b;
            })
          : [el('div', 'Vuota: aggiungi un modello o costruisci.', 'ed-meta')]),
      );
    },
    setDetails(d: Details | null) {
      pending = d;
      if (interacting) return; // a drag on the wheel / slider is going on: do not rebuild it under the pointer
      const sig = JSON.stringify(d);
      if (sig === lastSig) return;
      // While typing in a field, a refresh of the same kind of object must not rewrite it under the cursor.
      const typing = document.activeElement instanceof HTMLInputElement && ['number', 'text'].includes(document.activeElement.type);
      if (d && lastSig && typing && details.contains(document.activeElement) && JSON.parse(lastSig)?.kind === d.kind) return;
      lastSig = sig;
      renderDetails(d);
    },
    openId: () => openId,
  };
  return api;
}
