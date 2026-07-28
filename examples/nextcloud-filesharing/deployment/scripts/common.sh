#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STACK_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$STACK_DIR/compose.yaml"

if [ -n "${NEXTCLOUD_STACK_ENV_FILE:-}" ]; then
	ENV_FILE="$NEXTCLOUD_STACK_ENV_FILE"
elif [ -f "$STACK_DIR/.env" ]; then
	ENV_FILE="$STACK_DIR/.env"
else
	ENV_FILE="$STACK_DIR/.env.example"
fi

export NEXTCLOUD_STACK_ENV_FILE="$ENV_FILE"

. "$ENV_FILE"

compose() {
	docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

occ() {
	service="$1"
	shift
	compose exec -T -u www-data "$service" php occ "$@"
}
