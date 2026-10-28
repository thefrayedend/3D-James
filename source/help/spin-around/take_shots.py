import json
async def run(pg):
    await pg.set_viewport_size({'width':1280,'height':720})
    await pg.evaluate("""async()=>{ await __fresh(); __3dj.app.settings.panelOpen=false; __3dj.commands.renderAll();
      const k = __3dj.commands.startSketch(); window.__k = k; await new Promise(r=>setTimeout(r,300));
      const sh = (p)=>[p[0]-14, p[1]];
      k.loops.push({type:'poly', pts:[[0,0],[88,0],[88,10],[65,22],[65,32],[42,32],[9,65],[0,65]].map(sh), bulge:[0,0,0,0,0,0.414214,0,0]});
      k.setTool('select'); document.querySelector('.sketch [title="Fit everything in view"]').click(); await new Promise(r=>setTimeout(r,200)); }""")
    async def box(sel_js):
        return await pg.evaluate("(()=>{const e=(%s); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]})()" % sel_js)
    meta = {}
    await pg.screenshot(path='/tmp/claude-0/guide/s1.png')
    meta['green'] = await pg.evaluate("__k.screenOf([0,30])")
    meta['b1'] = await box("[...document.querySelectorAll('.sketch .chip')].find(b=>b.textContent==='Right of green line')")
    await pg.evaluate("[...document.querySelectorAll('.sketch .chip')].find(b=>b.textContent==='Right of green line').click()")
    await pg.wait_for_timeout(200)
    await pg.screenshot(path='/tmp/claude-0/guide/s2.png')
    meta['green2'] = await pg.evaluate("__k.screenOf([0,30])")
    meta['done'] = await box("document.querySelector('.sketch .btn.primary')")
    await pg.evaluate("document.querySelector('.sketch .btn.primary').click()"); await pg.wait_for_timeout(300)
    await pg.evaluate("[...document.querySelectorAll('.seg button')].find(b=>b.textContent==='Spin around').click()"); await pg.wait_for_timeout(150)
    await pg.screenshot(path='/tmp/claude-0/guide/s3.png')
    meta['spin'] = await box("[...document.querySelectorAll('.seg button')].find(b=>b.textContent==='Spin around')")
    meta['ok'] = await box("[...document.querySelectorAll('button.btn.primary')].find(b=>b.textContent==='OK')")
    await pg.evaluate("[...document.querySelectorAll('button.btn.primary')].find(b=>b.textContent==='OK').click()")
    for i in range(20): await pg.evaluate('__built()'); await pg.wait_for_timeout(100)
    await pg.evaluate("""()=>{ __sel([]); __3dj.app.settings.panelOpen=false; __3dj.commands.renderAll(); __cam(-60, 25, 300, [0,0,30]); }""")
    await pg.evaluate('__raf()'); await pg.wait_for_timeout(300); await pg.evaluate('__raf()')
    await pg.screenshot(path='/tmp/claude-0/guide/s4.png')
    meta['err'] = await pg.evaluate("Object.values(__3dj.app.results.errors)")
    json.dump(meta, open('/tmp/claude-0/guide/meta.json','w'))
    print(meta)
