#!/usr/bin/env bash
# check-exposure.sh contract test: local fake server only.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/check-exposure.sh"
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
[[ -x "$SCRIPT" ]] || fail "missing executable: $SCRIPT"
grep -F -- '--http1.1' "$SCRIPT" >/dev/null || fail 'WebSocket check must force HTTP/1.1'

TEST_ROOT="$(mktemp -d)"
SERVER_INFO="$TEST_ROOT/server.info"
SERVER_PID=''
SERVER_URL=''
cleanup() {
  set +e
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

start_server() {
  rm -f -- "$SERVER_INFO"
  SERVER_MODE="$1" python3 - "$SERVER_INFO" <<'PY_SERVER' &
import http.server, os, pathlib, sys
info_path = pathlib.Path(sys.argv[1])
mode = os.environ["SERVER_MODE"]
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_GET(self):
        if mode == "exposed" and self.path == "/":
            body = b"<title>herdweb</title><div>xterm</div>FAKE_BODY_SHOULD_NOT_LEAK"
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif mode == "exposed" and self.path == "/ws":
            self.send_response_only(101); self.send_header("Connection", "Upgrade"); self.send_header("Upgrade", "websocket"); self.end_headers(); self.close_connection = True
        elif mode == "protected":
            body = b"FAKE_PROTECTED_BODY_SHOULD_NOT_LEAK"
            self.send_response(403); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        else: self.send_error(404)
    def log_message(self, _format, *_args): pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
info_path.write_text(str(server.server_port), encoding="ascii")
server.serve_forever()
PY_SERVER
  SERVER_PID=$!
  for _ in {1..100}; do
    [[ -s "$SERVER_INFO" ]] && SERVER_URL="http://127.0.0.1:$(<"$SERVER_INFO")" && return
    sleep 0.02
  done
  fail 'fake server did not publish its port'
}
stop_server() { set +e; kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null; SERVER_PID=''; set -e; }
run_check() {
  local label="$1" expected_rc="$2" output rc
  set +e; output="$(bash "$SCRIPT" "$SERVER_URL" 2>&1)"; rc=$?; set -e
  printf '%s rc=%s\n%s\n' "$label" "$rc" "$output"
  [[ "$rc" -eq "$expected_rc" ]] || fail "$label expected rc=$expected_rc, got rc=$rc"
  [[ "$output" != *FAKE_BODY_SHOULD_NOT_LEAK* ]] || fail "$label leaked homepage body"
  [[ "$output" != *FAKE_PROTECTED_BODY_SHOULD_NOT_LEAK* ]] || fail "$label leaked protected body"
}

start_server exposed; run_check exposed 1; stop_server
start_server protected; run_check protected 0; stop_server
python3 - "$SERVER_INFO" <<'PY_PORT'
import pathlib, socket, sys
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0)); pathlib.Path(sys.argv[1]).write_text(str(sock.getsockname()[1]), encoding="ascii")
PY_PORT
SERVER_URL="http://127.0.0.1:$(<"$SERVER_INFO")"; run_check unreachable 2
printf 'PASS: exposure check covers exposed, protected, and unreachable local endpoints\n'
