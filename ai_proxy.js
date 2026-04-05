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
      const PUTER_AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0IjoiZ3VpIiwidiI6IjAuMC4wIiwidSI6ImJ5bkVwOXBqUjVPMkNMVWJIN08zZEE9PSIsInV1IjoiU3k1Y2MxcW1RQnVIWTBveWpPUWx4QT09IiwiaWF0IjoxNzc1NDIxMDcwfQ.D2iUFh6JfiIcAkC_U7ZJ9Zc2BRWH7vZ6xdxpwNfENAo";

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
