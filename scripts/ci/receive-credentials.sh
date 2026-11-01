#!/usr/bin/env bash
# One-time credential hand-off for a single Release run, for owners who can't
# add repository secrets (e.g. working from a phone).
#
#  1. This run generates a fresh RSA-4096 key pair; the private key never
#     leaves the runner VM, which is destroyed when the job ends.
#  2. It posts the PUBLIC key to the hand-off issue as github-actions[bot].
#  3. The repository owner replies with each credential encrypted to that key
#     (RSA-OAEP/SHA-256). Comments from anyone else are ignored.
#  4. The run decrypts, masks the values in all logs, deletes the encrypted
#     comment and writes the values to $RUNNER_TEMP for the Release step.
#
# Nothing readable is ever stored in the repository, its issues or logs.
set -euo pipefail

: "${GH_TOKEN:?}" "${ISSUE:?}" "${REPO:?}" "${OWNER:?}" "${RUN_ID:?}" "${RUNNER_TEMP:?}"
[[ "$ISSUE" =~ ^[0-9]+$ ]] || { echo "::error::handoff_issue must be an issue number"; exit 1; }

umask 077
dir="$RUNNER_TEMP/handoff"
mkdir -p "$dir"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$dir/key.pem" 2>/dev/null
pub="$(openssl pkey -in "$dir/key.pem" -pubout)"

marker="scopeflow-handoff-secret run=$RUN_ID"
body="$(printf 'scopeflow-handoff-key run=%s\n\nEncrypt each credential to this key and reply starting with `%s`.\n\n```\n%s\n```\n' "$RUN_ID" "$marker" "$pub")"
key_comment="$(gh api "repos/$REPO/issues/$ISSUE/comments" -f body="$body" --jq '.id')"
echo "Public key posted to issue #$ISSUE (comment $key_comment). Waiting up to 15 minutes for the owner's reply…"

deadline=$(( $(date +%s) + 900 ))
reply=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  reply="$(gh api "repos/$REPO/issues/$ISSUE/comments?per_page=100&sort=created&direction=desc" \
    --jq "[.[] | select(.id > $key_comment and .user.login == \"$OWNER\" and (.body | startswith(\"$marker\")))] | first | if . then \"\(.id)\n\(.body)\" else empty end")"
  [ -n "$reply" ] && break
  sleep 10
done
[ -n "$reply" ] || { echo "::error::No credentials received within 15 minutes — nothing was changed."; exit 1; }

reply_id="$(printf '%s\n' "$reply" | head -n1)"
received=0
while IFS= read -r line; do
  name="${line%%=*}"
  value="${line#*=}"
  case "$name" in
    SUPABASE_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID) ;;
    *) continue ;;
  esac
  [[ "$value" =~ ^[A-Za-z0-9+/=]+$ ]] || { echo "::error::$name is not valid base64"; exit 1; }
  plain="$(printf '%s' "$value" | base64 -d | openssl pkeyutl -decrypt -inkey "$dir/key.pem" \
    -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256)"
  [[ "$plain" =~ ^[A-Za-z0-9_.-]{8,200}$ ]] || { echo "::error::$name decrypted to an unexpected format"; exit 1; }
  echo "::add-mask::$plain"
  printf '%s' "$plain" > "$dir/$name"
  received=$((received + 1))
  echo "Received $name"
done < <(printf '%s\n' "$reply" | tail -n +2 | tr -d '\r')

rm -f "$dir/key.pem"
gh api -X DELETE "repos/$REPO/issues/comments/$reply_id" >/dev/null || true
gh api -X DELETE "repos/$REPO/issues/comments/$key_comment" >/dev/null || true
[ "$received" -gt 0 ] || { echo "::error::The reply contained no recognised credentials."; exit 1; }
