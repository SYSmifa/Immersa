// A small PDF writer: one page, vector lines / polygons / text (Helvetica) and one JPEG image. No dependencies.
// Coordinates are in millimetres from the TOP-LEFT corner of the page (like a drawing), converted to PDF points inside.

const MM = 72 / 25.4;

// Helvetica widths (1/1000 em) for the printable ASCII range 32..126, to align text without a font engine.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? HELV[c - 32] : 556;
  }
  return (w / 1000) * size * (bold ? 1.05 : 1) * (25.4 / 72); // mm, for a size in points
}

const num = (n: number) => (Math.round(n * 1000) / 1000).toString();
const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ');
};
// WinAnsi (Latin-1 range) bytes of a string; anything else becomes '?'
const winAnsi = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => (c === '’' ? "'" : c === '–' || c === '—' ? '-' : '?'));

export interface TextOpts {
  size?: number; // points
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  angle?: number; // degrees, counter-clockwise on the page
  halo?: string; // colour of an outline round the letters, to read over a picture
}

export class PdfPage {
  private ops: string[] = [];
  private image: { data: Uint8Array; w: number; h: number } | null = null;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  private y = (v: number) => this.height - v;

  // The JPEG fills the box (x, y, w, h) in mm. Only one picture per page.
  picture(jpeg: Uint8Array, pxW: number, pxH: number, x: number, y: number, w: number, h: number) {
    this.image = { data: jpeg, w: pxW, h: pxH };
    this.ops.push(`q ${num(w * MM)} 0 0 ${num(h * MM)} ${num(x * MM)} ${num(this.y(y + h) * MM)} cm /Im1 Do Q`);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.25, color = '#000000', dash?: number[]) {
    this.ops.push(`q ${rgb(color)} RG ${num(width * MM)} w ${dash ? `[${dash.map((d) => num(d * MM)).join(' ')}] 0 d ` : ''}${num(x1 * MM)} ${num(this.y(y1) * MM)} m ${num(x2 * MM)} ${num(this.y(y2) * MM)} l S Q`);
  }

  polygon(pts: [number, number][], o: { stroke?: string; fill?: string; width?: number; close?: boolean } = {}) {
    if (pts.length < 2) return;
    const path = pts.map((p, i) => `${num(p[0] * MM)} ${num(this.y(p[1]) * MM)} ${i ? 'l' : 'm'}`).join(' ');
    const close = o.close !== false ? ' h' : '';
    const paint = o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
    this.ops.push(`q ${o.fill ? `${rgb(o.fill)} rg ` : ''}${o.stroke || !o.fill ? `${rgb(o.stroke ?? '#000000')} RG ` : ''}${num((o.width ?? 0.25) * MM)} w ${path}${close} ${paint} Q`);
  }

  rect(x: number, y: number, w: number, h: number, o: { stroke?: string; fill?: string; width?: number } = {}) {
    this.polygon(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      o,
    );
  }

  // (x, y) is the baseline start (left), middle or end (right), according to `align`.
  text(s: string, x: number, y: number, o: TextOpts = {}) {
    const size = o.size ?? 9;
    const w = textWidth(s, size, o.bold);
    const dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
    const a = ((o.angle ?? 0) * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    // position the start so that the text is aligned about (x, y) along its own direction
    const px = x + dx * c;
    const py = y - dx * sn; // the page y grows downwards
    const font = o.bold ? '/F2' : '/F1';
    const body = `BT ${font} ${num(size)} Tf ${num(c)} ${num(sn)} ${num(-sn)} ${num(c)} ${num(px * MM)} ${num(this.y(py) * MM)} Tm (${winAnsi(s)}) Tj ET`;
    // with a halo: first the letters stroked thick in the halo colour, then the letters on top
    if (o.halo) this.ops.push(`q 1 Tr ${rgb(o.halo)} RG ${num(size * 0.3)} w 1 j ${body} Q`);
    this.ops.push(`q ${rgb(o.color ?? '#000000')} rg ${body} Q`);
  }

  build(): Uint8Array {
    // the page text is WinAnsi (one byte per character), not UTF-8
    const enc = { encode: (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0) & 0xff) };
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let size = 0;
    const put = (b: Uint8Array) => {
      chunks.push(b);
      size += b.length;
    };
    const str = (s: string) => put(enc.encode(s));
    const obj = (n: number, body: () => void) => {
      offsets[n] = size;
      str(`${n} 0 obj\n`);
      body();
      str('\nendobj\n');
    };
    const content = enc.encode(this.ops.join('\n'));
    str('%PDF-1.4\n%âãÏÓ\n');
    obj(1, () => str('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => str('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    obj(3, () =>
      str(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.width * MM)} ${num(this.height * MM)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${this.image ? ' /XObject << /Im1 7 0 R >>' : ''} >> >>`,
      ),
    );
    obj(4, () => {
      str(`<< /Length ${content.length} >>\nstream\n`);
      put(content);
      str('\nendstream');
    });
    obj(5, () => str('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    obj(6, () => str('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
    if (this.image) {
      const im = this.image;
      obj(7, () => {
        str(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`);
        put(im.data);
        str('\nendstream');
      });
    }
    const count = this.image ? 8 : 7;
    const xref = size;
    str(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let n = 1; n < count; n++) str(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
    str(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}
