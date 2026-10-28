"""Edits the three Immersa phase recordings into one demo video (silent, 1080p30).

Inputs, in <srcdir>: f1.mp4 (phase 1, headset), f2.mp4 (phase 2, desktop, 2560x1440),
f34.mp4 (phases 3-4, headset). Edit PHASES below to change cut points, speeds and titles:
each segment is (start_s, end_s, speed) in source seconds. Segments that continue the
previous one in the source are joined with a hard cut, the others with a dissolve.

Usage (needs ffmpeg with vidstab/drawtext, Inter font, logo.png next to this file):
  python3 make_demo_video.py <srcdir> <workdir> phase 0   # also 1 and 2
  python3 make_demo_video.py <srcdir> <workdir> final <out.mp4>

Stabilization exists (stab=True per phase) but is off: it looked worse than the originals.
"""
import subprocess, sys, os
V, W, MODE, ARG = sys.argv[1:5]
FONT = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
FADE = 0.6
XF = 0.5  # dissolve between cuts inside a phase
FIT = ('scale=1920:-2:flags=lanczos,fps=30,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0d1017,'
       'format=yuv420p,setsar=1')
ENC = ['-c:v', 'libx264', '-crf', '17', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-threads', '3']

# (start, end, speed) in source seconds
PHASES = [
  ('f1.mp4', None, False, 'FASE 1', 'Scansione della stanza con il Meta Quest 3',
   [(5.2, 7.7, 1), (9.3, 20.2, 1.25), (20.2, 26, 1), (29, 35, 1), (39, 46, 1), (59.8, 78.5, 1)]),
  ('f2.mp4', 'crop=2560:1340:0:40,', False, 'FASE 2', "Progettazione del layout sull’app desktop",
   [(0, 16, 1.5), (16, 22, 1), (22, 30, 1.5), (34, 88.5, 1.5)]),
  ('f34.mp4', None, False, 'FASE 3 e 4', 'Nel visore: caricamento e manipolazione oggetti',
   [(0.3, 41.5, 1)]),
]

def run(*a): subprocess.run(['ffmpeg', '-v', 'error', '-y', *a], check=True)
def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]))

def phase(idx):
    src, crop, stab, tag, title, segs = PHASES[idx]
    files = []
    for i, (a, b, sp) in enumerate(segs):
        raw, trf, out = f'{W}/p{idx}_s{i}_raw.mp4', f'{W}/p{idx}_s{i}.trf', f'{W}/p{idx}_s{i}.mp4'
        run('-ss', str(a), '-t', str(b - a), '-i', f'{V}/{src}', '-an', '-vf', (crop or '') + FIT,
            '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', raw)
        vf = f'setpts=PTS/{sp},fps=30'
        if stab:
            run('-i', raw, '-vf', f'vidstabdetect=shakiness=7:accuracy=15:result={trf}', '-f', 'null', '-')
            vf = (f'vidstabtransform=input={trf}:smoothing=40:optzoom=1:zoomspeed=0.3:interpol=bicubic,'
                  f'unsharp=5:5:0.4,') + vf
        run('-i', raw, '-vf', vf + ',format=yuv420p', *ENC, out)
        os.remove(raw); files.append(out)
    # Segments that continue the previous one in the source are joined with a hard cut;
    # dissolves are used only where footage was actually removed.
    groups = []
    for i, (a, b, sp) in enumerate(segs):
        if groups and segs[i - 1][1] == a: groups[-1].append(files[i])
        else: groups.append([files[i]])
    joined = []
    for g, members in enumerate(groups):
        if len(members) == 1: joined.append(members[0]); continue
        lst, out = f'{W}/p{idx}_g{g}.txt', f'{W}/p{idx}_g{g}.mp4'
        open(lst, 'w').write(''.join(f"file '{m}'\n" for m in members))
        run('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', out)
        joined.append(out)
    files, members_all = joined, files
    ds = [dur(f) for f in files]
    chain, prev, off = [], '[0:v]', 0.0
    for i in range(1, len(files)):
        off += ds[i - 1] - XF
        chain.append(f'{prev}[{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}[x{i}]'); prev = f'[x{i}]'
    chain.append(f'{prev}null[v]')
    run(*sum([['-i', f] for f in files], []), '-filter_complex', ';'.join(chain), '-map', '[v]', *ENC, f'{W}/phase{idx}.mp4')
    for f in set(files + members_all): os.remove(f)
    print('phase', idx, round(dur(f'{W}/phase{idx}.mp4'), 1), 's')

BLUR = ('scale=480:-2,gblur=sigma=7,scale=1920:1080:flags=bicubic,setsar=1')

def blur_wrap(inp, out, d, ramp=0.8, head=True, tail=True):
    """Blur->sharp at the start, sharp->blur at the end, with fades from/to black."""
    p = []
    if head: p.append(f'max(0,1-T/{ramp})')
    if tail: p.append(f'max(0,(T-({d}-{ramp}))/{ramp})')
    expr = '+'.join(p) or '0'
    fc = (f"[0:v]split[a][b];[b]{BLUR}[bl];"
          f"[a][bl]blend=all_expr='A*(1-({expr}))+B*({expr})',"
          f"fade=t=in:st=0:d=0.5,fade=t=out:st={d - 0.5:.3f}:d=0.5,format=yuv420p[v]")
    run('-i', inp, '-filter_complex', fc, '-map', '[v]', *ENC, out)

def card(idx, tag, title, out):
    D = 4.5
    al = f"alpha='if(lt(t,0.5),t/0.5,if(lt(t,{D - 0.5}),1,({D}-t)/0.5))'"
    t = title.replace(':', chr(92) + ':')
    vf = (f"drawtext=fontfile={FONT}:text='{tag}':fontsize=40:fontcolor=0xa78bfa:x=(w-text_w)/2:y=(h/2)-90:{al},"
          f"drawtext=fontfile={FONT}:text='{t}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h/2)-10:{al},"
          f"drawbox=x=(iw-160)/2:y=(ih/2)+90:w=160:h=4:color=0xa78bfa@1:t=fill")
    run('-f', 'lavfi', '-i', f'color=c=black:s=1920x1080:r=30:d={D}', '-vf', vf + ',format=yuv420p', *ENC, out)

def outro(out):
    D = 4.0
    run('-f', 'lavfi', '-i', f'color=c=black:s=1920x1080:r=30:d={D}', '-i', f'{os.path.dirname(os.path.abspath(__file__))}/logo.png',
        '-filter_complex', "[1:v]scale=1000:-1[l];[0:v][l]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]",
        '-map', '[v]', *ENC, f'{W}/outro_raw.mp4')
    blur_wrap(f'{W}/outro_raw.mp4', out, D, ramp=1.0, head=True, tail=False)

def final(out):
    parts = []
    for i, (_, _, _, tag, title, _) in enumerate(PHASES):
        c = f'{W}/card{i}.mp4'; card(i, tag, title, c); parts.append(c)
        d = dur(f'{W}/phase{i}.mp4'); w = f'{W}/wrap{i}.mp4'
        blur_wrap(f'{W}/phase{i}.mp4', w, d); parts.append(w)
    outro(f'{W}/outro.mp4'); parts.append(f'{W}/outro.mp4')
    lst = f'{W}/final.txt'
    open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
    run('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', out)
    print('total', round(dur(out), 1), 's', os.path.getsize(out) // 1024 // 1024, 'MB')

phase(int(ARG)) if MODE == 'phase' else final(ARG)
