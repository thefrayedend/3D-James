3DJames Help
============

The Help tab is built from this folder into 3DJames.html (build.py), so it works offline.

Pages
  help/pages/<id>.html     one page each, starting with its <h1> title
  help/pages/contents.json the chapters and the order of the pages (build.py checks every page is listed once)
  Link to another page with <a data-help-topic="<id>">...</a> (tests/help.py checks every link and picture).
  Chapters: Start here, Tutorials, Shapes and objects, Sketching, View measure and files,
  Tablets and the 3DJames box, Reference. Put a new topic where someone would look for it.

How the pages are written (see source/AGENTS.md)
  Plain words, for someone new to CAD. Say where a tool is (tab > button > menu item), what to click, a small
  worked example, how to finish or cancel, and its limits. Names in bold are exactly what the app shows.
  Every change people need to learn updates Help in the same version.

Pictures (help/img, real screenshots of the app, never mock-ups)
  Every picture is made by a script, so all of them can be taken again when the app changes:
    help/shots/*_shots.py         most pictures; markup.py starts the app at 1.5x and draws the red rings,
                                  arrows and numbered blue dots. Each script's first lines say which pictures it makes.
    help/capture_curved_plane.py  the curved-surface pictures (plane-*), via help/shots/curved-plane
    tests/ui_features.py          tools-ribbon, tools-measure, tools-versions (to dist/*-ui.png), then
    help/prepare_images.py        turns those and the curved-plane shots into JPEGs in help/img
    help/build_examples.py        checks the tutorial examples (help/examples) and takes the tutorial-* pictures
  Retake them all (after python build.py), from source/:
    for f in help/shots/*_shots.py; do (cd help/shots && python $(basename $f)); done
    python help/capture_curved_plane.py && python tests/ui_features.py && python help/prepare_images.py
    python help/build_examples.py
  Then look at every picture (the markup can land in the wrong place when the app's layout changes),
  run python build.py and python tests/help.py.

Tutorial examples
  help/examples/*.json are the editable tutorial projects (real steps, not meshes); build_examples.py checks they
  build and makes their pictures. tests/tutorials.py opens them from Help.
