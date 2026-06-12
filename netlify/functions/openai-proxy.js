 // =============================================================================
// openai-proxy.js  (Netlify function) — fail-fast on rate limits
//
// DEPLOY THIS to your Netlify project (netlify/functions/openai-proxy.js).
//
// The key change: `maxRetries: 0` + a 20s SDK timeout on the OpenAI client.
// Previously the OpenAI SDK silently retried on 429 (rate-limit) errors with
// backoff, which burned 20-30s and blew past the proxy's 25s race — surfacing
// as "OpenAI_Latency_Limit" and silent client stalls. Now a throttled call
// returns an error in a couple of seconds, the frontend retries gracefully,
// and the dashboard settles into fallbacks fast instead of hanging.
// =============================================================================
const OpenAI = require('openai');

const allowedOrigins = [
  'https://minky.ai', 'https://www.minky.ai',
  'https://problempop.io', 'https://www.problempop.io',
  'http://localhost:8888'
];

exports.handler = async (event) => {
  const origin = event.headers.origin;
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : '*'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: true, message: 'POST required' }) };
  }
  if (!event.body) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: true, message: 'Missing request body' }) };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    // maxRetries: 0  -> never sit in a silent backoff loop on a 429; fail fast and let the
    //                   frontend's own retry/fallback handle it.
    // timeout: 20000 -> the SDK aborts a single slow call at 20s (under the proxy's race).
    const openai = new OpenAI({ apiKey, maxRetries: 0, timeout: 20000 });
    const { openaiPayload } = JSON.parse(event.body);

    // Backstop race (rarely needed now that the SDK fails fast).
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OpenAI_Latency_Limit')), 22000)
    );
    const chatCompletion = await Promise.race([
      openai.chat.completions.create(openaiPayload),
      timeoutPromise
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ openaiResponse: chatCompletion.choices[0].message.content })
    };
  } catch (error) {
    // Surface the REAL reason in the Netlify log so we can tell rate-limit (429) from key/quota.
    console.error('[PROXY LOG]', error.status || '', error.message);
    // 200 + error flag so the browser handles it gracefully (no CORS/fatal).
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        error: true,
        status: error.status || null,
        message: error.message || 'OpenAI request failed'
      })
    };
  }
};
