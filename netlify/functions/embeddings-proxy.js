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
    const { embeddingPayload } = JSON.parse(event.body);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OpenAI_Latency_Limit')), 25000)
    );
    const embeddingResult = await Promise.race([
      openai.embeddings.create(embeddingPayload),
      timeoutPromise
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ embeddingResponse: { data: embeddingResult.data } })
    };
  } catch (error) {
    console.error('[EMBED PROXY LOG]', error.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: true, message: "Embedding service slow or unavailable." })
    };
  }
};
