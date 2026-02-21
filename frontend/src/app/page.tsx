"use client";

import { useCallback, useEffect, useState } from "react";
import { getModels, chat, health, type ChatMessage } from "@/lib/api";

export default function Home() {
  const [models, setModels] = useState<{ name: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"cloud" | "local">("local");
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    try {
      setError(null);
      const data = await getModels();
      setModels(data.models);
      setSource(data.source as "cloud" | "local");
      if (data.error) setError(data.error);
      if (data.models.length && !selectedModel) setSelectedModel(data.models[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
      setModels([]);
    }
  }, [selectedModel]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const send = async () => {
    const text = input.trim();
    if (!text || !selectedModel || loading) return;
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);
    setError(null);
    try {
      const res = await chat(selectedModel, [...messages, userMsg]);
      setMessages((m) => [...m, res.message]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-2xl mx-auto p-6 min-h-screen flex flex-col">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-100">HackEurope</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Ollama {source} · {models.length} model{models.length !== 1 ? "s" : ""} available
        </p>
      </header>

      <div className="flex gap-2 mb-4">
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={loadModels}
          className="px-3 py-2 rounded-lg bg-zinc-700 text-zinc-300 text-sm hover:bg-zinc-600"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg ${m.role === "user" ? "bg-zinc-800 ml-4" : "bg-zinc-800/60 mr-4"} text-zinc-200 text-sm whitespace-pre-wrap`}
          >
            <span className="text-zinc-500 text-xs font-medium">{m.role}</span>
            <p className="mt-1">{m.content}</p>
          </div>
        ))}
        {loading && (
          <div className="p-3 rounded-lg bg-zinc-800/60 mr-4 text-zinc-500 text-sm">
            Thinking…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={loading || !selectedModel}
        />
        <button
          type="submit"
          disabled={loading || !input.trim() || !selectedModel}
          className="px-4 py-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </main>
  );
}
