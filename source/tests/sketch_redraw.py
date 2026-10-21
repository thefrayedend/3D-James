# Sketch: take a side (or a run of sides) out of a closed outline and draw a new part in its place.
# The outline opens into an unfinished line (it stays on the board, rules kept) until its two ends meet again.
# Real mouse clicks and keys. Run after build.py:  python tests/sketch_redraw.py
import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
APP=(ROOT/'local/3DJames.html').as_uri()
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg=await b.new_page(viewport={'width':1280,'height':800}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(APP)
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden',timeout=120000)
    ev=pg.evaluate
    await ev("""async()=>{const C=__3dj.commands; C.newProject(); await new Promise(r=>setTimeout(r,800)); window.__k=C.startSketch(); await new Promise(r=>setTimeout(r,300));}""")
    # draw a rectangle with real clicks
    async def at(x,y): return await ev(f"()=>__k.screenOf([{x},{y}])")
    await ev("()=>document.querySelector('.sketch [title=\"Fit everything in view\"]').click()"); await pg.wait_for_timeout(200)
    await pg.keyboard.press('r')
    for q in [(0,0),(40,30)]:
      x,y=await at(*q); await pg.mouse.click(x,y)
    await ev("()=>document.querySelector('.sketch [title=\"Fit everything in view\"]').click()")
    await pg.wait_for_timeout(200)

    # a length rule on the bottom, flat on left? add rules
    await ev("()=>{__k.setLength(0,0,40); __k.pickItems([{l:0,i:1}]); __k.pressRule('upright'); __k.pickItems([]);}")

    # pick the top side (side 2 from [40,30] to [0,30]) and press Delete
    await pg.keyboard.press('s')
    x,y=await at(10,30); await pg.mouse.click(x,y)
    side=await ev("()=>document.querySelector('.sk-side').innerText"); assert 'Delete segment' in side, side
    assert await ev("()=>!document.querySelector('.sk-delseg').disabled")
    n0=await ev("()=>__k.rules.length")
    keep=await ev("()=>__k.rules.filter(r=>r.t!=='anchor' && !(r.a&&r.a.l===0&&r.a.i===2) && !(r.b&&r.b.l===0&&r.b.i===2)).length")
    assert keep>=2, keep  # the length on the bottom and Upright on the right (plus the rectangle's own Flat / Upright rules)
    await pg.keyboard.press('Delete')
    d=await ev("()=>JSON.stringify(__k.drawing)"); print('drawing',d)
    assert await ev("()=>__k.loops.length===1 && __k.loops[0].type==='open' && __k.loops[0].pts.length===4 && __k.drawing.pts.length===1")
    assert await ev("()=>__k.rules.filter(r=>r.t!=='anchor').length")==keep, 'rules on the sides that stayed are kept'
    await pg.mouse.move(*(await at(20,35)))
    await pg.screenshot(path=str(ROOT/'dist/redraw-1.png'))
    # Undo puts it back
    await pg.keyboard.press('Control+z')
    assert await ev("()=>__k.loops.length===1 && __k.loops[0].type==='poly' && __k.loops[0].pts.length===4 && !__k.drawing"), await ev("()=>JSON.stringify([__k.loops,__k.drawing])")
    assert await ev("()=>__k.rules.length")==n0
    # again, and draw a peak: from green end
    await pg.keyboard.press('s'); x,y=await at(10,30); await pg.mouse.click(x,y); await pg.click('.sk-delseg')
    end=await ev("()=>__k.drawing.pts.at(-1)"); first=await ev("()=>__k.loops[0].pts[0]"); print('from',end,'to',first)
    x,y=await at(20,35); await pg.mouse.click(x,y)
    await pg.mouse.move(*(await at(*first)))
    await pg.screenshot(path=str(ROOT/'dist/redraw-2.png'))
    x,y=await at(*first); await pg.mouse.click(x,y)
    L=await ev("()=>JSON.parse(JSON.stringify({loops:__k.loops,rules:__k.rules,d:__k.drawing}))"); print(json.dumps(L))
    assert len(L['loops'])==1 and L['loops'][0]['type']=='poly' and len(L['loops'][0]['pts'])==5 and L['d'] is None
    # length rule should now point to the bottom side still (pts 0..)
    lo=L['loops'][0]['pts']; lr=[r for r in L['rules'] if r['t']=='length'][0]; i=lr['a']['i']
    A,B=lo[i],lo[(i+1)%5]; assert A[1]==0 and B[1]==0, (A,B)
    fr=[r for r in L['rules'] if r['t']=='upright'][0]; assert lo[fr['a']['i']][0]==40 and lo[(fr['a']['i']+1)%5][0]==40
    await pg.screenshot(path=str(ROOT/'dist/redraw-3.png'))
    # Undo after closing: first back to the open line, then back to the rectangle
    await pg.keyboard.press('Control+z')
    assert await ev("()=>__k.loops[0].type==='open'")
    await pg.keyboard.press('Control+z')
    assert await ev("()=>__k.loops[0].type==='poly' && __k.loops[0].pts.length===4")
    # arc replacement: pick top side, delete, switch to arc, click other end then bend point
    await pg.keyboard.press('s'); x,y=await at(10,30); await pg.mouse.click(x,y); await pg.keyboard.press('Delete')
    await pg.keyboard.press('a'); first=await ev("()=>__k.loops[0].pts[0]")
    x,y=await at(*first); await pg.mouse.click(x,y); x,y=await at(20,34); await pg.mouse.click(x,y)
    L=await ev("()=>JSON.parse(JSON.stringify(__k.loops))"); print('arc',json.dumps(L)); assert L[0]['type']=='poly' and len(L[0]['pts'])==4 and any(L[0].get('bulge',[]))
    await pg.screenshot(path=str(ROOT/'dist/redraw-4.png'))
    # two sides with shift; non-adjacent refused
    await pg.keyboard.press('s'); x,y=await at(40,8); await pg.mouse.click(x,y); x,y=await at(0,8); await pg.keyboard.down('Shift'); await pg.mouse.click(x,y); await pg.keyboard.up('Shift')
    await pg.keyboard.press('Delete'); assert await ev("()=>__k.loops.length===2 && __k.loops.every(l=>l.type==='open' && l.pts.length===2)"), 'two sides that are not next to each other: two separate pieces are left'
    await pg.keyboard.press('Escape'); await pg.keyboard.press('Control+z'); assert await ev("()=>!__k.drawing && __k.loops[0].type==='poly' && __k.loops[0].pts.length===4")
    await pg.keyboard.press('s')
    x,y=await at(40,8); await pg.mouse.click(x,y); x,y=await at(10,0); await pg.keyboard.down('Shift'); await pg.mouse.click(x,y); await pg.keyboard.up('Shift')
    t=await ev("()=>document.querySelector('.sk-side').innerText"); assert 'Delete 2 segments' in t, t
    assert await ev("()=>document.querySelector('.sk-delseg').textContent")=='Delete 2 segments'
    await pg.keyboard.press('Delete'); d=await ev("()=>JSON.parse(JSON.stringify(__k.loops[0]))"); print('2 sides',d['pts']); assert d['type']=='open' and len(d['pts'])==3
    # Esc with nothing drawn: the outline stays open (unfinished); Undo puts it back
    await pg.keyboard.press('Escape'); assert await ev("()=>!__k.drawing && __k.loops[0].type==='open'")
    await pg.keyboard.press('Control+z'); assert await ev("()=>!__k.drawing && __k.loops[0].type==='poly' && __k.loops[0].pts.length===4")
    # stop halfway (Esc): the new part stays, still open; carry on later from its orange end and close it
    await pg.keyboard.press('s'); x,y=await at(40,8); await pg.mouse.click(x,y); await pg.keyboard.press('Delete')
    x,y=await at(47,8); await pg.mouse.click(x,y)
    await pg.keyboard.press('Escape'); L=await ev("()=>JSON.parse(JSON.stringify(__k.loops))"); assert len(L)==1 and L[0]['type']=='open' and len(L[0]['pts'])==5, L
    await pg.keyboard.press('l'); x,y=await at(47,8); await pg.mouse.click(x,y)
    end=await ev("()=>__k.loops[0].pts[0]"); x,y=await at(*end); await pg.mouse.click(x,y)
    L=await ev("()=>JSON.parse(JSON.stringify(__k.loops))"); assert len(L)==1 and L[0]['type']=='poly' and len(L[0]['pts'])==5, L
    assert not errs, errs
    print('ALL OK')
    await b.close()
asyncio.run(main())
