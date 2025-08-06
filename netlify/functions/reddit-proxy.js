
// This is the complete and corrected code for: netlify/functions/reddit-proxy.js

// Add your Reddit API credentials as environment variables in the Netlify UI
const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } = process.env;

// This function handles getting a valid Reddit API token
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
    // Define the CORS headers to be used in all responses
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    
    // Handle the browser's preflight OPTIONS request
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
        
        // ===================================================================
        // *** THE DEFINITIVE FIX IS ON THIS LINE ***
        // We are now wrapping the `niche` (the subreddit list) in parentheses
        // to enforce the correct search logic: (subreddits) AND (searchTerm)
        // ===================================================================
        const query = encodeURIComponent(`( ${niche} ) ${searchTerm}`);
        
        let url = `https://oauth.reddit.com/search?q=${query}&limit=${limit}&t=${timeFilter}&sort=relevance`;

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
