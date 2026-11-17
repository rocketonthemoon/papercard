#!/bin/sh
# Copies the Rust Harper crates the game needs into engine/vendor/, so the container build is self-contained.
# Usage: sh vendor.sh [path/to/harper-repo]   (default: ../../../harper-gpt2/harper-gpt2)
# Patches applied to the copy (the source repo is not touched):
#   - Document parsing uses the rule-based Brill chunker instead of the neural (burn) one,
#     like the Harper.px JavaScript port.
#   - The optional 24 MB thesaurus crate is dropped.
set -eu
SRC="${1:-$(dirname "$0")/../../../harper-gpt2/harper-gpt2}"
DST="$(dirname "$0")/vendor"
rm -rf "$DST"
mkdir -p "$DST"
for crate in harper-core harper-brill harper-pos-utils; do
  mkdir -p "$DST/$crate"
  (cd "$SRC/$crate" && tar cf - --exclude=./target --exclude=./tests --exclude=./examples .) | (cd "$DST/$crate" && tar xf -)
done
cp "$SRC/LICENSE" "$DST/LICENSE"
# Pin dependency versions to the ones Harper was built and tested with.
cp "$SRC/Cargo.lock" "$(dirname "$0")/Cargo.lock"
# Brill chunker instead of the neural one.
sed -i 's/let chunker = burn_chunker();/let chunker = harper_brill::brill_chunker();/; s/brill_tagger, burn_chunker}/brill_tagger}/' "$DST/harper-core/src/document.rs"
grep -q 'harper_brill::brill_chunker()' "$DST/harper-core/src/document.rs"
# No thesaurus.
sed -i '/^harper-thesaurus = /d; s/^default = \["thesaurus", "concurrent"\]/default = []/; s/^thesaurus = \["dep:harper-thesaurus"\]/thesaurus = []/' "$DST/harper-core/Cargo.toml"
! grep -q 'harper-thesaurus' "$DST/harper-core/Cargo.toml"
echo "vendored into $DST:"
du -sh "$DST"/* | sed 's/^/  /'
