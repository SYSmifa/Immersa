// Look of every 3D panel ("Aura"): a soft gradient panel with white cards, pill buttons and gradient accents.
// Panels read these tokens when they draw, so colours and shapes live in one place.
export interface Theme {
  bgStops: [number, string][]; // panel background, top → bottom
  blobs: [number, number, number, string][]; // soft light spots: x and y as fractions of the panel, radius px, colour
  border: string;
  panelRadius: number;
  text: string; // ink on white surfaces
  sub: string; // second lines
  muted: string;
  dim: string;
  text2: string;
  faint: string;
  notice: string;
  bad: string;
  good: string;
  headerText: string; // on the gradient
  headerSub: string;
  surface: string; // white cards
  surfaceHover: string;
  surfaceDown: string;
  shadow: string;
  accent: [string, string]; // gradient, left → right
  accentHover: [string, string];
  accentGlow: string; // shadow under accent buttons
  accentSoft: string; // pale tint of the accent
  accentText: string;
  glass: string; // translucent white on the gradient
  glassHover: string;
  textDisabled: string;
  tones: [string, string][]; // gradients for project tiles
}

export const AURA: Theme = {
  bgStops: [[0, '#0b0d12'], [0.55, '#141821'], [1, '#1d222d']],
  blobs: [[0.9, 0.02, 250, 'rgba(120,230,200,0.12)'], [0.04, 0.75, 280, 'rgba(255,255,255,0.05)'], [0.65, 1.02, 260, 'rgba(120,180,255,0.08)']],
  border: 'rgba(255,255,255,0.14)',
  panelRadius: 44,
  text: '#0f1a33',
  sub: '#5b6784',
  muted: '#5b6784',
  dim: '#8591ab',
  text2: '#1d2a49',
  faint: '#97a2ba',
  notice: '#b45309',
  bad: '#d6335a',
  good: '#0f9d6e',
  headerText: '#ffffff',
  headerSub: 'rgba(255,255,255,0.60)',
  surface: 'rgba(255,255,255,0.97)',
  surfaceHover: '#cdf3ed',
  surfaceDown: '#a8e6dc',
  shadow: 'rgba(0,0,0,0.60)',
  accent: ['#14b8a6', '#2dd4bf'],
  accentHover: ['#27cdb9', '#5eead4'],
  accentGlow: 'rgba(20,184,166,0.40)',
  accentSoft: '#e1f7f4',
  accentText: '#0b7f73',
  glass: 'rgba(255,255,255,0.09)',
  glassHover: 'rgba(255,255,255,0.18)',
  textDisabled: '#a8b1c6',
  tones: [['#14b8a6', '#5eead4'], ['#e0a53a', '#f3d37a'], ['#6366f1', '#a5b4fc'], ['#f43f5e', '#fda4af'], ['#0ea5e9', '#7dd3fc'], ['#22c55e', '#86efac'], ['#a855f7', '#d8b4fe'], ['#f97316', '#fdba74']],
};

export const theme = (): Theme => AURA;

// A project's tile colour: looks random but is stable (from the project's id), so it is the same in the headset and on the PC.
export const projectTone = (id: string): number => [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % AURA.tones.length;
