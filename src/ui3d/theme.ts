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
  bgStops: [[0, '#101a30'], [0.55, '#1b2f52'], [1, '#27466f']],
  blobs: [[0.9, 0.02, 250, 'rgba(70,130,255,0.30)'], [0.04, 0.7, 280, 'rgba(30,190,200,0.18)'], [0.65, 1.02, 260, 'rgba(90,120,220,0.26)']],
  border: 'rgba(255,255,255,0.16)',
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
  headerSub: 'rgba(255,255,255,0.68)',
  surface: 'rgba(255,255,255,0.97)',
  surfaceHover: '#eef3ff',
  surfaceDown: '#dde7fb',
  shadow: 'rgba(3,9,28,0.50)',
  accent: ['#2f6bff', '#14b8d4'],
  accentHover: ['#4a80ff', '#34c8e0'],
  accentGlow: 'rgba(47,107,255,0.45)',
  accentSoft: '#e6eeff',
  accentText: '#2457d6',
  glass: 'rgba(255,255,255,0.13)',
  glassHover: 'rgba(255,255,255,0.25)',
  textDisabled: '#a8b1c6',
  tones: [['#2f6bff', '#14b8d4'], ['#0e9f8e', '#6ee0b8'], ['#5a6bff', '#8f9bff'], ['#d9822b', '#f2c86b']],
};

export const theme = (): Theme => AURA;
