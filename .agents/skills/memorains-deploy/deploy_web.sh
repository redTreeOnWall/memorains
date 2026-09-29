#!/usr/bin/env bash
#
# Build the memorains web package and deploy it to production hosts.
# Companion script for .agents/skills/memorains-deploy/SKILL.md.
#
# Usage:
#   bash deploy_web.sh [-y] [--no-build] [--no-verify] HOST [HOST...]
#
# Examples:
#   bash deploy_web.sh example.com
#   bash deploy_web.sh -y example.com note.example.com
#   bash deploy_web.sh -y --no-build note.example.com
#
# Hosts are NOT configured in this script: pass them as arguments (the skill
# asks the user for them when unspecified). For each host the project root
# is discovered by inspecting the mount of the running reno_note_nodejs
# container, falling back to DEPLOY_PROJECT_ROOT if that container is gone.
#
# If this script fails, fall back to the manual steps in SKILL.md.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)

ASSUME_YES=0
DO_BUILD=1
DO_VERIFY=1
HOSTS=()

usage() {
  sed -n '3,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)     ASSUME_YES=1 ;;
    --no-build)   DO_BUILD=0 ;;
    --no-verify)  DO_VERIFY=0 ;;
    -h|--help)    usage 0 ;;
    -*)
                  # Guards against a host argument being taken as an ssh/scp option.
                  echo "unknown option: $1 (hosts must not start with '-')" >&2
                  usage 1 ;;
    *)            HOSTS+=("$1") ;;
  esac
  shift
done

if [[ ${#HOSTS[@]} -eq 0 ]]; then
  echo "error: no host given; pass one or more hosts as arguments" >&2
  usage 1
fi

# --- 1. build ---------------------------------------------------------------
if [[ ${DO_BUILD} -eq 1 ]]; then
  echo "==> building web package"
  ( cd "${PROJECT_ROOT}/script" && bash ./build_web_package.sh >/dev/null )
fi

PACKAGE_TARBALL="${PROJECT_ROOT}/script/out/package.tar.gz"
if [[ ! -f "${PACKAGE_TARBALL}" ]]; then
  echo "error: ${PACKAGE_TARBALL} not found (run without --no-build?)" >&2
  exit 1
fi
echo "==> package: ${PACKAGE_TARBALL} ($(du -h "${PACKAGE_TARBALL}" | cut -f1))"

# --- 2. resolve project root per host --------------------------------------
resolve_project_root() {
  local host="$1" server_mount

  server_mount="$(ssh "${SSH_OPTS[@]}" "${host}" \
    'podman inspect reno_note_nodejs --format "{{range .Mounts}}{{if eq .Destination \"/app/server\"}}{{.Source}}{{end}}{{end}}"' \
    2>/dev/null || true)"

  if [[ -n "${server_mount}" ]]; then
    # e.g. <PROJECT_ROOT>/package/server -> <PROJECT_ROOT>
    echo "${server_mount%/server}" | sed 's#/package$##'
    return 0
  fi

  if [[ -n "${DEPLOY_PROJECT_ROOT:-}" ]]; then
    echo "${DEPLOY_PROJECT_ROOT}"
    return 0
  fi

  return 1
}

ROOTS=()
for host in "${HOSTS[@]}"; do
  if ! root="$(resolve_project_root "${host}")"; then
    echo "error: cannot determine project root on ${host} (containers down?)" >&2
    echo "       set DEPLOY_PROJECT_ROOT to the project root, or follow SKILL.md manually" >&2
    exit 1
  fi
  # Never operate on a bogus root: an empty/relative/near-root path would make
  # the remote "rm -rf ${root}/package" below dangerous.
  if [[ -z "${root}" || "${root}" != /* || "${root}" == "/" ]]; then
    echo "error: refusing unsafe project root '${root}' on ${host}" >&2
    exit 1
  fi
  ROOTS+=("${root}")
  echo "==> ${host}: project root ${root}"
done

if [[ ${ASSUME_YES} -eq 0 ]]; then
  echo
  echo "About to deploy to: ${HOSTS[*]}"
  read -r -p "Continue? [y/N] " reply || reply=""
  [[ "${reply}" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }
fi

# --- 3. deploy each host ----------------------------------------------------
for i in "${!HOSTS[@]}"; do
  host="${HOSTS[$i]}"
  root="${ROOTS[$i]}"
  qroot="$(printf '%q' "${root}")"   # shell-quote the path before it goes into a remote command

  echo "==> ${host}: uploading"
  scp "${SSH_OPTS[@]}" "${PACKAGE_TARBALL}" "${host}:${root}/" >/dev/null

  echo "==> ${host}: stopping containers"
  ssh "${SSH_OPTS[@]}" "${host}" "cd ${qroot}/package && podman-compose down >/dev/null 2>&1 || true"

  echo "==> ${host}: extracting"
  ssh "${SSH_OPTS[@]}" "${host}" "rm -rf ${qroot}/package && cd ${qroot} && tar -zxf package.tar.gz"

  echo "==> ${host}: starting containers"
  ssh "${SSH_OPTS[@]}" "${host}" "cd ${qroot}/package && podman-compose up -d >/dev/null 2>&1"
done

# --- 4. verify --------------------------------------------------------------
if [[ ${DO_VERIFY} -eq 1 ]]; then
  echo
  echo "==> waiting 25s for containers to settle"
  sleep 25

  for i in "${!HOSTS[@]}"; do
    host="${HOSTS[$i]}"
    echo "--- ${host}"
    ssh "${SSH_OPTS[@]}" "${host}" \
      "podman ps --filter name=reno_note --format '{{.Names}} {{.Status}}'"

    echo -n "    web  : "
    curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 "https://${host}/doc/client/" || echo "FAILED"
    echo -n "    api  : "
    curl -s --max-time 20 "https://${host}/doc/server/hello" || echo "FAILED"
    echo
  done
fi

echo "==> done"
