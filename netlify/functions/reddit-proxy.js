// /netlify/functions/reddit-proxy.js

// Using 'node-fetch' version 2 for compatibility with Netlify Functions
const fetch = require('node-fetch');

// These will be loaded from Netlify's secure environment variables
const CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const USER_AGENT = 'web:problem-pulse-tool:v1.0 (by /u/RubyFishSimon)';

// We'll store the token in memory on the serverless function instance
let accessToken = null;
let tokenExpiry = 0;

async function getValidToken() {
    // If we have a valid token, return it
    if (accessToken && Date.now() < tokenExpiry) {
        return accessToken;
    }

    // Otherwise, fetch a new one
    console.log('Fetching new Reddit token...');
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    
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
        throw new Error(`Failed to get Reddit token: ${response.status}`);
    }

    const data = await response.json();
    accessToken = data.access_token;
    // Set expiry with a 60-second buffer
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    
    return accessToken;
}

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { searchTerm, niche, limit, timeFilter, after } = JSON.parse(event.body);
        const token = await getValidToken();

        // Construct the Reddit API URL
        const query = encodeURIComponent(`${searchTerm} ${niche}`);
        let url = `https://oauth.reddit.com/search?q=${query}&limit=${limit}&t=${timeFilter}&raw_json=1`;
        if (after) {
            url += `&after=${after}`;
        }
        
        const redditResponse = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': USER_AGENT,
            }
        });

        if (!redditResponse.ok) {
            // Forward the status code from Reddit if something goes wrong
            return {
                statusCode: redditResponse.status,
                body: JSON.stringify({ error: `Reddit API Error: ${redditResponse.statusText}` })
            };
        }

        const redditData = await redditResponse.json();

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(redditData)
        };

    } catch (error) {
        console.error('Proxy Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
