#!/bin/sh
#
# Which tracked files does the cspell step actually reach?
#
# Puts one obviously-misspelled word in every tracked file, one at a time, and asks cspell whether it
# reports it. A file it stays silent about is a file the spell check does not see, whatever the glob
# in the gate says. That question is worth asking once: a glob that quietly skips a tree is a gate
# that is green because it looked at less than it appears to.
#
# The gate passes globs rather than a file list, so this passes globs too. Naming the file under test
# explicitly would ask cspell to read it regardless, which is the opposite of what is being measured.
#
# Run it from the repository root:
#     sh scripts/probe-cspell-coverage.sh

set -u

# Pathname expansion off. The globs are passed unquoted so the shell splits them into separate
# arguments, and without this the shell would expand them itself first: `**` behaves as a single `*`
# without globstar, so cspell would receive a list of top-level filenames instead of the pattern, and
# every dotfile would come back "not reached" for a reason that has nothing to do with cspell. That
# was measured, and it is what the first version of this script reported.
set -f

CSpell="node_modules/.bin/cspell"
case "$(uname -s 2>/dev/null)" in
MINGW* | MSYS* | CYGWIN*) CSpell="$CSpell.cmd" ;;
esac

[ -f "$CSpell" ] || { echo "cspell is not installed; run npm install" >&2; exit 1; }

# The globs are the ones in scripts/gate.mjs. Changing them here without changing them there would
# make this answer a different question than the one the gate asks.
GLOBS="**/* .*/** .*"

# A word no dictionary has, and unlikely to appear anywhere for real. Declared here rather than in
# project-words.txt: this is a probe fixture and should not outlive the probe.
# cspell:ignore zzqjxwlm
NEEDLE="zzqjxwlm"

# This file reports itself as "not reached", and that is an artifact of the fixture rather than a
# finding. The needle has to be declared ignored here for the gate to stay green, so when the needle
# is appended to this file the directive that ignores it is a few lines above, and cspell correctly
# says there is nothing to report. Skipping the file is the honest way to record that: listing it as
# unreachable would be a false negative about the glob, which is the one thing this script measures.
SELF="scripts/probe-cspell-coverage.sh"

# The backup lives outside the tree. A copy inside it would be picked up by the glob on the very next
# iteration and would carry its own words into the answer.
BACKUP=$(mktemp 2>/dev/null) || BACKUP=".cspell-probe-backup.$$"
trap 'cp "$BACKUP" "$CURRENT" 2>/dev/null; rm -f "$BACKUP"' EXIT INT TERM
CURRENT=""

git ls-files | while read -r file; do
    # See the note on SELF above: this file cannot be its own evidence.
    if [ "$file" = "$SELF" ]; then
        printf '  skipped       %s (see the note on SELF above)\n' "$file"
        continue
    fi

    CURRENT="$file"
    cp "$file" "$BACKUP"

    # Append rather than substitute, so nothing that already reads as a word is disturbed.
    printf '\n%s\n' "$NEEDLE" >>"$file"

    if "$CSpell" --no-progress --gitignore $GLOBS >/dev/null 2>&1; then
        printf '  not reached   %s\n' "$file"
    else
        printf '  reached       %s\n' "$file"
    fi

    cp "$BACKUP" "$file"
done
