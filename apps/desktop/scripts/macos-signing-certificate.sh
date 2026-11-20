#!/usr/bin/env bash
# Makes the certificate the Mac app is signed with, once, and puts it in the repository's
# GitHub secrets. A signature that stays the same from one version to the next is what
# lets macOS keep the Screen Recording and Accessibility permissions across updates:
# with the ad hoc signature of earlier versions, every update looked like a new app.
#
# The certificate is self-signed: it does not remove Gatekeeper's warning at the first
# launch (that needs a paid Apple Developer ID), only the permissions being asked again.
#
# Usage: apps/desktop/scripts/macos-signing-certificate.sh [owner/repo]
# Needs openssl and the GitHub CLI (gh), signed in with access to the repository.
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
name="Couchwarp self-signed"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cat >"$work/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$work/key.pem" -out "$work/cert.pem" -config "$work/cert.cnf"

password="$(openssl rand -base64 24)"
# Algorithms macOS's keychain imports, whatever the OpenSSL or LibreSSL version.
openssl pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -inkey "$work/key.pem" -in "$work/cert.pem" \
  -name "$name" -out "$work/cert.p12" -passout "pass:$password"

base64 <"$work/cert.p12" | tr -d '\n' | gh secret set APPLE_CERTIFICATE --repo "$repo"
printf '%s' "$password" | gh secret set APPLE_CERTIFICATE_PASSWORD --repo "$repo"
printf '%s' "$name" | gh secret set APPLE_SIGNING_IDENTITY --repo "$repo"

echo "Secrets APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD and APPLE_SIGNING_IDENTITY set on $repo."
# A copy to keep (Bitwarden): with a new certificate, macOS would ask once more.
backup="$HOME/couchwarp-macos-signing.p12"
cp "$work/cert.p12" "$backup"
echo "A copy is in $backup, password: $password"
echo "Keep both in Bitwarden, then delete the file. A new certificate later means macOS asks for the permissions once more."
