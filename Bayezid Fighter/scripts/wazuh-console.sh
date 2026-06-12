#!/bin/bash
# wazuh-console.sh: prints IP, Wazuh Manager URL and drops to interactive bash

echo "================================================="
echo "          WAZUH SENSOR CONSOLE"
echo "================================================="
IP=$(hostname -I | awk '{print $1}')
if [ -z "$IP" ]; then
    IP="127.0.0.1"
fi
echo "[+] Machine IP: $IP"
echo "[+] Wazuh Manager URL: https://${IP}:443"
echo "================================================="
echo "[*] Dropping to interactive shell for Wazuh CLI operations..."
exec /bin/bash --login
