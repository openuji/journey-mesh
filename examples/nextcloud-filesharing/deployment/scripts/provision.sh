#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/common.sh"

wait_for_nextcloud() {
	service="$1"
	printf 'Waiting for %s to finish installation' "$service"
	for _ in $(seq 1 120); do
		status="$(occ "$service" status 2>/dev/null || true)"
		if printf '%s\n' "$status" | grep -q 'installed: true'; then
			printf '\n'
			return 0
		fi
		printf '.'
		sleep 2
	done
	printf '\nTimed out waiting for %s\n' "$service" >&2
	return 1
}

ensure_user() {
	service="$1"
	user="$2"
	password="$3"

	if occ "$service" user:info "$user" >/dev/null 2>&1; then
		return 0
	fi

	compose exec -T -e "OC_PASS=$password" -u www-data "$service" \
		php occ user:add --password-from-env "$user"
}

configure_instance() {
	service="$1"
	host="$2"
	port="$3"
	url="$4"

	occ "$service" app:enable federation >/dev/null 2>&1 || true
	occ "$service" app:enable files_sharing >/dev/null 2>&1 || true
	occ "$service" config:system:set trusted_domains 0 --value="$host"
	occ "$service" config:system:set trusted_domains 1 --value="$host:$port"
	occ "$service" config:system:set trusted_domains 2 --value="$service"
	occ "$service" config:system:set trusted_domains 3 --value=localhost
	occ "$service" config:system:set trusted_domains 4 --value=127.0.0.1
	occ "$service" config:system:set overwritehost --value="$host:$port"
	occ "$service" config:system:set overwriteprotocol --value=http
	occ "$service" config:system:set overwrite.cli.url --value="$url"
	occ "$service" config:system:set allow_local_remote_servers --type=boolean --value=true
	occ "$service" config:app:set files_sharing incoming_server2server_share_enabled --value=yes
	occ "$service" config:app:set files_sharing outgoing_server2server_share_enabled --value=yes
}

wait_for_nextcloud alice
wait_for_nextcloud bob

ensure_user alice "$NEXTCLOUD_ALICE_USER" "$NEXTCLOUD_ALICE_PASSWORD"
ensure_user bob "$NEXTCLOUD_BOB_USER" "$NEXTCLOUD_BOB_PASSWORD"

configure_instance alice "$NEXTCLOUD_ALICE_HOST" "$NEXTCLOUD_ALICE_PORT" "$NEXTCLOUD_ALICE_URL"
configure_instance bob "$NEXTCLOUD_BOB_HOST" "$NEXTCLOUD_BOB_PORT" "$NEXTCLOUD_BOB_URL"

occ alice federation:sync-addressbooks || true
occ bob federation:sync-addressbooks || true

cat <<EOF
Provisioned Nextcloud federation stack.

Alice: $NEXTCLOUD_ALICE_URL
Bob:   $NEXTCLOUD_BOB_URL

Users:
  $NEXTCLOUD_ALICE_USER / $NEXTCLOUD_ALICE_PASSWORD
  $NEXTCLOUD_BOB_USER / $NEXTCLOUD_BOB_PASSWORD
EOF
