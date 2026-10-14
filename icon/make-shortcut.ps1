# Puts a "3DJames" shortcut with the 3DJames icon on the desktop. Run by "Make desktop shortcut.cmd".
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$edge = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $edge) { $edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe' }
$url = ([Uri](Join-Path $root '3DJames.html')).AbsoluteUri
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) '3DJames.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $edge
$s.Arguments = "--app=`"$url`" --window-size=1440,900"
$s.IconLocation = Join-Path $root 'icon\3DJames.ico'
$s.WorkingDirectory = $root
$s.Description = '3DJames 3D modeler'
$s.Save()
Write-Host ''
Write-Host '  Done. 3DJames is on your desktop with its own icon.'
Write-Host '  Tip: right-click it > Pin to taskbar (or Pin to Start).'
Write-Host ''
