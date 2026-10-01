#!/bin/sh
#
# Verifies the session guard in .githooks/commit-msg against the values it has to get right.
#
# Run it after touching that case statement:
#
#     sh scripts/test-session-guard.sh
#
# It runs the real guard, not a copy: the case statement is read out of the hook and evaluated with
# the git command pointed at a throwaway message file. So this exercises the hook's own code path,
# including `git interpret-trailers`, and a guard that passes here is the guard that runs on a commit.
# A second copy of the pattern in this file could drift from the hook and keep reporting green.
#
# It needs a git repository for `git interpret-trailers` to run in, which is why it says so rather
# than failing obscurely when it is run from a directory that is not one.

set -u

HOOK=".githooks/commit-msg"
TMP_DIR=".git/session-guard-test"

if [ ! -f "$HOOK" ]; then
    echo "not found: $HOOK -- run this from the repository root" >&2
    exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "not a git repository -- run this from the repository root" >&2
    exit 1
fi

# The guard: the NOT_ALLOWED assignment and the case statement that uses it, up to its `esac`.
guard=$(sed -n '/^NOT_ALLOWED=/,/^esac$/p' "$HOOK")

if [ -z "$guard" ]; then
    echo "could not find the session guard in $HOOK" >&2
    echo "it is expected to start at a NOT_ALLOWED assignment and end at a line reading esac" >&2
    exit 1
fi

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
MSG_FILE="$TMP_DIR/message"
failures=0
checks=0

# want_stamped <yes|no> <value>
#
# Writes a valid message, runs the guard against it, and reads the answer back out of the trailers
# git left behind. Reading the file rather than a variable means the assertion is about what would
# really be committed.
want_stamped() {
    expected="$1"
    value="$2"

    printf 'subject: a valid conventional subject\n\nA body.\n' >"$MSG_FILE"

    OPENCODE_SESSION_ID="$value"
    # shellcheck disable=SC2086
    eval "$guard"

    checks=$((checks + 1))

    if grep -q '^OpenCode-Session: ' "$MSG_FILE"; then
        stamped=yes
    else
        stamped=no
    fi

    if [ "$stamped" = "$expected" ]; then
        printf '  ok       %-38s %s\n' "[$value]" "$stamped"
    else
        printf '  FAILED   %-38s got %s, wanted %s\n' "[$value]" "$stamped" "$expected"
        failures=$((failures + 1))
    fi
}

# The values below are checked by shape, not spelled, so cspell is told to skip them here rather than
# being given a dictionary entry per fake id. A word added to project-words.txt for a test fixture
# would outlive the fixture.
#
# The directive is a `#` comment because this is a shell script: `//` is a directory path here, and
# cspell reads its own directive syntax out of whatever comment syntax the file already uses.
# cspell:ignore OPENCODE Wqgrkgi sesf

echo "must stamp:"
want_stamped yes "ses_f07f7ce68ffe8E1Wqgrkgi4Snv"
want_stamped yes "ses_abc"
want_stamped yes "ses_0"
want_stamped yes "ses_A-Z_09"

echo
echo "must not stamp:"
want_stamped no ""
want_stamped no "ses_"
want_stamped no "sesf_abc"
want_stamped no "prefix_ses_abc"
want_stamped no "ses abc"
want_stamped no "ses_abc def"
want_stamped no "ses_abc;echo pwned"
want_stamped no 'ses_abc$HOME'
want_stamped no "ses_abc|nc"
want_stamped no "abc123"
want_stamped no "SES_abc"
want_stamped no "ses.abc"

rm -rf "$TMP_DIR"

echo
if [ "$failures" -gt 0 ]; then
    echo "$failures of $checks checks failed"
    exit 1
fi

echo "all $checks checks passed"
