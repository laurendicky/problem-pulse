// =============================================================================
// Netlify function: openai-proxy
// Path on your site: /.netlify/functions/openai-proxy
// Drop this in at: netlify/functions/openai-proxy.js  (replace your current one)
//
// THE FIX: CORS headers are returned on EVERY path — the OPTIONS preflight, the
// success response, AND every error/exception. Previously the error/timeout path
// returned no Access-Control-Allow-Origin header, so the browser reported those
// failures as "CORS policy" errors even though the real cause was a 5xx/timeout.
//
// Requires an env var in Netlify: OPENAI_API_KEY  (Site settings → Environment).
// =============================================================================

// Lock this down to your real origins (recommended). Use '*' only while testing.
const ALLOWED_ORIGINS = [
  'https://www.problempop.io',
  'https://problempop.io'
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

exports.handler = async (event) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const headers = corsHeaders(origin);

  // 1) Preflight — must succeed with CORS headers and no body.
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // 2) Only POST is supported — but still answer WITH CORS headers.
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: true, message: 'Method not allowed' }) };
  }

  try {
    const { openaiPayload } = JSON.parse(event.body || '{}');
    if (!openaiPayload) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: true, message: 'Missing openaiPayload' }) };
    }

    // Abort before Netlify's own timeout so we can return a CORS'd error instead of a header-less 502.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 24000); // Netlify max ~26s; leave headroom

    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(openaiPayload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { statusCode: 502, headers, body: JSON.stringify({ error: true, message: `OpenAI ${res.status}`, detail }) };
    }

    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';

    // Client expects { openaiResponse: "<stringified JSON content>" }
    return { statusCode: 200, headers, body: JSON.stringify({ openaiResponse: content }) };

  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      statusCode: aborted ? 504 : 500,
      headers, // <-- CORS headers present even on failure: this is what fixes your error
      body: JSON.stringify({ error: true, message: aborted ? 'OpenAI request timed out' : (err && err.message) || 'Proxy error' })
    };
  }
};
