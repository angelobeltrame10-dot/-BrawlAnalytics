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

interface HookRequestBody {
  hookText?: string;
  model?: string;
}

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const HOOK_TYPES = [
  "Question", "Surprise", "Shock", "Curiosity", "Challenge", "Tutorial",
  "Story", "Funny", "Prediction", "Comparison", "Mystery", "Countdown",
  "Direct Statement", "Other"
];

const HOOK_SYSTEM_PROMPT = `You are a world-class YouTube Shorts strategist. You evaluate ONLY the hook (the first seconds) of a Short — never the full video.

Follow this exact process:
1. Identify the hook type: Question, Surprise, Shock, Curiosity, Challenge, Tutorial, Story, Funny, Prediction, Comparison, Mystery, Countdown, Direct Statement, or Other.
2. Judge whether it creates curiosity.
3. Judge whether it immediately communicates the video's topic.
4. Judge whether it motivates the viewer to keep watching.
5. Judge whether it is too generic.
6. Judge whether it has been overused thousands of times.
7. Evaluate its emotional impact.
8. Estimate how likely it is to stop the scroll.

Never invent statistics or numbers you cannot justify. Justify every score through the strengths/weaknesses you list.

Always rewrite the hook into a genuinely stronger version in "improvedHook" — a real improvement, not a small edit.

Return ONLY this JSON, no markdown, no extra text:
{"hookType":"","hookScore":0,"scrollStopScore":0,"curiosityScore":0,"clarityScore":0,"emotionScore":0,"originalityScore":0,"strengths":[],"weaknesses":[],"improvedHook":"","summary":""}
All scores 0-100. summary max 60 words.`;

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

function extractHookJSON(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clampScore(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function sanitizeHookResult(raw: any) {
  return {
    hookType: HOOK_TYPES.includes(raw?.hookType) ? raw.hookType : "Other",
    hookScore: clampScore(raw?.hookScore),
    scrollStopScore: clampScore(raw?.scrollStopScore),
    curiosityScore: clampScore(raw?.curiosityScore),
    clarityScore: clampScore(raw?.clarityScore),
    emotionScore: clampScore(raw?.emotionScore),
    originalityScore: clampScore(raw?.originalityScore),
    strengths: Array.isArray(raw?.strengths) ? raw.strengths.slice(0, 6).map(String) : [],
    weaknesses: Array.isArray(raw?.weaknesses) ? raw.weaknesses.slice(0, 6).map(String) : [],
    improvedHook: String(raw?.improvedHook || "").trim(),
    summary: String(raw?.summary || "").trim(),
  };
}

async function handleHook(request: Request, env: Env, origin: string | null): Promise<Response> {
  let body: HookRequestBody;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const hookText = (body.hookText || "").trim();
  if (!hookText) {
    return jsonResponse({ error: "Missing hookText" }, 400, origin);
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "Missing API key" }, 401, origin);
  }

  const model = body.model || DEFAULT_MODEL;
  const baseUrl = (env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

  const messages = [
    { role: "system", content: HOOK_SYSTEM_PROMPT },
    { role: "user", content: `Analyze this YouTube Shorts hook (first seconds of the video):\n\n"${hookText}"` },
  ];

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.4 }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return jsonResponse(data, upstream.status, origin);
    }

    const raw = data.choices?.[0]?.message?.content || "";
    const parsed = extractHookJSON(raw);

    if (!parsed) {
      return jsonResponse({ error: "AI returned invalid JSON" }, 502, origin);
    }

    return jsonResponse(sanitizeHookResult(parsed), 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream request failed";
    return jsonResponse({ error: message }, 502, origin);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    const url = new URL(request.url);

    if (url.pathname === "/hook") {
      return handleHook(request, env, origin);
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