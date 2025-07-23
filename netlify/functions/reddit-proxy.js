// This is the complete code for: netlify/functions/reddit-proxy.js

// Add your Reddit API credentials as environment variables in the Netlify UI
const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } = process.env;

// This function handles getting a valid Reddit API token
async function getRedditToken() {
    // This is a basic implementation. A real app might cache the token.
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
    // Define the CORS headers object here to reuse it
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*', // Allows any origin
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    
    // The browser sends an OPTIONS request first to check permissions (preflight)
    // We need to handle this and return a 200 OK with the headers.
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    try {
        const { searchTerm, niche, limit, timeFilter, after } = JSON.parse(event.body);
        const token = await getRedditToken();
        
        // Construct the search query. The 'niche' is now our subreddit list.
        const query = encodeURIComponent(`${niche} ${searchTerm}`);
        
        let url = `https://oauth.reddit.com/search?q=${query}&limit=${limit}&t=${timeFilter}&sort=relevance&restrict_sr=off`;
        if (after) {
            url += `&after=${after}`;
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
            throw new Error(`Reddit API failed with status: ${redditResponse.status}`);
        }

        const data = await redditResponse.json();

        // ** SUCCESS RESPONSE **
        return {
            statusCode: 200,
            headers: corsHeaders, // <-- Add headers here
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('Proxy Error:', error);
        
        // ** ERROR RESPONSE **
        return {
            statusCode: 500,
            headers: corsHeaders, // <-- Add headers here too
            body: JSON.stringify({ error: error.message })
        };
    }
};
