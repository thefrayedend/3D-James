import json, os
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
from PIL import Image, ImageDraw, ImageFont
M = json.load(open('meta.json')); S = 1.5
FD='/usr/share/fonts/opentype/inter/'
f = lambda n,s: ImageFont.truetype(FD+n, s)
RED=(230,40,40); BLUE=(40,110,210); DARK=(25,35,50)
def ring(im, box, pad=10, w=7):
    d=ImageDraw.Draw(im); x,y,bw,bh=[v*S for v in box]
    d.rounded_rectangle([x-pad,y-pad,x+bw+pad,y+bh+pad], 18, outline=RED, width=w)
def arrow(im, frm, to, w=8, label=None, side='left'):
    d=ImageDraw.Draw(im); d.line([frm,to], fill=RED, width=w)
    import math; a=math.atan2(to[1]-frm[1], to[0]-frm[0])
    for s in (0.45,-0.45): d.line([to,(to[0]-40*math.cos(a+s), to[1]-40*math.sin(a+s))], fill=RED, width=w)
    if label:
        ft=f('Inter-Bold.otf',40); tw=ft.getlength(label)
        x = frm[0]-tw-16 if side=='left' else frm[0]+16
        d.rounded_rectangle([x-14,frm[1]-34,x+tw+14,frm[1]+30], 14, fill=(255,255,255), outline=RED, width=4)
        d.text((x,frm[1]-28), label, font=ft, fill=RED)
def badge(d, x, y, n):
    d.ellipse([x,y,x+76,y+76], fill=BLUE); ft=f('InterDisplay-Bold.otf',48)
    d.text((x+38-ft.getlength(str(n))/2, y+8), str(n), font=ft, fill='white')

s1=Image.open('s1.png').convert('RGB'); s1b=s1.copy(); s2=Image.open('s2.png').convert('RGB'); s3=Image.open('s3.png').convert('RGB'); s4=Image.open('s4.png').convert('RGB')
gx = M['green'][0]*S
# step 1: the green line
d=ImageDraw.Draw(s1); d.line([(gx,170),(gx,780)], fill=(40,190,70), width=6)
arrow(s1, (gx+430, 820), (gx+8, 700), label='Green line = what it spins around', side='right')
# step 2: the button
ring(s1b, M['b1'], pad=12)
arrow(s1b, (M['b1'][0]*S-60, M['b1'][1]*S+140), (M['b1'][0]*S-8, M['b1'][1]*S+40), label='Click this')
# step 3: after, plus Done
ring(s2, M['done'], pad=8)
d=ImageDraw.Draw(s2); d.line([(gx,170),(gx,780)], fill=(40,190,70), width=6)
arrow(s2, (gx+430, 820), (gx+10, 700), label='Now it touches the green line', side='right')
# step 4: dialog
ring(s3, M['spin'], pad=8); ring(s3, M['ok'], pad=8)
arrow(s3, (M['spin'][0]*S+M['spin'][2]*S+300, M['spin'][1]*S-60), (M['spin'][0]*S+M['spin'][2]*S+14, M['spin'][1]*S+20), label='Spin around', side='right')
arrow(s3, (M['ok'][0]*S+M['ok'][2]*S+300, M['ok'][1]*S+120), (M['ok'][0]*S+M['ok'][2]*S+14, M['ok'][1]*S+30), label='OK', side='right')

steps = [
 ('Open your sketch (Insert > Sketch, or Properties > Edit sketch).', 'The GREEN line is what the shape spins around. The whole outline must be on ONE side of it. Here it crosses over, so it can\'t spin yet.', s1),
 ('Click an empty spot so nothing is picked.', 'On the right, under WHOLE SKETCH, click "Right of green line".', s1b),
 ('The shape slides over and now touches the green line from the right.', 'Click Done (top right).', s2),
 ('In "Make it solid": click Spin around, leave 360, click OK.', '360 = all the way around. 180 would make half.', s3),
 ('Done! It spun around the green line.', 'You can change the turn or edit the outline later in Properties.', s4),
]
W = 1400; shotW = W - 120
parts=[]
head = Image.new('RGB',(W,230),(46,112,196)); d=ImageDraw.Draw(head)
d.text((60,40),'How to Spin a sketch around', font=f('InterDisplay-ExtraBold.otf',72), fill='white')
d.text((62,135),'3DJames 0.8.5  ·  Check: Help tab shows "0.8.5". If not, close 3DJames and open it again.', font=f('Inter-Medium.otf',30), fill=(225,236,255))
parts.append(head)
for i,(t1,t2,img) in enumerate(steps,1):
    sc = img.resize((shotW, int(img.height*shotW/img.width)), Image.LANCZOS)
    ft2=f('Inter-Regular.otf',30); words=t2.split(); lines=['']
    for w_ in words:
        if ft2.getlength(lines[-1]+' '+w_) > W-220: lines.append(w_)
        else: lines[-1]=(lines[-1]+' '+w_).strip()
    top = 95 + 40*len(lines) + 30
    blk = Image.new('RGB',(W, sc.height+top+60),(246,248,251)); d=ImageDraw.Draw(blk)
    badge(d, 60, 40, i)
    d.text((160,38), t1, font=f('InterDisplay-Bold.otf',38), fill=DARK)
    for j,ln in enumerate(lines): d.text((160,95+40*j), ln, font=ft2, fill=(70,82,100))
    blk.paste(sc, (60,top)); d.rectangle([60,top,60+shotW,top+sc.height], outline=(200,206,216), width=3)
    parts.append(blk)
H=sum(p.height for p in parts); out=Image.new('RGB',(W,H),'white'); y=0
for p in parts: out.paste(p,(0,y)); y+=p.height
out.save('../Spin-around-help.png', optimize=True)
# the single annotated pictures, for the help pages inside the app
for n, (_, _, img) in enumerate(steps, 1):
    im = img.resize((1100, int(img.height * 1100 / img.width)), Image.LANCZOS)
    im.save(f'../img/spin-{n}.jpg', quality=78, optimize=True)
print(out.size)
