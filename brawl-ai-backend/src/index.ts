export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
}

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  apiKey?: string;
  model?: string;
}

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    let payload: ChatRequestBody;

    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
    }

    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      return jsonResponse({ error: "Missing messages array" }, 400, origin);
    }

    const apiKey = payload.apiKey || env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: "Missing API key. Add it in the dashboard AI settings." },
        401,
        origin
      );
    }

    const model = payload.model || DEFAULT_MODEL;
    const baseUrl = (env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

    try {
      const upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: payload.messages,
          temperature: 0.7,
        }),
      });

      const data = await upstream.json();

      if (!upstream.ok) {
        return jsonResponse(data, upstream.status, origin);
      }

      return jsonResponse(data, 200, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upstream request failed";
      return jsonResponse({ error: message }, 502, origin);
    }
  },
};
