#!/usr/bin/env bash
set -euo pipefail

log_dir="${ANDROID_LOG_DIR:-$PWD/.tmp/android-logs}"
appium_port="${APPIUM_PORT:-4723}"
export APPIUM_URL="http://127.0.0.1:$appium_port/"
mkdir -p "$log_dir"
node examples/nextcloud-filesharing/node_modules/appium/index.js \
  --address 127.0.0.1 --port "$appium_port" --log-level warn \
  --log "$log_dir/appium.log" &
appium_pid=$!
adb -s "$ANDROID_UDID" logcat > "$log_dir/logcat.log" 2>&1 &
logcat_pid=$!
cleanup() {
  kill "$appium_pid" "$logcat_pid" 2>/dev/null || true
  wait "$appium_pid" "$logcat_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ready=0
for attempt in $(seq 1 60); do
  if curl --fail --silent --connect-timeout 2 --max-time 5 "$APPIUM_URL"status > "$log_dir/appium-status.json"; then
    ready=1
    break
  fi
  if ! kill -0 "$appium_pid" 2>/dev/null; then
    cat "$log_dir/appium.log"
    exit 1
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo 'Appium startup timed out' >&2
  exit 1
fi
adb -s "$ANDROID_UDID" shell getprop > "$log_dir/device-properties.txt"
pnpm --filter @openuji/example-nextcloud-filesharing android:check
journey_args=(test journey.yaml)
if [ -n "${JOURNEY_MESH_TEST-native-recipient-sharing}" ]; then
  journey_args+=(--test "${JOURNEY_MESH_TEST-native-recipient-sharing}")
fi
pnpm --filter @openuji/example-nextcloud-filesharing exec journey-mesh "${journey_args[@]}"
