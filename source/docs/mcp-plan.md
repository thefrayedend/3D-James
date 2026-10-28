# Letting Claude work in the open 3DJames (an "MCP connection") — plan

Status: **step 1 is built** (2026-10-26, 3DJames 0.17.12), with **Gemini** as the main target and Claude also
supported. Steps 2 and 3 are still plans. Not pushed to GitHub.

## What was built (step 1)

- `src/bridge.js`: the app side. Only when 3DJames is opened from a file on this computer (never on the box).
  Asks "Let Gemini work in 3DJames?" on the first job, shows "Gemini can work here · Stop", each change is one Undo
  step with a message, asks before saving over a file.
- `windows-desktop/link/` : `3DJamesLink.exe` (C# 5, built by `build_link.py` with the Windows C# compiler; the
  step guide is `skill/3djames-project/SKILL.md` built in). 17 tools: status, how_to_write_steps, list_projects,
  open_project, new_project, get_project, build, add_steps, change_step, delete_steps, set_vars, set_objects,
  replace_project, undo, picture, make_editable, save_project. Listens on 127.0.0.1:47831 only; a second AI's copy
  hands its jobs to the first with the key in `%LOCALAPPDATA%\3DJames\link.key`; opens 3DJames if it is closed.
- `windows-desktop/link/ai/`: what `tools/ship.py` puts next to `3DJames.html`: `GEMINI.md` (Gemini's
  instructions), `.gemini/settings.json` (Gemini finds the link, 11-minute timeout, trusted), `.mcp.json` (Claude
  Code finds it), `Ask Gemini.cmd` (double-click: installs Gemini CLI the first time if Node.js is there, then
  starts it in the 3DJames folder).
- Tests: `python tests/link.py` (every tool through the real exe and app, Allow / Don't allow / Stop, overwrite
  question, second AI, web sites and wrong keys turned away). Help page "Let an AI help (Gemini or Claude)" with
  pictures from `help/shots/link_shots.py`.
- Checked: Gemini CLI 0.65 connects ("3djames ... Connected") and uses the tools' JSON schemas as they are; real
  Microsoft Edge (what 3DJames.cmd uses) talks to the link. Not checked: a real Gemini conversation (needs the user's
  Google sign-in) and Claude Code (its command-line tool is not on this PC).

## Why Gemini (and not ChatGPT or Copilot)

Gemini CLI is free with a Google account, runs on this PC and can use local MCP helpers like 3DJames Link. The free
ChatGPT and Microsoft Copilot apps cannot use a helper on your own computer (as far as I know, ChatGPT's connectors need a paid plan
and reach servers on the internet, not your PC). GitHub Copilot can, but only inside VS Code.

---

The original plan follows.

## In one paragraph

Today Claude writes a `.3dj` file blind and you open it to see whether it worked. With this connection,
Claude would work *inside the 3DJames window you have open*: open a project, add or change steps, press
build, see the errors, the volume and the size, look at a picture of the model, fix what is wrong, and save.
You watch it happen on screen and every change Claude makes is one Ctrl+Z away. Nothing goes to the internet,
and only this computer (only your Windows account) can connect.

## What you could say to Claude

- "Open the Space Pi rack and make the slots 2 mm wider." (Claude changes the variable, rebuilds, checks
  nothing broke, shows you a picture.)
- "Add four M3 screw holes in the corners of the base, 5 mm in from the edges."
- "Why does step 14 fail?" (Claude reads the real error from the app, not a guess.)
- "How heavy is this in PETG?" / "Does it fit in 220 × 220 × 250?" (volume and size from the app.)
- "Make Downloads\bracket.stl editable and tell me how close it came." (runs Make editable, reports the
  "% the same" and the biggest gap, and says which parts stayed meshes.)
- "Save it as Bracket v2 in Projects." / "Show me the front and the top."

## How it works (the short version)

```
Claude  --(talks to)-->  small helper "3DJames Link"  --(this computer only)-->  3DJames window
```

1. **Inside the app** — a new part of 3DJames (`src/bridge.js`) that accepts a short list of jobs: read the
   project, add/change/delete steps, set a variable, build, measure, take a picture, Make editable, save,
   Undo. The steps are the same JSON as in a `.3dj` file (`skill/3djames-project/SKILL.md`), so the skill,
   the file format and this connection all speak one language. It can only do these jobs — not run arbitrary
   code. Each job Claude does is one Undo step and shows a small note ("Claude changed: Slot width").
2. **The helper, "3DJames Link"** — a tiny program shipped with 3DJames that Claude starts by itself when it
   needs it (that is what an MCP server is). It passes jobs to the open window and writes saved projects into
   `Documents\3DJames\Projects` (and nowhere else).
3. **The link between them** — only on this computer, never on the network:
   - In the **Windows desktop app** the window and the helper talk through a Windows "pipe" that only your
     account can open.
   - In the **browser version** (what `3DJames.cmd` opens today) a web page cannot be connected *to*, so the
     page connects *out* to the helper on `127.0.0.1`. The first time in a session 3DJames asks
     **"Let Claude work in this window? Allow / No"**, so nothing else on the computer can take over.

### Where it lives, so you have no terminal steps

- **Ships inside 3DJames.** `3DJames Link.exe` sits next to `3DJames.html` in the 3DJames folder and in the
  Windows installer. It is built with the same Windows C# compiler the desktop app already uses, so it needs
  no Python or Node on your PC.
- **Claude finds it by itself.** A one-line file `.mcp.json` in the 3DJames folder tells Claude Code
  "3DJames Link is here". The first time, Claude asks you once to allow it — one click, then done. For the
  Chat side of the Claude app there is a double-click install file (`3DJames.mcpb`) instead.
- **The 3DJames box (later, step 3).** The box server only stores files; the building happens in the
  browser. So for the box, the same jobs travel through the box to *your own open app tab*, signed in as you,
  using a personal key from the admin page. Other people on the network cannot use it without your key, and
  they can never reach your folders.

## Cost in work

| Step | What you get | Rough size |
|---|---|---|
| 0 (optional, small) | A checker Claude runs on a `.3dj` before handing it to you: real build errors, volume, size, using the real engine without a window (the Make editable tests already do this). | ~½ session |
| 1 | The app side + the helper + `.mcp.json`, for the browser version you use today. Includes tests, the Help page and the "Allow?" question. | ~2 sessions |
| 2 | The same in the Windows desktop app and its installer (note: the desktop app is still on 0.13 and needs bringing up to date anyway). | ~1 session |
| 3 | The box: jobs through the server to your own app tab, with a personal key. | ~1–2 sessions |

Step 1 is where most of the value is. Steps 2 and 3 can wait.

## Risks and how they are handled

- **Someone else controlling your 3DJames.** Only this computer: the link never listens on the network, the
  desktop-app pipe is limited to your Windows account, and the browser version asks "Allow?" first. The box
  version needs your personal key.
- **Claude breaking a project.** Every change is one Undo; Claude never saves over an existing file unless you
  say so (it saves "… (Claude)" copies by default); saved files only go into `Projects`.
- **Only limited jobs.** No "run any code" job, no reading or writing files outside `Projects` (STLs for Make
  editable are read only when you name them).
- **Version drift.** The app and the helper check each other's version and say plainly when one is too old.
- **Unsigned helper.** Like the installer, `3DJames Link.exe` is unsigned, so Windows may show a SmartScreen
  notice once.
- **Claude must be on this PC.** It works with the Claude app on this computer, not with Claude on the web or
  your phone (those cannot reach your PC, which is also what keeps it safe).

## Alternatives already available

- Claude can already click around the open app with "computer use" or Claude in Chrome. It works, but it is
  slow, reads numbers off the screen, and breaks when the layout changes. The connection is exact and fast.
- Step 0 alone gives Claude real build checks with no change to the app at all.

## The question for you

**Shall I build step 1 (Claude works in the open browser 3DJames, this computer only, with an "Allow?"
question)? Yes / No.** Nothing goes to GitHub without your OK.
