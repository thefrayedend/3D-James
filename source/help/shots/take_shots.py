# Takes the general help screenshots from the real app (run with tests' explore harness: python3 explore.py take_shots.py)
from PIL import Image
OUT = '/home/claude/cad/help/img/'
def save(src, name, w=1100):
    im = Image.open(src).convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS); im.save(OUT + name, quality=78, optimize=True)
async def run(pg):
    await pg.set_viewport_size({'width': 1280, 'height': 720})
    # the main window: the example bracket picked, Properties open
    await pg.evaluate("""async()=>{ __3dj.store.doc; const ids=[...__3dj.app.results.bodies.keys()]; __sel([ids[0]]); __3dj.commands.openPanel('props'); await new Promise(r=>setTimeout(r,300)); }""")
    await pg.evaluate('__raf()'); await pg.wait_for_timeout(400)
    await pg.screenshot(path='/tmp/h_over.png'); save('/tmp/h_over.png', 'overview.jpg')
    # the sketch board with a drawing, rules and a measurement
    await pg.evaluate("""async()=>{ await __fresh(); __3dj.app.settings.panelOpen=false; __3dj.commands.renderAll();
      const k = __3dj.commands.startSketch(); window.__k=k; await new Promise(r=>setTimeout(r,300));
      k.loops.push({type:'poly', pts:[[0,0],[88,0],[88,10],[65,22],[65,32],[42,32],[9,65],[0,65]], bulge:[0,0,0,0,0,0.414214,0,0]});
      k.addRule('flat',{l:0,i:0}); k.addRule('upright',{l:0,i:7}); k.measureRule('dx',{o:1},{l:0,k:5},42); k.setRadius(0,5,33);
      k.setTool('select'); k.pickEdge(0,0); document.querySelector('.sketch [title="Fit everything in view"]').click(); await new Promise(r=>setTimeout(r,250)); }""")
    await pg.screenshot(path='/tmp/h_sk.png'); save('/tmp/h_sk.png', 'sketch.jpg')
    await pg.evaluate("document.querySelector('.sketch .btn.primary').click()"); await pg.wait_for_timeout(300)
    await pg.screenshot(path='/tmp/h_solid.png')
    im = Image.open('/tmp/h_solid.png'); W, H = im.size; im.crop((int(W*0.22), int(H*0.2), int(W*0.78), int(H*0.95))).save('/tmp/h_solid2.png'); save('/tmp/h_solid2.png', 'solid.jpg', 800)
