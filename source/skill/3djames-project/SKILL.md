---
name: "3djames-project"
description: "Save a 3D model as a 3DJames project (.3dj) that opens fully editable in the 3DJames CAD app, instead of a STEP/STL. Use when the user asks to export, save or build a model for 3DJames."
---

# Saving models as 3DJames projects

3DJames is a local parametric CAD app (3D Builder look, OpenCascade inside). A 3DJames project (`.3dj`) is not a mesh: it is the list of build steps (shapes, moves, merges, fillets...). When the user opens it, every step shows in **History** and stays editable (sizes, positions, variables). That is why this format beats STEP for anything you design: STEP only carries the finished solid.

Workflow:
1. Plan the model as primitives + steps (below). Put key sizes in `vars` so the user can change them later in one place.
2. Build the project as a Python dict with a short script (no hand-typing huge files) and save it as `project.json`.
3. Run the checker at the bottom on `project.json`. Fix everything it reports.
4. Pack it: a `.3dj` file is a zip holding `project.json` (plus `files/<id>` for any imported STL/STEP and an optional `preview.png`):
   `python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED); z.write(sys.argv[1],'project.json'); z.close()" project.json "<name>.3dj"`
   (Older `.json` projects still open too, but `.3dj` is the format now.)
5. Deliver: if you can write to the user's computer, save it in their `Documents\3DJames\Projects` folder as `<name>.3dj` (create the folder if needed); otherwise send the file. Tell them: open 3DJames, click **≡** (top left) > **Open…** (or Ctrl+O), pick the file. Save in 3DJames keeps it as a project.

If a model came from code (CadQuery, OpenSCAD, replicad), translate its operations into these steps. Custom 2D profiles, revolves, lofts and sweeps are `sketch` shapes (see **Sketches** below). If a shape still has no equivalent (splines, free-form surfaces), build it as closely as possible and tell the user which parts are approximated. If that is impossible, say so and offer STEP instead.

## Make it easy to edit (important)
The user edits these files by hand. In 3DJames, selecting an object shows how it was made as a tree in History (its steps, with the shapes cut out of it or merged into it listed under each cut/merge), so the steps must read like a recipe, not a pile of parts.
- **Name every step** (`"name"` on every feature) and **every body specifically**: "Post 1 groove (front)", "Tray T2 M4 hole, rear left" — never just "slot", "hole", "strip". Someone scanning History must see what each cut is for.
- **Keep each object's steps together, in order**: its base shape, then its cutting/adding shapes, then the combine, then fillets. Finish one object before starting the next.
- **One cutter + array, not many copies.** Four identical grooves = one groove shape + `array` (or `mirror` copy), then one subtract. Then changing the groove once changes all of them.
- **Drive repeated sizes from `vars`** with clear names (`grooveW`, `grooveDepth`, `holeD`) so a change is one number.
- Prefer fewer, meaningful steps over many tiny ones. A model with hundreds of unnamed steps is not editable in practice even if it is technically parametric.

## Units and coordinates
- Millimetres. Z is up. The floor is Z = 0.
- A `shape` is built centred on X/Y with its **bottom at Z = 0**, then rotated (`rot`, degrees, about the shape's own centre, Euler order 'ZYX' — prefer single-axis rotations), then moved by `pos`.
- So `pos = [x_centre, y_centre, z_bottom]`.

## File layout (`project.json` inside the .3dj)
```json
{
  "v": 1, "name": "Wall bracket", "seq": 200, "counters": {},
  "vars": [ {"name": "wall", "expr": "4"}, {"name": "pitch", "expr": "slotW + wall"} ],
  "bodies": { "b1": {"name": "Base", "color": "#22B14C"},
              "b3": {"name": "Screw hole", "color": "#8b96a3", "hole": true} },
  "features": [ ...steps in build order... ]
}
```
- **Every body id used anywhere (`body`, `body2`, copy targets) needs an entry in `bodies`** with `name` and `color` — otherwise it shows up grey and unnamed.
- Ids: bodies `b1, b2...`, features `f1, f2...`, all unique. `seq` must be **larger than every number used in any id** (3DJames makes new ids from it).
- Any number field may be an expression string using `vars`: `"slots*pitch + wall"`. Operators `+ - * / % ^ ( )`, functions `sin cos tan` (degrees) `sqrt abs min max round floor ceil`, constant `pi`. Vars may use earlier vars.
- `"hole": true` on a body makes it a hole (grey, cuts when merged).
- Colours are the Windows Paint palette: `#000000 #7F7F7F #880015 #ED1C24 #FF7F27 #FFF200 #22B14C #00A2E8 #3F48CC #A349A4 #FFFFFF #C3C3C3 #B97A57 #FFAEC9 #FFC90E #EFE4B0 #B5E61D #99D9EA #7092BE #C8BFE7`. Defaults: box/sphere `#22B14C`, cylinder `#00A2E8`, tetrahedron `#99D9EA`, wedge `#7092BE`, hexagon `#FFC90E`, cone `#FF7F27`, torus `#FFF200`, pyramid `#B5E61D`, tube `#ED1C24`, extrusion/washer `#C3C3C3`, thread `#7F7F7F`, standoff `#FFC90E`, hole `#8b96a3`.

## Shapes: `{"id","type":"shape","body","kind","p":{...},"pos":[x,y,z],"rot":[rx,ry,rz]}`
| kind | p (defaults) |
|---|---|
| box | `w` (X) 20, `d` (Y) 20, `h` (Z) 20, `round` 0, `roundMode` `all`/`vertical`/`top` |
| cyl | `d` 20, `h` 20 |
| sphere | `d` 20 |
| cone | `d1` bottom 20, `d2` top 0, `h` 20 |
| torus | `D` ring 24, `d` tube 6 |
| wedge | `w` (X) 20, `d` (Y) 20, `h` (Z) 20 |
| pyramid | `n` sides 4 (3 = tetrahedron), `d` base diameter 20, `h` 20 |
| tube | `od` 20, `id` 14, `h` 20 |
| prism | `n` sides 6 (hexagon), `af` width across flats 20, `h` 10 |
| text | `text`, `size` 10, `depth` 3, `font` `sans`/`round` |
| extrusion | `size` `t2020`/`t2040`/`t2060`/`t3030`/`t4040` (T-slot) or `v2020`/`v2040`/`v2060`/`v2080`/`v4040` (V-slot), exact profiles (3030: typical dimensions); `len` 100 |
| washer | `size` M2–M12 (ISO 7089), `id`, `od`, `t` |
| standoff | `size` M2–M5, `od`, `hole`, `h` |
| screwhole (hole) | `size` M2–M8 (ISO 273 clearance), `head` `plain`/`countersunk`/`counterbore`, `d`, `len` 10, `hd` (countersink Ø), `cb`, `hk` (counterbore Ø and depth). Opening at the top |
| nuttrap (hole) | `size` M2–M8, `af`, `m` (nut pocket depth, at the top), `d`, `len` |
| insert (hole) | heat-set insert pocket: `size` M2–M5, `d`, `depth` (M3: 4 × 6) |
| thread | `kind` `bolt`/`nut`/`cutter`, `size` e.g. `M8` (or `custom`), `D` 8, `P` 1.25, `len` 16, `clear` 0.15, `head` `hex`/`round`/`none`, `headH` 5.6, `af` 13, `nutH` 6.4, `chamfer` true |

| sketch | a drawn profile made solid: `loops` (outlines, below), `h` 10, `mode` (leave out = push up; `revolve`, `loft`, `sweep`), `angle` 360 (revolve) |

<!-- parts:start -->
### Ready-made parts (each stands on its base, centred; every number can be an expression)
| kind | label: p (defaults) |
|---|---|
| screw | Screw: `type` "socket" (`socket`/`button`/`flat`/`hex`/`set`), `size` "M3" (`M2`/`M2.5`/`M3`/`M4`/`M5`/`M6`/`M8`/`M10`), `len` 10, `d` 3, `dk` 5.5, `k` 3, `s` 2.5 |
| nut | Nut: `type` "regular" (`regular`/`nylock`/`thin`), `size` "M3" (`M2`/`M2.5`/`M3`/`M4`/`M5`/`M6`/`M8`/`M10`/`M12`), `af` 5.5, `m` 2.4, `d` 3 |
| bearing | Bearing: `size` "608" (`608`/`623`/`624`/`625`/`626`/`688`/`6000`/`6001`/`6002`/`6200`/`6201`/`6202`/`6800`/`F623`/`F624`/`F625`/`F608`/`F688`/`LM6UU`/`LM8UU`/`LM10UU`/`LM12UU`), `id` 8, `od` 22, `w` 7, `fd` 0, `ft` 0 |
| pin | Dowel pin: `d` 3, `len` 12 |
| rod | Smooth rod: `d` 8, `len` 100 |
| magnet | Round magnet: `size` "6x3" (`3x2`/`5x2`/`6x2`/`6x3`/`8x2`/`8x3`/`10x2`/`10x3`/`10x5`/`12x3`/`15x3`/`20x3`), `d` 6, `h` 3 |
| hexstandoff | Hex standoff: `size` "M3" (`M2`/`M2.5`/`M3`/`M4`), `len` 10, `af` 5, `d` 3, `male` false, `stud` 6 |
| gfbaseplate | Gridfinity baseplate: `nx` 3, `ny` 3, `floor` 0, `magnets` false |
| gfbin | Gridfinity bin: `nx` 2, `ny` 1, `nz` 3, `wall` 1.2, `lip` true, `magnets` false, `divx` 1, `divy` 1 |
| boardhook | Wall hook: `style` "pegboard" (`pegboard`/`skadis`), `armLen` 40, `armW` 10, `armT` 4, `lipH` 15, `plateT` 4, `pegD` 6, `spacing` 25.4, `pegLen` 10, `pegs` 2, `slotW` 5, `board` 5, `tabClear` 0.3, `tabGap` 40 |
| drawerdivider | Drawer divider: `len` 200, `h` 60, `t` 2, `slots` 3, `depth` 0.5, `clear` 0.25, `slotsOn` "top" (`top`/`bottom`) |
| lidbox | Box with lid: `part` "box" (`box`/`lid`), `style` "press" (`press`/`sliding`/`hinged`), `w` 80, `d` 60, `h` 40, `wall` 2, `round` 4, `clear` 0.3, `knuckles` 5, `pin` 2 |
| keyhole (hole) | Keyhole slot: `head` 9, `shank` 4.5, `slot` 9, `depth` 5, `pocket` 3 |
| screwtab | Screw tab: `w` 20, `len` 30, `t` 3, `hole` 4.5, `csk` 9 |
| frenchcleat | French cleat: `part` "wall" (`wall`/`item`), `len` 150, `h` 40, `t` 10, `holes` 3 |
| cableclip | Cable clip: `cable` 6, `wall` 1.6, `len` 10, `gap` 0.7, `hole` 3.4, `base` 2 |
| zipanchor | Zip-tie anchor: `tie` 4.8, `tieT` 1.4, `padW` 22, `padD` 14, `t` 2.4, `hole` 3.4 |
| grommet | Desk grommet: `hole` 60, `thick` 25, `wall` 2.5, `flange` 6, `flangeT` 3, `clear` 0.4, `slot` false |
| chainlink | Cable-chain link: `inW` 30, `inH` 12, `t` 3, `pitch` 20, `pin` 3, `clear` 0.3 |
| boardposts | Board standoffs: `board` "pi4" (`pi4`/`pizero`/`pico`/`uno`/`mega`/`custom`), `hx` 58, `hy` 49, `h` 6, `od` 6, `pilot` 0, `pilotDepth` 5, `plate` 2, `margin` 3 |
| boardholes (hole) | Board mounting holes: `board` "pi4" (`pi4`/`pizero`/`pico`/`uno`/`mega`/`custom`), `hx` 58, `hy` 49, `d` 0, `len` 10 |
| fanmount | Fan mount plate: `size` "40" (`25`/`30`/`40`/`50`/`60`/`70`/`80`/`92`/`120`/`140`), `side` 40, `spacing` 32, `screw` 3.4, `open` 37, `t` 3, `round` 3 |
| fanholes (hole) | Fan holes: `size` "40" (`25`/`30`/`40`/`50`/`60`/`70`/`80`/`92`/`120`/`140`), `spacing` 32, `screw` 3.4, `open` 37, `len` 4 |
| ptfehole (hole) | PTFE push-fit hole: `fit` "PC4-M10" (`PC4-M5`/`PC4-M6`/`PC4-M10`/`PC6-M10`/`PC6-M12`), `len` 15, `depth` 8, `tap` 0, `bore` 0 |
| filamentguide | Filament guide: `bore` 2.4, `len` 20, `od` 8, `flangeD` 20, `flangeT` 3, `funnel` 2.5, `hole` 3.4 |
| spoolaxle | Spool axle: `d` 8, `len` 120, `flangeD` 75, `flangeT` 4, `seatD` 54, `seatLen` 25 |
| bearingmount | Bearing mount: `bearing` "608" (`608`/`623`/`624`/`625`/`626`/`688`/`6000`/`6001`/`6002`/`6200`/`6201`/`6202`/`6800`/`F623`/`F624`/`F625`/`F608`/`F688`/`LM6UU`/`LM8UU`/`LM10UU`/`LM12UU`), `clear` 0.15, `wall` 4, `base` 4, `hole` 3.4 |
| bearingpocket (hole) | Bearing pocket: `bearing` "608" (`608`/`623`/`624`/`625`/`626`/`688`/`6000`/`6001`/`6002`/`6200`/`6201`/`6202`/`6800`/`F623`/`F624`/`F625`/`F608`/`F688`/`LM6UU`/`LM8UU`/`LM10UU`/`LM12UU`), `clear` 0.15, `len` 12 |
| gt2pulley | GT2 pulley: `teeth` 20, `bore` 5, `flat` 0, `belt` 6.5, `hubD` 16, `hubH` 8, `setscrew` true |
| shaftcollar | Shaft collar: `style` "set" (`set`/`clamp`), `bore` 8, `od` 18, `w` 10, `screw` 3.4 |
| vwheel | V-slot wheel: `size` "standard" (`standard`/`mini`/`custom`), `od` 23.9, `w` 10.2, `vdepth` 2.6, `lip` 1, `bore` 5, `seat` 16, `seatDepth` 5 |
| footpocket (hole) | Foot pocket: `d` 12, `depth` 3, `screw` 0, `len` 10 |
| levelfoot | Leveling foot: `baseD` 30, `baseH` 5, `dome` 3, `stemD` 8, `stemLen` 25 |
| hinge | Hinge: `style` "inplace" (`inplace`/`pin`), `len` 40, `leaf` 22, `t` 3, `d` 8, `pin` 3, `knuckles` 5, `gap` 0.4, `clear` 0.3, `screws` 2, `hole` 3.4 |
| dovetail | Dovetail tail: `len` 30, `w` 14, `h` 6, `angle` 15, `base` 3 |
| dovetailslot (hole) | Dovetail slot: `len` 30, `w` 14, `h` 6, `angle` 15, `clear` 0.2 |
| peg | Peg: `d` 8, `len` 12, `chamfer` 1, `baseD` 16, `baseH` 3 |
| pegsocket (hole) | Peg socket: `d` 8, `depth` 12, `clear` 0.2, `chamfer` 0.8 |
| balljoint | Ball joint: `d` 14, `stem` 6, `stemLen` 14, `wall` 3, `clear` 0.35, `postD` 10, `postLen` 8 |
| ujoint | Universal joint: `size` 14, `pin` 4, `armT` 4, `armW` 12, `clear` 0.4, `shaft` 8, `shaftLen` 20 |
| shafthole (hole) | Shaft hole: `type` "d" (`d`/`dd`/`keyway`/`round`), `d` 5, `len` 12, `flat` 0.5, `kw` 2, `kd` 1, `clear` 0.1 |
| boss | Screw boss: `od` 8, `h` 12, `hole` 2.5, `depth` 8, `ribs` 4, `ribT` 1.6, `ribH` 0.7, `ribL` 8 |
| rib | Rib (gusset): `w` 20, `h` 20, `t` 3 |
| knob | Knob: `style` "knurl" (`knurl`/`scallop`/`round`), `d` 30, `h` 16, `teeth` 20, `depth` 1.5, `bore` 6, `flat` 0, `trapAF` 0, `trapH` 3, `setscrew` false |
| thumbscrew | Thumbscrew: `head` "wing" (`wing`/`knurl`/`hex`), `hd` 30, `hh` 8, `d` 5, `len` 20 |
| drawerpull | Drawer pull: `spacing` 96, `barD` 12, `reach` 30, `postD` 10, `hole` 3.3, `holeDepth` 15 |
| snapfit | Snap-fit clip: `w` 10, `len` 15, `t` 1.6, `hook` 1.2, `hookH` 2.5, `baseD` 8, `baseH` 4 |
| tolerancetest | Tolerance test: `d` 8, `n` 6, `step` 0.1, `t` 4, `pegLen` 6 |
| gear | Gear: `type` "spur" (`spur`/`helical`/`bevel`), `m` 1.5, `z` 20, `w` 10, `pa` 20, `helix` 20, `herring` false, `mate` 40, `bore` 5, `flat` 0, `hubD` 0, `hubH` 0 |
| rack | Gear rack: `m` 1.5, `teeth` 15, `w` 10, `base` 5, `pa` 20 |
| worm | Worm: `m` 1.5, `starts` 1, `len` 30, `pitchD` 14, `hand` "right" (`right`/`left`), `bore` 5, `flat` 0 |
| stock | Profile: `shape` "tube" (`tube`/`ibeam`/`cchannel`/`angle`/`tbeam`/`flat`), `w` 40, `d` 40, `t` 3, `tw` 3, `len` 200 |
| cornerbracket | Corner bracket: `w` 20, `armA` 25, `armB` 25, `t` 3, `hole` 5.5, `gusset` true |
| tnut | T-nut: `series` "2020" (`2020`/`3030`), `thread` "M5" (`M3`/`M4`/`M5`/`M6`/`M8`), `w` 9.8, `len` 10, `t` 4.2, `hole` 4.2 |
| woodscrew | Wood or sheet-metal screw: `type` "wood" (`wood`/`pan`/`sheet`), `size` "4" (`2.5`/`3`/`3.5`/`4`/`4.5`/`5`/`6`), `len` 30, `d` 4, `dk` 8, `k` 2.8 |
| rivet | Pop rivet: `size` "4" (`3.2`/`4`/`4.8`), `d` 4, `len` 8, `flangeD` 8, `flangeT` 0.8, `bore` 2 |

Mark the bodies of parts shown as `(hole)` with `"hole": true`. Moving parts (hinge, ball joint, universal joint, tolerance test) are separate solids with a gap: do not merge them with anything touching the gap. `gear` types: `spur`, `helical`, `bevel`. Part sizes with a standard list (fans, boards, bearings, fittings) fill in their numbers when you pick one in 3DJames; in a project, give every number.
<!-- parts:end -->

### Sketches (`kind: "sketch"`)
A sketch is a 2D drawing (mm, x right, y up) that the user can reopen and edit in 3DJames' sketch board (Properties > Edit sketch). Use it for any custom profile instead of approximating with primitives.
- `p.loops` is a list of:
  - closed outline `{"type":"poly","pts":[[x,y],...],"bulge":[...],"round":[...]}` (at least 3 points). `bulge[i]` makes side i (point i to point i+1, the last side back to point 0) an arc: `bulge = tan(sweep/4)`, positive bends counter-clockwise, 0 = straight; `1` is a half circle. `round[i]` rounds corner i with that radius (leave out `bulge`/`round` when not used).
  - circle `{"type":"circle","c":[x,y],"r":5}`
  - helper line `{"type":"line","pts":[[x,y],[x,y]]}`: a guide, never solid (and the path for `sweep`).
  - unfinished line `{"type":"open","pts":[[x,y],...],"bulge":[...]}`: lines the user still has to close. Never solid; the sketch board shows its loose ends in orange so they can carry on drawing from them and close them. Only write these when the user asks for a partly drawn sketch; everything else should be closed `poly` outlines.
- Outlines inside other outlines are holes (inside a hole again: solid). Outlines that overlap are joined.
- Push up (no `mode`): extruded `h` mm.
- `"mode":"revolve"`: spun 360° (or `angle`) around the drawing's y axis (the green line). Draw it at x ≥ 0: x is the radius, y the height. Example cup wall: `pts [[20,0],[22,0],[22,40],[20,40]]`.
- `"mode":"loft"`: exactly two closed outlines, first = bottom, second = top, `h` apart. `"ruled": true` for straight sides.
- `"mode":"sweep"`: one profile (closed outline, holes allowed) carried along a path of `line` helper lines joined end to end (a line with `"bulge":[b]` bends).
- Placement: the solid is centered (X/Y) on the middle of its closed outlines with its bottom at Z = 0, then `pos`/`rot` like any shape. For a revolve the axis stays at the shape's X/Y centre.
- Leave out `rules` (the user adds rules like Flat or Parallel themselves in 3DJames).

For the hardware kinds always give every number (copy the standard values above from the size), and mark screwhole / nuttrap / insert bodies `"hole": true`.
A shape may also have `"stretch": [sx, sy, sz]` (multipliers along its own axes) to make ovals; leave it out normally.

Threads are meshes: anything merged with one becomes a mesh (no fillets/STEP after). Do threads last. For a threaded hole: a `thread` with `kind: "cutter"` in a body marked `hole`, then subtract it.
Sizes M2–M30, #6-32, #8-32, #10-24, 1/4"-20, 5/16"-18, 3/8"-16, 1/2"-13. Always give D, P, af, headH, nutH too (D/P from the standard; headH ≈ 0.7·D, nutH ≈ 0.8·D, af = hex size).

## Other steps
- **combine** `{"type":"combine","op":"union"|"subtract"|"intersect","body":"b1","tools":["b2","b3"]}` — result stays in `body`; tool bodies are used up (don't reference them later). In a union, tools marked `hole` are cut.
- **copy** `{"type":"copy","src":"b1","body":"b7","d":[dx,dy,dz]}` — new body `b7` (add it to `bodies`).
- **move** `{"type":"move","body":"b1","m":[16 numbers]}` — 4×4 column-major matrix (three.js order): plain shift = `[1,0,0,0, 0,1,0,0, 0,0,1,0, dx,dy,dz,1]`. For primitives, prefer editing `pos`/`rot` instead.
- **array** `{"type":"array","body":"b2","kind":"linear","n":4,"dx":64,"dy":0,"dz":0}` — n total copies (2–200), merged into the body. Circular: `"kind":"circular","n":6,"angle":360,"cx":0,"cy":0` (around a vertical axis).
- **mirror** `{"type":"mirror","body":"b1","axis":"x"|"y"|"z","copy":true,"side":"max"|"min"}` — `copy:true` adds a mirrored copy against that side of its bounding box (merged in); `copy:false` flips in place.
- **fillet / chamfer** `{"type":"fillet","body":"b1","edges":[{"nc":[1,0.5,1],"d":[0,1,0]}],"r":3}` — each edge: `nc` = edge midpoint as a 0–1 fraction of the body's bounding box *at that step*, `d` = edge direction. Example: on a box, the top edge along Y at the +X side is `nc [1,0.5,1]`, `d [0,1,0]`. Matches within 0.2 of the box size, so pick edges that are clearly distinct. For simple boxes prefer `round` + `roundMode`.
- **shell** (hollow) `{"type":"shell","body":"b1","faces":[{"nc":[0.5,0.5,1],"d":[0,0,1]}],"t":2}` — faces listed are removed (open top); `faces: []` hollows fully closed. Face ref: `nc` = face centre fraction, `d` = outward normal.
- **extrude** on a face `{"type":"extrude","body":"b1","face":{nc,d},"prof":"rect"|"circle"|"poly"|"slot","w":10,"h":10,"d":10,"n":6,"u":0,"v":0,"depth":5,"mode":"add"|"cut"}` — `u,v` offset from the face centre. A heat-set insert pocket is a `circle` cut with the insert's `d` and `depth`.
- **split** `{"type":"split","body":"b1","off":0,"roll":0,"pitch":0,"yaw":0,"keep":"above"|"below"|"both","body2":"b8"}` — plane through the body's centre, normal +Z rotated by roll/pitch/yaw degrees, shifted `off` along the normal. `body2` (needed for `both`) gets the upper part.
- **pushpull** `{"type":"pushpull","body":"b1","face":{nc,d},"d":5}` — moves a flat face along its normal: positive adds material, negative removes it.
- **delete** `{"type":"delete","body":"b5"}`.
- Any step may have `"name"` (shown in History) or `"suppressed": true`.

Positioning tip: when stacking (a wall on a base), overlap by 0.01 (`"pos":[x,y,"wall - 0.01"]`) so merges fuse cleanly.

## Checker (run before delivering)
```python
import json, re, sys, collections
d = json.load(open(sys.argv[1])); errs = []
# parts:kinds:start
KINDS = {'box','cyl','sphere','cone','torus','wedge','pyramid','tube','prism','text','thread','extrusion','washer','standoff','screwhole','nuttrap','insert','sketch','screw','nut','bearing','pin','rod','magnet','hexstandoff','gfbaseplate','gfbin','boardhook','drawerdivider','lidbox','keyhole','screwtab','frenchcleat','cableclip','zipanchor','grommet','chainlink','boardposts','boardholes','fanmount','fanholes','ptfehole','filamentguide','spoolaxle','bearingmount','bearingpocket','gt2pulley','shaftcollar','vwheel','footpocket','levelfoot','hinge','dovetail','dovetailslot','peg','pegsocket','balljoint','ujoint','shafthole','boss','rib','knob','thumbscrew','drawerpull','snapfit','tolerancetest','gear','rack','worm','stock','cornerbracket','tnut','woodscrew','rivet'}
# parts:kinds:end
TYPES = {'shape','combine','copy','move','array','mirror','fillet','chamfer','shell','extrude','split','delete','pushpull'}
names = [v['name'] for v in d.get('vars', [])]
ids = [f['id'] for f in d['features']]
if len(ids) != len(set(ids)): errs.append('duplicate feature ids')
nums = [int(x[1:]) for x in ids + list(d['bodies']) if re.fullmatch(r'[bf]\d+', x)]
if nums and d.get('seq', 0) <= max(nums): errs.append(f"seq must be > {max(nums)}")
alive = set()
def expr(v, where):
    if isinstance(v, str):
        for w in re.findall(r'[A-Za-z_]\w*', v):
            if w not in names and w not in {'sin','cos','tan','sqrt','abs','min','max','round','floor','ceil','pi','PI'}: errs.append(f'{where}: unknown name {w}')
for f in d['features']:
    w = f"{f['id']} ({f['type']})"
    if f['type'] not in TYPES: errs.append(w + ': unknown type'); continue
    for k, v in f.items():
        if k == 'p':
            for kk, x in v.items():
                if kk in ('text','kind','head','font','roundMode','size','mode','loops','rules','ruled','flip','off'): continue
                expr(x, w)
            if f.get('kind') == 'sketch':
                L = v.get('loops', [])
                for i, l in enumerate(L):
                    t = l.get('type')
                    if t not in ('poly','circle','line','open'): errs.append(f'{w}: loop {i} has unknown type {t}')
                    elif t == 'poly' and not (len(l['pts']) >= 3 or (len(l['pts']) == 2 and any(l.get('bulge', [])))): errs.append(f'{w}: loop {i} needs 3+ points')
                    elif t == 'circle' and not (l.get('r', 0) > 0): errs.append(f'{w}: circle {i} needs r > 0')
                    elif t in ('line','open') and len(l.get('pts', [])) < 2: errs.append(f'{w}: line {i} needs 2+ points')
                solid = [l for l in L if l.get('type') in ('poly','circle')]
                if not solid: errs.append(f'{w}: no closed outline (open and helper lines are never solid)')
                if v.get('mode') == 'loft' and len(solid) != 2: errs.append(f'{w}: loft needs exactly two closed outlines')
                if v.get('mode') == 'sweep' and not any(l.get('type') == 'line' for l in L): errs.append(f'{w}: sweep needs a path of helper lines')
                if v.get('mode') == 'revolve' and any(min(q[0] for q in l.get('pts', [l.get('c', [0])])) < -0.05 for l in solid if l['type'] == 'poly'): errs.append(f'{w}: revolve outline must stay at x >= 0')
        elif k in ('pos','rot','d') and isinstance(v, list): [expr(x, w) for x in v]
        elif k in ('r','t','n','dx','dy','dz','off','roll','pitch','yaw','depth','angle','cx','cy','u','v','w','h'): expr(v, w)
    new = [f['body']] if f['type'] in ('shape','copy') else []
    if f['type'] == 'split' and f.get('keep') == 'both': new.append(f.get('body2'))
    if f['type'] == 'shape' and f.get('kind') not in KINDS: errs.append(w + ': unknown kind')
    if f['type'] == 'copy' and f['src'] not in alive: errs.append(w + f": {f['src']} not available")
    for b in [f['body']] + f.get('tools', []):
        if f['type'] not in ('shape','copy') and b not in alive: errs.append(w + f': {b} does not exist (yet) or was used up')
    for b in dict.fromkeys(new + [f['body']] + f.get('tools', [])):
        if b and b not in d['bodies']: errs.append(w + f': {b} missing from "bodies"')
    alive.update(b for b in new if b)
    if f['type'] == 'combine': alive.difference_update(f.get('tools', []))
    if f['type'] == 'delete': alive.discard(f['body'])
unnamed = [f['id'] for f in d['features'] if not f.get('name')]
if unnamed: errs.append(f"{len(unnamed)} steps have no name (e.g. {', '.join(unnamed[:5])})")
dup = [n for n, c in collections.Counter(b['name'] for b in d['bodies'].values()).items() if c > 1]
if dup: errs.append('body names used more than once, make them specific: ' + ', '.join(dup[:8]))
print('\n'.join(errs) or f"OK: {len(ids)} steps, {len(alive)} objects at the end")
```
The checker catches structure mistakes only. Geometry problems (a fillet too big, objects not touching) show in 3DJames as a red problem on that step in History, which the user can click to edit. If you can reach the user's computer, ask them to open the file and say whether anything is flagged.