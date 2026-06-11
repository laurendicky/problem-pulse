// =============================================================================
// reddit-proxy.js  (Netlify function)  — upgraded
//
// Two changes vs. the old version:
//   1. TOKEN CACHING. The old proxy minted a brand-new OAuth token on EVERY request
//      (two round-trips per call). Tokens are valid for hours, so we now cache each
//      app's token in module scope (survives warm invocations) and only refresh when
//      it's near expiry. This roughly halves Reddit latency on its own.
//   2. OPTIONAL MULTI-APP POOL. Add a second Reddit app's creds as REDDIT_CLIENT_ID_2
//      / REDDIT_CLIENT_SECRET_2 in Netlify and the proxy round-robins across both,
//      doubling your effective ~100 req/min ceiling for multiple simultaneous users.
//      If you don't set the _2 vars, it runs on the single app exactly as before.
//
// No client-side changes needed — same request/response shape.
// =============================================================================

const UA = process.env.REDDIT_USER_AGENT;

// Build the app pool from env. App #1 is required; #2 is optional.
const APPS = [
    { id: process.env.REDDIT_CLIENT_ID,   secret: process.env.REDDIT_CLIENT_SECRET },
    { id: process.env.REDDIT_CLIENT_ID_2, secret: process.env.REDDIT_CLIENT_SECRET_2 }
].filter(a => a.id && a.secret);

// Per-app token cache: id -> { token, expiresAt(ms) }. Persists across warm invocations.
const tokenCache = new Map();
let rr = 0; // round-robin cursor

async function getToken(app, forceRefresh = false) {
    const cached = tokenCache.get(app.id);
    // Reuse a cached token until 60s before it expires.
    if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60000) {
        return cached.token;
    }
    const auth = Buffer.from(`${app.id}:${app.secret}`).toString('base64');
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA
        },
        body: 'grant_type=client_credentials'
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error('Reddit Token Error:', errorBody);
        throw new Error('Failed to retrieve Reddit API token');
    }
    const data = await response.json();
    const ttlMs = (data.expires_in || 3600) * 1000;
    tokenCache.set(app.id, { token: data.access_token, expiresAt: Date.now() + ttlMs });
    return data.access_token;
}

// Build the Reddit URL for a given request body (unchanged routing logic).
function buildUrl(body) {
    if (body.type === 'about') {
        if (!body.subreddit) throw new Error("A 'subreddit' name is required for 'about' details.");
        return `https://oauth.reddit.com/r/${body.subreddit}/about`;
    }
    if (body.type === 'comments') {
        if (!body.postId) throw new Error("A 'postId' is required for fetching comments.");
        return `https://oauth.reddit.com/comments/${body.postId}?limit=500&depth=10`;
    }
    if (body.searchTerm) {
        const { searchTerm, niche, limit, timeFilter, after } = body;
        const query = encodeURIComponent(`( ${niche} ) ${searchTerm}`);
        let url = `https://oauth.reddit.com/search?q=${query}&limit=${limit}&t=${timeFilter}&sort=relevance`;
        if (after) url += `&after=${after}`;
        return url;
    }
    throw new Error('Invalid request payload.');
}

// One Reddit call with a cached token. On a 401 (token rejected), refresh once and retry —
// so a stale cached token never causes a hard failure.
async function redditFetch(app, url) {
    let token = await getToken(app);
    let res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': UA } });
    if (res.status === 401) {
        token = await getToken(app, true);
        res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': UA } });
    }
    return res;
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

    // Safeguard 1: Reject GET requests or other non-POST methods gracefully
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: corsHeaders, 
            body: JSON.stringify({ error: 'Method Not Allowed. This endpoint requires a POST request.' }) 
        };
    }

    // Safeguard 2: Check if event.body exists and is not empty
    if (!event.body) {
        return { 
            statusCode: 400, 
            headers: corsHeaders, 
            body: JSON.stringify({ error: 'Bad Request. Missing request body.' }) 
        };
    }

    try {
        if (!APPS.length) throw new Error('No Reddit app credentials configured.');

        const body = JSON.parse(event.body);
        const url = buildUrl(body);

        // Pick an app round-robin across the pool (1 app => always the same one).
        const app = APPS[rr++ % APPS.length];

        const redditResponse = await redditFetch(app, url);

        if (!redditResponse.ok) {
            // 'about' failures (404/403/etc.) just mean the subreddit isn't accessible — not an error.
            if (body.type === 'about') {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(null) };
            }
            const errorText = await redditResponse.text();
            console.error('Reddit API Error:', errorText);
            throw new Error(`Reddit API failed with status: ${redditResponse.status} for URL: ${url}`);
        }

        const data = await redditResponse.json();
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(data) };

    } catch (error) {
        console.error('Proxy Error:', error);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
    }
};
