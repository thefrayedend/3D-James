#!/bin/bash
# Runs INSIDE the board's root filesystem (chroot) during build-image.sh.
# Installs system packages and enables the services.
# The 3DJames server files themselves were already copied in by build-image.sh.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8 LANG=C.UTF-8

log() { echo "[customize] $*"; }

# ---------------------------------------------------------------- packages
log "Installing system packages"
# Vendor images point apt at their own mirrors (e.g. repo.huaweicloud.com), which are often
# slow, out of date or unreachable from the build server. For the build we use the official
# Debian/Ubuntu servers and put the vendor's settings back afterwards.
. /etc/os-release
CODENAME="${VERSION_CODENAME:-}"
APT_BAK=/tmp/apt-sources-backup
rm -rf "$APT_BAK"; mkdir -p "$APT_BAK"
cp -a /etc/apt/sources.list "$APT_BAK/" 2>/dev/null || true
[ -d /etc/apt/sources.list.d ] && cp -a /etc/apt/sources.list.d "$APT_BAK/" && rm -f /etc/apt/sources.list.d/*
restore_apt() {
  rm -f /etc/apt/sources.list /etc/apt/sources.list.d/* 2>/dev/null || true
  [ -f "$APT_BAK/sources.list" ] && cp -a "$APT_BAK/sources.list" /etc/apt/sources.list
  [ -d "$APT_BAK/sources.list.d" ] && cp -a "$APT_BAK/sources.list.d/." /etc/apt/sources.list.d/
  rm -rf "$APT_BAK"
}
trap restore_apt EXIT
PKGS="avahi-daemon libnss-mdns network-manager dnsmasq-base wpasupplicant iw rfkill wireless-regdb
  sudo python3 ca-certificates dosfstools fdisk e2fsprogs util-linux curl tzdata cifs-utils nfs-common"

# Writes /etc/apt/sources.list for one of several server choices.
set_sources() {
  if [ "${ID:-}" = ubuntu ]; then
    local M=http://ports.ubuntu.com/ubuntu-ports
    [ "$(dpkg --print-architecture)" = amd64 ] && M=http://archive.ubuntu.com/ubuntu
    case "$1" in
      full) printf 'deb %s %s main universe\ndeb %s %s-updates main universe\ndeb %s %s-security main universe\n' "$M" "$CODENAME" "$M" "$CODENAME" "$M" "$CODENAME" ;;
      base) printf 'deb %s %s main universe\n' "$M" "$CODENAME" ;;
      *) return 1 ;;
    esac > /etc/apt/sources.list
    return 0
  fi
  local SEC="$CODENAME-security"; [ "$CODENAME" = buster ] && SEC="buster/updates"
  local C="main contrib non-free"
  case "$1" in
    # 1) normal Debian servers incl. security updates
    full) printf 'deb http://deb.debian.org/debian %s %s\ndeb http://deb.debian.org/debian %s-updates %s\ndeb http://deb.debian.org/debian-security %s %s\n' \
            "$CODENAME" "$C" "$CODENAME" "$C" "$SEC" "$C" ;;
    # 2) old release whose security updates were moved: security from archive.debian.org
    mixed) printf 'deb http://deb.debian.org/debian %s %s\ndeb http://deb.debian.org/debian %s-updates %s\ndeb http://archive.debian.org/debian-security %s %s\n' \
            "$CODENAME" "$C" "$CODENAME" "$C" "$SEC" "$C" ;;
    # 3) snapshot.debian.org keeps every package version ever published (slow but complete)
    snapshot) printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260815T000000Z %s %s\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260815T000000Z %s-updates %s\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260815T000000Z %s %s\n' \
            "$CODENAME" "$C" "$CODENAME" "$C" "$SEC" "$C" ;;
    # 4) without security updates
    base) printf 'deb http://deb.debian.org/debian %s %s\ndeb http://deb.debian.org/debian %s-updates %s\n' "$CODENAME" "$C" "$CODENAME" "$C" ;;
    # 5) fully archived release
    archive) printf 'deb http://archive.debian.org/debian %s %s\ndeb http://archive.debian.org/debian-security %s %s\n' "$CODENAME" "$C" "$SEC" "$C" ;;
    *) return 1 ;;
  esac > /etc/apt/sources.list
}

INSTALLED=0
for choice in full mixed snapshot base archive; do
  set_sources "$choice" || continue
  log "Trying package servers: $choice (${ID:-?} $CODENAME)"
  rm -rf /var/lib/apt/lists/*   # drop stale lists from earlier attempts / the vendor mirror
  apt-get -o Acquire::Check-Valid-Until=false update || true
  # shellcheck disable=SC2086
  if apt-get install -y --no-install-recommends $PKGS; then
    INSTALLED=1
    break
  fi
  log "That didn't work, trying the next option"
done
[ "$INSTALLED" = 1 ] || { echo "[customize] ERROR: could not install the system packages from any package server"; exit 1; }
# Optional, nice to have; ignore if the distro calls them differently.
apt-get install -y --no-install-recommends openssh-server || true
# Samba: only for the optional "3DJames-update" network folder (switched off until the admin turns it on).
apt-get install -y --no-install-recommends samba samba-common-bin || log "samba not available: the update folder will be missing"

# ---------------------------------------------------------------- user & folders
if ! id threedjames >/dev/null 2>&1; then
  log "Creating service user threedjames"
  useradd --system --home-dir /var/lib/3djames --create-home --shell /usr/sbin/nologin threedjames
fi
install -d -o threedjames -g threedjames -m 750 /var/lib/3djames
install -d -o threedjames -g threedjames -m 775 /srv/3djames
install -d -m 755 /var/lib/3djames-sys /tdjsetup /mnt/3djames
install -d -m 700 /etc/3djames /etc/3djames/places
chown -R root:root /opt/3djames
python3 -m py_compile /opt/3djames/server/3djames_server.py
# Samba: off until the admin switches the update folder on
mkdir -p /etc/samba
[ -f /etc/samba/3djames.conf ] || echo "# The 3DJames update folder is switched off (admin page > App)." > /etc/samba/3djames.conf
if [ -f /etc/samba/smb.conf ] && ! grep -q 3djames.conf /etc/samba/smb.conf; then echo "include = /etc/samba/3djames.conf" >> /etc/samba/smb.conf; fi
systemctl disable smbd.service nmbd.service samba-ad-dc.service 2>/dev/null || true

# ---------------------------------------------------------------- SD-card settings drive
if ! grep -q 'LABEL=3DJAMES' /etc/fstab; then
  log "Adding the 3DJAMES settings drive to /etc/fstab"
  echo 'LABEL=3DJAMES /tdjsetup vfat defaults,nofail,uid=threedjames,gid=threedjames,fmask=0133,dmask=0022,flush,x-systemd.device-timeout=15s 0 0' >> /etc/fstab
fi

# ---------------------------------------------------------------- hostname / mDNS
echo 3djames > /etc/hostname
if grep -q '^127\.0\.1\.1' /etc/hosts; then
  sed -i 's/^127\.0\.1\.1.*/127.0.1.1\t3djames/' /etc/hosts
else
  printf '127.0.1.1\t3djames\n' >> /etc/hosts
fi
# Use mDNS (.local) for name lookups too.
if grep -q '^hosts:' /etc/nsswitch.conf && ! grep -q mdns /etc/nsswitch.conf; then
  sed -i 's/^hosts:.*/hosts:          files mdns4_minimal [NOTFOUND=return] dns/' /etc/nsswitch.conf
fi

# ---------------------------------------------------------------- security defaults
# Vendor images ship well-known default passwords and SSH switched on. A rookie never needs
# them, so lock them; SSH can be enabled from 3djames-config.txt with a personal password.
log "Locking default accounts and disabling SSH (enable it in 3djames-config.txt)"
passwd -l root >/dev/null 2>&1 || true
for u in $(awk -F: '$3 >= 1000 && $3 < 60000 {print $1}' /etc/passwd); do
  [ "$u" = threedjames ] || [ "$u" = tdjadmin ] || passwd -l "$u" >/dev/null 2>&1 || true
done
systemctl disable ssh.service 2>/dev/null || true
systemctl disable sshd.service 2>/dev/null || true
# Skip Armbian's interactive first-login wizard (nobody logs in on this appliance).
rm -f /root/.not_logged_in_yet
# Getty autologin on the debug console of some vendor images: turn it off.
rm -f /etc/systemd/system/serial-getty@*.service.d/override.conf /etc/systemd/system/getty@tty1.service.d/override.conf 2>/dev/null || true

# ---------------------------------------------------------------- services
# Our firstboot service grows the root partition; vendor resizers would fight over it.
for s in armbian-resize-filesystem orangepi-resize-filesystem resize2fs_once rpi-resizefs; do
  systemctl disable "$s.service" 2>/dev/null || true
  systemctl mask "$s.service" 2>/dev/null || true
done
systemctl enable NetworkManager.service avahi-daemon.service || true
systemctl enable 3djames-firstboot.service 3djames-config.service 3djames-hotspot.service 3djames.service
# A static/ifupdown wlan0 config would stop NetworkManager from managing Wi-Fi.
if [ -f /etc/network/interfaces ]; then
  sed -i -E '/^\s*(auto|allow-hotplug)\s+wlan[0-9]+/d; /^\s*iface\s+wlan[0-9]+/,/^\s*$/d' /etc/network/interfaces || true
fi

# ---------------------------------------------------------------- tidy up
restore_apt; trap - EXIT
apt-get clean
rm -rf /var/lib/apt/lists/* /root/.cache /tmp/* 2>/dev/null || true
# A fresh machine-id is generated on first boot (needed for unique DHCP/mDNS identity).
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
log "Done"
