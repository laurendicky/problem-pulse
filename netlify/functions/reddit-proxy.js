// =================================================================================
// UPDATED PROXY FUNCTION (reddit-proxy.js)
// This version can handle BOTH search requests and comment-fetching requests.
// =================================================================================
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // Allow requests from any origin
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Handle preflight requests for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers
        };
    }

    try {
        const body = JSON.parse(event.body);

        let targetUrl;

        // --- NEW LOGIC: Check if the request is for comments ---
        if (body.commentUrl) {
            // It's a request for comments. Construct the URL.
            // Example commentUrl: /r/Fitness/comments/q3zjo3/moronic_monday_your_weekly_stupid_questions_thread/
            if (!body.commentUrl.startsWith('/')) {
                throw new Error('Invalid commentUrl format.');
            }
            targetUrl = `https://www.reddit.com${body.commentUrl}.json?limit=100&depth=1`;
        }
        // --- FALLBACK: Handle original search functionality ---
        else if (body.searchTerm && body.niche) {
            const { searchTerm, niche, limit = 25, timeFilter = 'all', after = null } = body;
            const afterParam = after ? `&after=${after}` : '';
            targetUrl = `https://www.reddit.com/search.json?q=(${niche}) ${encodeURIComponent(searchTerm)}&limit=${limit}&t=${timeFilter}&restrict_sr=off&sort=relevance${afterParam}`;
        }
        // --- ERROR: Invalid request body ---
        else {
            throw new Error('Invalid request. Must include either commentUrl or searchTerm/niche.');
        }

        const response = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Problem-Finder-Tool/1.0' }
        });

        if (!response.ok) {
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
