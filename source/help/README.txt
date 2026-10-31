3DJames help pictures
=====================
How Help is organised (0.17.0):
  help/pages/<id>.html, one page each; the order and the chapters come from help/pages/contents.json
  (build.py checks every page is listed exactly once). The Help window shows the chapters as fold-out
  groups. Link between pages with <a data-help-topic="<id>">...</a> (tests/help.py checks every link).
  Chapters: Start here, Tutorials, Shapes and objects, Sketching, View measure and files,
  Tablets and the 3DJames box, Reference. Put a new topic in the chapter where someone would look for it.
  Picture scripts that work on Windows: help/shots/*_shots.py (they use help/shots/markup.py).
  basics_shots.py makes spin-1..5, view-tab, history-vars and objects-list.
  mesh_shots.py makes mesh-sketch (the board on the top of an imported STL).

Maintaining Help is required for changes users need to learn (see source/AGENTS.md).
Use screenshots from the real app with captions, alternative text and a worked
example. Check older pages for obsolete instructions and rebuild the HTML.

Current screenshot sources:
  python tests/ui_features.py
  python help/capture_curved_plane.py
  python help/prepare_images.py
  python build.py
  python tests/help.py

The first two commands capture the real app. prepare_images.py retains PNG shots
and makes compact JPEGs in help/img for build.py to embed. Pictures work offline
and can be enlarged in Help. The curved-plane capture also checks that its
example actually removes material. Do not substitute imaginary UI mockups.

Tutorials and About (0.13.0):
  About is help/pages/00-about.html. Tutorials are 12-tutorials through 15-mug.
  JSON templates and editable archives are in help/examples.
  python help/build_examples.py validates models and captures tutorial screenshots.
  Rebuild with python build.py, then run tests/help.py and tests/tutorials.py.
  Templates must remain editable modeling history, rather than flattened meshes.
  Help starts on About each launch and retains its reading position within a run.

Sketch lines (0.14.0):
  python help/shots/lines_shots.py makes lines-1..4 and redraw-1..3 (open lines, joining, the Done
  prompt, taking a side out). New picture scripts should use help/shots/markup.py: it starts the app,
  takes screenshots and draws the red rings, arrows and numbered dots, on Windows as well as Linux.
