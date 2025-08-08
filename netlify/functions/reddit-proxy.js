// =================================================================================
// COMPLETE AND VERIFIED PROXY SCRIPT (VERSION 3.3 - ULTIMATE RESILIENCE)
// This version handles ALL non-OK responses for 'about' requests (404, 403, etc.)
// by gracefully returning null, making it immune to AI suggestions of non-existent,
// private, or banned subreddits.
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

        // --- Main routing logic ---
        if (body.type === 'about') {
            if (!body.subreddit) throw new Error("A 'subreddit' name is required for 'about' details.");
            url = `https://oauth.reddit.com/r/${body.subreddit}/about`;
        } else if (body.type === 'comments') {
            if (!body.postId) throw new Error("A 'postId' is required for fetching comments.");
            url = `https://oauth.reddit.com/comments/${body.postId}?limit=500&depth=10`;
        } else if (body.searchTerm) {
            const { searchTerm, niche, limit, timeFilter, after } = body;
            const query = encodeURIComponent(`( ${niche} ) ${searchTerm}`);
            url = `https://oauth.reddit.com/search?q=${query}&limit=${limit}&t=${timeFilter}&sort=relevance`;
            if (after) {
                url += `&after=${after}`;
            }
        } else {
            throw new Error("Invalid request payload.");
        }
        
        const redditResponse = await fetch(url, {
            headers: { 
                'Authorization': `Bearer ${token}`, 
                'User-Agent': REDDIT_USER_AGENT 
            }
        });

        // ======================================================================
        // *** THE FINAL FIX IS HERE: Handle ANY failure for 'about' requests ***
        // ======================================================================
        if (!redditResponse.ok) {
            // If this was an 'about' request, any failure (404, 403, etc.) simply means
            // the subreddit is not accessible. This is expected and not a server error.
            if (body.type === 'about') {
                return {
                    statusCode: 200, // Return a success code
                    headers: corsHeaders,
                    body: JSON.stringify(null) // Signal to the front-end that this one is invalid.
                };
            }

            // For any OTHER type of request (search, comments), a non-OK status IS a server problem.
            const errorText = await redditResponse.text();
            console.error("Reddit API Error:", errorText);
            throw new Error(`Reddit API failed with status: ${redditResponse.status} for URL: ${url}`);
        }
        // ======================================================================

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
