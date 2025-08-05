// In your Netlify file: /functions/reddit-proxy.js

const fetch = require('node-fetch');

// Define the CORS headers that give your frontend permission to make requests.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // Allows any origin, you can restrict to 'https://www.problempop.io' if you want
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', // We need to allow POST for data and OPTIONS for the preflight check
};

exports.handler = async (event, context) => {
  // Immediately handle the browser's preflight request.
  // This is the crucial step that was missing.
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200, // OK
      headers: CORS_HEADERS,
      body: '', // No body needed for preflight
    };
  }
  
  // Reject any method that is not POST for the main logic
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { type, searchTerm, niche, limit, timeFilter, after, postId } = JSON.parse(event.body);
    let redditApiUrl;

    if (type === 'comments') {
      if (!postId) {
        return { statusCode: 400, body: 'Post ID is required for fetching comments.' };
      }
      redditApiUrl = `https://www.reddit.com/comments/${postId}.json?sort=top&limit=50`;
    } else { // Default to 'search'
      if (!searchTerm || !niche) {
        return { statusCode: 400, body: 'Search term and niche are required for search.' };
      }
      const query = encodeURIComponent(`(${searchTerm}) AND (${niche})`);
      const afterParam = after ? `&after=${after}` : '';
      redditApiUrl = `https://www.reddit.com/search.json?q=${query}&sort=relevance&t=${timeFilter || 'all'}&limit=${limit || 25}${afterParam}&restrict_sr=off&type=link`;
    }

    const response = await fetch(redditApiUrl, {
      headers: { 'User-Agent': 'ProblemFinder/1.0' }
    });

    if (!response.ok) {
      return { 
        statusCode: response.status, 
        headers: CORS_HEADERS, // Also include headers on error responses
        body: response.statusText 
      };
    }

    const data = await response.json();
    
    // The main successful response also MUST include the CORS headers.
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS, // Also include headers on error responses
      body: JSON.stringify({ error: error.message }),
    };
  }
};
