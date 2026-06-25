#!/usr/bin/env bash
# 生成本地开发用自签名 TLS 证书（仅 localhost，不用于生产）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/../certs"
mkdir -p "$CERTS_DIR"

echo "Generating self-signed TLS certificate in $CERTS_DIR ..."

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERTS_DIR/key.pem" \
  -out "$CERTS_DIR/cert.pem" \
  -days 3650 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Done:"
echo "  cert: $CERTS_DIR/cert.pem"
echo "  key:  $CERTS_DIR/key.pem"
