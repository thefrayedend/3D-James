3DJames - a parametric 3D modeler for 3D printing
Version 0.17.21
=================================================

Everything runs on your computer. No install, no account, no internet needed.
Use Microsoft Edge or Google Chrome (in Firefox/Safari it opens, but Save windows and folders won't work).

START IT
  Double-click "Open 3DJames.cmd"   - opens 3DJames in its own window.
  Or double-click 3DJames.html      - opens it in your browser.
  Desktop icon: double-click "Make desktop shortcut.cmd" once. It puts a 3DJames shortcut with
  the 3DJames icon on your desktop (right-click it > Pin to taskbar or Pin to Start).
  Keep all these files together in one folder; the shortcut points to this folder.

SAVING
  Ctrl+S saves back to the file you opened. Ctrl+Shift+S (Save as) picks the place and type:
    .3dj  - a 3DJames project (normal choice). Keeps every step editable, plus any imported files.
    3MF   - opens in slicers, and 3DJames still opens it fully editable.
    STL / STEP - the finished shape only, for slicers and other CAD apps.
  Older .json projects still open.
  Backups are made automatically: File menu (top-left) > Backups. File > Save as new version keeps
  named versions inside the project.
  The "Projects" folder is a good home for your projects.

TABLETS AND A 3DJAMES BOX
  3DJames works with fingers and the Apple Pencil too (Help > Tablets and Apple Pencil).
  A 3DJames box (an Orange Pi Zero 4 on your network) serves 3DJames to everyone in the house, with
  sign-in and folders on the box or your NAS: http://3djames.local (Help > 3DJames box).

HELP
  Click the Help tab: a picture guide to every tool (search box at the top left).
  Extra picture guides are in the Help folder.

THE BASICS
  Insert tab: shapes (cube, cylinder, ...), Text, Sketch, and Parts (hardware like screw holes, nut traps,
  heat-set insert holes, aluminum extrusion, and your own saved parts).
  Sketch: draw an outline with exact sizes (lines, arcs, rectangles, circles, rules like Flat or Parallel),
  then push it up, spin it around, loft or sweep it, or cut it in. Lines can stop anywhere and be carried
  on later; lines whose ends meet join up, and an outline is finished once it is closed.
  Mouse: left-drag turns the view, right-drag slides it, the wheel zooms. Double-click an object to fly to it.
  Drag an object to move it; the arrows lift it or slide it; the corner dots size it. Objects snap flush
  against each other. Type exact numbers in the bar at the bottom.
  Object tab: Merge, Subtract (select the cutting object, click Subtract: it is cut out of everything it
  passes through), Intersect, Emboss (raised or sunk text and SVG art), Round edges, Bevel edges, Faces (hollow, shape on a face, push/pull, lay flat,
  heat-set insert pocket), Mirror, Pattern, Split, Group, Align, Duplicate (Ctrl+D repeats your last move).
  View tab: Solid / Wireframe / See-through / X-ray, Look at face, Measure, Ruler, Flat view, Snap,
  printer bed outline.
  History (right panel): select an object to see how it was made, step by step. Click any step to change it.
  Variables: name a number once (like wall = 2) and type its name into any size box.

MY PARTS
  Select an object > Properties > Save to My parts. The first time, pick your "3D Objects" folder
  (C:\Users\<you>\3D Objects); 3DJames keeps your parts there in a "3DJames Parts" folder as .3dj files.
  Insert them into any project from Insert > Parts > My parts.

YOUR OWN BUTTON PICTURES
  See icons\README.txt.

LICENSES
  3DJames itself is free software under the GNU GPL, version 3 or later (see LICENSE.txt).
  You may use, share and change it; copies you share must stay under the GPL, with their source code.
  3DJames is built on open-source projects (OpenCascade, three.js, Manifold and more).
  See Help tab > Licenses and components (bottom left of the Help tab), or the "licenses" folder.
