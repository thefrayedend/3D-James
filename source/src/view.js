// The 3D view, wired to the rest of the app.
import { Viewport } from './viewport.js';
import { app } from './state.js';
import { $ } from './ui/dom.js';
import { withGroup, commitTransform, editStep, translateSel, alignPlan, alignSel } from './commands.js';
import { toolPick, splitBarValues, endTool } from './tools.js';
import { renderAll } from './ui/panels.js';
import { renderObjBar, setBarValues, markActiveAxis } from './ui/bars.js';

export const vp = new Viewport($('view'), {
  onSelect(id, additive) {
    if (app.tool?.type === 'align') {
      // clicking one of the picked objects makes it the one the others line up with; clicking elsewhere ends Align
      if (id != null && app.sel.includes(id)) { app.tool.anchor = id; vp.setAlign({ anchor: withGroup([id]) }); renderAll(); return; }
      endTool();
    }
    if (app.tool) return;
    editStep(null);
    if (id == null) { if (!additive) app.sel = []; }
    else if (additive) { const g = withGroup([id]); app.sel = app.sel.includes(id) ? app.sel.filter((x) => !g.includes(x)) : [...new Set([...app.sel, ...g])]; }
    else app.sel = withGroup([id]);
    vp.setSelection(app.sel);
    renderAll();
  },
  onDoubleClick(id) { app.sel = withGroup([id]); editStep(null); vp.setSelection(app.sel); vp.centerOn(app.sel, true); renderAll(); },
  onPlaneLive(pe, final) {
    if (app.tool?.type !== 'split') return;
    Object.assign(app.tool, { off: pe.off, roll: pe.roll, pitch: pe.pitch, yaw: pe.yaw });
    setBarValues(splitBarValues());
    if (final) renderObjBar(true);
  },
  onTransformCommit(ids, matrix, info) { commitTransform(ids, matrix, info); },
  onDragState(on) { app.dragging = on; renderObjBar(); },
  onDragLive(kind, v) {
    // keep the bottom bar numbers live while dragging
    if (kind === 'scale') { if (app.gizmo === 'scale') setBarValues([v.x, v.y, v.z]); }
    else if (kind === 'rotate') { if (app.gizmo === 'rotate' && app.barBase) setBarValues(app.barBase.map((b, i) => b + v[i])); }
    else if (app.gizmo === 'translate' && app.barBase) setBarValues(app.barBase.map((b, i) => b + [v.x, v.y, v.z][i]));
  },
  onPick(kind, hit) { toolPick(kind, hit); },
  onRulerMove(d) { translateSel(...d); },
  onActiveAxis(ax) { markActiveAxis(ax); },
  alignPreview(axis, where) { return app.tool?.type === 'align' ? alignPlan(axis, where, app.tool.anchor) : {}; },
  onAlign(axis, where) { if (app.tool?.type === 'align') alignSel(axis, where, app.tool.anchor); },
});
