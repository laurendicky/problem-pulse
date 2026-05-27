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

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const openai = new OpenAI({ apiKey });
    const { openaiPayload } = JSON.parse(event.body);

    // 25-Second Race. If OpenAI doesn't answer fast, we cut it off.
    // This prevents the 504 Gateway Timeout and the CORS error.
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OpenAI_Latency_Limit')), 25000)
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
    console.error('[PROXY LOG]', error.message);
    
    // We send a 200 even on error so the FRONTEND logic can handle it gracefully
    // without the browser triggering a Fatal Error/CORS block.
    return {
      statusCode: 200, 
      headers,
      body: JSON.stringify({ 
        error: true, 
        message: "OpenAI is currently slow. Retrying segment..." 
      })
    };
  }
};
