/**
 * Interviewbold - AI Reasoning Proxy (Cloudflare Worker)
 * This script handles AI requests for Paid/Demo users using your Developer Token.
 * It supports full Streaming (the typing effect).
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS (Cross-Origin Resource Sharing)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const body = await request.json();
      const { messages, model, stream } = body;

      // Your Puter Auth Token (the one you provided)
      const PUTER_AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYyIn0.eyJ0IjoidCIsInYiOiIyIiwidG9rZW5fdWlkIjoiNzY3YjBjN2ItYzBjZC00ZWU4LTlhMGUtNWIxYzUyODg4YWIwIiwidXUiOiJjeWN4L1F1aVRXU2tIU3VpdmpzYnV3PT0iLCJzdSI6InFzR29HL1JZUjBDUWFzMjN5M0JXeXc9PSIsImFpIjoiY3ljeC9RdWlUV1NrSFN1aXZqc2J1dz09IiwiZnVsbF9hY2Nlc3MiOnRydWUsImlhdCI6MTc4NzI1NTQxM30.-RogmvYY3kyyHeXJfk9VmpULuQiokWLlmw4L5sm_lYs";

      // 2. Forward request to Puter's OpenAI-compatible endpoint
      const response = await fetch("https://api.puter.com/puterai/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${PUTER_AUTH_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: messages,
          stream: stream || false
        })
      });

      // 3. Return the response with CORS headers
      const newResponse = new Response(response.body, response);
      newResponse.headers.set("Access-Control-Allow-Origin", "*");
      
      return newResponse;

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  },
};
