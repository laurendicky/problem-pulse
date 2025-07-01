// Copy and paste this entire block into netlify/functions/openai-proxy.js

const OpenAI = require('openai');

// Define the complete whitelist of allowed domains
const allowedOrigins = [
  'https://minky.ai',
  'https://www.minky.ai',
  'https://problempop.io',
  'https://www.problempop.io',
  // It's a good practice to add your local dev environment too
  // e.g., 'http://localhost:8888' (Netlify Dev) or 'http://localhost:3000'
];

exports.handler = async (event) => {
  // Check the incoming request's origin
  const origin = event.headers.origin;
  
  // Prepare the response headers object. We will build this dynamically.
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // If the origin is in our whitelist, add the ACAO header to the response
  if (allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  // Handle the browser's preflight OPTIONS request using the dynamic headers
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204, // No Content
      headers,
      body: '',
    };
  }

  // If the origin is not allowed, the 'Access-Control-Allow-Origin' header
  // will be missing, and the browser will block the request.
  // We can also return a explicit forbidden error.
  if (!allowedOrigins.includes(origin)) {
      return {
        statusCode: 403,
        body: 'Forbidden: Origin not allowed.'
      };
  }
  
  // Only allow POST requests for the actual work.
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    // Get the secret key from the environment.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Server configuration error: API key not set.');
    }

    // Get the payload sent from the frontend.
    const { openaiPayload } = JSON.parse(event.body);
    if (!openaiPayload) {
      throw new Error('Request body is missing openaiPayload.');
    }

    // Initialize OpenAI and make the API call.
    const openai = new OpenAI({ apiKey });
    const chatCompletion = await openai.chat.completions.create(openaiPayload);

    // Send the successful response back, using the dynamic headers
    return {
      statusCode: 200,
      headers: {
        ...headers, // Include our CORS headers
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        openaiResponse: chatCompletion.choices[0].message.content,
      }),
    };
  } catch (error) {
    console.error('Error in function:', error);
    // Send the error response back, also using the dynamic headers
    return {
      statusCode: 500,
      headers: {
        ...headers, // Include our CORS headers
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
