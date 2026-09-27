#!/bin/bash
set -u

PROJECT="/Users/wjh/code/ball_screw/题库"
URL="http://127.0.0.1:8000"
BACKGROUND="${1:-}"

fail() {
  printf '\n%s\n' "$1"
  if [ "$BACKGROUND" != "--background" ]; then
    read -r -p "Press Enter to close... " _
  fi
  exit 1
}

cd "$PROJECT" || fail "Project folder not found: $PROJECT"
PYTHON="$PROJECT/.venv/bin/python"
[ -x "$PYTHON" ] || fail "Python environment missing. Please set up .venv first."

is_quiz_running() {
  /usr/bin/curl --noproxy '*' --fail --silent --max-time 2 "$URL/static/app.js" |
    /usr/bin/grep -q 'quiz_bank_stats_v1'
}

if is_quiz_running; then
  /usr/bin/open "$URL" || fail "Could not open browser. Visit $URL"
  exit 0
fi

if /usr/sbin/lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port 8000 is occupied by another service. Close that service and try again."
fi

"$PYTHON" -c 'import uvicorn, fastapi, pandas, openpyxl' ||
  fail "Dependencies missing. Run .venv/bin/pip install -r requirements.txt in the project."

printf 'Starting quiz at %s\nKeep this terminal open while using the quiz.\n' "$URL"
if [ "$BACKGROUND" = "--background" ]; then
  LOG=$(mktemp /tmp/quiz-server.XXXXXX) || fail "Cannot create startup log."
  /usr/bin/nohup "$PYTHON" -m uvicorn server:app --host 127.0.0.1 --port 8000 >"$LOG" 2>&1 </dev/null &
else
  "$PYTHON" -m uvicorn server:app --host 127.0.0.1 --port 8000 &
fi
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM HUP

for ((attempt=0; attempt<30; attempt++)); do
  kill -0 "$SERVER_PID" 2>/dev/null || fail "Server failed to start. See the error above."
  if is_quiz_running; then
    /usr/bin/open "$URL" || fail "Could not open browser. Visit $URL"
    if [ "$BACKGROUND" = "--background" ]; then
      trap - EXIT INT TERM HUP
      exit 0
    fi
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 1
done
fail "Server startup timed out. See the error above."
