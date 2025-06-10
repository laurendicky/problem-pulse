const OpenAI = require('openai');

exports.handler = async (event) => {
  // Explicitly handle the browser's preflight OPTIONS request.
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': 'https://www.minky.ai',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  // Only allow POST requests for the actual work.
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Get the secret key from the environment.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Server configuration error: API key not set.');
    }

    // Get the payload sent from the Webflow page.
    const { openaiPayload } = JSON.parse(event.body);
    if (!openaiPayload) {
      throw new Error('Request body is missing openaiPayload.');
    }

    // Initialize OpenAI and make the API call.
    const openai = new OpenAI({ apiKey });
    const chatCompletion = await openai.chat.completions.create(openaiPayload);

    // Send the successful response directly back to the browser.
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://www.minky.ai',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        openaiResponse: chatCompletion.choices[0].message.content,
      }),
    };
  } catch (error) {
    console.error('Error in function:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://www.minky.ai',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
