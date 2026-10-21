import asyncio, sys, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
        pg = await b.new_page(viewport={'width':1400,'height':860})
        logs=[]
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.goto(sys.argv[4] if len(sys.argv)>4 else 'http://localhost:8765/test.html')
        await pg.wait_for_timeout(int(sys.argv[2]) if len(sys.argv)>2 else 12000)
        if len(sys.argv)>3:
            for step in json.loads(sys.argv[3]):
                if step[0]=='eval': logs.append('EVAL: '+str(await pg.evaluate(step[1])))
                elif step[0]=='click': await pg.mouse.click(step[1],step[2])
                elif step[0]=='dblat':
                    x,y=await pg.evaluate(step[1]); await pg.mouse.dblclick(x,y)
                elif step[0]=='wait': await pg.wait_for_timeout(step[1])
                elif step[0]=='key': await pg.keyboard.press(step[1])
                elif step[0]=='drag':
                    await pg.mouse.move(step[1],step[2]); await pg.mouse.down(button=step[5] if len(step)>5 else 'left'); 
                    for i in range(1,11): await pg.mouse.move(step[1]+(step[3]-step[1])*i/10, step[2]+(step[4]-step[2])*i/10)
                    await pg.mouse.up(button=step[5] if len(step)>5 else 'left')
                elif step[0]=='dragel':
                    box=await pg.evaluate("([s,i])=>{const e=document.querySelectorAll(s)[i]; const r=e.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]}", [step[1],step[2]])
                    x,y=box; await pg.mouse.move(x,y); await pg.mouse.down()
                    for k in range(1,11): await pg.mouse.move(x+step[3]*k/10, y+step[4]*k/10)
                    await pg.mouse.up()
                elif step[0]=='setfile':
                    await pg.set_input_files('#fileInput', step[1])
                elif step[0]=='shot': await pg.screenshot(path=step[1], clip=step[2] if len(step)>2 else None)
        await pg.screenshot(path=sys.argv[1])
        print('\n'.join(logs[-40:]))
        await b.close()
asyncio.run(main())
