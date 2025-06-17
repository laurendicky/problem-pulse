// The single URL for our new, simplified Netlify function
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';

const stopWords = [
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't", "as", "at",
    "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can't", "cannot", "could",
    "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few", "for",
    "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's",
    "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm",
    "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't",
    "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours",
    "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't",
    "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there",
    "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too",
    "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't",
    "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's",
    "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
    "yourselves", "like", "just", "dont", "can", "people", "help", "hes", "shes", "thing", "stuff", "really", "actually", "even", "know", "still",
];
const CLIENT_ID = 'PynIoQ3wsLrGESAOvl2nSw';
const CLIENT_SECRET = 'giYtA4-dQNiVuKE1ePH5ImAC5vysaA';
const USER_AGENT = 'web:problem-pulse-tool:v1.0 (by /u/RubyFishSimon)';

function deduplicatePosts(posts) {
    const seen = new Set();
    return posts.filter(post => {
        if (!post.data || !post.data.id) return false;
        if (seen.has(post.data.id)) return false;
        seen.add(post.data.id);
        return true;
    });
}

function formatDate(utcSeconds) {
    const date = new Date(utcSeconds * 1000);
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

let accessToken = null;
let tokenExpiry = 0;

async function fetchNewToken() {
    const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

    const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
        },
        body: 'grant_type=client_credentials'
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Failed to get Reddit token: ${resp.status} ${resp.statusText} - ${text}`);
    }

    const data = await resp.json();
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // expires_in is seconds
    return accessToken;
}

async function getValidToken() {
    if (!accessToken || Date.now() >= tokenExpiry) {
        await fetchNewToken();
    }
    return accessToken;
}
const MAX_CONCURRENT_BATCH = 8; // Number of simultaneous requests per batch
const PAGINATION_BATCH_SIZE = 25; // Posts fetched per page during pagination
const MAX_RETRIES = 3; // Max retries on rate limit/error per request

async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all') {
    let allPosts = [];
    let after = null;
    let retries = 0;
    let token = await getValidToken();

    async function fetchPage(afterToken) {
        let url = `https://oauth.reddit.com/search?q=${encodeURIComponent(term + ' ' + niche)}&limit=${PAGINATION_BATCH_SIZE}&t=${timeFilter}`;
        if (afterToken) url += `&after=${afterToken}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': USER_AGENT,
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                token = await fetchNewToken();
                return await fetchPage(afterToken);
            }
            if (response.status === 429) {
                if (retries >= MAX_RETRIES) {
                    throw new Error(`Rate limited by Reddit API too many times for term "${term}".`);
                }
                const retryAfterSec = Number(response.headers.get('Retry-After')) || 2;
                console.warn(`Rate limited on term "${term}", retrying after ${retryAfterSec} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000));
                retries++;
                return await fetchPage(afterToken);
            }
            throw new Error(`Error fetching posts for term "${term}": ${response.status} ${response.statusText}`);
        }
        retries = 0;
        const data = await response.json();
        return data.data;
    }

    try {
        while (allPosts.length < totalLimit) {
            const pageData = await fetchPage(after);
            if (!pageData || !pageData.children || pageData.children.length === 0) break;
            allPosts = allPosts.concat(pageData.children);
            after = pageData.after;
            if (!after) break;
        }
    } catch (err) {
        console.error(`Failed to fetch posts for term "${term}":`, err.message);
    }
    return allPosts.slice(0, totalLimit);
}

async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all') {
    const allResults = [];
    for (let i = 0; i < searchTerms.length; i += MAX_CONCURRENT_BATCH) {
        const batchTerms = searchTerms.slice(i, i + MAX_CONCURRENT_BATCH);
        const batchPromises = batchTerms.map(term => fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter));
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(posts => {
            if (Array.isArray(posts)) {
                allResults.push(...posts);
            }
        });
        if (i + MAX_CONCURRENT_BATCH < searchTerms.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    const dedupedPosts = deduplicatePosts(allResults);
    return dedupedPosts;
}

async function fetchMultipleRedditData(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all', minUpvotes = 0) {
    const fetchPromises = searchTerms.map(async (term) => {
        const token = await getValidToken();
        const query = encodeURIComponent(`${term} ${niche}`);
        const url = `https://oauth.reddit.com/search?q=${query}&limit=${limitPerTerm}&t=${timeFilter}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': USER_AGENT,
            }
        });
        if (!response.ok) {
            console.error(`Reddit API Error for term "${term}": ${response.status} ${response.statusText}`);
            return [];
        }
        const data = await response.json();
        return data.data.children || [];
    });
    const results = await Promise.all(fetchPromises);
    const allPosts = results.flat();
    const dedupedPosts = deduplicatePosts(allPosts);
    const filteredByUpvotes = minUpvotes > 0 ? dedupedPosts.filter(post => post.data.ups >= minUpvotes) : dedupedPosts;
    return filteredByUpvotes;
}

function parseAISummary(aiResponse) {
    try {
        aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim();
        const jsonMatch = aiResponse.match(/{[\s\S]*}/);
        if (!jsonMatch) {
            throw new Error("No JSON object found in the AI response.");
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.summaries || !Array.isArray(parsed.summaries) || parsed.summaries.length < 1) {
            throw new Error("AI response does not contain at least one summary.");
        }
        parsed.summaries.forEach((summary, idx) => {
            const missingFields = [];
            if (!summary.title) missingFields.push("title");
            if (!summary.body) missingFields.push("body");
            if (typeof summary.count !== 'number') missingFields.push("count");
            if (!summary.quotes || !Array.isArray(summary.quotes) || summary.quotes.length < 1) missingFields.push("quotes");
            if (!summary.keywords || !Array.isArray(summary.keywords) || summary.keywords.length === 0) missingFields.push("keywords");
            if (missingFields.length > 0)
                throw new Error(`Summary ${idx + 1} is missing required fields: ${missingFields.join(", ")}.`);
        });
        return parsed.summaries;
    } catch (error) {
        console.error("Parsing Error:", error);
        console.log("Raw AI Response:", aiResponse);
        throw new Error("Failed to parse AI response. Ensure the response is in the correct JSON format.");
    }
}

function parseAIAssignments(aiResponse) {
    try {
        aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim();
        const jsonMatch = aiResponse.match(/{[\s\S]*}/);
        if (!jsonMatch) {
            throw new Error("No JSON object found in the AI response.");
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.assignments || !Array.isArray(parsed.assignments)) {
            throw new Error("AI response does not contain an 'assignments' array.");
        }
        parsed.assignments.forEach((assignment, idx) => {
            const missingFields = [];
            if (typeof assignment.postNumber !== 'number') missingFields.push("postNumber");
            if (typeof assignment.finding !== 'number') missingFields.push("finding");
            if (missingFields.length > 0)
                throw new Error(`Assignment ${idx + 1} is missing required fields: ${missingFields.join(", ")}.`);
        });
        return parsed.assignments;
    } catch (error) {
        console.error("Parsing Error:", error);
        console.log("Raw AI Response:", aiResponse);
        throw new Error("Failed to parse AI response. Ensure the response is in the correct JSON format.");
    }
}

function isRamblingOrNoisy(text) {
    if (!text) return false;
    const htmlEntityRegex = /&#x[0-9a-fA-F]+;/g;
    if (htmlEntityRegex.test(text)) return true;
    const longSymbolSeqRegex = /[^a-zA-Z0-9\s]{5,}/g;
    if (longSymbolSeqRegex.test(text)) return true;
    const gibberishRegex = /(.)\1{6,}/g;
    if (gibberishRegex.test(text)) return true;
    return false;
}

function filterPosts(posts, minUpvotes = 20) {
    return posts.filter(post => {
        const title = post.data.title.toLowerCase();
        const selftext = post.data.selftext || '';
        if (title.includes('[ad]') || title.includes('sponsored')) return false;
        if (post.data.upvote_ratio < 0.2) return false;
        if (post.data.ups < minUpvotes) return false;
        if (!selftext || selftext.length < 100) return false;
        if (isRamblingOrNoisy(title) || isRamblingOrNoisy(selftext)) return false;
        return true;
    });
}

function preprocessText(text) {
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/[^a-zA-Z0-9\s.,!?]/g, '');
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function countUniquePostsPerKeyword(posts, keyword) {
    const keywordLower = keyword.toLowerCase();
    const regex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const seenPostIds = new Set();
    posts.forEach(post => {
        const text = ((post.data.title || '') + " " + (post.data.selftext || '')).toLowerCase();
        if (regex.test(text) && !seenPostIds.has(post.data.id)) {
            seenPostIds.add(post.data.id);
        }
    });
    return seenPostIds.size;
}

function getTopKeywords(posts, topN = 10) {
    const freqMap = {};
    posts.forEach(post => {
        const combinedText = `${post.data.title} ${post.data.selftext}`;
        const cleanedText = preprocessText(combinedText);
        const words = cleanedText.split(/\s+/);
        words.forEach(word => {
            if (!stopWords.includes(word) && word.length > 2) {
                freqMap[word] = (freqMap[word] || 0) + 1;
            }
        });
    });
    const sortedWords = Object.keys(freqMap).sort((a, b) => freqMap[b] - freqMap[a]);
    return sortedWords.slice(0, topN);
}

function countKeywordMentions(posts, terms) {
    const counts = {};
    terms.forEach(term => {
        counts[term] = 0;
    });
    posts.forEach(post => {
        const title = post.data.title ? post.data.title.toLowerCase() : '';
        const selftext = post.data.selftext ? post.data.selftext.toLowerCase() : '';
        terms.forEach(term => {
            const escapedTerm = term.replace(/[-\\/^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedTerm}\\b`, 'g');
            counts[term] += (title.match(regex) || []).length + (selftext.match(regex) || []).length;
        });
    });
    return counts;
}

function getFirstTwoSentences(text) {
    if (!text) return '';
    const sentences = text.match(/[^\.!\?]+[\.!\?]+(?:\s|$)/g);
    if (!sentences) return text;
    return sentences.slice(0, 2).join(' ').trim();
}

function reorderPostsAdvanced(allPosts, userTerm, struggleTerms) {
    const group1 = [];
    const group2 = [];
    const group3 = [];
    const group4 = [];
    allPosts.forEach(post => {
        const title = post.data.title || "";
        const selftext = post.data.selftext || "";
        const firstTwo = getFirstTwoSentences(selftext);
        const titleHasUser = title.toLowerCase().includes(userTerm.toLowerCase());
        const titleHasStruggle = struggleTerms.some(term => title.toLowerCase().includes(term.toLowerCase()));
        const firstTwoHasUser = firstTwo.toLowerCase().includes(userTerm.toLowerCase());
        const firstTwoHasStruggle = struggleTerms.some(term => firstTwo.toLowerCase().includes(term.toLowerCase()));
        if (titleHasUser && titleHasStruggle) group1.push(post);
        else if (titleHasUser) group2.push(post);
        else if (firstTwoHasUser && firstTwoHasStruggle) group3.push(post);
        else if (firstTwoHasUser) group4.push(post);
    });
    return [...group1, ...group2, ...group3, ...group4];
}

async function assignPostsToFindings(summaries, posts, keywordsString, userNiche, combinedTexts, maxFindings = 5) {
    const prompt = `
    You are an assistant that carefully categorizes Reddit posts by assigning each to the most relevant of up to ${maxFindings} findings, based on the post's content. Each finding must have highly relevant posts, ensuring posts clearly illustrate the finding’s core theme. Avoid assigning duplicated, unrelated or off-topic posts. Provide your response only as a JSON object listing assignments.
    Here are the findings:
    ${summaries.map((summary, index) => `Finding ${index + 1}:
    Title: ${summary.title}
    Summary: ${summary.body}`).join('\n\n')}
    Here are the Reddit posts:
    ${posts.map((post, index) => `Post ${index + 1}:
    Title: ${post.data.title}
    Body: ${getFirstTwoSentences(post.data.selftext)}`).join('\n\n')}
    For each post, assign it to the most relevant finding (between 1 and ${summaries.length}) based on the content. If a post does not clearly relate to any finding, it can be omitted.
    Provide the assignments in the following JSON format without any additional text, explanations, or code blocks:
    {
      "assignments": [
        {"postNumber": 1, "finding": 2},
        {"postNumber": 3, "finding": 1}
      ]
    }`;
    const openAIParams = {
        model: "gpt-4o-mini",
        messages: [{
            role: "system",
            content: "You are a helpful assistant that categorizes Reddit posts into the most relevant findings based on their content."
        }, {
            role: "user",
            content: prompt
        }],
        temperature: 0,
        max_tokens: 1000
    };
    try {
        const response = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: openAIParams })
        });
        if (!response.ok) {
            const errorDetail = await response.json();
            throw new Error(`OpenAI API Error: ${errorDetail.error || response.statusText}`);
        }
        const data = await response.json();
        let aiResponse = data.openaiResponse;
        const assignments = parseAIAssignments(aiResponse);
        return assignments;
    } catch (error) {
        console.error("Assignment Error:", error);
        throw new Error("Failed to assign Reddit posts to findings using OpenAI.");
    }
}

function getWordMatchRegex(word) {
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapedWord}\\b`, 'i');
}

function calculateRelevanceScore(post, finding) {
    let score = 0;
    const postTitle = post.data.title || "";
    const postBody = post.data.selftext || "";
    const findingTitleWords = finding.title.toLowerCase().split(' ').filter(word => word.length > 3 && !stopWords.includes(word));
    const findingKeywords = (finding.keywords || []).map(k => k.toLowerCase());
    let titleWordMatched = false;
    let keywordMatched = false;
    for (const word of findingTitleWords) {
        const regex = getWordMatchRegex(word);
        if (regex.test(postTitle)) {
            score += 5;
            titleWordMatched = true;
        }
        if (regex.test(postBody)) {
            score += 2;
            titleWordMatched = true;
        }
    }
    for (const keyword of findingKeywords) {
        const regex = getWordMatchRegex(keyword);
        if (regex.test(postTitle)) {
            score += 3;
            keywordMatched = true;
        }
        if (regex.test(postBody)) {
            score += 1;
            keywordMatched = true;
        }
    }
    if (titleWordMatched && keywordMatched) {
        score += 10;
    }
    return score;
}

function calculateFindingMetrics(validatedSummaries, filteredPosts) {
    const metrics = {};
    const allProblemPostIds = new Set();
    validatedSummaries.forEach((finding, index) => {
        metrics[index] = {
            supportCount: 0
        };
    });
    filteredPosts.forEach(post => {
        let bestFindingIndex = -1;
        let maxScore = 0;
        validatedSummaries.forEach((finding, index) => {
            const score = calculateRelevanceScore(post, finding);
            if (score > maxScore) {
                maxScore = score;
                bestFindingIndex = index;
            }
        });
        if (bestFindingIndex !== -1 && maxScore > 0) {
            metrics[bestFindingIndex].supportCount++;
            allProblemPostIds.add(post.data.id);
        }
    });
    metrics.totalProblemPosts = allProblemPostIds.size;
    return metrics;
}

function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) {
    const MIN_POSTS = 3;
    const MAX_POSTS = 6;
    const MINIMUM_RELEVANCE_SCORE = 5;
    const finding = window._summaries[summaryIndex];
    if (!finding) return;
    let relevantPosts = [];
    const addedPostIds = new Set();
    let headerMessage = `Real Stories from Reddit: "${finding.title}"`;
    const addPost = (post) => {
        if (post && post.data && !usedPostIds.has(post.data.id) && !addedPostIds.has(post.data.id)) {
            relevantPosts.push(post);
            addedPostIds.add(post.data.id);
        }
    };
    const assignedPostNumbers = assignments.filter(a => a.finding === (summaryIndex + 1)).map(a => a.postNumber);
    assignedPostNumbers.forEach(postNum => {
        const post = window._postsForAssignment[postNum - 1];
        addPost(post);
    });
    if (relevantPosts.length < MIN_POSTS) {
        const candidatePool = allPosts.filter(p => !usedPostIds.has(p.data.id) && !addedPostIds.has(p.data.id));
        const scoredCandidates = candidatePool.map(post => ({
                post: post,
                score: calculateRelevanceScore(post, finding)
            }))
            .filter(item => item.score >= MINIMUM_RELEVANCE_SCORE)
            .sort((a, b) => b.score - a.score);
        for (const candidate of scoredCandidates) {
            if (relevantPosts.length >= MIN_POSTS) break;
            addPost(candidate.post);
        }
    }
    let html;
    if (relevantPosts.length === 0) {
        html = `<div style="font-style: italic; color: #555;">Could not find any highly relevant Reddit posts for this finding.</div>`;
    } else {
        const finalPosts = relevantPosts.slice(0, MAX_POSTS);
        finalPosts.forEach(post => usedPostIds.add(post.data.id));
        html = finalPosts.map(post => `
          <div class="insight" style="border:1px solid #ccc; padding:8px; margin-bottom:8px; background:#fafafa; border-radius:4px;">
            <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1rem; color:#007bff;">${post.data.title}</a>
            <p style="font-size:0.9rem; margin:0.5rem 0; color:#333;">${post.data.selftext ? post.data.selftext.substring(0, 150) + '...' : 'No content.'}</p>
            <small>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 💬 ${post.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</small>
          </div>
        `).join('');
    }
    const container = document.getElementById(`reddit-div${summaryIndex + 1}`);
    if (container) {
        container.innerHTML = `<div class="reddit-samples-header" style="font-weight:bold; margin-bottom:6px;">${headerMessage}</div><div class="reddit-samples-posts">${html}</div>`;
    }
}

const sortFunctions = {
    relevance: (a, b) => 0,
    newest: (a, b) => b.data.created_utc - a.data.created_utc,
    upvotes: (a, b) => b.data.ups - a.data.ups,
    comments: (a, b) => b.data.num_comments - a.data.num_comments,
};

function renderPosts(posts) {
    const container = document.getElementById("posts-container");
    if (!container) return;
    const html = posts.map(post => `
        <div class="insight" style="border:1px solid #ccc; padding:8px; margin-bottom:8px; background:#fafafa; border-radius:4px;">
          <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1rem; color:#007bff;">
            ${post.data.title}
          </a>
          <p style="font-size:0.9rem; margin:0.5rem 0; color:#333;">
            ${post.data.selftext ? post.data.selftext.substring(0,200) + (post.data.selftext.length > 200 ? '...' : '') : 'No additional content.'}
          </p>
          <small>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 💬 ${post.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</small>
        </div>
      `).join('');
    container.innerHTML = html;
}

// =============================================================
// START: ADDITION OF NEW HELPER FUNCTIONS FOR QUOTE BUBBLES
// These are added here, in the global scope, with other helpers.
// =============================================================

/**
 * Extracts a relevant, quote-worthy sentence from a post based on a finding's keywords.
 * @param {object} post - The Reddit post object.
 * @param {object} finding - The summary/finding object (containing keywords).
 * @returns {string|null} A relevant quote string, or null if no suitable quote is found.
 */
function extractRelevantQuote(post, finding) {
    const bodyText = post.data.selftext;
    if (!bodyText || bodyText.length < 50) return null;

    const sentences = bodyText.match(/[^\.!\?]+[\.!\?]+/g) || [];
    const keywords = (finding.keywords || []).map(k => k.toLowerCase());
    if (keywords.length === 0) return null;

    for (const sentence of sentences) {
        const cleanSentence = sentence.trim();
        if (cleanSentence.length > 20 && cleanSentence.length < 250) {
            for (const keyword of keywords) {
                if (getWordMatchRegex(keyword).test(cleanSentence)) {
                    return cleanSentence;
                }
            }
        }
    }
    if (sentences.length > 0) {
        const firstSentence = sentences[0].trim();
        if (firstSentence.length > 20 && firstSentence.length < 250) {
            return firstSentence;
        }
    }
    return null;
}

/**
 * Finds top posts for a finding, extracts quotes, and renders them as animated floating bubbles.
 * @param {number} findingIndex - The 0-based index of the finding.
 * @param {object} finding - The summary/finding object.
 * @param {Array} allPosts - The complete list of filtered Reddit posts.
 */
function renderQuoteBubbles(findingIndex, finding, allPosts) {
    const container = document.getElementById(`quote-float-container-${findingIndex + 1}`);
    if (!container) return;

    const topPosts = allPosts
        .map(post => ({
            post: post,
            score: calculateRelevanceScore(post, finding)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map(item => item.post);

    const quotes = topPosts.map(post => extractRelevantQuote(post, finding))
        .filter(quote => quote !== null);

    // Clear any existing quote bubbles first
    container.innerHTML = '';

    quotes.forEach(quote => {
        const quoteEl = document.createElement('div');
        quoteEl.classList.add('quote-bubble');
        quoteEl.textContent = `“${quote}”`;

        // Random horizontal position (0–70%)
        const randomLeft = Math.random() * 70;
        quoteEl.style.left = `${randomLeft}%`;

        // Random vertical offset (to reduce overlapping)
        const randomBottomOffset = Math.random() * 300;// pixels
        quoteEl.style.bottom = `-${200 + randomBottomOffset}px`;

        // Random float duration (20–35s)
        const randomDuration = Math.random() * 15 + 20;
        quoteEl.style.animation = `floatUp ${randomDuration}s linear forwards`;

        // Random font size (14–18px)
        const randomSize = Math.random() * 4 + 14;
        quoteEl.style.fontSize = `${randomSize}px`;

        container.appendChild(quoteEl);

        // Remove quote after animation to prevent buildup
        setTimeout(() => quoteEl.remove(), randomDuration * 1000);
    });
}
// Only render bubbles when the matching "See more" button is clicked
const totalFindings = 5;
for (let i = 1; i <= totalFindings; i++) {
  const btn = document.getElementById(`see-more-${i}`);
  if (!btn) continue;
  btn.addEventListener('click', () => {
    renderQuoteBubbles(i - 1, findings[i - 1], allPosts);
  });
}

// =============================================================
// END: ADDITION OF NEW HELPER FUNCTIONS
// =============================================================

document.getElementById("pulse-search").addEventListener("click", async function(event) {
    event.preventDefault();
    const toClear = [
        "count-header", "filter-header", "findings-1", "findings-2", "findings-3",
        "findings-4", "findings-5", "pulse-results", "posts-container"
    ];

    toClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
    });
    document.querySelectorAll('.reddit-samples-posts, .reddit-samples-header, .quote-float-container').forEach(container => {
        container.innerHTML = '';
    });

    const nicheElement = document.getElementById("niche-input");
    if (!nicheElement) {
        alert("Error: 'niche-input' element not found.");
        return;
    }

    let userNiche = (typeof nicheElement.value !== 'undefined') ?
        nicheElement.value.trim() :
        nicheElement.innerText.trim();

    const redditDiv = document.getElementById("pulse-results");
    const finding1 = document.getElementById("findings-1");
    const finding2 = document.getElementById("findings-2");
    const finding3 = document.getElementById("findings-3");
    const finding4 = document.getElementById("findings-4");
    const finding5 = document.getElementById("findings-5");
    const resultsMessageDiv = document.getElementById("results-message");
    const countHeaderDiv = document.getElementById("count-header");

    if (resultsMessageDiv) resultsMessageDiv.innerHTML = "";

    if (!userNiche) {
        alert("Please enter a niche.");
        return;
    }

    const timeRadios = document.getElementsByName("timePosted");
    let selectedTimeRaw = "all";
    for (const radio of timeRadios) {
        if (radio.checked) {
            selectedTimeRaw = radio.value;
            break;
        }
    }

    const timeMap = {
        week: "week",
        month: "month",
        "6months": "year",
        year: "year",
        all: "all"
    };

    const minVotesRadios = document.getElementsByName("minVotes");
    let selectedMinUpvotes = 20;
    for (const radio of minVotesRadios) {
        if (radio.checked) {
            selectedMinUpvotes = parseInt(radio.value, 10);
            break;
        }
    }

    const filterHeaderDiv = document.getElementById("filter-header");
    
    // THIS IS YOUR ORIGINAL NESTED FUNCTION, PRESERVED EXACTLY.
    function formatFilterHeader(timeRaw, minUpvotes) {
        const timeMapReadable = {
            all: "All-time",
            week: "Past week",
            month: "Past month",
            year: "Past year"
        };
        const timeText = timeMapReadable[timeRaw] || "All-time";
        let upvoteText;
        if (minUpvotes === 0) {
            upvoteText = "all upvotes";
        } else if (minUpvotes === 1) {
            upvoteText = "1+ upvote";
        } else {
            upvoteText = `${minUpvotes}+ upvotes`;
        }
        return `${timeText} posts with ${upvoteText}`;
    }

    if (filterHeaderDiv) {
        filterHeaderDiv.innerText = formatFilterHeader(selectedTimeRaw, selectedMinUpvotes);
    }
    
    const selectedTime = timeMap[selectedTimeRaw] || "all";

    redditDiv.innerHTML = "";
    finding1.innerHTML = "<p class='loading'>Insight brewing...</p>";
    finding2.innerHTML = "<p class='loading'>Drama detected...</p>";
    finding3.innerHTML = "<p class='loading'>Tea being spilled...</p>";
    finding4.innerHTML = "<p class='loading'>Juice incoming...</p>";
    finding5.innerHTML = "<p class='loading'>Gossip loading...</p>";

    const loadingBlock = document.getElementById("loading-code-1");
    if (loadingBlock) loadingBlock.style.display = "flex";

    const searchTerms = [
        "struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve",
        "annoyance", "annoyed", "frustration", "disappointed", "fed up", "drives me mad", "hate when",
        "help", "advice", "solution to", "workaround", "how do I", "how to fix", "how to stop",
        "can’t find", "nothing works", "tried everything", "too expensive", "takes too long",
        "vent", "rant", "so annoying", "makes me want to scream"
    ];
    
    // THIS IS YOUR ORIGINAL NESTED FUNCTION, PRESERVED EXACTLY.
    function countUniquePostsMentioningTerm(posts, term) {
        const termLower = term.toLowerCase();
        let count = 0;
        posts.forEach(post => {
            const title = post.data.title ? post.data.title.toLowerCase() : '';
            const selftext = post.data.selftext ? post.data.selftext.toLowerCase() : '';
            const combinedText = title + " " + selftext;
            if (combinedText.includes(termLower)) {
                count++;
            }
        });
        return count;
    }

    try {
        let allPosts = await fetchMultipleRedditDataBatched(userNiche, searchTerms, 100, selectedTime);

        if (allPosts.length === 0) {
            if (loadingBlock) loadingBlock.style.display = "none";
            resultsMessageDiv.innerHTML = "<p>😔 No results found on Reddit.</p>";
            [finding1, finding2, finding3, finding4, finding5].forEach(f => { if(f) f.innerHTML = "" });
            if (countHeaderDiv) countHeaderDiv.textContent = "";
            return;
        }

        const reorderedPosts = reorderPostsAdvanced(allPosts, userNiche, searchTerms);
        const filteredPosts = filterPosts(reorderedPosts, selectedMinUpvotes);

        if (filteredPosts.length === 0 || filteredPosts.length < 10) {
            if (loadingBlock) loadingBlock.style.display = "none";
            let msg = filteredPosts.length === 0 ? 'No high-quality results found on Reddit.' : 'Not enough high-quality results found on Reddit.';
            resultsMessageDiv.innerHTML = `<p class='no-results-message'>😔 ${msg}</p>`;
            [finding1, finding2, finding3, finding4, finding5].forEach(f => { if(f) f.innerHTML = "" });
            if (countHeaderDiv) countHeaderDiv.textContent = "";
            if (document.getElementById("posts-container")) {
                document.getElementById("posts-container").innerHTML = "";
            }
            return;
        }

        window._filteredPosts = filteredPosts;
        renderPosts(filteredPosts);

        function formatMentionCount(count, term) {
            if (count < 10) {
                return `No high quality Reddit posts mention struggles with “${term}” right now.`;
            } else if (count < 100) {
                const rounded = Math.round(count / 10) * 10;
                return `Over ${rounded.toLocaleString()} Reddit posts complain about “${term}”.`;
            } else {
                const rounded = Math.round(count / 100) * 100;
                return `Over ${rounded.toLocaleString()} Reddit posts complain about “${term}”.`;
            }
        }

        const userNicheCount = countUniquePostsMentioningTerm(allPosts, userNiche);
        if (countHeaderDiv) {
            countHeaderDiv.textContent = formatMentionCount(userNicheCount, userNiche);
            if (countHeaderDiv.textContent.trim() !== "" && countHeaderDiv.textContent.includes("Over")) {
                const offset = 20;
                const y = countHeaderDiv.getBoundingClientRect().top + window.pageYOffset - offset;
                window.scrollTo({
                    top: y,
                    behavior: "smooth"
                });
            }
        }

        resultsMessageDiv.innerHTML = "";

        const topKeywords = getTopKeywords(filteredPosts, 10);
        const keywordsString = topKeywords.join(', ');

        const topPosts = filteredPosts.slice(0, 80);
        const combinedTexts = topPosts.map(post => `${post.data.title || ""}. ${post.data.selftext ? post.data.selftext.substring(0, 300) : ""}`).join("\n\n");
        
        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [{
                role: "system",
                content: "You are a helpful assistant that summarizes user-provided text into between 1 and 5 core common struggles within a specific niche and provides three authentic, concise quotes for each struggle."
            }, {
                role: "user",
                content: `Using the top keywords [${keywordsString}], summarize the following content into between 1 and 5 core common struggles in the niche "${userNiche}". For each struggle, provide a concise title, a brief summary, and the number of times this problem was mentioned. Additionally, generate three authentic, raw, and short (no longer than 6 words) quotes that reflect the lived experience of each struggle. Ensure that each summary's "body" includes the user's keyword "${userNiche}" or a close variant of it, and that it appears naturally and clearly to emphasize relevance. 
      Present the output in strict JSON format as shown below:
    
      {
        "summaries": [
          { "title": "SummaryTitle1", "body": "SummaryBody1", "count": 60, "quotes": ["Quote1","Quote2","Quote3"], "keywords": ["keyword1","synonym1"] },
          { "title": "SummaryTitle2", "body": "SummaryBody2", "count": 45, "quotes": ["Quote1","Quote2","Quote3"], "keywords": ["keyword2a","synonym2a"] }
        ]
      }
      Ensure the quotes and keywords sound realistic and reflect genuine user language.
    
      \`\`\`
      ${combinedTexts}
      \`\`\``
            }],
            temperature: 0.0,
            max_tokens: 1000
        };

        const openAIResponse = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: openAIParams })
        });
        if (!openAIResponse.ok) {
            const errorDetail = await openAIResponse.json();
            throw new Error(`OpenAI API Error: ${errorDetail.error || openAIResponse.statusText}`);
        }
        const openAIData = await openAIResponse.json();
        const aiSummary = openAIData.openaiResponse;

        let summaries;
        try {
            summaries = parseAISummary(aiSummary);
        } catch (parseError) {
            if (loadingBlock) loadingBlock.style.display = "none";
            redditDiv.innerHTML += `<p class='error'>❌ Parsing Error: ${parseError.message}</p>`;
            throw parseError;
        }
        
        const MIN_SUPPORTING_POSTS_PER_FINDING = 3;
        const validatedSummaries = summaries.filter(finding => {
            const supportingPosts = filteredPosts.filter(post => calculateRelevanceScore(post, finding) > 0);
            return supportingPosts.length >= MIN_SUPPORTING_POSTS_PER_FINDING;
        });

        if (validatedSummaries.length === 0) {
            if (loadingBlock) loadingBlock.style.display = "none";
            resultsMessageDiv.innerHTML = "<p class='no-results-message'>😔 While posts were found, none formed a clear, common problem. Try a broader niche.</p>";
            [finding1, finding2, finding3, finding4, finding5].forEach(f => { if(f) f.innerHTML = "" });
            if (countHeaderDiv) countHeaderDiv.textContent = "";
            return;
        }

        const metrics = calculateFindingMetrics(validatedSummaries, filteredPosts);
        const sortedFindings = validatedSummaries.map((summary, index) => {
            const findingMetrics = metrics[index];
            const totalProblemPosts = metrics.totalProblemPosts || 1;
            const prevalence = Math.round((findingMetrics.supportCount / totalProblemPosts) * 100);
            return {
                summary: summary,
                prevalence: prevalence,
                supportCount: findingMetrics.supportCount
            };
        }).sort((a, b) => b.prevalence - a.prevalence);

        const sortedSummaries = sortedFindings.map(item => item.summary);

        for (let i = 1; i <= 5; i++) {
            const block = document.getElementById(`findings-block${i}`);
            if (block) block.style.display = "none";
        }

        sortedFindings.forEach((findingData, index) => {
            const displayIndex = index + 1;
            const block = document.getElementById(`findings-block${displayIndex}`);
            const content = document.getElementById(`findings-${displayIndex}`);
            const btn = document.getElementById(`button-sample${displayIndex}`);
            const redditDiv = document.getElementById(`reddit-div${displayIndex}`);

            if (!block || !content) return;
            block.style.display = "flex";

            // --- THIS IS THE ONLY ADDED LINE IN THIS LOOP ---
            renderQuoteBubbles(index, findingData.summary, window._filteredPosts);
            // --------------------------------------------------

            const { summary, prevalence, supportCount } = findingData;
            const summaryId = `summary-body-${displayIndex}-${Date.now()}`;
            const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;

            let metricsHtml = '';
            if (sortedFindings.length === 1) {
                metricsHtml = `
                    <div class="prevalence-container">
                        <div class="prevalence-header">Primary Finding</div>
                        <div class="single-finding-metric" style="font-size: 1.2rem; font-weight: bold; color: #333; margin-top: 4px;">Supported by ${supportCount} Posts</div>
                        <div class="prevalence-subtitle">This was the only significant problem theme identified.</div>
                    </div>`;
            } else {
                let barColor, prevalenceLabel;
                if (prevalence >= 30) { prevalenceLabel = "High Prevalence"; barColor = "#296fd3"; } 
                else if (prevalence >= 15) { prevalenceLabel = "Medium Prevalence"; barColor = "#8ab4f3"; } 
                else { prevalenceLabel = "Low Prevalence"; barColor = "#b5cef3"; }
                metricsHtml = `
                    <div class="prevalence-container">
                        <div class="prevalence-header">${prevalenceLabel}</div>
                        <div class="prevalence-bar-background">
                            <div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${barColor};">${prevalence}%</div>
                        </div>
                        <div class="prevalence-subtitle">Represents ${prevalence}% of all identified problems.</div>
                    </div>`;
            }

            content.innerHTML = `
                <div class="section-title">${summary.title}</div>
                <div class="summary-expand-container">
                    <span class="summary-teaser" id="${summaryId}">${summaryShort}</span>
                    ${summary.body.length > 95 ? `<button class="see-more-btn" data-summary="${summaryId}">See more</button>` : ""}
                    <span class="summary-full" id="${summaryId}-full" style="display:none">${summary.body}</span>
                </div>
                <div class="quotes-container">
                    ${summary.quotes.map(quote => `<div class="quote">"${quote}"</div>`).join('')}
                </div>
                ${metricsHtml}`;
            
            if (summary.body.length > 95) {
                setTimeout(() => {
                    const seeMoreBtn = content.querySelector(`.see-more-btn[data-summary="${summaryId}"]`);
                    if (seeMoreBtn) {
                        const teaser = content.querySelector(`#${summaryId}`);
                        const full = content.querySelector(`#${summaryId}-full`);
                        seeMoreBtn.addEventListener('click', function() {
                            if (teaser.style.display !== 'none') { teaser.style.display = 'none'; full.style.display = ''; seeMoreBtn.textContent = 'See less'; } 
                            else { teaser.style.display = ''; full.style.display = 'none'; seeMoreBtn.textContent = 'See more'; }
                        });
                    }
                }, 0);
            }

            if (redditDiv) redditDiv.innerHTML = "";
            if (btn) {
                btn.onclick = function() {
                    showSamplePosts(index, window._assignments, window._filteredPosts, window._usedPostIds);
                };
            }
        });

        window._summaries = sortedSummaries;
        
        const postsForAssignment = filteredPosts.map(post => {
            let bestScore = 0;
            sortedSummaries.forEach(finding => {
                const score = calculateRelevanceScore(post, finding);
                if (score > bestScore) { bestScore = score; }
            });
            return { post, score: bestScore };
        }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 75).map(item => item.post);
        window._postsForAssignment = postsForAssignment;
        
        const assignments = await assignPostsToFindings(sortedSummaries, postsForAssignment, keywordsString, userNiche, combinedTexts, 5);
        window._assignments = assignments;
        window._usedPostIds = new Set();
        
        for (let index = 0; index < sortedSummaries.length; index++) {
            showSamplePosts(index, assignments, filteredPosts, window._usedPostIds);
        }

        if (loadingBlock) loadingBlock.style.display = "none";
    
    } catch (err) {
        if (loadingBlock) loadingBlock.style.display = "none";
        console.error("Error:", err);
        resultsMessageDiv.innerHTML = `<p class='error'>❌ ${err.message}</p>`;
        [finding1, finding2, finding3, finding4, finding5].forEach(f => { if(f) f.innerHTML = `<p class='error'>❌ Unable to load summary.</p>` });
        if (countHeaderDiv) countHeaderDiv.textContent = "";
    }
});

['button-sample1', 'button-sample2', 'button-sample3', 'button-sample4', 'button-sample5'].forEach((buttonId, idx) => {
    const btn = document.getElementById(buttonId);
    if (btn) {
        btn.addEventListener('click', () => {
            if (window._summaries && window._summaries.length > idx) {
                showSamplePosts(idx, window._assignments, window._filteredPosts, window._usedPostIds);
            }
        });
    }
});

document.getElementById("sort-posts").addEventListener("change", (event) => {
    const sortBy = event.target.value;
    let posts = window._filteredPosts || [];
    if (sortBy in sortFunctions) {
        const sortedPosts = [...posts];
        sortedPosts.sort(sortFunctions[sortBy]);
        renderPosts(sortedPosts);
    }
});
