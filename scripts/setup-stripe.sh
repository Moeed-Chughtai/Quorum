#!/usr/bin/env bash
#
# Download the Stripe CLI into .tools/stripe-cli/ and configure it
# for local webhook forwarding against this project.
#
# Usage:
#   ./scripts/setup-stripe.sh          # install + login
#   ./scripts/setup-stripe.sh --listen  # start webhook forwarding
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_DIR="$REPO_ROOT/.tools"
CLI_DIR="$TOOLS_DIR/stripe-cli"
CONFIG_DIR="$TOOLS_DIR/stripe-config"
STRIPE="$CLI_DIR/stripe"

STRIPE_VERSION="1.25.1"

# ── Detect platform ──────────────────────────────────────────────────
detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    darwin) os="mac-os" ;;
    linux)  os="linux"  ;;
    *)      echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x86_64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)             echo "Unsupported architecture: $arch" >&2; exit 1 ;;
  esac

  echo "${os}_${arch}"
}

# ── Download & extract ───────────────────────────────────────────────
install_cli() {
  if [[ -x "$STRIPE" ]]; then
    echo "Stripe CLI already installed at $STRIPE"
    "$STRIPE" version
    return
  fi

  local platform
  platform="$(detect_platform)"
  local url="https://github.com/stripe/stripe-cli/releases/download/v${STRIPE_VERSION}/stripe_${STRIPE_VERSION}_${platform}.tar.gz"

  echo "Downloading Stripe CLI v${STRIPE_VERSION} for ${platform}..."
  mkdir -p "$CLI_DIR"

  local tarball="$CLI_DIR/stripe.tar.gz"
  curl -fSL "$url" -o "$tarball"
  tar -xzf "$tarball" -C "$CLI_DIR"
  rm -f "$tarball"
  chmod +x "$STRIPE"

  echo "Installed: $("$STRIPE" version)"
}

# ── Login ────────────────────────────────────────────────────────────
login() {
  mkdir -p "$CONFIG_DIR/stripe"
  echo "Logging in to Stripe (opens browser)..."
  XDG_CONFIG_HOME="$CONFIG_DIR" "$STRIPE" login
  echo ""
  echo "Done. Config saved to $CONFIG_DIR/stripe/config.toml (git-ignored)."
}

# ── Webhook forwarding ──────────────────────────────────────────────
listen() {
  if [[ ! -x "$STRIPE" ]]; then
    echo "Stripe CLI not found. Run this script without --listen first." >&2
    exit 1
  fi

  echo "Starting webhook forwarding to http://localhost:8000/api/stripe/webhook ..."
  echo "The whsec_... secret printed below should be set as STRIPE_WEBHOOK_SECRET in .env"
  echo ""
  XDG_CONFIG_HOME="$CONFIG_DIR" "$STRIPE" listen \
    --forward-to http://localhost:8000/api/stripe/webhook
}

# ── Print webhook secret only ────────────────────────────────────────
print_secret() {
  if [[ ! -x "$STRIPE" ]]; then
    echo "Stripe CLI not found. Run this script without flags first." >&2
    exit 1
  fi
  XDG_CONFIG_HOME="$CONFIG_DIR" "$STRIPE" listen \
    --forward-to http://localhost:8000/api/stripe/webhook \
    --print-secret 2>&1 | head -1
}

# ── Main ─────────────────────────────────────────────────────────────
case "${1:-}" in
  --listen)
    listen
    ;;
  --print-secret)
    print_secret
    ;;
  *)
    install_cli
    login
    echo ""
    echo "Next steps:"
    echo "  1. Copy your STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY into .env"
    echo "  2. Start webhook forwarding:  ./scripts/setup-stripe.sh --listen"
    echo "  3. Set the printed whsec_... as STRIPE_WEBHOOK_SECRET in .env"
    ;;
esac
