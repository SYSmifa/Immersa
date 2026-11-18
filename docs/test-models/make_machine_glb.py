# Writes docs/test-models/macchina_animata.glb: a small machine made of rigid parts (base, column, arm with a gripper, a piston) and
# four animations on the parts' own transforms, the way a CAD motion study exports them. Run: python3 make_machine_glb.py <out.glb>
import json, struct, math, sys

out = sys.argv[1]
bin_ = b''
views, acc = [], []


def add(data, target=None):
    global bin_
    while len(bin_) % 4:
        bin_ += b'\0'
    views.append({'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data), **({'target': target} if target else {})})
    bin_ += data
    return len(views) - 1


def f(a):
    return struct.pack('<%df' % len(a), *a)


def box(w, h, d, ox=0, oy=0, oz=0):
    hx, hy, hz = w / 2, h / 2, d / 2
    faces = [((1, 0, 0), [(hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)]), ((-1, 0, 0), [(-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz), (-hx, -hy, -hz)]),
             ((0, 1, 0), [(-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz)]), ((0, -1, 0), [(-hx, -hy, hz), (-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz)]),
             ((0, 0, 1), [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]), ((0, 0, -1), [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)])]
    pos, nor, idx = [], [], []
    for n, vs in faces:
        b = len(pos) // 3
        for v in vs:
            pos += [v[0] + ox, v[1] + oy, v[2] + oz]
            nor += n
        idx += [b, b + 1, b + 2, b, b + 2, b + 3]
    return pos, nor, idx


meshes, materials, nodes = [], [], []


def material(name, rgb):
    materials.append({'name': name, 'pbrMetallicRoughness': {'baseColorFactor': [*rgb, 1], 'metallicFactor': 0.6, 'roughnessFactor': 0.45}})
    return len(materials) - 1


def mesh(name, geo, mat):
    pos, nor, idx = geo
    n = len(pos) // 3
    xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
    a = len(acc)
    acc.append({'bufferView': add(f(pos), 34962), 'componentType': 5126, 'count': n, 'type': 'VEC3', 'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)]})
    acc.append({'bufferView': add(f(nor), 34962), 'componentType': 5126, 'count': n, 'type': 'VEC3'})
    acc.append({'bufferView': add(struct.pack('<%dH' % len(idx), *idx), 34963), 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'})
    meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': a, 'NORMAL': a + 1}, 'indices': a + 2, 'material': mat}]})
    return len(meshes) - 1


def node(name, parent=None, translation=None, m=None):
    nodes.append({'name': name, **({'translation': translation} if translation else {}), **({'mesh': m} if m is not None else {})})
    i = len(nodes) - 1
    if parent is not None:
        nodes[parent].setdefault('children', []).append(i)
    return i


grey, blue, orange, red = material('Acciaio', (0.62, 0.65, 0.7)), material('Blu', (0.15, 0.4, 0.8)), material('Arancio', (0.95, 0.5, 0.1)), material('Rosso', (0.85, 0.15, 0.15))
base = node('Base', None, None, mesh('Base', box(1.2, 0.1, 0.6, 0, 0.05, 0), grey))
colonna = node('Colonna', base, [0, 0.1, 0], mesh('Colonna', box(0.12, 0.6, 0.12, 0, 0.3, 0), blue))
braccio = node('Braccio', colonna, [0, 0.6, 0], mesh('Braccio', box(0.7, 0.08, 0.1, 0.35, 0, 0), orange))  # pivots at the top of the column
pinza = node('Pinza', braccio, [0.7, 0, 0], mesh('Pinza', box(0.05, 0.2, 0.05, 0, -0.1, 0), red))  # slides along z at the arm's end
pistone = node('Pistone', base, [-0.4, 0.1, 0], mesh('Pistone', box(0.08, 0.25, 0.08, 0, 0.125, 0), blue))


def sampler(times, values, kind):
    ti = add(f(times))
    vi = add(f(values))
    a = len(acc)
    acc.append({'bufferView': ti, 'componentType': 5126, 'count': len(times), 'type': 'SCALAR', 'min': [min(times)], 'max': [max(times)]})
    acc.append({'bufferView': vi, 'componentType': 5126, 'count': len(times), 'type': kind})
    return a


def yaw(deg):
    r = math.radians(deg) / 2
    return [0, math.sin(r), 0, math.cos(r)]


def clip(name, channels):
    samplers, chans = [], []
    for target, path, times, values, kind in channels:
        a = sampler(times, values, kind)
        samplers.append({'input': a, 'output': a + 1, 'interpolation': 'LINEAR'})
        chans.append({'sampler': len(samplers) - 1, 'target': {'node': target, 'path': path}})
    return {'name': name, 'samplers': samplers, 'channels': chans}


def slide(node_id, axis, dist, times, fractions):
    vals = []
    for fr in fractions:
        v = [0, 0, 0]
        v[axis] = dist * fr
        vals += v
    return (node_id, 'translation', times, vals, 'VEC3')


def turn(times, degs):
    vals = []
    for d in degs:
        vals += yaw(d)
    return (braccio, 'rotation', times, vals, 'VEC4')


def fix_base(ch, base_pos):  # a translation channel is absolute: add the node's rest position
    n, path, times, vals, kind = ch
    vals = [vals[i] + base_pos[i % 3] for i in range(len(vals))]
    return (n, path, times, vals, kind)


animations = [
    clip('Ciclo completo', [
        turn([0, 1, 2, 3, 4], [0, 60, 60, -60, 0]),
        fix_base(slide(pinza, 2, 0.08, [0, 1, 1.5, 2.5, 3, 4], [0, 0, 1, 1, 0, 0]), [0.7, 0, 0]),
        fix_base(slide(pistone, 1, 0.15, [0, 2, 4], [0, 1, 0]), [-0.4, 0.1, 0]),
    ]),
    clip('Solo braccio', [turn([0, 1.5, 3], [0, 90, 0])]),
    clip('Apri pinza', [fix_base(slide(pinza, 2, 0.08, [0, 1], [0, 1]), [0.7, 0, 0])]),
    clip('Chiudi pinza', [fix_base(slide(pinza, 2, 0.08, [0, 1], [1, 0]), [0.7, 0, 0])]),
]
gltf = {'asset': {'version': '2.0', 'generator': 'immersa test model'}, 'scene': 0, 'scenes': [{'nodes': [base]}], 'nodes': nodes, 'meshes': meshes, 'materials': materials,
        'animations': animations, 'accessors': acc, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
js = json.dumps(gltf).encode()
while len(js) % 4:
    js += b' '
while len(bin_) % 4:
    bin_ += b'\0'
total = 12 + 8 + len(js) + 8 + len(bin_)
open(out, 'wb').write(struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(bin_), b'BIN\0') + bin_)
