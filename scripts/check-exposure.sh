#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  printf '用法：%s <base-url>\n' "$0" >&2
  exit 2
fi

BASE_URL="${1%/}"
case "$BASE_URL" in
  http://*|https://*) ;;
  *) printf '无法判定：base-url 必须使用 http:// 或 https://\n' >&2; exit 2 ;;
esac

TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT
HOME_BODY="${TMP_DIR}/home.body"
WS_KEY='dGhlIHNhbXBsZSBub25jZQ=='
EXPOSED=0
UNKNOWN=0

curl_home() {
  curl --config /dev/null --silent --output "$HOME_BODY" --write-out '%{http_code}' \
    --connect-timeout 5 --max-time 15 "$BASE_URL/" 2>/dev/null
}

check_homepage() {
  local status feature_count access_count
  status=''
  status="$(curl_home)" || :
  if [[ ! "$status" =~ ^[0-9]{3}$ || "$status" == 000 ]]; then
    printf 'FAIL: 首页无法判定（网络错误）\n'; UNKNOWN=1; return
  fi
  case "$status" in
    302|403|401) printf 'PASS: 首页需要认证（status=%s）\n' "$status" ;;
    200)
      feature_count="$(grep -aEic 'herdweb|xterm' "$HOME_BODY" || :)"
      access_count="$(grep -aEic 'cloudflare access|cf-access|zero trust|access login|one-time pin|email verification' "$HOME_BODY" || :)"
      if (( access_count > 0 )); then
        printf 'PASS: 首页显示身份门页面（status=%s access_features=%s）\n' "$status" "$access_count"
      elif (( feature_count > 0 )); then
        printf 'FAIL: 首页暴露 herdweb 应用（status=%s app_features=%s）\n' "$status" "$feature_count"; EXPOSED=1
      else
        printf 'FAIL: 首页无法判定（status=%s app_features=0 access_features=0）\n' "$status"; UNKNOWN=1
      fi
      ;;
    *) printf 'FAIL: 首页无法判定（status=%s）\n' "$status"; UNKNOWN=1 ;;
  esac
}

ws_curl() {
  local force_http11="$1"
  local -a args=(--config /dev/null --silent --output /dev/null --write-out '%{http_code}'
    --connect-timeout 5 --max-time 15 -H 'Connection: Upgrade' -H 'Upgrade: websocket'
    -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: ${WS_KEY}")
  [[ "$force_http11" == true ]] && args+=(--http1.1)
  curl "${args[@]}" "$BASE_URL/ws" 2>/dev/null
}

check_websocket() {
  local status default_status
  status=''
  status="$(ws_curl true)" || :
  if [[ ! "$status" =~ ^[0-9]{3}$ || "$status" == 000 ]]; then
    printf 'FAIL: WebSocket 无法判定（网络错误；http1.1=true）\n'; UNKNOWN=1; return
  fi
  if [[ "$status" == 101 ]]; then
    printf 'FAIL: WebSocket 未受保护（status=%s；http1.1=true）\n' "$status"; EXPOSED=1
  else
    printf 'PASS: WebSocket 未完成未认证升级（status=%s；http1.1=true）\n' "$status"
  fi
  default_status=''
  default_status="$(ws_curl false)" || :
  if [[ ! "$default_status" =~ ^[0-9]{3}$ || "$default_status" == 000 ]]; then
    printf 'FAIL: 协议假阴性护栏无法判定（网络错误）\n'; UNKNOWN=1
  else
    printf 'PASS: 协议假阴性护栏 http1.1=%s default=%s\n' "$status" "$default_status"
  fi
}

check_homepage
check_websocket
if (( EXPOSED )); then
  printf '暴露警告：公网入口仍可直接访问 herdweb，退出码=1\n'; exit 1
fi
if (( UNKNOWN )); then
  printf '无法判定：网络或响应状态不足以证明入口已受保护，退出码=2\n'; exit 2
fi
printf '检查结论：公网入口已受身份保护，退出码=0\n'
