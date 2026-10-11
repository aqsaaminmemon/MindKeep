#!/usr/bin/env bash
# Configure reset-email delivery locally without putting secrets in shell history.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p data
printf 'Configure the SMTP service that sends MindKeep password reset emails.\n'
if [[ "${1:-}" == "--gmail" ]]; then
  MK_MAIL_HOST=smtp.gmail.com
  MK_MAIL_PORT=587
  printf 'Gmail selected. Enable 2-Step Verification and create a Google app password first.\n'
else
  read -r -p 'SMTP host: ' MK_MAIL_HOST
  read -r -p 'SMTP port [587, STARTTLS]: ' MK_MAIL_PORT
  MK_MAIL_PORT="${MK_MAIL_PORT:-587}"
fi
if [[ -z "$MK_MAIL_HOST" || ! "$MK_MAIL_PORT" =~ ^[0-9]{1,5}$ ]] || ((10#$MK_MAIL_PORT < 1 || 10#$MK_MAIL_PORT > 65535)); then
  printf 'Enter a host and a port between 1 and 65535.\n' >&2
  exit 1
fi
read -r -p 'SMTP username: ' MK_MAIL_USER
read -r -s -p 'SMTP password (hidden; use your provider-issued SMTP credential): ' MK_MAIL_SECRET
printf '\n'
if [[ "${1:-}" == "--gmail" ]]; then
  MK_MAIL_SECRET="${MK_MAIL_SECRET// /}"
  MK_MAIL_FROM="$MK_MAIL_USER"
else
  read -r -p 'Sender email address: ' MK_MAIL_FROM
fi
if [[ -z "$MK_MAIL_USER" || -z "$MK_MAIL_SECRET" || "$MK_MAIL_FROM" != *@* ]]; then
  printf 'Username, password and a sender email address are required.\n' >&2
  exit 1
fi
MK_MAIL_TEMP=$(mktemp data/mail.env.XXXXXX)
trap 'rm -f "$MK_MAIL_TEMP"' EXIT
{
  printf 'export SMTP_HOST=%q\n' "$MK_MAIL_HOST"
  printf 'export SMTP_PORT=%q\n' "$MK_MAIL_PORT"
  printf 'export SMTP_USERNAME=%q\n' "$MK_MAIL_USER"
  printf 'export SMTP_PASSWORD=%q\n' "$MK_MAIL_SECRET"
  printf 'export SMTP_FROM=%q\n' "$MK_MAIL_FROM"
  printf 'export MINDKEEP_MAIL_COMMAND=%q\n' "python3 \"$PWD/scripts/send-email.py\""
} > "$MK_MAIL_TEMP"
chmod 600 "$MK_MAIL_TEMP"
mv "$MK_MAIL_TEMP" data/mail.env
unset MK_MAIL_SECRET
printf 'Saved private email settings in data/mail.env. Restart MindKeep to load them.\n'
printf 'SMTP delivery is verified when you successfully request a reset email.\n'
