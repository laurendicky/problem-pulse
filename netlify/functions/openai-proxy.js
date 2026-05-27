const OpenAI = require('openai');

// 1. Move initialization OUTSIDE to reuse connections (Speed boost)
const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey });

const allowedOrigins = [
  'https://minky.ai',
  'https://www.minky.ai',
  'https://problempop.io',
  'https://www.problempop.io',
  'http://localhost:8888',
];

exports.handler = async (event) => {
  const origin = event.headers.origin;
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (!allowedOrigins.includes(origin)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const { openaiPayload } = JSON.parse(event.body);

    // 2. INTERNAL TIMEOUT (The "Shield")
    // This races OpenAI against a 50-second timer. 
    // It ensures we return a response with HEADERS before Netlify kills us at 60s.
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OpenAI took too long (Proxy Timeout)')), 50000)
    );

    // Race the API call against the 50s timer
    const chatCompletion = await Promise.race([
      openai.chat.completions.create(openaiPayload),
      timeoutPromise
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        openaiResponse: chatCompletion.choices[0].message.content,
      }),
    };

  } catch (error) {
    console.error('[PROXY ERROR]', error.message);
    
    // Even on failure, we return the CORS headers so the frontend can read the error
    return {
      statusCode: error.message.includes('too long') ? 504 : 500,
      headers,
      body: JSON.stringify({ 
        error: error.message,
        suggestion: "Try reducing the number of posts or using a 'Quick Search'."
      }),
    };
  }
};
