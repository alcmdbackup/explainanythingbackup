#!/usr/bin/env bash
# Persistent system monitor for S16.
# Active mode: polls status files, sends ONE summary when all skills stop.
# Idle mode: blocks on inotifywait (zero CPU). Dashboard only when user attached.
# Usage:
#   maintenance-watcher.sh <DATE> <LOG_DIR> <REPO_DIR>   # scheduler launch (active first)
#   maintenance-watcher.sh --monitor                       # standalone (idle only)
set -euo pipefail

REPO_DIR="${3:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG_DIR="${2:-$REPO_DIR/logs/maintenance}"
TRIGGER_FILE="$LOG_DIR/.maintenance-trigger"

# Preflight: verify inotifywait is available
if ! command -v inotifywait &>/dev/null; then
  echo "FATAL: inotifywait not found. Install: apt install inotify-tools" >&2
  exit 1
fi

# Source credentials if available (for Slack/Resend notifications)
[ -f /etc/maintenance-scheduler.env ] && set -a && source /etc/maintenance-scheduler.env && set +a

SKILLS=(refactor-simplify test-gaps update-docs ts-coverage bugs-code bugs-ux)
declare -A SKILL_SESSIONS=(
  [refactor-simplify]=S10 [test-gaps]=S11 [update-docs]=S12
  [ts-coverage]=S13 [bugs-code]=S14 [bugs-ux]=S15
)

# ─── Notification: single summary after all skills stop ───

send_summary() {
  local DATE="$1"
  local PASS=0 FAIL=0 TIMED_OUT=0 SUMMARY_TEXT=""

  for skill in "${SKILLS[@]}"; do
    local STATUS=$(cat "$LOG_DIR/${skill}-${DATE}.status" 2>/dev/null || echo "unknown")
    local SESSION="${SKILL_SESSIONS[$skill]}" ICON
    case "$STATUS" in
      success) PASS=$((PASS+1)); ICON="✅" ;; failure) FAIL=$((FAIL+1)); ICON="❌" ;;
      timeout) TIMED_OUT=$((TIMED_OUT+1)); ICON="⏰" ;; *) ICON="❓" ;;
    esac
    SUMMARY_TEXT="${SUMMARY_TEXT}${ICON} ${SESSION} ${skill}: ${STATUS}\n"
  done

  local HEADLINE="${PASS} passed, ${FAIL} failed, ${TIMED_OUT} timed out"
  echo "=== MAINTENANCE SUMMARY ${DATE}: ${HEADLINE} ==="
  echo -e "$SUMMARY_TEXT"

  # 1. wall (all terminals)
  echo -e "Maintenance ${DATE}: ${HEADLINE}\n${SUMMARY_TEXT}" | wall 2>/dev/null || true

  # 2. notify-send (desktop)
  if [ "$FAIL" -gt 0 ] || [ "$TIMED_OUT" -gt 0 ]; then
    notify-send -u critical "Maintenance ${DATE}: ${HEADLINE}" "tmux attach -t S16" 2>/dev/null || true
  else
    notify-send "Maintenance ${DATE}: all passed" "" 2>/dev/null || true
  fi

  # 3. Slack
  local SLACK_COLOR="good"
  [ "$FAIL" -gt 0 ] && SLACK_COLOR="danger"
  [ "$TIMED_OUT" -gt 0 ] && SLACK_COLOR="warning"
  send_slack "Maintenance Report ${DATE}" "${HEADLINE}\n${SUMMARY_TEXT}" "$SLACK_COLOR"

  # 4. Resend email
  send_resend_email "$DATE"
}

# ─── Notification channel helpers ───

send_slack() {
  local SUBJECT="$1" BODY="$2" COLOR="${3:-good}"
  local SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
  [ -z "$SLACK_WEBHOOK_URL" ] && return 0
  local PAYLOAD
  PAYLOAD=$(jq -n --arg color "$COLOR" --arg title "$SUBJECT" \
    --arg text "$BODY" --arg footer "maintenance-monitor | $(hostname)" \
    '{attachments:[{color:$color, title:$title, text:$text, footer:$footer}]}')
  curl -s -X POST -H 'Content-type: application/json' --data "$PAYLOAD" \
    "$SLACK_WEBHOOK_URL" || echo "WARN: Slack failed"
}

send_resend_email() {
  local DATE="$1"
  local RESEND_KEY="${RESEND_API_KEY:-}"
  local NOTIFY_EMAIL="${MAINT_NOTIFY_EMAIL:-}"
  local FROM_EMAIL="${MAINT_FROM_EMAIL:-maintenance@explainanything.com}"
  [ -z "$RESEND_KEY" ] || [ -z "$NOTIFY_EMAIL" ] && return 0

  local PASS=0 FAIL=0 TIMED_OUT=0 HTML_ROWS=""
  for skill in "${SKILLS[@]}"; do
    local STATUS=$(cat "$LOG_DIR/${skill}-${DATE}.status" 2>/dev/null || echo "unknown")
    local SESSION="${SKILL_SESSIONS[$skill]}"
    local BRANCH="chore/maint-${skill}-${DATE}"
    local COLOR ICON
    case "$STATUS" in
      success) COLOR="#22c55e"; ICON="&#9989;"; PASS=$((PASS+1)) ;;
      failure) COLOR="#ef4444"; ICON="&#10060;"; FAIL=$((FAIL+1)) ;;
      timeout) COLOR="#f59e0b"; ICON="&#9200;"; TIMED_OUT=$((TIMED_OUT+1)) ;;
      *)       COLOR="#6b7280"; ICON="&#10067;" ;;
    esac
    HTML_ROWS="${HTML_ROWS}<tr><td>${ICON} ${SESSION}</td><td>${skill}</td><td style='color:${COLOR};font-weight:bold'>${STATUS}</td><td><code>${BRANCH}</code></td></tr>"
  done

  local SUBJECT="Maintenance Report ${DATE}: ${PASS} passed, ${FAIL} failed, ${TIMED_OUT} timeout"
  local HTML_BODY="<h2>Maintenance Report - ${DATE}</h2>\
<p><strong>${PASS}</strong> passed, <strong>${FAIL}</strong> failed, <strong>${TIMED_OUT}</strong> timed out</p>\
<table border='1' cellpadding='8' cellspacing='0' style='border-collapse:collapse;font-family:monospace'>\
<tr style='background:#f3f4f6'><th>Session</th><th>Skill</th><th>Status</th><th>Branch</th></tr>\
${HTML_ROWS}</table>\
<p style='margin-top:16px'>To review: <code>ssh minicomputer && tmux attach -t S10</code></p>\
<hr><p style='color:#6b7280;font-size:12px'>maintenance-monitor on $(hostname)</p>"

  local PAYLOAD
  PAYLOAD=$(jq -n \
    --arg from "Maintenance <${FROM_EMAIL}>" \
    --arg to "$NOTIFY_EMAIL" \
    --arg subject "$SUBJECT" \
    --arg html "$HTML_BODY" \
    '{from:$from, to:[$to], subject:$subject, html:$html, tags:[{name:"type",value:"maintenance"}]}')
  curl -s -X POST 'https://api.resend.com/emails' \
    -H "Authorization: Bearer ${RESEND_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD" \
    && echo "Email sent to ${NOTIFY_EMAIL}" \
    || echo "WARN: Resend email failed"
}

# ─── Active mode: wait for all skills to stop, then notify once ───

watch_run() {
  local DATE="$1"
  local TOTAL=${#SKILLS[@]}
  local TIMEOUT=7200  # 2 hours
  local START=$(date +%s)

  echo "━━━ ACTIVE: Monitoring run ${DATE} (${TOTAL} skills, timeout: ${TIMEOUT}s) ━━━"

  while true; do
    local DONE=0 ELAPSED=$(( $(date +%s) - START ))

    for skill in "${SKILLS[@]}"; do
      local STATUS_FILE="$LOG_DIR/${skill}-${DATE}.status"
      if [ ! -f "$STATUS_FILE" ]; then
        # Missing status file = skill never launched, count as done (failure)
        DONE=$((DONE + 1))
        continue
      fi
      [[ "$(cat "$STATUS_FILE")" != "running" ]] && DONE=$((DONE + 1))
    done

    # Progress line (overwrite in-place, no scroll)
    printf "\r  [%02d:%02d] %d/%d skills complete" $((ELAPSED/60)) $((ELAPSED%60)) "$DONE" "$TOTAL"

    if [ "$DONE" -ge "$TOTAL" ]; then
      echo ""; break
    fi

    if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
      echo ""
      for skill in "${SKILLS[@]}"; do
        local SF="$LOG_DIR/${skill}-${DATE}.status"
        [ -f "$SF" ] && [ "$(cat "$SF")" == "running" ] && echo "timeout" > "$SF"
      done
      break
    fi

    sleep 30
  done

  # --- Single summary notification (all 4 channels) ---
  send_summary "$DATE"
}

# ─── Idle mode: live dashboard ───

show_dashboard() {
  clear
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  S16 SYSTEM MONITOR — $(date '+%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Last maintenance run
  local LATEST_LOG=$(ls -t "$LOG_DIR"/scheduler-*.log 2>/dev/null | head -1)
  if [ -n "$LATEST_LOG" ]; then
    local LAST_DATE=$(basename "$LATEST_LOG" | sed 's/scheduler-//;s/.log//')
    echo "  LAST RUN: ${LAST_DATE}"
    local P=0 F=0 T=0
    for skill in "${SKILLS[@]}"; do
      local S=$(cat "$LOG_DIR/${skill}-${LAST_DATE}.status" 2>/dev/null || echo "none")
      case "$S" in success) P=$((P+1));; failure) F=$((F+1));; timeout) T=$((T+1));; esac
    done
    echo "  Results:  ✅ ${P} passed  ❌ ${F} failed  ⏰ ${T} timeout"
  else
    echo "  LAST RUN: (none)"
  fi
  echo ""

  # tmux sessions
  echo "  TMUX SESSIONS:"
  for skill in "${SKILLS[@]}"; do
    local SESSION="${SKILL_SESSIONS[$skill]}"
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "    ${SESSION}  ${skill}  🟢 alive"
    else
      echo "    ${SESSION}  ${skill}  ⚫ stopped"
    fi
  done
  echo ""

  # Evolution runner
  echo "  EVOLUTION RUNNER:"
  if systemctl is-active --quiet evolution-runner.timer 2>/dev/null; then
    local NEXT=$(systemctl show evolution-runner.timer --property=NextElapseUSecRealtime --value 2>/dev/null || echo "unknown")
    echo "    Timer:  🟢 active (next: ${NEXT})"
  else
    echo "    Timer:  ⚫ inactive"
  fi
  echo ""

  # Maintenance timer
  echo "  MAINTENANCE SCHEDULER:"
  if systemctl is-active --quiet maintenance-scheduler.timer 2>/dev/null; then
    local NEXT=$(systemctl show maintenance-scheduler.timer --property=NextElapseUSecRealtime --value 2>/dev/null || echo "unknown")
    echo "    Timer:  🟢 active (next: ${NEXT})"
  else
    echo "    Timer:  ⚫ inactive"
  fi
  echo ""

  # Disk usage
  echo "  DISK USAGE:"
  echo "    logs/maintenance/:  $(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)"
  echo "    docs/planning/:    $(du -sh "$REPO_DIR/docs/planning" 2>/dev/null | cut -f1)"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Refreshing every 60s | Ctrl+C for menu"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ─── Main loop: persistent monitor ───

# If called with a DATE arg, start in active mode for that run
if [ "${1:-}" != "--monitor" ] && [ -n "${1:-}" ]; then
  watch_run "$1"
fi

# Ensure trigger dir exists and clean any stale trigger
mkdir -p "$LOG_DIR"
rm -f "$TRIGGER_FILE"

echo "S16 entering idle mode. Blocking on inotifywait (zero CPU)."

while true; do
  # Render dashboard ONLY if a user is attached to S16
  ATTACHED=$(tmux display-message -p -t S16 '#{session_attached}' 2>/dev/null || echo "0")
  if [ "$ATTACHED" != "0" ]; then
    show_dashboard
  fi

  # Block until trigger file appears — zero CPU, zero I/O while waiting.
  # 300s timeout lets us refresh dashboard if user attaches mid-wait.
  inotifywait -t 300 -qq -e create -e modify "$LOG_DIR/" --include '^\\.maintenance-trigger$' 2>/dev/null || true

  # Check if trigger file appeared (vs timeout)
  if [ -f "$TRIGGER_FILE" ]; then
    NEW_DATE=$(cat "$TRIGGER_FILE")
    rm -f "$TRIGGER_FILE"
    watch_run "$NEW_DATE"
    echo "Run complete. Returning to idle mode..."
  fi
done
