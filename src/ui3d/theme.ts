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
  accentSoft: string; // pale tint of the accent
  accentText: string;
  glass: string; // translucent white on the gradient
  glassHover: string;
  textDisabled: string;
  tones: [string, string][]; // gradients for project tiles
}

export const AURA: Theme = {
  bgStops: [[0, '#6c63ee'], [0.55, '#a77af0'], [1, '#ff9ccd']],
  blobs: [[0.88, 0.04, 230, 'rgba(255,255,255,0.22)'], [0.05, 0.62, 270, 'rgba(255,110,200,0.28)'], [0.62, 1, 260, 'rgba(255,190,130,0.30)']],
  border: 'rgba(255,255,255,0.45)',
  panelRadius: 44,
  text: '#1c1744',
  sub: '#6b6790',
  muted: '#6b6790',
  dim: '#8a86ad',
  text2: '#2c2656',
  faint: '#9a96bb',
  notice: '#b45309',
  bad: '#e5365a',
  good: '#0f9d6e',
  headerText: '#ffffff',
  headerSub: 'rgba(255,255,255,0.82)',
  surface: 'rgba(255,255,255,0.97)',
  surfaceHover: '#f4eeff',
  surfaceDown: '#e8defc',
  shadow: 'rgba(52,26,130,0.30)',
  accent: ['#7c5cff', '#c05cf5'],
  accentHover: ['#8f75ff', '#d075f7'],
  accentSoft: '#efe9ff',
  accentText: '#6a4cf0',
  glass: 'rgba(255,255,255,0.22)',
  glassHover: 'rgba(255,255,255,0.36)',
  textDisabled: '#a9a5c4',
  tones: [['#7c5cff', '#ff8ad8'], ['#17b8c2', '#7cf0b8'], ['#ff7a59', '#ffcf5c'], ['#4f8cff', '#a78bff']],
};

export const theme = (): Theme => AURA;
