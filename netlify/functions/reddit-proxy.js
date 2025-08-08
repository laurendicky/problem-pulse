// =================================================================================
// COMPLETE AND VERIFIED PROXY SCRIPT (VERSION 3 - NOW WITH SUBREDDIT 'ABOUT' DETAILS)
// This version adds the ability to fetch details for a specific subreddit using the /about.json endpoint.
// =================================================================================

const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } = process.env;

async function getRedditToken() {
    const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': REDDIT_USER_AGENT
        },
        body: 'grant_type=client_credentials'
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error("Reddit Token Error:", errorBody);
        throw new Error('Failed to retrieve Reddit API token');
    }
    const data = await response.json();
    return data.access_token;
}

exports.handler = async (event) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    try {
        const body = JSON.parse(event.body);
        const token = await getRedditToken();
        let url;

        // --- UPDATED: Main routing logic to handle different request types ---
        
        // **NEW**: Handle requests for subreddit details
        if (body.type === 'about') {
            if (!body.subreddit) {
                throw new Error("A 'subreddit' name is required for fetching 'about' details.");
            }
            url = `https://oauth.reddit.com/r/${body.subreddit}/about.json`;
        
        // Handle requests for post comments (existing)
        } else if (body.type === 'comments') {
            if (!body.postId) {
                throw new Error("A 'postId' is required for fetching comments.");
            }
            url = `https://oauth.reddit.com/comments/${body.postId}?limit=500&depth=10`;
        
        // Handle standard search requests (existing)
        } else if (body.searchTerm) {
            const { searchTerm, niche, limit, timeFilter, after } = body;
            const query = encodeURIComponent(`( ${niche} ) ${searchTerm}`);
            url = `https://oauth.reddit.com/search?q=${query}&limit=${limit}&t=${timeFilter}&sort=relevance`;
            if (after) {
                url += `&after=${after}`;
            }
        } else {
            // If none of the above match, it's an invalid request
            throw new Error("Invalid request payload. Must include 'type' or 'searchTerm'.");
        }
        
        const redditResponse = await fetch(url, {
            headers: { 
                'Authorization': `Bearer ${token}`, 
                'User-Agent': REDDIT_USER_AGENT 
            }
        });

        if (!redditResponse.ok) {
            const errorText = await redditResponse.text();
            console.error("Reddit API Error:", errorText);
            throw new Error(`Reddit API failed with status: ${redditResponse.status} for URL: ${url}`);
        }

        const data = await redditResponse.json();

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('Proxy Error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: error.message })
        };
    }
};
