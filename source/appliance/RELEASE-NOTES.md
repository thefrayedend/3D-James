**3DJames box for the Orange Pi Zero 4**

1. Download `3djames-orangepi-zero4.img.xz` below and write it to a micro-SD card with balenaEtcher
   or Raspberry Pi Imager (no need to unzip it first).
2. Optional: open the card's `3DJAMES` drive on your PC and fill in your Wi-Fi in `3djames-config.txt`
   (or plug the board into your router with a cable).
3. Put the card in the board and power it up. After about 2 minutes open **http://3djames.local:8080**,
   make your admin account and upload `3DJames.html` (App tab).
4. Everyone uses **http://3djames.local**.

`3djames-server-*.zip` is for the admin page (Network & box > Server program): it updates only the
server program, without a new SD card. App updates (a new `3DJames.html`) go through the App tab.
