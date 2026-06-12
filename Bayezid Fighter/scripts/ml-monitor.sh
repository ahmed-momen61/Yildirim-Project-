#!/bin/bash
# ml-monitor.sh: tmux terminal split monitoring ML engine services

SESSION="ML_MONITOR"
tmux has-session -t $SESSION 2>/dev/null

if [ $? -ne 0 ]; then
    # Create new session, split it into 3 panes
    tmux new-session -d -s $SESSION -n "ML Logs" "journalctl -fu bayezid-python-ml@gnn"
    tmux split-window -h -t $SESSION:0.0 "journalctl -fu bayezid-python-ml@causal"
    tmux split-window -v -t $SESSION:0.1 "journalctl -fu bayezid-python-ml@sniper"
    tmux select-layout -t $SESSION main-horizontal
fi

tmux attach-session -t $SESSION
