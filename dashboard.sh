#!/bin/bash
# Claude Slack Bot Dashboard — zellij-based interactive dashboard
# Top pane: live logs | Bottom pane: action menu
# Usage: ./dashboard.sh

cd "$(dirname "$0")"

if ! command -v zellij &>/dev/null; then
  echo "zellij is not installed. Install it: brew install zellij"
  exit 1
fi

if ! command -v pm2 &>/dev/null; then
  echo "pm2 is not installed. Install it: npm install -g pm2"
  exit 1
fi

# Ensure bot is started
pm2 describe claude-slack-bot &>/dev/null || pm2 start ecosystem.config.cjs

# Create helper scripts
ACTIONS_SCRIPT="/tmp/claude-bot-actions.sh"
cat > "$ACTIONS_SCRIPT" << 'SCRIPT'
#!/bin/bash
cd "$(dirname "$0")" 2>/dev/null
cd /Users/aryehbeitz/dev/claude-slack-bot 2>/dev/null

show_menu() {
    clear
    STATUS=$(pm2 pid claude-slack-bot 2>/dev/null)
    if [ -n "$STATUS" ] && [ "$STATUS" != "0" ]; then
        printf "\033[32m● Running (PID: %s)\033[0m\n" "$STATUS"
    else
        printf "\033[31m● Stopped\033[0m\n"
    fi
    echo ""
    echo "  [s] Start    [x] Stop    [r] Restart    [c] Clear logs    [q] Quit"
}

while true; do
    show_menu
    read -n1 -s key
    echo ""
    case $key in
        s) pm2 start ecosystem.config.cjs 2>&1 | tail -3 ;;
        x) pm2 stop claude-slack-bot 2>&1 | tail -3 ;;
        r) pm2 restart claude-slack-bot 2>&1 | tail -3 ;;
        c) zellij action move-focus up 2>/dev/null
           zellij action clear 2>/dev/null
           zellij action move-focus down 2>/dev/null
           pm2 flush claude-slack-bot 2>&1
           echo "Cleared." ;;
        q) zellij kill-session claude-bot 2>/dev/null; exit 0 ;;
    esac
    sleep 1
done
SCRIPT
chmod +x "$ACTIONS_SCRIPT"

LAYOUT="/tmp/claude-bot-layout.kdl"
cat > "$LAYOUT" << 'KDL'
layout {
    pane command="pm2" start_suspended=false {
        args "logs" "claude-slack-bot" "--lines" "100"
        name "Logs"
        size "80%"
    }
    pane command="bash" start_suspended=false {
        args "/tmp/claude-bot-actions.sh"
        name "Actions"
        size "20%"
    }
}
KDL

# Join existing session if alive, otherwise create with layout
# --force-run-commands: when resurrecting an EXITED session, run pane commands immediately (no "Waiting to run")
zellij --layout "$LAYOUT" attach --create --force-run-commands claude-bot
