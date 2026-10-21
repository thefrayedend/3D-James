# Windows desktop build

The native WinForms host uses the installed Microsoft WebView2 runtime. Web content
is served from the local `app` directory at `https://app.3djames.local`, with no web
server and no remote copy of the modeling app.

From the original 3DJames project folder, on 64-bit Windows with Python 3:

```text
python source/windows-desktop/build.py --app-root . --output release
```

The build script downloads the WebView2 SDK 1.0.4258.31, the Inno Setup compiler
6.7.3, and Microsoft's Evergreen runtime bootstrapper. It uses the Windows .NET
Framework C# compiler, so a separate .NET SDK is not needed. The SDK/installer
packages are cached in `build/deps`. Tool license terms are included in the
downloaded packages; review the compiler license before commercial use.

The installer includes the app, custom icon assets, licenses, help images, native
host, WebView2 SDK assemblies, and a complete source archive. It installs WebView2
from Microsoft only if the runtime is absent. The modeler then works offline.

The unsigned installer offers machine-wide installation into Program Files or
account-only installation into LocalAppData/Programs. Both modes add Start menu
shortcuts and an Installed apps entry. A desktop shortcut is optional. Uninstall
preserves saved projects and `%LOCALAPPDATA%/3DJames/WebView2`.

## Validation

`test_payload.py` needs Playwright and Microsoft Edge. It serves the packaged
assets under the desktop origin, checks that the file/folder picker APIs exist,
and verifies a .3dj save/open round trip, PNG preview, 3MF, and STL export.

The host supports `--smoke-test report.json --profile-dir test-profile` to run an
offscreen native smoke test. `--test-suite suite.js` can supply a script defining
`window.__runDesktopTests`; it must return an object with boolean `ok`. These test
arguments are opt-in and are not used by the installed shortcuts.

Before public release, test both actual installation modes, updates, uninstallation,
native dialogs and close prompts on ordinary Windows accounts. The build environment
used for this beta blocks writes to the Installed apps registry, so a complete
install/uninstall cycle could not be verified there. The offscreen WebView2 test
also stalled after controller initialization; visible-window startup needs testing.

## References

- [Microsoft: local content and virtual hosts](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content)
- [Microsoft: WebView2 runtime distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Inno Setup: installation scope](https://jrsoftware.org/ishelp/topic_setup_privilegesrequiredoverridesallowed.htm)
- [Inno Setup: installation directories](https://jrsoftware.org/ishelp/topic_setup_defaultdirname.htm)
