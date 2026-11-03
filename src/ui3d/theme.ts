// Look of every 3D panel: colours, radii, how buttons are filled. Panels read the current theme when they draw.
export interface Theme {
  name: string;
  bg: [string, string]; // panel background, top → bottom
  border: string; // panel outline
  panelRadius: number;
  radius: number; // buttons, rows
  keyRadius: number;
  outline: string | null; // thin outline around buttons (null: none)
  button: string;
  buttonHover: string;
  disabled: string;
  field: string;
  accent: [string, string]; // active / primary fill, left → right
  accentHover: [string, string];
  accentDown: string;
  onAccent: string; // text on the accent
  text: string;
  textDisabled: string;
  sub: string; // second line in rows
  muted: string; // subtitles
  dim: string; // small notes
  text2: string; // body text
  faint: string;
  notice: string;
  bad: string;
  good: string;
}

export const THEMES: Record<string, Theme> = {
  // Deep indigo glass, violet to cyan accent.
  aurora: {
    name: 'Aurora',
    bg: ['rgba(22,18,48,0.95)', 'rgba(9,11,26,0.95)'],
    border: 'rgba(150,130,255,0.40)',
    panelRadius: 34,
    radius: 22,
    keyRadius: 16,
    outline: 'rgba(170,155,255,0.18)',
    button: '#2a2650',
    buttonHover: '#383268',
    disabled: '#17162e',
    field: '#0c0b1c',
    accent: ['#7c5cff', '#22d3ee'],
    accentHover: ['#9277ff', '#4be0f6'],
    accentDown: '#a58bff',
    onAccent: '#ffffff',
    text: '#f5f4ff',
    textDisabled: '#6c6a93',
    sub: '#b3b0e0',
    muted: '#a9a6dc',
    dim: '#8f8cc0',
    text2: '#dedcf8',
    faint: '#6f6d9c',
    notice: '#ffd36b',
    bad: '#ff8fa3',
    good: '#7ff0c0',
  },
  // Almost black, one mint accent, flat and thin.
  mint: {
    name: 'Mint',
    bg: ['rgba(15,18,18,0.96)', 'rgba(15,18,18,0.96)'],
    border: 'rgba(255,255,255,0.12)',
    panelRadius: 22,
    radius: 14,
    keyRadius: 11,
    outline: 'rgba(255,255,255,0.10)',
    button: '#1a2120',
    buttonHover: '#26302f',
    disabled: '#131817',
    field: '#0b0e0e',
    accent: ['#2ee6a6', '#2ee6a6'],
    accentHover: ['#5cf0bd', '#5cf0bd'],
    accentDown: '#8af7d2',
    onAccent: '#04251a',
    text: '#eef5f3',
    textDisabled: '#59665f',
    sub: '#98a8a2',
    muted: '#8fa39b',
    dim: '#6f827a',
    text2: '#cfdcd7',
    faint: '#566761',
    notice: '#ffd36b',
    bad: '#ff8a80',
    good: '#2ee6a6',
  },
  // Warm aubergine, coral to amber accent, pill shapes.
  sunset: {
    name: 'Sunset',
    bg: ['rgba(40,18,36,0.95)', 'rgba(21,10,24,0.95)'],
    border: 'rgba(255,140,110,0.38)',
    panelRadius: 40,
    radius: 40,
    keyRadius: 22,
    outline: null,
    button: '#3f2138',
    buttonHover: '#522b49',
    disabled: '#24122a',
    field: '#160a1b',
    accent: ['#ff5f7e', '#ffb04a'],
    accentHover: ['#ff7b95', '#ffc26e'],
    accentDown: '#ffd09a',
    onAccent: '#ffffff',
    text: '#fff3ee',
    textDisabled: '#7d5d73',
    sub: '#e2b8c4',
    muted: '#d9a9b8',
    dim: '#b58a9d',
    text2: '#f5dce2',
    faint: '#8a6477',
    notice: '#ffe08a',
    bad: '#ff8aa0',
    good: '#8ff0c2',
  },
  // Light frosted glass: reads well over a bright room.
  ice: {
    name: 'Ice',
    bg: ['rgba(248,250,255,0.96)', 'rgba(226,234,250,0.96)'],
    border: 'rgba(70,100,210,0.30)',
    panelRadius: 34,
    radius: 22,
    keyRadius: 16,
    outline: 'rgba(40,70,160,0.16)',
    button: '#ffffff',
    buttonHover: '#eaf1ff',
    disabled: '#dde5f5',
    field: '#eef2fb',
    accent: ['#3b82f6', '#06b6d4'],
    accentHover: ['#5a97f8', '#2cc8df'],
    accentDown: '#1d4ed8',
    onAccent: '#ffffff',
    text: '#13203d',
    textDisabled: '#9aa6c2',
    sub: '#5b6a8f',
    muted: '#56668c',
    dim: '#6d7ba0',
    text2: '#24345a',
    faint: '#8794b3',
    notice: '#b45309',
    bad: '#d6335a',
    good: '#0f9d6e',
  },
};

let current: Theme = THEMES.aurora;
export const theme = (): Theme => current;
export function setTheme(name: string) {
  current = THEMES[name] ?? current;
}
