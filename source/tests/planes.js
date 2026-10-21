window.__planeTests = async () => {
  const { app, commands: C, store: S, vp } = window.__3dj, results = [];
  const assert = (v, msg) => { if (!v) throw new Error(msg); };
  const built = async () => { for (let i = 0; app.building || app.pending || app.builtRevision !== S.revision || app.afterBuild; i++) { if (i > 6000) throw new Error('Build timeout'); await new Promise(r => setTimeout(r, 20)); } };
  const test = async (name, fn) => { try { await fn(); results.push({name,ok:true}); } catch(e) { results.push({name,ok:false,message:e.message}); } console.log('TEST '+JSON.stringify(results.at(-1))); };
  const fresh = async (kind, p) => { C.newProject(); await built(); const id = C.addShape(kind,p); S.amend(d=>{d.features[0].pos=[0,0,0];}); await built(); return id; };
  const curved = id => app.results.bodies.get(id).flat.findIndex(x=>!x);
  const query = async (id, point, face=curved(id)) => (await C.workerCall({type:'surfacePlane',body:id,face,point})).plane;
  let id, plane;
  await test('cylinder tangent projects off-mesh points onto exact CAD surface',async()=>{
    id=await fresh('cyl',{d:40,h:40}); plane=await query(id,[18,5,20]);
    assert(Math.abs(Math.hypot(plane.P[0],plane.P[1])-20)<1e-6,'origin not on cylinder');
    assert(Math.abs(plane.n[0]-plane.P[0]/20)<1e-6 && Math.abs(plane.n[1]-plane.P[1]/20)<1e-6 && Math.abs(plane.n[2])<1e-6,'wrong outward normal');
  });
  await test('plane offset and flip preserve tangent origin and unit normal',async()=>{
    const p=C.adjustedPlane(plane,-2,true);
    assert(Math.abs(p.P[0]-plane.P[0]+2*plane.n[0])<1e-8 && Math.abs(p.n[0]+plane.n[0])<1e-8,'bad adjustment');
    let rejected=false;try{C.adjustedPlane(plane,Infinity,false);}catch{rejected=true;}assert(rejected,'invalid offset accepted');
  });
  await test('sphere tangent normal follows the clicked location',async()=>{
    id=await fresh('sphere',{d:40}); const p=await query(id,[10,10,30]);
    const c=[0,0,20], radial=p.P.map((v,i)=>v-c[i]);
    assert(Math.abs(Math.hypot(...radial)-20)<1e-5,'origin not on sphere');
    assert(radial.every((v,i)=>Math.abs(v/20-p.n[i])<1e-6),'sphere normal wrong');
  });
  await test('cone tangent is normal to its sloping surface',async()=>{
    id=await fresh('cone',{d1:40,d2:20,h:40});const p=await query(id,[15,0,20]);
    assert(Math.abs(Math.hypot(p.P[0],p.P[1])-(20-p.P[2]/4))<1e-5,'point not on cone');
    assert(Math.abs(p.n[2]-1/Math.sqrt(17))<1e-5,'wrong cone normal');
  });
  await test('cut sketch on cylinder tangent removes material, round-trips and supports Undo',async()=>{
    id=await fresh('cyl',{d:40,h:40});plane=await query(id,[20,0,20]);
    const before=app.results.bodies.get(id).volume;
    C.setWorkplane(plane);C.createSketch([{type:'circle',c:[0,0],r:3}],[],{mode:'extrude',h:6,cut:true},plane);
    await built();await new Promise(r=>setTimeout(r,200));await built();
    assert(!Object.keys(app.results.errors).length,JSON.stringify(app.results.errors));
    const after=app.results.bodies.get(id).volume;assert(after<before-100 && after>before-250,'cut volume wrong: '+(before-after));
    const feature=S.doc.features.find(f=>f.kind==='sketch');assert(feature.p.sketchPlane.curved,'plane metadata missing');
    S.undo();await built();assert(app.results.bodies.get(id).volume>after+100,'Undo did not remove cut');S.redo();await built();assert(Math.abs(app.results.bodies.get(id).volume-after)<1e-4,'Redo did not restore cut');
    const bytes=await C.buildFileData('3dj');await C.openFile(new File([bytes],'tangent.3dj'),null);await built();
    assert(Math.abs(app.results.bodies.get(id).volume-after)<1e-4,'round trip changed cut');
  });
  await test('new solid on an offset tangent plane is oriented and remains editable',async()=>{
    id=await fresh('cyl',{d:40,h:40});plane=C.adjustedPlane(await query(id,[20,0,20]),-1,false);C.setWorkplane(plane);
    const sketch=C.createSketch([{type:'circle',c:[0,0],r:3}],[],{mode:'extrude',h:6,cut:false},plane);await built();
    assert(!Object.keys(app.results.errors).length,'new sketch error');const box=app.results.bodies.get(sketch).bbox;
    assert(Math.abs(box[0][0]-19)<0.02 && Math.abs(box[1][0]-25)<0.02,'bad oriented placement '+JSON.stringify(box));
    const f=S.doc.features.find(f=>f.body===sketch);C.editSketch(f);assert(document.body.classList.contains('sketching'),'edit sketch missing');[...document.querySelectorAll('button')].find(b=>b.textContent==='Cancel' && b.closest('.sketch'))?.click();
    S.undo();await built();assert(!S.doc.features.some(f=>f.body===sketch),'Undo did not remove sketch');
  });
  await test('invalid surface query fails without losing current model',async()=>{
    const doc=JSON.stringify(S.doc);let failed=false;try{await query(id,[0,0,0],9999);}catch{failed=true;}assert(failed&&JSON.stringify(S.doc)===doc,'invalid query mutated project');
  });
  await test('surface picking waits for current geometry and ignores a canceled tool',async()=>{
    const before=JSON.stringify(S.doc), hit={body:id,index:curved(id),point:[20,0,20]};
    C.startTool('sketchplane');app.pending=true;C.toolPick('face',hit);app.pending=false;
    assert(!app.tool.busy && !document.querySelector('dialog'),'stale displayed face was accepted');
    C.toolPick('face',hit);C.endTool();await new Promise(r=>setTimeout(r,100));
    assert(!document.querySelector('dialog') && !app.tool && JSON.stringify(S.doc)===before,'canceled query opened a plane');
  });
  C.setWorkplane(null);return results;
};

