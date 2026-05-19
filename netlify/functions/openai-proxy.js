// Copy and paste this entire block into netlify/functions/openai-proxy.js

const OpenAI = require('openai');

// Define the complete whitelist of allowed domains
const allowedOrigins = [
  'https://minky.ai',
  'https://www.minky.ai',
  'https://problempop.io',
  'https://www.problempop.io',
  // It's a good practice to add your local dev environment too
  'http://localhost:8888', // For `netlify dev`
];

exports.handler = async (event) => {
  // Get the incoming request's origin
  const origin = event.headers.origin;
  
  // --- CHANGE 1: Added logging for easier debugging ---
  // This will show the exact origin in your Netlify function logs.
  console.log(`[PROXY LOG] Incoming request from origin: ${origin}`);

  // Prepare the response headers object.
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // If the origin is in our whitelist, add the crucial ACAO header to the response
  if (allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    console.log(`[PROXY LOG] Origin is in whitelist. Granting access.`);
  } else {
    console.warn(`[PROXY LOG] Origin NOT in whitelist: ${origin}`);
  }

  // Handle the browser's preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204, // No Content
      headers,
      body: '',
    };
  }
  
  // Explicitly block non-whitelisted origins
  if (!allowedOrigins.includes(origin)) {
      // --- CHANGE 2: Added the 'headers' object to the error response ---
      // This ensures the browser gets a proper CORS response even on failure.
      return {
        statusCode: 403,
        headers, 
        body: `Forbidden: Origin ${origin} is not allowed.`
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

    // Send the successful response back
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        openaiResponse: chatCompletion.choices[0].message.content,
      }),
    };
  } catch (error) {
    console.error('Error in OpenAI proxy function:', error);
    // Send the error response back
    return {
      statusCode: 500,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
