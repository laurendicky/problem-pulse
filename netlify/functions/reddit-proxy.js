// =============================================================================
// reddit-proxy.js  (Netlify function)  — upgraded with internal timeouts
//
// DEPLOY THIS to your Netlify project (netlify/functions/reddit-proxy.js),
// not just this folder. The key addition is fetchWithTimeout(): every outgoing
// call to Reddit (token + search/about/comments) is aborted after 8s, so if
// Reddit rate-limits or stalls Netlify's IP, the function returns a descriptive
// error in ~8s instead of hanging open until Netlify's execution ceiling.
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

// Helper: enforce a strict timeout on outgoing fetch calls to Reddit.
async function fetchWithTimeout(url, options, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function getToken(app, forceRefresh = false) {
    const cached = tokenCache.get(app.id);
    if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60000) {
        return cached.token;
    }
    const auth = Buffer.from(`${app.id}:${app.secret}`).toString('base64');
    const response = await fetchWithTimeout('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA
        },
        body: 'grant_type=client_credentials'
    }, 8000);

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

async function redditFetch(app, url) {
    let token = await getToken(app);
    let res = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': UA } }, 8000);
    if (res.status === 401) {
        token = await getToken(app, true);
        res = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': UA } }, 8000);
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

    // Reject non-POST methods gracefully (e.g. a browser GET).
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed. This endpoint requires a POST request.' }) };
    }

    // Guard against an empty body (the cause of the "Unexpected end of JSON input" log).
    if (!event.body) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Bad Request. Missing request body.' }) };
    }

    try {
        if (!APPS.length) throw new Error('No Reddit app credentials configured.');

        const body = JSON.parse(event.body);
        const url = buildUrl(body);
        const app = APPS[rr++ % APPS.length];
        const redditResponse = await redditFetch(app, url);

        if (!redditResponse.ok) {
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
