#!/usr/bin/env python3
import sys
import json
import os

try:
    import redis
except ImportError:
    redis = None

def log_error(err_msg):
    log_dir = "/var/ossec/logs"
    if not os.path.exists(log_dir):
        # Fallback to local logs directory if not in ossec environment
        log_dir = os.path.join(os.path.dirname(__file__), "../../logs")
        os.makedirs(log_dir, exist_ok=True)
    
    log_path = os.path.join(log_dir, "bayezid_bridge_errors.log")
    try:
        with open(log_path, "a") as f:
            f.write(f"[ERROR] {err_msg}\n")
    except Exception:
        pass

def main():
    alert_data = None
    try:
        # Wazuh integration convention: sys.argv[1] is the temporary alert JSON file path
        if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
            with open(sys.argv[1], "r") as f:
                alert_data = json.load(f)
        else:
            # Fallback to stdin
            alert_data = json.loads(sys.stdin.readline().strip())
    except Exception as e:
        log_error(f"Failed to read alert payload: {str(e)}")
        return

    if not alert_data:
        log_error("Alert payload empty.")
        return

    # Filter rule level < 6 (low severity)
    rule = alert_data.get("rule", {})
    rule_level = int(rule.get("level", 0))
    if rule_level < 6:
        return # Skip low severity alerts

    # Normalize to AlertEvent schema
    normalized = {
        "timestamp": alert_data.get("timestamp", ""),
        "rule_id": rule.get("id", "0"),
        "rule_description": rule.get("description", "Wazuh Alert"),
        "agent_name": alert_data.get("agent", {}).get("name", "unknown"),
        "agent_ip": alert_data.get("agent", {}).get("ip", "127.0.0.1"),
        "srcip": alert_data.get("data", {}).get("srcip", alert_data.get("srcip", "127.0.0.1")),
        "dstip": alert_data.get("data", {}).get("dstip", alert_data.get("dstip", "127.0.0.1")),
        "protocol": alert_data.get("data", {}).get("protocol", "tcp"),
        "severity_level": str(rule_level),
        "mitre_tactic": ",".join(rule.get("mitre", {}).get("tactic", [])),
        "mitre_technique": ",".join(rule.get("mitre", {}).get("id", [])),
        "full_log": alert_data.get("full_log", "")
    }

    # Write to Redis Stream
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    try:
        if redis:
            r = redis.from_url(redis_url)
            r.xadd("bayezid:alerts:raw", {"alert": json.dumps(normalized)}, maxlen=100000, approximate=True)
            print("Alert successfully queued to Redis Stream")
        else:
            # Fallback to curl HTTP webhook to server.js if redis library is not installed
            import urllib.request
            hook_url = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:3000/api/v1/wazuh/ingest"
            api_key = sys.argv[2] if len(sys.argv) > 2 else "bayezid_wazuh_secret_token"
            req = urllib.request.Request(
                hook_url,
                data=json.dumps(normalized).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-Wazuh-Token": api_key
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    print("Alert successfully sent to Webhook")
                else:
                    log_error(f"HTTP hook returned status code: {response.status}")
    except Exception as e:
        log_error(f"Bridge publish failed: {str(e)}")

if __name__ == "__main__":
    main()
