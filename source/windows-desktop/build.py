"""Build the native Windows host and installer using pinned, locally downloaded tools."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, urllib.request, zipfile

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--app-root', type=Path, default=ROOT.parents[1])
parser.add_argument('--output', type=Path, default=ROOT/'release')
parser.add_argument('--tools', type=Path, default=ROOT/'build/deps')
parser.add_argument('--host-only', action='store_true')
args = parser.parse_args()
APP = args.app_root.resolve()
BUILD = ROOT/'build'
DEPS = args.tools.resolve()
PAYLOAD = BUILD/'payload'
OUTPUT = args.output.resolve()
for p in (BUILD, DEPS, PAYLOAD, OUTPUT): p.mkdir(parents=True,exist_ok=True)

def download(url, dest):
    if not dest.exists():
        req = urllib.request.Request(url, headers={'User-Agent':'3DJames-build/0.13.0'})
        with urllib.request.urlopen(req,timeout=120) as r: dest.write_bytes(r.read())
    print(dest.name, hashlib.sha256(dest.read_bytes()).hexdigest(),flush=True)

def unpack(package, dest):
    if not dest.exists():
        with zipfile.ZipFile(package) as z: z.extractall(dest)

download('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4258.31/microsoft.web.webview2.1.0.4258.31.nupkg',DEPS/'webview2.zip')
download('https://api.nuget.org/v3-flatcontainer/tools.innosetup/6.7.3/tools.innosetup.6.7.3.nupkg',DEPS/'inno.zip')
download('https://go.microsoft.com/fwlink/p/?LinkId=2124703',DEPS/'MicrosoftEdgeWebview2Setup.exe')
unpack(DEPS/'webview2.zip',DEPS/'webview2')
unpack(DEPS/'inno.zip',DEPS/'inno')

lib = DEPS/'webview2/lib/net462'
for name in ('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll'):
    shutil.copy2(lib/name,PAYLOAD/name)
shutil.copy2(DEPS/'webview2/runtimes/win-x64/native/WebView2Loader.dll',PAYLOAD/'WebView2Loader.dll')
shutil.copy2(APP/'source/assets/3DJames.ico',PAYLOAD/'3DJames.ico')
shutil.copy2(ROOT/'3DJames.exe.config',PAYLOAD/'3DJames.exe.config')
shutil.copy2(APP/'LICENSE.txt',PAYLOAD/'LICENSE.txt')
shutil.copy2(ROOT/'README.txt',PAYLOAD/'README.txt')
if (DEPS/'webview2/LICENSE.txt').exists(): shutil.copy2(DEPS/'webview2/LICENSE.txt',PAYLOAD/'WebView2-SDK-LICENSE.txt')

assets = PAYLOAD/'app'
assets.mkdir(exist_ok=True)
shutil.copy2(APP/'3DJames.html',assets/'3DJames.html')
for name in ('icons','licenses','Help'):
    if (APP/name).exists(): shutil.copytree(APP/name,assets/name,dirs_exist_ok=True)

compiler = Path(os.environ.get('WINDIR',r'C:\Windows'))/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
refs=['System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll',str(lib/'Microsoft.Web.WebView2.Core.dll'),str(lib/'Microsoft.Web.WebView2.WinForms.dll')]
cmd=[str(compiler),'/nologo','/target:winexe','/platform:x64','/optimize+', '/out:'+str(PAYLOAD/'3DJames.exe'), '/win32icon:'+str(PAYLOAD/'3DJames.ico'), '/win32manifest:'+str(ROOT/'app.manifest')]
cmd += ['/reference:'+r for r in refs]+[str(ROOT/'Program.cs')]
subprocess.run(cmd,check=True)
if args.host_only:
    print('BUILT HOST', PAYLOAD/'3DJames.exe', flush=True)
    raise SystemExit(0)

# The installer carries the complete app source, including the native host and build recipe.
with zipfile.ZipFile(PAYLOAD/'3DJames-Source.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in (APP/'source').rglob('*'):
        if not p.is_file(): continue
        rel=p.relative_to(APP/'source')
        if any(x in ('node_modules','dist','local','build','release','__pycache__','windows-desktop') for x in rel.parts): continue
        z.write(p,'source/'+rel.as_posix())
    for p in ROOT.rglob('*'):
        if p.is_file() and not any(x in ('build','release','__pycache__') for x in p.relative_to(ROOT).parts):
            z.write(p,'source/windows-desktop/'+p.relative_to(ROOT).as_posix())

# Keep bootstrapper in this predictable location for the installer script.
localdeps=BUILD/'deps'; localdeps.mkdir(exist_ok=True)
if DEPS != localdeps.resolve(): shutil.copy2(DEPS/'MicrosoftEdgeWebview2Setup.exe',localdeps/'MicrosoftEdgeWebview2Setup.exe')
iscc=DEPS/'inno/tools/ISCC.exe'
subprocess.run([str(iscc),'/DBuildRoot='+str(BUILD),'/DOutputRoot='+str(OUTPUT),str(ROOT/'installer.iss')],check=True)
installer=OUTPUT/'3DJames-0.13.0-Windows-Setup.exe'
print('BUILT',installer,installer.stat().st_size,flush=True)
print('SHA256',hashlib.sha256(installer.read_bytes()).hexdigest(),flush=True)
