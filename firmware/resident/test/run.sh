#!/usr/bin/env bash
# Builds and runs the host tests for firmware/resident/src/core (no Arduino needed).
# Usage: firmware/resident/test/run.sh   (CXX overrides the compiler, default c++)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
"${CXX:-c++}" -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined -g \
  "$here/test_core.cpp" -o "$out/test_core"
"$out/test_core"
