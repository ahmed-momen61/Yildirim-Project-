#!/bin/bash
# start-ml-daemons.sh: starts python daemons in background
cd /opt/bayezid
python3 ml_engine/main.py > /var/log/bayezid-ml-sniper.log 2>&1 &
python3 ml_engine/gnn_oracle.py > /var/log/bayezid-gnn-oracle.log 2>&1 &
python3 ml_engine/causal_engine.py > /var/log/bayezid-causal-engine.log 2>&1 &
python3 ml_engine/llvm_mutator.py > /var/log/bayezid-llvm-mutator.log 2>&1 &
echo "[+] ML Daemons started in background."
