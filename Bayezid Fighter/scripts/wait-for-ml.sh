#!/bin/bash
# wait-for-ml.sh: poll /health endpoint of Python FastAPI services on ports 8000, 8001, 8002.
# Return exit 0 when all three respond 200 OK. Exponential backoff (max 60s total).

echo "[🔍] wait-for-ml: Polling Python ML daemons for readiness..."
PORTS=(8000 8001 8002)
MAX_WAIT=60
ELAPSED=0
DELAY=1

while [ $ELAPSED -lt $MAX_WAIT ]; do
    ALL_READY=true
    for PORT in "${PORTS[@]}"; do
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/health)
        if [ "$STATUS" != "200" ]; then
            ALL_READY=false
            break
        fi
    done
    
    if [ "$ALL_READY" = true ]; then
        echo "[✅] wait-for-ml: All Python ML daemons are online and loaded!"
        exit 0
    fi
    
    echo "[⏳] wait-for-ml: daemons not ready yet. Retrying in ${DELAY}s..."
    sleep $DELAY
    ELAPSED=$((ELAPSED + DELAY))
    # Exponential backoff up to 8s max step
    if [ $DELAY -lt 8 ]; then
        DELAY=$((DELAY * 2))
    fi
done

echo "[⚠️] wait-for-ml: Timeout waiting for Python daemons. Proceeding with caution..."
exit 1
