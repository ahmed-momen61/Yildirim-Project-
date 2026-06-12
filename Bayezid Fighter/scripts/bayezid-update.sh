#!/bin/bash
# bayezid-update.sh: orchestrates Kali Linux OS package, code repo, deps, model, and service updates.

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}===================================================${NC}"
echo -e "${YELLOW}          BAYEZID GLOBAL UPDATE UTILITY            ${NC}"
echo -e "${YELLOW}===================================================${NC}"

# Helper to exit on failure
fail_step() {
    echo -e "${RED}[❌] Step failed: $1${NC}"
    echo -e "${RED}[+] Attempting rollback / restoring state...${NC}"
    # Rollback logic: if git was updated, checkout previous commit
    if [ -f "/tmp/bayezid_prev_commit" ]; then
        PREV_COMMIT=$(cat /tmp/bayezid_prev_commit)
        echo -e "${YELLOW}[🔄] Rolling back git repository to commit $PREV_COMMIT...${NC}"
        cd /opt/bayezid && git reset --hard "$PREV_COMMIT"
    fi
    echo -e "${RED}[🛑] Update aborted.${NC}"
    exit 1
}

# 1. Update OS packages
echo -e "\n${YELLOW}[1/10] Updating Kali Linux OS packages...${NC}"
sudo apt-get update && sudo apt-get upgrade -y || fail_step "APT update/upgrade failed."

# Save current git commit for rollback
if [ -d "/opt/bayezid/.git" ]; then
    cd /opt/bayezid
    git rev-parse HEAD > /tmp/bayezid_prev_commit
fi

# 2. Git fetch and diff
echo -e "\n${YELLOW}[2/10] Fetching repository updates...${NC}"
cd /opt/bayezid && git fetch origin || fail_step "Git fetch failed."
echo -e "${GREEN}[+] Pending changes:${NC}"
git diff --stat origin/main

# 3. Interactive prompt
echo -e "\n${YELLOW}[3/10] Codebase update prompt:${NC}"
read -p "Apply codebase patch? [y/N]: " CONFIRM
if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}[+] Applying git pull origin main...${NC}"
    git pull origin main || fail_step "Git pull failed."
else
    echo -e "${GREEN}[+] Codebase patch skipped.${NC}"
fi

# 4. Node.js deps
echo -e "\n${YELLOW}[4/10] Installing Node.js dependencies...${NC}"
npm install --prefix /opt/bayezid || fail_step "Node dependency installation failed."

# 5. Pip packages
echo -e "\n${YELLOW}[5/10] Updating Python ML package dependencies...${NC}"
if [ -f "/opt/bayezid/ml_engine/requirements.txt" ]; then
    pip install --break-system-packages -r /opt/bayezid/ml_engine/requirements.txt || fail_step "Pip install requirements failed."
else
    echo -e "${GREEN}[+] No requirements.txt found. Skipping.${NC}"
fi

# 6. Ollama model update
echo -e "\n${YELLOW}[6/10] Pulling latest local LLM model via Ollama...${NC}"
if [ -f "/opt/bayezid/.env" ]; then
    MODEL_NAME=$(grep -E "^LOCAL_MODEL_NAME=" /opt/bayezid/.env | cut -d= -f2 | tr -d '"' | tr -d "'")
    if [ -n "$MODEL_NAME" ]; then
        echo -e "${YELLOW}[+] Pulling model: $MODEL_NAME${NC}"
        ollama pull "$MODEL_NAME" || fail_step "Ollama pull model failed."
    else
        echo -e "${YELLOW}[⚠️] No LOCAL_MODEL_NAME found in .env. Pulling fallback qwen2.5-coder:7b...${NC}"
        ollama pull qwen2.5-coder:7b || fail_step "Ollama fallback pull failed."
    fi
else
    echo -e "${YELLOW}[⚠️] No .env file found. Pulling fallback qwen2.5-coder:7b...${NC}"
    ollama pull qwen2.5-coder:7b || fail_step "Ollama fallback pull failed."
fi

# 7. Restart services
echo -e "\n${YELLOW}[7/10] Restarting systemd services...${NC}"
sudo systemctl restart bayezid-python-ml bayezid-backend || fail_step "Service restart failed."

# 8. Docker update
echo -e "\n${YELLOW}[8/10] Updating Docker components...${NC}"
sudo apt-get install --only-upgrade -y docker.io docker-compose-plugin || fail_step "Docker update failed."

# 9. Wazuh update
echo -e "\n${YELLOW}[9/10] Updating Wazuh Manager controls...${NC}"
if [ -f "/var/ossec/bin/ossec-control" ]; then
    sudo /var/ossec/bin/ossec-control update || fail_step "Wazuh control update failed."
else
    echo -e "${YELLOW}[⚠️] /var/ossec/bin/ossec-control not found. Skipping.${NC}"
fi

# 10. Print summary
echo -e "\n${GREEN}[10/10] Generating status report...${NC}"
echo -e "${GREEN}===================================================${NC}"
echo -e "${GREEN}            UPDATE COMPLETE SUMMARY                ${NC}"
echo -e "${GREEN}===================================================${NC}"
echo -e "Node version: $(node -v)"
echo -e "Docker version: $(docker --version)"
if command -v ollama &> /dev/null; then
    echo -e "Ollama active models:"
    ollama list
fi
echo -e "\nService status:"
sudo systemctl status bayezid-backend --no-pager -n 5
sudo systemctl status bayezid-python-ml --no-pager -n 5
echo -e "${GREEN}===================================================${NC}"
