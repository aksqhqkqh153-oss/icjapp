#!/bin/sh
set -eu
PORT_VALUE="${PORT:-8000}"
echo "[entrypoint] Starting uvicorn on port ${PORT_VALUE}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT_VALUE}"
