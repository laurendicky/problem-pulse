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
        // ====================================================================
        // START OF KEY CHANGES
        // ====================================================================

        // 1. We now expect `subreddits` instead of `niche`.
        const { subreddits, searchTerm, limit, timeFilter, after } = JSON.parse(event.body);

        // Add a validation check for the new required parameter.
        if (!subreddits || subreddits.trim() === '') {
            return {
                statusCode: 400, // Bad Request
                headers,
                body: JSON.stringify({ error: 'The "subreddits" parameter is required and cannot be empty.' })
            };
        }

        const token = await getValidToken();
        
        // 2. The search query is now just the `searchTerm` (e.g., "problem OR challenge...").
        const query = encodeURIComponent(searchTerm);

        // 3. We build a new URL targeting specific subreddits and use `restrict_sr=1`.
        // The `subreddits` variable will look like "saas+smallbusiness+entrepreneur".
        // `restrict_sr=1` is the critical flag to search ONLY within those subreddits.
        let url = `https://oauth.reddit.com/r/${subreddits}/search.json?q=${query}&restrict_sr=1&limit=${limit}&t=${timeFilter}&raw_json=1&sort=relevance`;
        
        // Pagination logic remains the same.
        if (after) {
            url += `&after=${after}`;
        }
        
        // ====================================================================
        // END OF KEY CHANGES
        // ====================================================================

        const redditResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT }
        });

        if (!redditResponse.ok) {
            const errorBody = await redditResponse.text();
            console.error("Reddit API Error Body:", errorBody);
            return {
                statusCode: redditResponse.status,
                headers,
                body: JSON.stringify({ error: `Reddit API Error: ${redditResponse.statusText}` })
            };
        }

        const redditData = await redditResponse.json();
        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(redditData)
        };

    } catch (error) {
        console.error("Handler Error:", error);
        return { 
            statusCode: 500, 
            headers,
            body: JSON.stringify({ error: error.message }) 
        };
    }
};
