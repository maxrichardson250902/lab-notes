"""
3090 SSH helpers — Wake-on-LAN, SSH commands, remote LLM management.
Dual-boot: Windows (Ollama HTTP) / Linux (llama.cpp SSH).
Used by enrichment, predictions, plan converter, workflow features.
"""
import subprocess, socket, time, os, json, shlex, urllib.request
from datetime import datetime

PC_IP        = os.getenv("PC_IP",        "192.168.1.144")
PC_USER      = os.getenv("PC_USER",      "max")
PC_SSH_PORT  = int(os.getenv("PC_SSH_PORT", "22"))
PC_MAC       = os.getenv("PC_MAC",       "d8:43:ae:91:2f:9b")
PC_MODEL     = os.getenv("PC_MODEL",     "llama-3.1-8b-instruct-q4_k_m.gguf")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
SSH_KEY      = os.getenv("SSH_KEY",      "/root/.ssh/boltz_key")
BOOT_TIMEOUT = int(os.getenv("BOOT_TIMEOUT", "120"))

OLLAMA_PORT  = 11434
LLAMA_PORT   = 8080

# ── Shared enrichment state ──────────────────────────────────────────────────
enrich_running = False
enrich_log: list[str] = []

# ── Backend tracking ─────────────────────────────────────────────────────────
active_backend = None   # 'ollama' | 'llamacpp' | None
detected_os = None      # 'windows' | 'linux' | None


def elog(msg: str):
    global enrich_log
    entry = f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}"
    enrich_log.append(entry)
    enrich_log = enrich_log[-40:]
    print(entry)


# ── Network helpers ──────────────────────────────────────────────────────────

def _port_open(ip, port, timeout=3) -> bool:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        result = s.connect_ex((ip, port))
        s.close()
        return result == 0
    except:
        return False


def _http_get(url, timeout=5) -> bool:
    try:
        req = urllib.request.Request(url)
        resp = urllib.request.urlopen(req, timeout=timeout)
        return resp.status == 200
    except:
        return False


# ── Detect backend (Windows Ollama / Linux llama.cpp / Linux SSH / offline) ──

def detect_backend() -> str | None:
    """Probe the 3090 to figure out what's running.
    Returns: 'ollama' | 'llamacpp' | 'linux' | 'windows' | None
    """
    global active_backend, detected_os

    # Check Ollama (Windows or Linux)
    if _http_get(f"http://{PC_IP}:{OLLAMA_PORT}/api/tags"):
        elog("Ollama responding on 3090")
        active_backend = 'ollama'
        detected_os = 'windows'
        return 'ollama'

    # Check llama.cpp (Linux)
    if _http_get(f"http://{PC_IP}:{LLAMA_PORT}/v1/models"):
        elog("llama.cpp responding on 3090")
        active_backend = 'llamacpp'
        detected_os = 'linux'
        return 'llamacpp'

    # Check SSH (Linux booted, LLM not started)
    if _port_open(PC_IP, PC_SSH_PORT):
        elog("Linux SSH available, LLM not running")
        detected_os = 'linux'
        active_backend = None
        return 'linux'

    # Check Windows RPC (Windows booted, Ollama not started)
    if _port_open(PC_IP, 135, timeout=2):
        elog("Windows running, Ollama not started")
        detected_os = 'windows'
        active_backend = None
        return 'windows'

    elog("3090 appears offline")
    detected_os = None
    active_backend = None
    return None


# ── SSH helpers ──────────────────────────────────────────────────────────────

def ssh_run(cmd: str, check: bool = True):
    return subprocess.run([
        "ssh", "-i", SSH_KEY,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-p", str(PC_SSH_PORT),
        f"{PC_USER}@{PC_IP}", cmd
    ], capture_output=True, text=True, check=check)


def pc_online() -> bool:
    """Check if the 3090 is reachable via any method."""
    return (_port_open(PC_IP, PC_SSH_PORT) or
            _port_open(PC_IP, OLLAMA_PORT) or
            _port_open(PC_IP, 135))


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


# ── LLM start (unified) ─────────────────────────────────────────────────────

def _start_llm_linux() -> bool:
    """Start llama.cpp on Linux via SSH."""
    r = ssh_run("curl -sf http://localhost:8080/v1/models", check=False)
    if r.returncode == 0:
        elog("LLM already running on 3090 (llama.cpp)")
        return True
    elog(f"Starting llama.cpp ({PC_MODEL})...")
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
            elog("llama.cpp ready")
            return True
    elog("llama.cpp failed to start after 90s")
    return False


def start_llm() -> bool:
    """Detect backend and start LLM if needed. Works on Windows + Linux."""
    global active_backend

    backend = detect_backend()

    if backend == 'ollama':
        active_backend = 'ollama'
        elog("Ollama ready on Windows")
        return True

    if backend == 'llamacpp':
        active_backend = 'llamacpp'
        elog("llama.cpp ready on Linux")
        return True

    if backend == 'linux':
        if _start_llm_linux():
            active_backend = 'llamacpp'
            return True
        return False

    if backend == 'windows':
        elog("Windows is running but Ollama is not started. Start Ollama on the 3090.")
        return False

    # Offline — try wake
    elog("3090 offline, sending Wake-on-LAN...")
    if ensure_pc_online():
        time.sleep(5)
        return start_llm()  # recurse once after wake
    return False


# ── LLM call (unified) ──────────────────────────────────────────────────────

def _call_ollama(system: str, prompt: str, max_tokens: int) -> str:
    """Call Ollama HTTP API directly (no SSH needed)."""
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "stream": False,
        "options": {"num_predict": max_tokens, "temperature": 0.2}
    }).encode('utf-8')
    req = urllib.request.Request(
        f"http://{PC_IP}:{OLLAMA_PORT}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    resp = urllib.request.urlopen(req, timeout=120)
    data = json.loads(resp.read())
    return data["message"]["content"].strip()


def _call_llamacpp_ssh(system: str, prompt: str, max_tokens: int) -> str:
    """Call llama.cpp via SSH + curl (Linux)."""
    payload = json.dumps({
        "model": PC_MODEL, "max_tokens": max_tokens, "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ]
    })
    cmd = (
        f"curl -sf -X POST http://localhost:8080/v1/chat/completions "
        f"-H 'Content-Type: application/json' -d {shlex.quote(payload)}"
    )
    r = ssh_run(cmd)
    data = json.loads(r.stdout)
    return data["choices"][0]["message"]["content"].strip()


def call_llm_3090(system: str, prompt: str, max_tokens: int = 300) -> str:
    """Unified LLM call — routes to Ollama or llama.cpp depending on backend."""
    global active_backend

    if not active_backend:
        detect_backend()

    if active_backend == 'ollama':
        elog("Calling Ollama (Windows)...")
        return _call_ollama(system, prompt, max_tokens)
    elif active_backend == 'llamacpp':
        elog("Calling llama.cpp (Linux via SSH)...")
        return _call_llamacpp_ssh(system, prompt, max_tokens)
    else:
        raise RuntimeError("No LLM backend available — is the 3090 on?")


def title_similarity(a: str, b: str) -> float:
    """Simple word overlap similarity between two titles."""
    wa = set(a.lower().split())
    wb = set(b.lower().split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / max(len(wa), len(wb))
