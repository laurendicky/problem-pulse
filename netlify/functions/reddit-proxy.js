// Copy and paste this entire block into netlify/functions/reddit-proxy.js

const fetch = require('node-fetch');

const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET } = process.env;
const USER_AGENT = 'web:problem-pulse-tool:v1.0 (by /u/RubyFishSimon)';

// Define the complete whitelist of allowed domains
const allowedOrigins = [
  'https://minky.ai',
  'https://www.minky.ai',
  'https://problempop.io',
  'https://www.problempop.io',
  // It's a good practice to add your local dev environment too
  // e.g., 'http://localhost:8888' (Netlify Dev) or 'http://localhost:3000'
];

let accessToken = null;
let tokenExpiry = 0;

async function getValidToken() {
    if (accessToken && Date.now() < tokenExpiry) {
        return accessToken;
    }

    const credentials = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
        },
        body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to get Reddit token:', errorText);
        throw new Error('Could not authenticate with Reddit API.');
    }

    const data = await response.json();
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return accessToken;
}

exports.handler = async (event) => {
    // Check the incoming request's origin and prepare dynamic headers
    const origin = event.headers.origin;
    const headers = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }

    // Handle the preflight 'OPTIONS' request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content
            headers,
            body: ''
        };
    }
    
    // Forbid requests from non-whitelisted origins
    if (!allowedOrigins.includes(origin)) {
        return {
          statusCode: 403,
          body: 'Forbidden: Origin not allowed.'
        };
    }
    
    // Only allow POST requests for the actual logic
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    try {
        const { searchTerm, niche, limit, timeFilter, after } = JSON.parse(event.body);
        const token = await getValidToken();
        const query = encodeURIComponent(`${searchTerm} ${niche}`);
        let url = `https://oauth.reddit.com/search?q=${query}&limit=${limit}&t=${timeFilter}&raw_json=1`;
        if (after) {
            url += `&after=${after}`;
        }
        
        const redditResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT }
        });

        if (!redditResponse.ok) {
            return {
                statusCode: redditResponse.status,
                headers, // Use dynamic headers
                body: JSON.stringify({ error: `Reddit API Error: ${redditResponse.statusText}` })
            };
        }

        const redditData = await redditResponse.json();
        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' }, // Use dynamic headers
            body: JSON.stringify(redditData)
        };

    } catch (error) {
        return { 
            statusCode: 500, 
            headers, // Use dynamic headers
            body: JSON.stringify({ error: error.message }) 
        };
    }
};
