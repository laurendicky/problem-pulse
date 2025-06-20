// netlify/functions/reddit-proxy.js
const fetch = require('node-fetch');

const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET } = process.env;
const USER_AGENT = 'web:problem-pulse-tool:v1.0 (by /u/RubyFishSimon)';

// Define CORS headers. We are explicitly allowing your website's domain.
const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://www.minky.ai',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

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
    // Handle the preflight 'OPTIONS' request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content
            headers: corsHeaders,
            body: ''
        };
    }
    
    // Only allow POST requests for the actual logic
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
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
                headers: corsHeaders,
                body: JSON.stringify({ error: `Reddit API Error: ${redditResponse.statusText}` })
            };
        }

        const redditData = await redditResponse.json();
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(redditData)
        };

    } catch (error) {
        return { 
            statusCode: 500, 
            headers: corsHeaders,
            body: JSON.stringify({ error: error.message }) 
        };
    }
};
