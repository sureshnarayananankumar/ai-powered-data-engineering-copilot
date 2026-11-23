"""Thin wrapper around the OpenAI client so agents never import the SDK directly.

If OPENAI_API_KEY is not set, `LLMNotConfigured` is raised and callers return a
clear message instead of inventing an answer.
"""
from openai import OpenAI

from app.config.settings import get_settings


class LLMNotConfigured(RuntimeError):
    pass


def complete(system: str, user: str, temperature: float = 0.0) -> str:
    settings = get_settings()
    if not settings.llm_configured:
        raise LLMNotConfigured("OPENAI_API_KEY is not set. Add it to backend/.env to enable LLM features.")
    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.chat.completions.create(
        model=settings.openai_model,
        temperature=temperature,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    return resp.choices[0].message.content or ""
