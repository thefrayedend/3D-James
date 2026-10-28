# 3DJames

A parametric CAD app for 3D printing, designed to be simple without losing much functionality: start with shapes or
draw your own outlines with exact sizes, and everything stays editable. Runs offline in your browser, as one file.

## Use it

On Windows: download **[3DJames-Setup.exe](3DJames-Setup.exe)** (click it, then the download button) and run it. It installs 3DJames
with a Start menu entry and lets AI apps (Claude, Antigravity) work in the open window.

Or without installing: download **3DJames.html** and open it in Edge or Chrome (or double-click **Open 3DJames.cmd**).
**Make desktop shortcut.cmd** puts an icon on your desktop. Everything you need to know is in the app's Help tab.

## The source

The code is in [`source/`](source): see [`source/BUILDING.md`](source/BUILDING.md) to build and test it
(Node.js and Python: `npm install`, then `python build.py`). `source/server` and `source/appliance` are the
3DJames box (a home server on an Orange Pi), also published at [3djames-pi](https://github.com/thefrayedend/3djames-pi).

## License

GPL-3.0 (see [LICENSE.txt](LICENSE.txt)). The open-source components it is built with, and their licenses, are listed
in [`licenses/`](licenses) and in the app under Help > Licenses and components.
