// Injected by vite.config.ts: git commit and build time.
declare const __BUILD_ID__: string;

// occt-import-js (CAD import through OpenCascade compiled to WebAssembly) ships no types.
declare module 'occt-import-js' {
  const init: (options?: { locateFile?: (name: string) => string }) => Promise<{
    ReadStepFile(content: Uint8Array, params: unknown): OcctResult;
    ReadIgesFile(content: Uint8Array, params: unknown): OcctResult;
    ReadBrepFile(content: Uint8Array, params: unknown): OcctResult;
  }>;
  export interface OcctMesh {
    name?: string;
    color?: [number, number, number];
    attributes: { position: { array: number[] }; normal?: { array: number[] } };
    index: { array: number[] };
  }
  export interface OcctNode {
    name: string;
    meshes: number[];
    children: OcctNode[];
  }
  export interface OcctResult {
    success: boolean;
    root: OcctNode;
    meshes: OcctMesh[];
  }
  export default init;
}
