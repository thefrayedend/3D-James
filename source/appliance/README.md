# 3DJames box

Turns an Orange Pi Zero 4 into a **3DJames server** for your home network:

* **http://3djames.local**: everyone signs in and uses 3DJames in their browser (PC, Mac, tablet, phone).
  Open and Save show their own folders, plus a shared folder if the admin allows it.
* **http://3djames.local:8080**: the admin page. People and passwords, where files are kept (on the
  box's SD card, a USB drive, or your NAS over SMB or NFS), the shared folder, app updates, Wi-Fi.

The 3DJames app itself is one file, `3DJames.html`. Updating it never needs a new SD card: upload the new
file on the admin page (App tab), or switch on the update folder there and copy the file to
`\\3djames\3DJames-update` from any Windows PC.

## Get the SD card image

Releases → **Latest SD card image** → `3djames-orangepi-zero4.img.xz`. Write it to a micro-SD card with
[balenaEtcher](https://etcher.balena.io) or Raspberry Pi Imager. Then follow `READ-ME-FIRST.txt` on the
card's small `3DJAMES` drive.

## Build it yourself

Actions → **Build SD card image** → Run workflow (about 30 to 60 minutes). It needs the Orange Pi Zero 4
base image in a release called `base-image` (this project's, or another project's named when you run it).

## What is where

| Folder | What |
|---|---|
| `server/` | The 3DJames server (Python 3, nothing to install). Try it on any PC: `python server/3djames_server.py --data testdata --app-port 8090 --admin-port 8091 --bundled-app path/to/3DJames.html` |
| `appliance/build-image.sh` | Turns the stock board image into the 3DJames box image |
| `appliance/customize.sh` | Runs inside the image while it is built (packages, users, services) |
| `appliance/rootfs/` | Files copied into the image (services, the root helper `3djames-helper`) |
| `appliance/setup-partition/` | What is on the card's `3DJAMES` drive (settings file, quick start) |

Plain http on purpose: everything stays on your home network.

3DJames and this server are free software under the GNU GPL, version 3 or later.
