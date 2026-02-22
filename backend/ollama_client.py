import os
from ollama import Client, AsyncClient


def get_ollama_client() -> Client:
    api_key = os.environ.get("OLLAMA_API_KEY")
    if api_key:
        return Client(
            host="https://ollama.com",
            headers={"Authorization": f"Bearer {api_key}"},
        )
    return Client(host=os.environ.get("OLLAMA_HOST", "http://localhost:11434"))


def get_async_ollama_client() -> AsyncClient:
    api_key = os.environ.get("OLLAMA_API_KEY")
    if api_key:
        return AsyncClient(
            host="https://ollama.com",
            headers={"Authorization": f"Bearer {api_key}"},
        )
    return AsyncClient(host=os.environ.get("OLLAMA_HOST", "http://localhost:11434"))


def is_cloud() -> bool:
    return bool(os.environ.get("OLLAMA_API_KEY"))
