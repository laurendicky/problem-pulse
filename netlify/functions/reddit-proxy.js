// =================================================================================
// CORRECTED PROXY FUNCTION (reddit-proxy.js) - VERSION 1.2
// This version fixes the 403 FORBIDDEN error by using a valid User-Agent
// that Reddit's API will not block.
// =================================================================================
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    try {
        const body = JSON.parse(event.body);
        let targetUrl;

        // --- THIS IS THE CRITICAL FIX ---
        // A standard, descriptive User-Agent to avoid getting blocked by Reddit.
        const redditRequestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
        };

        if (body.commentUrl) {
            // Handle comment fetching
            if (!body.commentUrl.startsWith('/')) {
                throw new Error('Invalid commentUrl format.');
            }
            targetUrl = `https://www.reddit.com${body.commentUrl}.json?limit=100&depth=1&sort=top`;

        } else if (body.searchTerm && body.niche) {
            // Handle search fetching
            const { searchTerm, niche, limit = 25, timeFilter = 'all', after = null } = body;
            const afterParam = after ? `&after=${after}` : '';
            // The niche already contains "subreddit:..." so we don't need parentheses
            targetUrl = `https://www.reddit.com/search.json?q=${niche} ${encodeURIComponent(searchTerm)}&limit=${limit}&t=${timeFilter}&restrict_sr=off&sort=relevance${afterParam}`;

        } else {
            throw new Error('Invalid request. Must include either commentUrl or searchTerm/niche.');
        }

        const response = await fetch(targetUrl, { headers: redditRequestHeaders });

        if (!response.ok) {
            console.error(`Reddit API responded with ${response.status}:`, await response.text());
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `Reddit API error: ${response.statusText}` }),
                headers
            };
        }

        const data = await response.json();

        return {
            statusCode: 200,
            body: JSON.stringify(data),
            headers
        };

    } catch (error) {
        console.error("Proxy Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
            headers
        };
    }
};
