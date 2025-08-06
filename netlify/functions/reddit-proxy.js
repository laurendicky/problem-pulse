// This is the complete and corrected code for: netlify/functions/reddit-proxy.js (v2 - with Comment Fetching)

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

        // --- NEW --- Logic to handle two different types of requests
        if (body.type === 'comments') {
            // This is a request to fetch comments for a specific post
            if (!body.postId) throw new Error("A 'postId' is required for fetching comments.");
            url = `https://oauth.reddit.com/comments/${body.postId}?limit=500&depth=10`; // Get up to 500 comments from a thread
        } else {
            // This is a standard search request (the original functionality)
            const { searchTerm, niche, limit, timeFilter, after } = body;
            const query = encodeURIComponent(`( ${niche} ) ${searchTerm}`);
            url = `https://oauth.reddit.com/search?q=${query}&limit=${limit}&t=${timeFilter}&sort=relevance`;
            if (after) {
                url += `&after=${after}`;
            }
        }
        
        const redditResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': REDDIT_USER_AGENT }
        });

        if (!redditResponse.ok) {
            const errorText = await redditResponse.text();
            console.error("Reddit API Error:", errorText);
            throw new Error(`Reddit API failed with status: ${redditResponse.status}`);
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
