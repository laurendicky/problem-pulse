// In your netlify/functions/reddit-proxy.js file

const fetch = require('node-fetch');

// Store credentials in environment variables in your Netlify settings
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_USER_AGENT = 'ProblemPop/1.0';

let token = {
  value: null,
  expires: 0,
};

async function getValidToken() {
    // ... (Your existing getValidToken function) ...
    // NOTE: This part is likely already in your Netlify function. 
    // If not, you'll need the logic to get an auth token.
    // For brevity, I'm assuming it exists. If it doesn't, here's a basic version:
    if (Date.now() >= token.expires) {
        const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
        const response = await fetch('https://www.reddit.com/api/v1/access_token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': REDDIT_USER_AGENT,
            },
            body: 'grant_type=client_credentials',
        });
        const data = await response.json();
        token = {
            value: data.access_token,
            expires: Date.now() + data.expires_in * 1000 - 60000, // Refresh 1 min early
        };
    }
    return token.value;
}


exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const authToken = await getValidToken();
    const body = JSON.parse(event.body);
    let url;

    // *** THIS IS THE CRITICAL NEW LOGIC ***
    if (body.searchType === 'subreddits') {
        const query = encodeURIComponent(body.query);
        // This endpoint specifically searches for subreddit names
        url = `https://oauth.reddit.com/api/search_subreddits.json?query=${query}&limit=10`;
    } else {
        // This is your existing logic for searching posts
        const niche = encodeURIComponent(body.niche || '');
        const term = encodeURIComponent(body.searchTerm || '');
        const limit = body.limit || 25;
        const timeFilter = body.timeFilter || 'all';
        const after = body.after || null;
        
        // Use the niche as the main query part
        const query = `${niche} ${term}`.trim();

        url = `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&limit=${limit}&t=${timeFilter}&type=link&sort=relevance`;
        if (after) {
            url += `&after=${after}`;
        }
    }
    // *** END OF NEW LOGIC ***

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'User-Agent': REDDIT_USER_AGENT,
      },
    });

    if (!response.ok) {
        const errorText = await response.text();
        return { statusCode: response.status, body: JSON.stringify({ error: `Reddit API Error: ${response.statusText}`, details: errorText }) };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
