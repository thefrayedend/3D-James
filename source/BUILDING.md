# Building and testing 3DJames

The shipped `3DJames.html` works offline without installing development tools.

To rebuild the source, use Node.js 20 or newer and Python 3. Install the JavaScript
dependencies with `npm ci` (or double-click `Build 3DJames.cmd`, which does it the first time), then run:

```text
python build.py
```

The resulting app is `local/3DJames.html`. The bundler reads source files through
Node so Windows directory restrictions do not interfere with package resolution.

Browser tests need Playwright and its Chromium browser:

```text
python -m pip install playwright
python -m playwright install chromium
python tests/all.py
```

`tests/all.py` runs every suite below one after the other and ends with a summary (about half an hour).
Name suites to run just those (`python tests/all.py features sketch_lines`), or leave some out
(`python tests/all.py --skip link`: the link suite needs the AI link's port free).

Shipping (`python tools/ship.py`) raises the last part of the version number by itself when the build
differs from the one already shipped, so every shipped app has its own number.

The reliability suite tests saving during edits, failed imports, pending geometry
exports, missing files, invalid project and mesh data, ZIP limits and CRC checks,
cyclic 3MF components, backup errors, close warnings, worker recovery, and dialog
keyboard behavior. The main suite also exercises modeling tools and real mouse
interactions. Test screenshots are written to `dist/`.

Run lint with `npm run lint`. The source has no lint warnings or errors.

The feature suite checks emboss/engrave geometry, SVG holes, read-only measurements,
portable version records and imports, dependency-aware history, boolean previews,
and export identity. The UI suite uses actual mouse clicks, narrow ribbon menus,
and orbit controls. Run browser suites sequentially to avoid software-renderer contention.

Named versions store model snapshots separately inside .3dj, editable .3mf, or JSON,
with shared imported files. Restoring and deleting versions support Undo. The first
versioned save also preserves the last saved model when it differs. There is a
200-version and 400 MB project archive limit. Older projects remain readable; older
app builds cannot evaluate the new emboss feature.

Tangent plane checks: `python tests/planes.py` tests exact CAD surface projection,
cylinder/sphere/cone normals, offset/flip, sketch cutting, file round trips, Undo/Redo
and new-object orientation. `python tests/plane_ui.py` clicks a curved face and
checks placement, cancellation, flip and both sketch entry points.

Open sketch lines: `python tests/sketch_lines.py` checks that Line and Arc can stop anywhere (Enter / Esc) and
carry on later from an orange end, that lines whose ends meet join into one line and then one outline (also across
two sketches edited together), the Done prompt for unfinished lines, splitting a line, rules following the joins,
live mirror of an open half, and that the engine ignores open lines saved in a sketch.

Sketch redraw check: `python tests/sketch_redraw.py` uses real clicks to take sides out of a
closed outline (Delete side / Delete key, Shift for a run of sides), redraw with Line and Arc,
close on the dashed end, keep the rules of the kept sides, and put it back with Undo or Esc.
Help pictures for it and for open lines: `python help/shots/lines_shots.py`.

Double-click zoom: `python tests/doubleclick.py` double-clicks a cube with the real mouse:
first view, twice as close, back again, and a fresh start after the view is moved by hand.

Copies and several sketches: `python tests/copies.py` checks that Mirror copy makes a separate
object (a sketch stays an editable sketch, flipped; compared with the engine's exact mirror for
turned, spun and loft sketches), Turned copy, older joined mirror copies, Edit sketches together
(round trip in place on the floor and on a turned, lifted plane; moving shapes between sketches)
and Join into one sketch. Help pictures: `python help/shots/copies_shots.py`.

Help is part of completing tool changes (AGENTS.md). Update the relevant topics,
capture real screenshots using the commands in help/README.txt, prepare embedded
JPEGs, and rebuild. Run `python tests/help.py` to verify all topics, offline image
decoding, search, enlargement, keyboard focus and narrow-window layout. Inspect
the generated screenshots in dist before delivery.

Tutorial projects are authored as help/examples/*.json. Run
`python help/build_examples.py` against a built app to generate real .3dj archives,
validate one CAD solid per model through STEP export/import, exercise parameter
edits and Undo, and capture screenshots. Rebuild afterward to embed updated archives
and images. `python tests/tutorials.py` checks About session defaults, persistent
reading position, docked modeling/sketching, unsaved work protection and downloads.
The full suite expects Help to close when leaving the Help tab, and to stay docked beside
the model only after Keep visible (until Close), then closes it before continuing.

Putting a build where it is used: `python tools/ship.py` copies `local/3DJames.html` to the 3DJames folder
(the one you open) and `single/`, updates the version in the shipped README, remakes `icons/originals`, and
builds and copies the AI link. (There is no share zip: 3DJames is shared as the installer that
`Installation\Make 3DJames Installer.cmd` makes.) The 3DJames folder above `source` is the master copy of everything that ships.

Code map (the parts most changes touch):
- `src/sketchgeom.js`: sketch loop geometry shared by the board and the engine (closed outlines, circles, helper
  lines and open lines; `isSolidLoop`, `isOpenLoop`, `sideCount` say which is which).
- `src/sketchsolve.js`: the sketch rules and their solver (plain math, no screen code).
- The sketch board is one object, `sb`, made in `src/ui/sketch.js` (`openSketch`: its state, toolbar, Done
  and the test hook). Each part installs its functions on `sb`, so they can call each other as `sb.name()`:
  `sketchdraw.js` (screen, snapping, drawing), `sketchedit.js` (changing the drawing, rules, joining lines),
  `sketchpanel.js` (the panel on the right), `sketchtools.js` (Line, Arc, Rectangle...), `sketchinput.js`
  (mouse and keys), `sketchkit.js` (shared helpers and tables). Rules are renumbered only through
  `sb.eachRef`/`sb.remapRules`, and open lines join and close only through `sb.joinEnds`.
- `skill/3djames-project/SKILL.md`: the Claude skill that writes .3dj projects. Change it when the project
  format changes (`tools/ship.py` zips it into `Share`).
- `src/build.js`: the link to the geometry engine. `ENGINE_TIMEOUT_MS` (10 minutes) is how long one job may run.

Touch and pen: `python tests/touch.py` sends real touch and pen events (Chrome DevTools protocol): touch mode,
tap / hold-drag / swipe / pinch / double tap in 3D, touch-slide-lift and two-finger zoom in the sketch, the
on-screen keys and 123 pad, pen drawing and palm rejection. `src/touch.js` holds touch mode and the on-screen keys.

The 3DJames box (server): `server/` is the server (Python 3, standard library only). Try it on any PC:
`python server/3djames_server.py --data testdata --app-port 8090 --admin-port 8091 --bundled-app local/3DJames.html`
then open http://localhost:8091 (admin) and http://localhost:8090 (the app). `python tests/server.py` starts its
own server and checks setup, users, sign-in, the server's Open/Save window, the shared folder, conflicts,
presence, My parts, app uploads, the update folder and that nobody can reach outside their folders.
The app talks to files through `src/drive/` (`local.js`: this computer; `server.js`: a box), chosen at start-up.
`appliance/` builds the Orange Pi SD card image (on GitHub: `python tools/publish_appliance.py --push`, then
Actions > Build SD card image in the 3djames-pi repository). Help pictures: `python help/shots/touch_server_shots.py`.

Sketch from a photo: `python tests/photo.py` makes photos with known sizes (an L bracket with two holes on A4 paper
seen at an angle, a 450 mm bar sized from a measured rectangle, a top view sized by a line) and checks the window,
straightening, scaling, the outline found (6 corners, holes as circles, sizes within 1.5 mm), saving the photo in the
project, Edit sketch, Move / Size again and Undo. The maths is in `src/photo.js`, the window in `src/ui/photowin.js`,
the photo on the board in `src/ui/sketchphoto.js`. Help pictures: `python help/shots/photo_shots.py`.

More sketch tools (Trim, Slot, Polygon, Offset, Pattern, helper <-> drawn line, Level & upright, Import DXF / SVG):
`python tests/sketch_tools.py` (real mouse and keys). Where lines cross and cutting sides is in `src/sketchcut.js`,
reading DXF / SVG in `src/sketchimport.js`, the tools on the board in `src/ui/sketchmore.js`; Offset runs in the
geometry engine (`offsetLoops` in `src/engine.js`). Help pictures: `python help/shots/tools_shots.py`.

Sketch on a mesh: `src/meshfaces.js` groups a mesh's triangles into flat areas (and tells a flat face from the facets
of a curve), so Sketch > On a surface... and Workplane can pick an imported STL. `python tests/mesh_sketch.py` does it
with the mouse on the fixture block (cut into its top) and knob (a plane touching its round side). Help picture:
`python help/shots/mesh_shots.py`.

Importing meshes: `src/formats.js` reads 3MF (the main model from `_rels/.rels`, parts in other model files through
`p:path` as Bambu Studio and PrusaSlicer save them) and OBJ (faces with dents filled properly); `addMeshParts` in
`src/files.js` checks every part before adding any, keeps the parts of one file where they were relative to each
other, and adds them as one undo step. `python tests/imports.py` checks that, bad 3MF numbers and units, and that
Make editable drops a result when the project changed while it worked (`TDJ_APP=<path>` runs it on another build).

Sizing: `python tests/sizing.py` checks that typed sizes and the X / Y size arrows (real mouse drags) change both
sides the same so the object stays put (plain, turned and combined objects), and that Z keeps the bottom on the floor.

Paint: `python tests/paint.py` paints with the real mouse (Fill, Brush) and the other tools, checks Done / Cancel /
Undo, the paint following moves, turns, sizing, copies and merges, and reads the 3MF's `paint_color` back the way
OrcaSlicer's TriangleSelector does (src/paint.js says how the strings are made). Checked by hand in OrcaSlicer 2.x:
the paint lands on the right filaments; Orca keeps its own filament colors for files from other programs.

Ready-made parts (Insert > Parts, beyond the plain hardware in `src/catalog.js`): each is a shape kind. `src/parts/defs.js` holds
the fields, standard numbers and the menu (`PART_DEFS`, `PART_MENU`, `PART_HOLES`, and a `preset` for ones whose size fills in other
numbers); the builders are in `src/parts/*.js` (`gridfinity`, `organizing`, `mounting`, `electronics`, `printer`, `motion`, `joints`,
`knobs`, `helpers`, `gears`, `stock`, `fasteners`), made with the small toolkit in `src/parts/kit.js` and registered in
`src/parts/index.js`; size tables are in `src/parts/tables.js`. replicad's booleans leave their inputs alone but moving, turning
and mirroring a shape uses it up (clone first); `K.cutMany` / `K.fuseMany` take many pieces at once and only work when the pieces
do not overlap each other. To add a part: write the builder, add its `PART_DEFS` entry and menu item, add cases to
`tests/parts.cases.json` (size to expect; a number of separate solids for print-in-place parts), then
`node tests/parts.mjs` (no browser; builds every case and every menu item), `python tests/parts_sheet.py <kind>` (a contact-sheet
picture: look at it), `node tools/make_skill_parts.mjs` (the AI skill's table), the Help pages (`parts`, `printparts`, `gridfinity`,
`gears`; pictures: `python help/shots/parts_shots.py`). `python tests/parts.py` runs the engine check and then the Parts menu with
the real mouse.

Make editable (STL to sketches): `src/stlconvert.js` rebuilds a mesh as sketches pushed up (layers between flat
faces, holes through several layers as one cutter), profiles spun around, or outlines seen from two or three sides
pushed through each other, then works out what that misses the same way (cut out or merged in). Outlines become
lines, true arcs, circles and rounded corners. It runs in the geometry worker (`convertImport` in `src/worker.js`),
which also builds the result in a trial run and measures it against the mesh (retrying more simply when the CAD
kernel cannot build it); `src/editable.js` puts the steps in place of the import step (one Undo).
`node tests/stl_convert.mjs [file.stl ...]` converts STLs with the real engine (no browser) and prints steps,
how much differs and the largest gap; with no files it uses `tests/fixtures/stl` (made by
`node tests/make_stl_fixtures.mjs`) and fails when one is not close. `python tests/stl_editable.py` opens them in
the app with the mouse: Make editable, change a sketch, Undo back to the mesh, save and reopen. Help pictures:
`python help/shots/editable_shots.py`.

The AI link (Gemini / Claude work in the open window): `src/bridge.js` (the page side, only for files on this
computer) and `windows-desktop/link/` (`3DJamesLink.exe`, an MCP server; `python windows-desktop/link/build_link.py`
builds it with the Windows C# compiler into `local/`). `python tests/link.py` drives every tool through the real exe
and app. `tools/ship.py` builds it and puts it, `GEMINI.md`, `Ask Gemini.cmd`, `.gemini/settings.json` and `.mcp.json`
(from `windows-desktop/link/ai/`) next to `3DJames.html`. When the tools change, update `windows-desktop/link/tools.json`
and the Help page `help/pages/ai.html` (pictures: `python help/shots/link_shots.py`). Plan and later steps (desktop app,
the box): `docs/mcp-plan.md`.
