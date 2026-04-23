/* ============================================================
   api/claude.js — Vercel Serverless Function.

   Proxies POSTs from the browser to Anthropic's Messages API
   so the real key stays on the server (ANTHROPIC_API_KEY env
   var set in the Vercel dashboard) and never ships inside the
   frontend bundle. Replaces the older dev-only pattern where
   the key was hardcoded in src/utils/claude.js and therefore
   readable by anyone who opened DevTools on the deployed site.

   Contract:
     • Method:  POST only. Any other verb → 405.
     • Body:    forwarded to Anthropic verbatim. The frontend
                is responsible for building the Messages-API-
                shaped payload (model, max_tokens, system,
                messages, thinking, …) — this function adds no
                business logic, just the auth + version headers.
     • Return:  whatever Anthropic returns, with Anthropic's
                status code preserved so the client can
                distinguish 4xx/5xx from success.

   Why maxDuration = 60:
     Default serverless timeout is 10s. This app uses extended
     thinking (THINKING_BUDGET = 2000) and max_tokens up to
     3500 for multi-turn calls — upstream can take 15-25s end
     to end. 60s is the Hobby plan's ceiling and covers even
     the slowest expected response.

   Security notes:
     • process.env.ANTHROPIC_API_KEY is only available server-
       side in Vercel. It is NOT the VITE_ANTHROPIC_API_KEY
       that the frontend reads in local dev — those are two
       separate env vars on purpose: anything prefixed with
       VITE_ gets inlined into the client bundle by Vite, so
       the production key MUST NOT use that prefix.
     • No CORS headers are set because the frontend is served
       from the same origin as this function (both live on the
       user's Vercel deployment domain).
   ============================================================ */

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: {
        message: 'Server misconfigured: ANTHROPIC_API_KEY env var not set in Vercel.',
      },
    });
    return;
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({
      error: { message: err?.message || 'Upstream fetch to Anthropic failed' },
    });
  }
}
