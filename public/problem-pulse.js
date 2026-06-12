// =============================================================================
// problem-pulse-v2.js — clean rebuild, piece by piece.
//
// PART 1 — Entry / search flow (first 3 functions):
//   1. callOpenAI            — single reliable helper for the OpenAI proxy
//   2. getRelatedSearchTermsAI — brainstorm related search terms for an audience
//   3. findSubredditsForGroup  — turn those terms into candidate subreddits
//
// Design rules for the rebuild:
//   - Keep it simple. No throttling/circuit-breakers until a piece actually needs them.
//   - One fetch per call, with a timeout that covers BOTH the request AND the JSON parse.
//   - Every async function fails soft (returns a sensible empty value), never throws to the UI.
// =============================================================================

const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy'; // used by later parts

// --- 1. callOpenAI ----------------------------------------------------------
// Sends an OpenAI chat payload to the proxy and returns the PARSED JSON object
// the model produced. The proxy responds with either { openaiResponse: "<json string>" }
// or { error: true, message }. The abort timer is cleared in `finally` — i.e. AFTER
// response.json() resolves — so a server that stalls mid-body still gets aborted
// (that was the silent-hang bug in the old code).
async function callOpenAI(payload, { timeoutMs = 45000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: payload }),
            signal: ctrl.signal
        });
        const data = await res.json();
        if (!data || data.error) {
            throw new Error((data && data.message) || 'OpenAI proxy returned an error');
        }
        return JSON.parse(data.openaiResponse);
    } finally {
        clearTimeout(timer);
    }
}

// --- 2. getRelatedSearchTermsAI --------------------------------------------
// Given an audience name, returns up to ~5 related search terms (or [] on failure).
async function getRelatedSearchTermsAI(audience) {
    const payload = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a creative brainstorming assistant that outputs only JSON.' },
            { role: 'user', content: `Given the target audience "${audience}", generate up to 5 related but distinct search terms or concepts that would help find communities for them. Think about activities, problems, life stages, and related interests. Respond ONLY with a valid JSON object with a single key "terms", which is an array of strings.` }
        ],
        temperature: 0.4,
        max_completion_tokens: 150,
        response_format: { type: 'json_object' }
    };
    try {
        const parsed = await callOpenAI(payload);
        return Array.isArray(parsed.terms) ? parsed.terms : [];
    } catch (error) {
        console.warn('[Search Terms] failed:', error && error.message);
        return [];
    }
}

// --- 3. findSubredditsForGroup ---------------------------------------------
// Brainstorms related terms, then asks the model for up to 20 candidate subreddits
// (names without the "r/" prefix). Returns [] on failure so the caller can handle it.
async function findSubredditsForGroup(groupName) {
    const relatedTerms = await getRelatedSearchTermsAI(groupName);
    window._audienceTopics = relatedTerms; // stash for later parts that want the topics
    const allTerms = [groupName, ...relatedTerms];

    const payload = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are an expert Reddit community finder providing answers in strict JSON format.' },
            { role: 'user', content: `Based on the following audience and related keywords: [${allTerms.join(', ')}], suggest up to 20 relevant and active Reddit subreddits. Prioritize a variety of communities, including both large general ones and smaller niche ones. Provide your response ONLY as a JSON object with a single key "subreddits" which contains an array of subreddit names (without "r/").` }
        ],
        temperature: 0.2,
        max_completion_tokens: 300,
        response_format: { type: 'json_object' }
    };
    try {
        const parsed = await callOpenAI(payload);
        return Array.isArray(parsed.subreddits) ? parsed.subreddits : [];
    } catch (error) {
        console.error('[Find Subreddits] failed:', error && error.message);
        return [];
    }
}
