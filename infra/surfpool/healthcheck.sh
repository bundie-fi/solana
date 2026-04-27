#!/bin/sh
# Surfpool RPC liveness check.
# Returns 0 if the local Solana RPC at :8899 responds with a slot, non-zero otherwise.
RES=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:18899" \
    -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[]}')
[ "$RES" = "200" ] || exit 1
exit 0
