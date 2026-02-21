# HackEurope

Next.js frontend + Python (FastAPI) backend with **Ollama Cloud** (and optional local Ollama) support.

## Quick start

### 1. Backend (Python)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

**Ollama Cloud** (recommended): create an [API key](https://ollama.com/settings/keys), then:

```bash
export OLLAMA_API_KEY=your_api_key
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Local Ollama only:** run [Ollama](https://ollama.com) locally (no `OLLAMA_API_KEY`), then start the backend as above. Pull models with e.g. `ollama pull llama3.2`.

### 2. Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The UI lists available models and lets you chat.

### 3. Environment

- Copy `.env.example` to `.env` in the repo root (or set vars in the shell).
- Backend: `OLLAMA_API_KEY` for Cloud; omit for local.
- Frontend: `NEXT_PUBLIC_API_URL=http://localhost:8000` if the API is elsewhere.

## API

- `GET /api/health` — backend health and whether Cloud is used.
- `GET /api/models` — list Ollama models (cloud or local).
- `POST /api/chat` — chat completion (body: `{ "model": "...", "messages": [...], "stream": false }`).

## Ollama Cloud models

With `OLLAMA_API_KEY` set, the backend uses `https://ollama.com` and you can use [cloud models](https://ollama.com/search?c=cloud) (e.g. `gpt-oss:120b-cloud`). Without the key, it uses local Ollama at `http://localhost:11434`.
