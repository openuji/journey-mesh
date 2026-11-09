#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STACK_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
NEXTCLOUD_STACK_ENV_FILE="$(node "$STACK_DIR/configure-runtime.mjs" --refresh)"
export NEXTCLOUD_STACK_ENV_FILE
. "$SCRIPT_DIR/common.sh"

compose up -d
