#!/usr/bin/env bash
set -uo pipefail

if [ -z "${XTREAM_HOST:-}" ] || [ -z "${XTREAM_USER:-}" ] || [ -z "${XTREAM_PASS:-}" ]; then
  echo "Defina XTREAM_HOST, XTREAM_USER e XTREAM_PASS antes de rodar este script." >&2
  exit 1
fi

BASE="${XTREAM_HOST%/}"
CANDIDATES=("$BASE" "${BASE}:8080" "${BASE}:2095" "${BASE}:80" "${BASE}:25461")

for host in "${CANDIDATES[@]}"; do
  echo "== Testando: $host =="
  code=$(curl -s -o /tmp/xtream_test.json -m 8 -w "%{http_code}" \
    "${host}/player_api.php?username=${XTREAM_USER}&password=${XTREAM_PASS}")
  echo "HTTP_STATUS:$code"
  if [ "$code" = "200" ]; then
    python3 - <<'PYEOF'
import json
try:
    d = json.load(open('/tmp/xtream_test.json'))
    info = d.get('user_info', d)
    for k in ('auth', 'status', 'active_cons', 'max_connections', 'exp_date', 'message'):
        if k in info:
            print(f"{k}: {info[k]}")
    server = d.get('server_info', {})
    if server:
        print("server_url:", server.get('url'), server.get('port'))
except Exception as e:
    print("Falha ao interpretar resposta:", e)
PYEOF
    echo "^^ Esse host funcionou. Use XTREAM_HOST=${host}"
    rm -f /tmp/xtream_test.json
    exit 0
  fi
  echo
done

echo "Nenhuma variação de porta funcionou. Pode ser host incorreto, provedor fora do ar, ou bloqueio de IP."
rm -f /tmp/xtream_test.json
