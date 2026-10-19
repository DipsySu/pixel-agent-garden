#!/usr/bin/env bash
# usage: outside-real-home.sh LABEL PATH
# Prints PATH's physical form and exits 0 only when PATH is an existing directory outside the real
# user home. Otherwise it says why on stderr and exits 2. launch-site.sh and agent-garden.sh call it.
#
# The real home comes from the passwd database through Python's stdlib pwd module: getent does not
# exist on macOS, and HOME cannot be trusted because a verify run overrides it on purpose.
# Containment compares device+inode of PATH and each parent with the home, so a symlink into the
# home, a bind mount, or a different letter case on a case-insensitive volume (/USERS/me on APFS)
# still counts as the home. Any lookup failure, including a missing python3, refuses.
set -euo pipefail

[[ $# -eq 2 ]] || { echo "usage: outside-real-home.sh LABEL PATH" >&2; exit 2; }

python3 -I - "$1" "$2" <<'PY' || exit 2
import os, pwd, sys

label, path = sys.argv[1], sys.argv[2]

def refuse(why):
    print(f"verify: {why}; refusing", file=sys.stderr)
    sys.exit(2)

try:
    home = os.stat(pwd.getpwuid(os.getuid()).pw_dir)
except (KeyError, OSError) as e:
    refuse(f"cannot resolve the real user home from the passwd database ({e})")
if not path or not os.path.isdir(path):
    refuse(f"{label} must be an existing disposable directory")
phys = os.path.realpath(path)
p = phys
while True:
    st = os.stat(p)
    if (st.st_dev, st.st_ino) == (home.st_dev, home.st_ino):
        refuse(f"{label}={phys} is inside the real user home")
    parent = os.path.dirname(p)
    if parent == p:
        break
    p = parent
print(phys)
PY
