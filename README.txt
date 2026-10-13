3DJames - a parametric 3D modeler for 3D printing
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
  Backups are made automatically: File menu (top-left) > Backups.
  The "Projects" folder is a good home for your projects.

THE BASICS
  Insert tab: shapes (cube, cylinder, ...), Text, and Parts (hardware like screw holes, nut traps,
  heat-set insert holes, aluminum extrusion, and your own saved parts).
  Mouse: left-drag turns the view, right-drag slides it, the wheel zooms. Double-click an object to fly to it.
  Drag an object to move it; the arrows lift it or slide it; the corner dots size it. Objects snap flush
  against each other. Type exact numbers in the bar at the bottom.
  Object tab: Merge, Subtract (select the cutting object, click Subtract: it is cut out of everything it
  passes through), Intersect, Fillet, Chamfer, Faces (hollow, shape on a face, push/pull, lay flat,
  heat-set insert pocket), Mirror, Pattern, Split, Group, Align, Duplicate (Ctrl+D repeats your last move).
  View tab: Solid / Wireframe / See-through / X-ray, Flat view, Ruler, Snap, printer bed outline.
  History (right panel): select an object to see how it was made, step by step. Click any step to change it.
  Variables: name a number once (like wall = 2) and type its name into any size box.

MY PARTS
  Select an object > Properties > Save to My parts. The first time, pick your "3D Objects" folder
  (C:\Users\<you>\3D Objects); 3DJames keeps your parts there in a "3DJames Parts" folder as .3dj files.
  Insert them into any project from Insert > Parts > My parts.

THE APP CODE
  The "source" folder holds the 3DJames code, in case of changes later
  (build: python3 build.py, tests: python3 tests/run.py). Don't send it along when you share 3DJames.

YOUR OWN BUTTON PICTURES
  See icons\README.txt.

LICENSES
  3DJames is built on open-source projects (OpenCascade, three.js, Manifold and more).
  See Help tab > About / Licenses, or the "licenses" folder.
