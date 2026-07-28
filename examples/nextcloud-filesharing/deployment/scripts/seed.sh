#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

FIXTURE="$STACK_DIR/fixtures/report.pdf"

printf 'Waiting for %s' "$NEXTCLOUD_ALICE_URL"
for _ in $(seq 1 60); do
	if curl -fsS "$NEXTCLOUD_ALICE_URL/status.php" >/dev/null 2>&1; then
		printf '\n'
		break
	fi
	printf '.'
	sleep 1
done

curl -fsS -u "$NEXTCLOUD_ALICE_USER:$NEXTCLOUD_ALICE_PASSWORD" \
	-T "$FIXTURE" \
	"$NEXTCLOUD_ALICE_URL/remote.php/dav/files/$NEXTCLOUD_ALICE_USER/report.pdf"

printf 'Seeded %s to %s as %s\n' "$FIXTURE" "$NEXTCLOUD_ALICE_URL" "$NEXTCLOUD_ALICE_USER"
