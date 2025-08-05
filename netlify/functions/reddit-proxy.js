// In your Netlify file: /functions/reddit-proxy.js

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { type, searchTerm, niche, limit, timeFilter, after, postId } = JSON.parse(event.body);
    let redditApiUrl;

    // Use 'type' to decide which Reddit API endpoint to hit
    if (type === 'comments') {
      if (!postId) {
        return { statusCode: 400, body: 'Post ID is required for fetching comments.' };
      }
      // Endpoint for fetching comments from a specific post
      redditApiUrl = `https://www.reddit.com/comments/${postId}.json?sort=top&limit=50`;
    } else {
      // Default to search if type is not 'comments' or is undefined
      if (!searchTerm || !niche) {
        return { statusCode: 400, body: 'Search term and niche are required for search.' };
      }
      const query = encodeURIComponent(`(${searchTerm}) AND (${niche})`);
      const afterParam = after ? `&after=${after}` : '';
      redditApiUrl = `https://www.reddit.com/search.json?q=${query}&sort=relevance&t=${timeFilter || 'all'}&limit=${limit || 25}${afterParam}&restrict_sr=off&type=link`;
    }

    const response = await fetch(redditApiUrl, {
      headers: { 'User-Agent': 'ProblemFinder/1.0' }
    });

    if (!response.ok) {
      return { statusCode: response.status, body: response.statusText };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
