"""One OpenAI-compatible client, pointed at OpenRouter.

This single implementation gives the plan's mixed-provider property for free: the agent runs on
``anthropic/claude-sonnet-5`` and the judge on ``openai/gpt-5-mini`` through the same client, so the
verifier is never grading the model family that produced the work. Verified live at temperature 0
with JSON mode on both vendors.
"""

from __future__ import annotations

import json
import time
from typing import Any

from backend.config import get_settings

RETRYABLE_STATUS = (429, 500, 502, 503, 504)
MAX_ATTEMPTS = 3


class ProviderError(RuntimeError):
    """The provider failed after retries. Callers decide whether that is fatal."""


class OpenAICompatProvider:
    """``ModelProvider`` over any OpenAI-compatible endpoint."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        default_model: str | None = None,
    ) -> None:
        from openai import OpenAI

        settings = get_settings()
        self.base_url = base_url or settings.openai_base_url
        self.default_model = default_model or settings.judge_model
        key = api_key or settings.openai_api_key.get_secret_value()
        if not key:
            raise ProviderError("no API key configured (set OPENAI_API_KEY in .env)")
        self._client = OpenAI(base_url=self.base_url, api_key=key)
        self.calls = 0

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
        json_mode: bool = False,
        model: str | None = None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": model or self.default_model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        if tools:
            kwargs["tools"] = [{"type": "function", "function": t} for t in tools]

        last: Exception | None = None
        for attempt in range(MAX_ATTEMPTS):
            try:
                self.calls += 1
                response = self._client.chat.completions.create(**kwargs)
                choice = response.choices[0]
                return {
                    "content": choice.message.content or "",
                    "tool_calls": [
                        {"name": c.function.name, "arguments": c.function.arguments}
                        for c in (choice.message.tool_calls or [])
                    ],
                    "model": response.model,
                    "finish_reason": choice.finish_reason,
                }
            except Exception as exc:
                last = exc
                if getattr(exc, "status_code", None) not in RETRYABLE_STATUS:
                    break
                time.sleep(0.6 * (2**attempt))
        raise ProviderError(f"provider call failed: {last}") from last

    def complete_json(
        self, messages: list[dict[str, Any]], model: str | None = None
    ) -> dict[str, Any]:
        """Complete in JSON mode and parse, tolerating a model that wraps its object in prose."""
        raw = self.complete(messages, temperature=0.0, json_mode=True, model=model)["content"]
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            start, end = raw.find("{"), raw.rfind("}")
            if start >= 0 and end > start:
                try:
                    return json.loads(raw[start : end + 1])
                except json.JSONDecodeError:
                    pass
            raise ProviderError(f"provider returned non-JSON: {raw[:200]!r}") from exc


class MockProvider:
    """Scripted provider for tests. Deterministic by construction — no network, no clock."""

    def __init__(self, responses: list[Any] | None = None) -> None:
        self.responses = list(responses or [])
        self.received: list[list[dict[str, Any]]] = []
        self.calls = 0

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
        json_mode: bool = False,
        model: str | None = None,
    ) -> dict[str, Any]:
        self.received.append(messages)
        self.calls += 1
        base = {"tool_calls": [], "model": "mock", "finish_reason": "stop"}
        if not self.responses:
            return {**base, "content": "{}"}
        nxt = self.responses.pop(0)
        if isinstance(nxt, dict) and "content" in nxt:
            return {**base, **nxt}
        return {**base, "content": json.dumps(nxt)}

    def complete_json(
        self, messages: list[dict[str, Any]], model: str | None = None
    ) -> dict[str, Any]:
        return json.loads(self.complete(messages, json_mode=True, model=model)["content"])


def build_provider() -> OpenAICompatProvider:
    return OpenAICompatProvider()
