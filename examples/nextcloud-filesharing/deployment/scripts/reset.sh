#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

compose down -v --remove-orphans
rm -f "$STACK_DIR/../.runtime/stack.env"
