#!/bin/bash
# =============================================================================
#  3DJames box - SD card image builder
# =============================================================================
#  Turns a stock Debian/Ubuntu server image for the board (e.g. the official Orange Pi Zero 4
#  image, or Armbian) into a ready-to-flash 3DJames box:
#
#    * adds a small Windows-readable "3DJAMES" drive with 3djames-config.txt (Wi-Fi etc.)
#    * installs the 3DJames server (the app on port 80, the admin page on port 8080),
#      Samba (for the optional update folder) and NAS support (SMB and NFS)
#    * enables the services, locks default passwords, grows the SD card on first boot
#
#  Usage (Linux or WSL2, as root):
#    sudo ./build-image.sh --base <image.img | .img.xz | .img.gz | .zip | .7z | https://...>
#         [--app 3DJames.html] [--out out-dir] [--name 3djames-orangepi-zero4] [--grow-mb 1024] [--setup-mb 64]
#         [--skip-customize] [--no-compress]
#  --app is optional: without it, the admin uploads 3DJames.html on the admin page (App tab).
#
#  On an x86-64 PC the chroot step needs qemu-user-static + binfmt (apt install
#  qemu-user-static binfmt-support). On an arm64 machine (e.g. GitHub's ubuntu-24.04-arm
#  runner) it runs natively.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"               # repository root (server/ and appliance/)
BASE="" APP="" OUT="$REPO/out" NAME="3djames-orangepi-zero4" EXTRA_CA=""
GROW_MB=1024 SETUP_MB=64 SKIP_CUSTOMIZE=0 COMPRESS=1

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --app) APP="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --grow-mb) GROW_MB="$2"; shift 2 ;;
    --setup-mb) SETUP_MB="$2"; shift 2 ;;
    --skip-customize) SKIP_CUSTOMIZE=1; shift ;;
    --no-compress) COMPRESS=0; shift ;;
    --extra-ca) EXTRA_CA="$2"; shift 2 ;;   # CA bundle for HTTPS through a company proxy
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
done

say() { echo -e "\n\033[1;32m==>\033[0m $*"; }
die() { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (sudo)"
[ -n "$BASE" ] || die "--base is required (the board's stock server image)"
for t in sfdisk losetup mkfs.vfat mcopy e2fsck resize2fs python3 xz curl rsync partx; do
  command -v "$t" >/dev/null || die "missing tool: $t  (apt install fdisk dosfstools mtools e2fsprogs xz-utils curl rsync python3 util-linux)"
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/3djames-build.XXXXXX")"
MNT="$WORK/root"
LOOP=""
cleanup() {
  set +e
  for m in "$MNT/dev/pts" "$MNT/dev" "$MNT/proc" "$MNT/sys" "$MNT"; do
    mountpoint -q "$m" && umount -l "$m"
  done
  [ -n "$LOOP" ] && losetup -d "$LOOP" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

# ----------------------------------------------------------------------------- inputs
say "Preparing the base image"
SRC="$BASE"
if [[ "$BASE" =~ ^https?:// ]]; then
  SRC="$WORK/$(basename "${BASE%%\?*}")"
  curl -fL --retry 5 -o "$SRC" "$BASE"
fi
[ -f "$SRC" ] || die "base image not found: $SRC"
BASEIMG="$WORK/base.img"
case "$SRC" in
  *.img.xz|*.xz) xz -dc "$SRC" > "$BASEIMG" ;;
  *.img.gz|*.gz) gzip -dc "$SRC" > "$BASEIMG" ;;
  *.zip) python3 - "$SRC" "$BASEIMG" <<'PY'
import sys, zipfile, shutil
z = zipfile.ZipFile(sys.argv[1])
n = max((i for i in z.infolist() if i.filename.lower().endswith('.img')), key=lambda i: i.file_size)
with z.open(n) as s, open(sys.argv[2], 'wb') as d: shutil.copyfileobj(s, d, 16 << 20)
PY
  ;;
  *.7z) command -v 7z >/dev/null || die "7z needed (apt install p7zip-full)"; 7z e -so "$SRC" '*.img' > "$BASEIMG" ;;
  *) cp --sparse=always "$SRC" "$BASEIMG" ;;
esac

[ -f "$REPO/server/3djames_server.py" ] || die "server/3djames_server.py not found next to appliance/"
if [ -n "$APP" ]; then [ -f "$APP" ] || die "app file not found: $APP"; fi

# ----------------------------------------------------------------------------- new layout
say "Building the new partition layout"
# Keep everything in front of the root filesystem (boot loader, any boot partition) byte for
# byte, insert the 3DJAMES drive where the root filesystem started and move the root
# filesystem behind it. The root partition keeps its NUMBER (boot scripts often say "p1"),
# only its position changes; it stays the last partition so it can grow on first boot.
eval "$(python3 - "$BASEIMG" <<'PY'
import json, subprocess, sys
t = json.loads(subprocess.check_output(["sfdisk", "--json", sys.argv[1]]))["partitiontable"]
parts = t["partitions"]
linux = {"83", "0fc63daf-8483-4772-8e79-3d69d8477de4", "b921b045-1df0-41c3-af44-4c6f280d3fae", "69dad710-2ce4-4e3c-b16c-21a1d49abed3"}
cands = [p for p in parts if str(p["type"]).lower() in linux] or parts
root = max(cands, key=lambda p: p["start"])
if root["start"] != max(p["start"] for p in parts):
    sys.exit("root filesystem is not the last partition - unsupported layout")
num = int(''.join(c for c in root["node"][len(sys.argv[1]):] if c.isdigit()))
used = {int(''.join(c for c in p["node"][len(sys.argv[1]):] if c.isdigit())) for p in parts}
setup_num = next(n for n in range(1, 129) if n not in used)
if t["label"] == "dos" and setup_num > 4:
    sys.exit("MBR already has 4 partitions - no room for the settings drive")
print(f'LABEL={t["label"]} ROOT_NUM={num} ROOT_START={root["start"]} ROOT_SIZE={root["size"]} SETUP_NUM={setup_num} SECTOR={t.get("sectorsize", 512)}')
PY
)"
[ "$SECTOR" = 512 ] || die "unexpected sector size $SECTOR"
echo "  table=$LABEL root=p$ROOT_NUM start=$ROOT_START size=$ROOT_SIZE -> settings drive = p$SETUP_NUM"

ALIGN=2048                                      # 1 MiB
SETUP_START=$ROOT_START
SETUP_SECTORS=$(( SETUP_MB * 2048 ))
NEW_ROOT_START=$(( (SETUP_START + SETUP_SECTORS + ALIGN - 1) / ALIGN * ALIGN ))
NEW_ROOT_SIZE=$(( ROOT_SIZE + GROW_MB * 2048 ))
TOTAL=$(( NEW_ROOT_START + NEW_ROOT_SIZE + 2048 ))  # + room for a GPT backup header

IMG="$WORK/$NAME.img"
truncate -s $(( TOTAL * 512 )) "$IMG"
dd if="$BASEIMG" of="$IMG" bs=512 count="$ROOT_START" conv=notrunc,sparse status=none
dd if="$BASEIMG" of="$IMG" bs=512 skip="$ROOT_START" seek="$NEW_ROOT_START" count="$ROOT_SIZE" conv=notrunc,sparse status=none

python3 - "$BASEIMG" "$IMG" "$ROOT_NUM" "$NEW_ROOT_START" "$NEW_ROOT_SIZE" "$SETUP_NUM" "$SETUP_START" "$SETUP_SECTORS" "$LABEL" > "$WORK/table.sfdisk" <<'PY'
import re, subprocess, sys
base, img, rnum, rstart, rsize, snum, sstart, ssize, label = sys.argv[1:]
dump = subprocess.check_output(["sfdisk", "--dump", base], text=True).splitlines()
out, parts = [], {}
for line in dump:
    if line.startswith(base):
        name, spec = line.split(":", 1)
        n = int(re.search(r"(\d+)$", name.strip()).group(1))
        parts[n] = spec.strip()
    elif line.startswith(("last-lba", "first-lba")):
        continue  # recomputed for the bigger image
    elif line.startswith("device:"):
        out.append(f"device: {img}")
    else:
        out.append(line)
spec = parts[int(rnum)]
spec = re.sub(r"start=\s*\d+", f"start={rstart}", spec)
spec = re.sub(r"size=\s*\d+", f"size={rsize}", spec)
parts[int(rnum)] = spec
if label == "gpt":
    parts[int(snum)] = f'start={sstart}, size={ssize}, type=EBD0A0A2-B9E5-4433-87C0-68B6B72699C7, name="3DJAMES"'
else:
    parts[int(snum)] = f"start={sstart}, size={ssize}, type=c"
for n in sorted(parts):
    out.append(f"{img}{n} : {parts[n]}")
print("\n".join(out))
PY
echo "  new table:"; sed 's/^/    /' "$WORK/table.sfdisk"
sfdisk --no-reread --no-tell-kernel "$IMG" < "$WORK/table.sfdisk" >/dev/null

LOOP="$(losetup --show -f -P "$IMG")"
partx -u "$LOOP" 2>/dev/null || true
sleep 1
ROOTDEV="${LOOP}p${ROOT_NUM}"
SETUPDEV="${LOOP}p${SETUP_NUM}"
[ -b "$ROOTDEV" ] && [ -b "$SETUPDEV" ] || die "loop partitions did not appear ($ROOTDEV, $SETUPDEV)"

say "Growing the root filesystem by ${GROW_MB} MB"
e2fsck -f -y "$ROOTDEV" >/dev/null || [ $? -le 1 ] || die "e2fsck failed"
resize2fs "$ROOTDEV" >/dev/null
mkfs.vfat -n 3DJAMES "$SETUPDEV" >/dev/null

mkdir -p "$MNT"
mount "$ROOTDEV" "$MNT"
mkdir -p "$MNT/tdjsetup"   # mount point; the drive itself is filled with mtools below
echo "  root filesystem: $(. "$MNT/etc/os-release" 2>/dev/null; echo "${PRETTY_NAME:-unknown}")"

# ----------------------------------------------------------------------------- payload
say "Copying the 3DJames server"
install -d "$MNT/opt/3djames/server" "$MNT/opt/3djames/app"
rsync -a --delete --exclude '__pycache__' --exclude 'testdata' "$REPO/server/" "$MNT/opt/3djames/server/"
if [ -n "$APP" ]; then install -m 644 "$APP" "$MNT/opt/3djames/app/3DJames.html"; echo "  app: $(basename "$APP")"; else echo "  no app file: the admin uploads 3DJames.html on the admin page"; fi
install -m 644 "$REPO/LICENSE" "$MNT/opt/3djames/LICENSE" 2>/dev/null || true
rsync -a --exclude '__pycache__' "$HERE/rootfs/" "$MNT/"
chmod 440 "$MNT/etc/sudoers.d/3djames"
chmod 755 "$MNT/usr/local/sbin/3djames-helper"
git -C "$REPO" describe --always --dirty > "$MNT/opt/3djames/BUILD" 2>/dev/null || date -u +%Y%m%d > "$MNT/opt/3djames/BUILD"

say "Filling the 3DJAMES settings drive"
mkdir -p "$WORK/setup"
for f in "$HERE"/setup-partition/*; do
  sed 's/\r$//; s/$/\r/' "$f" > "$WORK/setup/$(basename "$f")"   # Windows line endings for Notepad
done
MTOOLS_SKIP_CHECK=1 mcopy -o -i "$SETUPDEV" "$WORK"/setup/* ::/
MTOOLS_SKIP_CHECK=1 mdir -i "$SETUPDEV" ::/ | sed 's/^/    /' 

# ----------------------------------------------------------------------------- chroot
if [ "$SKIP_CUSTOMIZE" = 0 ]; then
  say "Installing packages inside the image (this takes a while)"
  # ELF machine of the image's /bin/sh vs. this computer: emulation needed only on a mismatch.
  IMG_ARCH="$(python3 -c "import struct,sys,os; d=open(os.path.realpath(sys.argv[1]),'rb').read(20); print({183:'aarch64',62:'x86_64',40:'arm'}.get(struct.unpack('<H',d[18:20])[0],'unknown'))" "$MNT/bin/bash" 2>/dev/null || echo unknown)"
  echo "  image architecture: $IMG_ARCH, this computer: $(uname -m)"
  if [ "$IMG_ARCH" != "$(uname -m)" ]; then
    [ -e "/proc/sys/fs/binfmt_misc/qemu-$IMG_ARCH" ] || die "running $IMG_ARCH programs here needs qemu-user-static + binfmt (apt install qemu-user-static binfmt-support)"
  fi
  mount --bind /dev "$MNT/dev"; mount --bind /dev/pts "$MNT/dev/pts"
  mount -t proc proc "$MNT/proc"; mount -t sysfs sys "$MNT/sys"
  RESOLV_BAK=""
  if [ -e "$MNT/etc/resolv.conf" ] || [ -L "$MNT/etc/resolv.conf" ]; then
    RESOLV_BAK="$WORK/resolv.conf.bak"; mv "$MNT/etc/resolv.conf" "$RESOLV_BAK"
  fi
  cp -L /etc/resolv.conf "$MNT/etc/resolv.conf"
  printf '#!/bin/sh\nexit 101\n' > "$MNT/usr/sbin/policy-rc.d"; chmod 755 "$MNT/usr/sbin/policy-rc.d"
  install -m 755 "$HERE/customize.sh" "$MNT/tmp/customize.sh"
  # Clean environment inside the image; only proxy settings are passed through.
  CENV=(PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 TERM=dumb)
  for v in http_proxy https_proxy no_proxy HTTP_PROXY HTTPS_PROXY NO_PROXY; do
    [ -n "${!v:-}" ] && CENV+=("$v=${!v}")
  done
  if [ -n "$EXTRA_CA" ]; then
    cp "$EXTRA_CA" "$MNT/tmp/extra-ca.crt"
    CENV+=(PIP_CERT=/tmp/extra-ca.crt SSL_CERT_FILE=/tmp/extra-ca.crt REQUESTS_CA_BUNDLE=/tmp/extra-ca.crt)
  fi
  chroot "$MNT" /usr/bin/env -i "${CENV[@]}" /bin/bash /tmp/customize.sh
  rm -f "$MNT/usr/sbin/policy-rc.d" "$MNT/tmp/customize.sh" "$MNT/tmp/extra-ca.crt" "$MNT/etc/resolv.conf"
  [ -n "$RESOLV_BAK" ] && mv "$RESOLV_BAK" "$MNT/etc/resolv.conf"
  umount "$MNT/dev/pts" "$MNT/dev" "$MNT/proc" "$MNT/sys"
else
  say "Skipping the package step (--skip-customize): image is NOT bootable as a bridge, for testing only"
fi

say "Finishing"
sync
umount "$MNT"
e2fsck -f -y "$ROOTDEV" >/dev/null || [ $? -le 1 ] || die "final e2fsck failed"
losetup -d "$LOOP"; LOOP=""

mkdir -p "$OUT"
if [ "$COMPRESS" = 1 ]; then
  xz -T0 -6 -c "$IMG" > "$OUT/$NAME.img.xz"
  (cd "$OUT" && sha256sum "$NAME.img.xz" > "$NAME.img.xz.sha256")
  say "Done: $OUT/$NAME.img.xz ($(du -h "$OUT/$NAME.img.xz" | cut -f1))"
else
  cp --sparse=always "$IMG" "$OUT/$NAME.img"
  say "Done: $OUT/$NAME.img"
fi
