"""
LLM helpers — local LLM calls and URL fetching.
Used by features that need AI summarisation / classification.
"""
import httpx, os, re

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:8080")
LLM_MODEL    = os.getenv("LLM_MODEL",    "local")
TODO_API_URL = os.getenv("TODO_API_URL",  "http://localhost:3000")


async def llm(prompt: str, system: str = "", max_tokens: int = 300) -> str:
    """Async LLM call. Routes to the backend selected in Settings:
        "claude" → Anthropic API (falls back to local on cap / missing key)
        otherwise → the local OpenAI-compatible endpoint at LLM_BASE_URL.
    Returns "" on any failure (callers treat that as 'LLM unavailable')."""
    # Backend selection (shared with the sync path in core.ssh).
    backend = "local"
    try:
        from core.claude import current_backend
        backend = current_backend()
    except Exception:
        backend = "local"

    if backend == "claude":
        # call_claude is synchronous; run it in a thread so we don't block the
        # event loop. Falls back to the local path on cap / not-configured.
        try:
            import asyncio
            from core.claude import call_claude, CapReachedError, ClaudeNotConfigured
            loop = asyncio.get_event_loop()
            try:
                return await loop.run_in_executor(
                    None, call_claude, system, prompt, max_tokens)
            except (CapReachedError, ClaudeNotConfigured):
                pass  # fall through to local
        except Exception:
            pass  # fall through to local

    try:
        msgs = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.append({"role": "user", "content": prompt})
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{LLM_BASE_URL}/v1/chat/completions", json={
                "model": LLM_MODEL, "max_tokens": max_tokens, "temperature": 0.3,
                "messages": msgs
            })
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"].strip()
    except:
        pass
    return ""


async def fetch_url_text(url: str) -> str:
    """Fetch a URL and return cleaned text (HTML stripped)."""
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True,
                                     headers={"User-Agent": "Mozilla/5.0"}) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                text = resp.text
                text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)
                text = re.sub(r'<style[^>]*>.*?</style>',   '', text, flags=re.DOTALL)
                text = re.sub(r'<[^>]+>', ' ', text)
                text = re.sub(r'\s+', ' ', text).strip()
                return text[:6000]
    except Exception as e:
        return f"Error fetching URL: {e}"
    return ""
