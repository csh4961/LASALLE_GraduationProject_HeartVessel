/* ============================================================
   netlify/functions/claude.js — Netlify Function.

   Same job as the former api/claude.js (Vercel Serverless
   Function): proxies POSTs from the browser to Anthropic's
   Messages API so the real key stays on the server
   (ANTHROPIC_API_KEY env var set in the Netlify dashboard)
   and never ships inside the frontend bundle.

   Why this file exists AS WELL AS api/claude.js:
     We migrated to Netlify after Vercel signup/GitHub-OAuth
     state got tangled. api/claude.js is left in place so the
     project can deploy back to Vercel without code changes if
     needed later — Netlify simply ignores the api/ folder at
     runtime (it serves dist/ as the static site and runs only
     what's under netlify/functions/).

   Frontend path (unchanged):
     The client in src/utils/claude.js POSTs to `/api/claude`.
     On Netlify, a redirect rule in netlify.toml rewrites that
     path to `/.netlify/functions/claude`, which is THIS file.
     Keeping the client-facing URL identical to the Vercel
     setup means zero changes in src/ — the deploy target is
     swappable.

   Handler shape:
     Netlify Functions use the classic AWS-Lambda handler
     signature (event, context) — not the Node req/res that
     Vercel uses. event.body is a STRING (needs JSON.parse),
     and we return { statusCode, headers, body } — body must
     also be a string (JSON.stringify the response).

   Security notes:
     • process.env.ANTHROPIC_API_KEY is only set in the Netlify
       site's Environment Variables panel — it never reaches
       the browser bundle. This is specifically NOT prefixed
       with VITE_, because anything VITE_-prefixed gets inlined
       into the client JS by Vite at build time.
     • No explicit CORS headers — Netlify serves the frontend
       from the same origin as this function, so cross-origin
       rules don't apply.
   ============================================================ */

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Method not allowed' } }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          message:
            'Server misconfigured: ANTHROPIC_API_KEY env var not set in Netlify.',
        },
      }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    return {
      statusCode: upstream.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { message: err?.message || 'Upstream fetch to Anthropic failed' },
      }),
    };
  }
};
