#!/usr/bin/env bash
set -euo pipefail

mkdir -p .tmp/android-logs
node examples/nextcloud-filesharing/node_modules/appium/index.js \
  --address 127.0.0.1 --port 4723 --log-level warn \
  --log "$PWD/.tmp/android-logs/appium.log" &
appium_pid=$!
adb -s "$ANDROID_UDID" logcat > .tmp/android-logs/logcat.log 2>&1 &
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
  if curl --fail --silent http://127.0.0.1:4723/status > .tmp/android-logs/appium-status.json; then
    ready=1
    break
  fi
  if ! kill -0 "$appium_pid" 2>/dev/null; then
    cat .tmp/android-logs/appium.log
    exit 1
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo 'Appium startup timed out' >&2
  exit 1
fi
adb -s "$ANDROID_UDID" shell getprop > .tmp/android-logs/device-properties.txt
pnpm --filter @openuji/example-nextcloud-filesharing e2e:android
