#!/bin/sh
# A stand-in for the vendor's installer: prints, waits a little, and puts the stand-in `vibe`
# where `uv tool install` lands: `$HOME/.local/bin/vibe`. `fail` as
# the first argument makes it the installer that does not finish. Never run against a real home.
here=$(cd "$(dirname "$0")" && pwd)
echo "stand-in installer: downloading…"
sleep 1
if [ "$1" = "fail" ]; then
  echo "stand-in installer: the download failed (this is the failing variant)"
  exit 7
fi
mkdir -p "$HOME/.local/bin"
cp "$here/vibe" "$HOME/.local/bin/vibe"
cp "$here/vibe.ts" "$HOME/.local/bin/vibe.ts"
chmod +x "$HOME/.local/bin/vibe"
echo "stand-in installer: installed to $HOME/.local/bin/vibe"
