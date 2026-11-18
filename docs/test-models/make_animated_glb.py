import json, struct, math, sys
out=sys.argv[1]
# box 0.4 x 0.4 x 0.4
h=0.2
faces=[((1,0,0),[(h,-h,-h),(h,h,-h),(h,h,h),(h,-h,h)]),((-1,0,0),[(-h,-h,h),(-h,h,h),(-h,h,-h),(-h,-h,-h)]),
((0,1,0),[(-h,h,-h),(-h,h,h),(h,h,h),(h,h,-h)]),((0,-1,0),[(-h,-h,h),(-h,-h,-h),(h,-h,-h),(h,-h,h)]),
((0,0,1),[(-h,-h,h),(h,-h,h),(h,h,h),(-h,h,h)]),((0,0,-1),[(h,-h,-h),(-h,-h,-h),(-h,h,-h),(h,h,-h)])]
pos=[];nor=[];idx=[]
for n,vs in faces:
    b=len(pos)//3
    for v in vs: pos+=v; nor+=n
    idx+=[b,b+1,b+2,b,b+2,b+3]
def f(a): return struct.pack('<%df'%len(a),*a)
bin_=b''
views=[];acc=[]
def add(data,target=None):
    global bin_
    while len(bin_)%4: bin_+=b'\0'
    views.append({'buffer':0,'byteOffset':len(bin_),'byteLength':len(data),**({'target':target} if target else {})})
    bin_+=data
    return len(views)-1
vp=add(f(pos),34962); vn=add(f(nor),34962); vi=add(struct.pack('<%dH'%len(idx),*idx),34963)
acc+= [{'bufferView':vp,'componentType':5126,'count':24,'type':'VEC3','min':[-h]*3,'max':[h]*3},
       {'bufferView':vn,'componentType':5126,'count':24,'type':'VEC3'},
       {'bufferView':vi,'componentType':5123,'count':36,'type':'SCALAR'}]
# anim 1: rotate about Y, 4 keys over 2 s
times=[0,0.5,1,1.5,2]
quat=[]
for t in times:
    a=t/2*2*math.pi/2*2  # 0..2pi
    a=t/2*2*math.pi
    quat+= [0,math.sin(a/2),0,math.cos(a/2)]
ti=add(f(times)); qi=add(f(quat))
acc+=[{'bufferView':ti,'componentType':5126,'count':5,'type':'SCALAR','min':[0],'max':[2]},{'bufferView':qi,'componentType':5126,'count':5,'type':'VEC4'}]
# anim 2: up and down
t2=[0,0.75,1.5]; tr=[0,0,0, 0,0.5,0, 0,0,0]
t2i=add(f(t2)); tri=add(f(tr))
acc+=[{'bufferView':t2i,'componentType':5126,'count':3,'type':'SCALAR','min':[0],'max':[1.5]},{'bufferView':tri,'componentType':5126,'count':3,'type':'VEC3'}]
gltf={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Cubo','mesh':0}],
 'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':1},'indices':2,'material':0}]}],
 'materials':[{'name':'Rosso','pbrMetallicRoughness':{'baseColorFactor':[0.85,0.2,0.2,1],'metallicFactor':0.1,'roughnessFactor':0.6}}],
 'animations':[{'name':'Gira','samplers':[{'input':3,'output':4}],'channels':[{'sampler':0,'target':{'node':0,'path':'rotation'}}]},
               {'name':'Salta','samplers':[{'input':5,'output':6}],'channels':[{'sampler':0,'target':{'node':0,'path':'translation'}}]}],
 'accessors':acc,'bufferViews':views,'buffers':[{'byteLength':len(bin_)}]}
js=json.dumps(gltf).encode()
while len(js)%4: js+=b' '
while len(bin_)%4: bin_+=b'\0'
total=12+8+len(js)+8+len(bin_)
open(out,'wb').write(struct.pack('<4sII',b'glTF',2,total)+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(bin_),b'BIN\0')+bin_)
