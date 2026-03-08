"""
LLM helpers — local LLM calls and URL fetching.
Used by features that need AI summarisation / classification.
"""
import httpx, os, re

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:8080")
LLM_MODEL    = os.getenv("LLM_MODEL",    "local")
TODO_API_URL = os.getenv("TODO_API_URL",  "http://localhost:3000")


async def llm(prompt: str, system: str = "", max_tokens: int = 300) -> str:
    """Call the local LLM via OpenAI-compatible /v1/chat/completions."""
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
