// File: netlify/functions/reddit-proxy.js

const fetch = require('node-fetch');

const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET } = process.env;
const USER_AGENT = 'web:problem-pop-tool:v1.0 (by /u/YourUsername)'; // It's good practice to update this

// Define the complete whitelist of allowed domains
const allowedOrigins = [
  'https://minky.ai',
  'https://www.minky.ai',
  'https://problempop.io',
  'https://www.problempop.io',
  // Add your local dev environment if you need it, e.g.:
  // 'http://localhost:8888',
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
    // --- CORS and Preflight Handling (No changes here) ---
    const origin = event.headers.origin;
    const headers = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }
    if (!allowedOrigins.includes(origin)) {
        return { statusCode: 403, body: 'Forbidden: Origin not allowed.' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const token = await getValidToken();
        let url;

        // --- NEW LOGIC: Route based on the 'type' of request ---
        if (body.type === 'find_subreddits') {
            // This handles the new "Audience Discovery" step
            if (!body.topic) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Topic is required.' }) };
            const query = encodeURIComponent(body.topic);
            // This is the Reddit API endpoint for searching for subreddits
            url = `https://oauth.reddit.com/api/search_subreddits.json?query=${query}&limit=10&sort=relevance`;
        
        } else if (body.type === 'find_problems') {
            // This is our existing logic for finding problem posts
            if (!body.subreddits) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Subreddits are required.' }) };
            const query = encodeURIComponent(body.searchTerm);
            url = `https://oauth.reddit.com/r/${body.subreddits}/search.json?q=${query}&restrict_sr=1&limit=${body.limit}&t=${body.timeFilter}&raw_json=1&sort=relevance`;
            if (body.after) {
                url += `&after=${body.after}`;
            }
        
        } else {
            // If no valid type is provided, return an error
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request type.' }) };
        }

        const redditResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT }
        });

        if (!redditResponse.ok) {
            const errorBody = await redditResponse.text();
            console.error("Reddit API Error:", errorBody);
            return { statusCode: redditResponse.status, headers, body: JSON.stringify({ error: `Reddit API Error: ${redditResponse.statusText}` }) };
        }

        const redditData = await redditResponse.json();
        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(redditData)
        };

    } catch (error) {
        console.error("Handler Error:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
