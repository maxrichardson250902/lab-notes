"""
3090 SSH helpers — Wake-on-LAN, SSH commands, remote LLM management.
Used by enrichment & predictions features.
"""
import subprocess, socket, time, os, json, shlex
from datetime import datetime

PC_IP        = os.getenv("PC_IP",        "192.168.1.144")
PC_USER      = os.getenv("PC_USER",      "max")
PC_SSH_PORT  = int(os.getenv("PC_SSH_PORT", "22"))
PC_MAC       = os.getenv("PC_MAC",       "d8:43:ae:91:2f:9b")
PC_MODEL     = os.getenv("PC_MODEL",     "llama-3.1-8b-instruct-q4_k_m.gguf")
SSH_KEY      = os.getenv("SSH_KEY",      "/root/.ssh/boltz_key")
BOOT_TIMEOUT = int(os.getenv("BOOT_TIMEOUT", "120"))

# ── Shared enrichment state ──────────────────────────────────────────────────
enrich_running = False
enrich_log: list[str] = []


def elog(msg: str):
    global enrich_log
    entry = f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}"
    enrich_log.append(entry)
    enrich_log = enrich_log[-40:]
    print(entry)


def ssh_run(cmd: str, check: bool = True):
    return subprocess.run([
        "ssh", "-i", SSH_KEY,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-p", str(PC_SSH_PORT),
        f"{PC_USER}@{PC_IP}", cmd
    ], capture_output=True, text=True, check=check)


def pc_online() -> bool:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3)
        result = s.connect_ex((PC_IP, PC_SSH_PORT))
        s.close()
        return result == 0
    except:
        return False


def wake_pc():
    mac = PC_MAC.replace(":", "")
    payload = bytes.fromhex("F" * 12 + mac * 16)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(payload, ("255.255.255.255", 9))


def ensure_pc_online() -> bool:
    if pc_online():
        elog("3090 already online")
        return True
    elog(f"Waking 3090 ({PC_MAC})...")
    wake_pc()
    deadline = time.time() + BOOT_TIMEOUT
    while time.time() < deadline:
        if pc_online():
            elog("3090 is online")
            time.sleep(3)
            return True
        time.sleep(5)
    return False


def start_llm() -> bool:
    r = ssh_run("curl -sf http://localhost:8080/v1/models", check=False)
    if r.returncode == 0:
        elog("LLM already running on 3090")
        return True
    elog(f"Starting LLM ({PC_MODEL})...")
    ssh_run(
        f"nohup /home/max/anaconda3/bin/conda run -n boltz_env "
        f"python3 -m llama_cpp.server "
        f"--model /home/max/models/{PC_MODEL} "
        f"--host 0.0.0.0 --port 8080 --n_ctx 4096 "
        f"> /tmp/llama.log 2>&1 &",
        check=False
    )
    for _ in range(30):
        time.sleep(3)
        r = ssh_run("curl -sf http://localhost:8080/v1/models", check=False)
        if r.returncode == 0:
            elog("LLM ready")
            return True
    return False


def call_llm_3090(system: str, prompt: str, max_tokens: int = 300) -> str:
    payload = json.dumps({
        "model": PC_MODEL, "max_tokens": max_tokens, "temperature": 0.2,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    })
    cmd = (
        f"curl -sf -X POST http://localhost:8080/v1/chat/completions "
        f"-H 'Content-Type: application/json' -d {shlex.quote(payload)}"
    )
    r = ssh_run(cmd)
    data = json.loads(r.stdout)
    return data["choices"][0]["message"]["content"].strip()


def title_similarity(a: str, b: str) -> float:
    """Simple word overlap similarity between two titles."""
    wa = set(a.lower().split())
    wb = set(b.lower().split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / max(len(wa), len(wb))
