
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
    } else {
        upvoteText = `${minUpvotes}+ upvotes`;
    }
    return `${timeText} posts with ${upvoteText}`;
}

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

// Fetch posts for one term with pagination and retries
async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all') {
    let allPosts = [];
    let after = null;
    let retries = 0;
    let token = await getValidToken();

    // Helper function to fetch a single page
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
                // Token expired, refresh token once (fail-safe)
                token = await fetchNewToken();
                return await fetchPage(afterToken);
            }

            if (response.status === 429) {
                if (retries >= MAX_RETRIES) {
                    throw new Error(`Rate limited by Reddit API too many times for term "${term}".`);
                }
                // Read Retry-After header, fallback 2 seconds
                const retryAfterSec = Number(response.headers.get('Retry-After')) || 2;
                console.warn(`Rate limited on term "${term}", retrying after ${retryAfterSec} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000));
                retries++;
                return await fetchPage(afterToken);
            }

            throw new Error(`Error fetching posts for term "${term}": ${response.status} ${response.statusText}`);
        }

        retries = 0; // reset retry count on success

        const data = await response.json();
        return data.data;
    }

    // Paginate until totalLimit reached or no more pages
    try {
        while (allPosts.length < totalLimit) {
            const pageData = await fetchPage(after);
            if (!pageData || !pageData.children || pageData.children.length === 0) break;

            allPosts = allPosts.concat(pageData.children);

            after = pageData.after;
            if (!after) break; // no more pages
        }
    } catch (err) {
        console.error(`Failed to fetch posts for term "${term}":`, err.message);
    }

    return allPosts.slice(0, totalLimit);
}

// Main function to fetch posts for multiple terms batching requests
async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all') {
    const allResults = [];

    for (let i = 0; i < searchTerms.length; i += MAX_CONCURRENT_BATCH) {
        const batchTerms = searchTerms.slice(i, i + MAX_CONCURRENT_BATCH);

        // Map each term in the batch to a fetch promise
        const batchPromises = batchTerms.map(term =>
            fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter)
        );

        // Await them all and flatten results
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(posts => {
            if (Array.isArray(posts)) {
                allResults.push(...posts);
            }
        });

        // Optional: short pause between batches to be polite and avoid surge
        if (i + MAX_CONCURRENT_BATCH < searchTerms.length) {
            await new Promise(resolve => setTimeout(resolve, 500)); // 500 ms delay
        }
    }

    const dedupedPosts = deduplicatePosts(allResults);
    return dedupedPosts;
}
// Fetch Reddit Data Function
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

    // Filter by minUpvotes only if minUpvotes > 0
    const filteredByUpvotes = minUpvotes > 0 ?
        dedupedPosts.filter(post => post.data.ups >= minUpvotes) :
        dedupedPosts;

    return filteredByUpvotes;
}
// Parse AI Summary
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
        // Don't slice, and don't require 3! Allow 1–5
        parsed.summaries.forEach((summary, idx) => {
            const missingFields = [];
            if (!summary.title) missingFields.push("title");
            if (!summary.body) missingFields.push("body");
            if (typeof summary.count !== 'number') missingFields.push("count");
            if (!summary.keywords || !Array.isArray(summary.keywords) || summary.keywords.length === 0) missingFields.push("keywords");
            if (missingFields.length > 0)
                throw new Error(`Summary ${idx + 1} is missing required fields: ${missingFields.join(", ")}.`);
        });
        return parsed.summaries;
    } catch (error) {
        console.error("Parsing Error:", error);
        console.log("Raw AI Response:", aiResponse); // Debugging
        throw new Error("Failed to parse AI response. Ensure the response is in the correct JSON format.");
    }
} // <<< THIS WAS THE MISSING BRACE. IT IS NOW FIXED.

// NEW HELPER FUNCTION: Fetch Comments for a Post
async function fetchCommentsForPost(subreddit, postId) {
    try {
        const token = await getValidToken();
        const url = `https://oauth.reddit.com/r/${subreddit}/comments/${postId}.json?sort=top&limit=25`; // Get top 25 comments

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': USER_AGENT,
            }
        });

        if (!response.ok) {
            console.error(`Failed to fetch comments for post ${postId}: ${response.status}`);
            return []; // Return empty array on failure
        }

        const data = await response.json();
        // The comments are in the second element of the response array
        const commentsData = data[1]?.data?.children || [];

        // Filter out deleted comments or ones without a body, and return just the text
        return commentsData
            .map(comment => comment.data?.body)
            .filter(body => body && body !== '[deleted]' && body !== '[removed]');

    } catch (error) {
        console.error(`Error in fetchCommentsForPost for post ${postId}:`, error);
        return []; // Return empty on error
    }
}
// New Function: Parse AI Assignments
function parseAIAssignments(aiResponse) {
    try {
        // Remove any code block markers or backticks
        aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim();

        // Extract JSON using regex to find the first JSON object in the response
        const jsonMatch = aiResponse.match(/{[\s\S]*}/);
        if (!jsonMatch) {
            throw new Error("No JSON object found in the AI response.");
        }

        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.assignments || !Array.isArray(parsed.assignments)) {
            throw new Error("AI response does not contain an 'assignments' array.");
        }

        // Validate each assignment
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
        console.log("Raw AI Response:", aiResponse); // Debugging
        throw new Error("Failed to parse AI response. Ensure the response is in the correct JSON format.");
    }
}

function isRamblingOrNoisy(text) {
    if (!text) return false;

    // Check for escaped unicode or HTML entities -- many of these look like "​"
    const htmlEntityRegex = /&#x[0-9a-fA-F]+;/g;
    if (htmlEntityRegex.test(text)) return true;

    // Check for long sequences (>5) of non-alphanumeric chars e.g., ####, $$$$$, ---
    const longSymbolSeqRegex = /[^a-zA-Z0-9\s]{5,}/g;
    if (longSymbolSeqRegex.test(text)) return true;

    // Optional: check for excessive repeated chars (7 or more times)
    const gibberishRegex = /(.)\1{6,}/g;
    if (gibberishRegex.test(text)) return true;

    return false;
}

// Make sure this is *after* isRamblingOrNoisy definition
function filterPosts(posts, minUpvotes = 20) {
    return posts.filter(post => {
        const title = post.data.title.toLowerCase();
        const selftext = post.data.selftext || '';

        if (title.includes('[ad]') || title.includes('sponsored')) return false;
        if (post.data.upvote_ratio < 0.2) return false;
        if (post.data.ups < minUpvotes) return false; // use minUpvotes param here
        if (!selftext || selftext.length < 100) return false;
        if (isRamblingOrNoisy(title) || isRamblingOrNoisy(selftext)) return false;

        return true;
    });
}

// Preprocess Text
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

// Get Top Keywords
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

// Count Keyword Mentions
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

// Get First Two Sentences
function getFirstTwoSentences(text) {
    if (!text) return '';
    const sentences = text.match(/[^\.!\?]+[\.!\?]+(?:\s|$)/g);
    if (!sentences) return text;
    return sentences.slice(0, 2).join(' ').trim();
}

// Reorder Posts (Advanced)
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

// Assign Posts to Findings using OpenAI
async function assignPostsToFindings(
    summaries,
    posts,
    keywordsString,
    userNiche,
    combinedTexts,
    maxFindings = 5
) {
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
    }
    `;

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
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                openaiPayload: openAIParams
            })
        });
        if (!response.ok) {
            const errorDetail = await response.json();
            throw new Error(`OpenAI API Error: ${errorDetail.error || response.statusText}`);
        }
        const data = await response.json();
        let aiResponse = data.openaiResponse;

        // Attempt to parse the JSON response
        const assignments = parseAIAssignments(aiResponse);

        return assignments;
    } catch (error) {
        console.error("Assignment Error:", error);
        throw new Error("Failed to assign Reddit posts to findings using OpenAI.");
    }
}

function getWordMatchRegex(word) {
    // Escape special regex characters in the word, then wrap with word boundaries (\b).
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapedWord}\\b`, 'i');
}
// =============================================================
// NEW: Smart Quote Extractor
// =============================================================
/**
 * Extracts a relevant, quote-worthy sentence from a post based on a finding's keywords.
 * @param {object} post - The Reddit post object.
 * @param {object} finding - The summary/finding object (containing keywords).
 * @returns {string|null} A relevant quote string, or null if no suitable quote is found.
 */
function extractRelevantQuote(post, finding) {
    const bodyText = post.data.selftext;
    if (!bodyText || bodyText.length < 50) return null; // Ignore posts with no real body

    // Split the post body into individual sentences. This is a simple but effective regex.
    const sentences = bodyText.match(/[^\.!\?]+[\.!\?]+/g) || [];

    // Get the finding's keywords to search for.
    const keywords = (finding.keywords || []).map(k => k.toLowerCase());
    if (keywords.length === 0) return null; // Can't find a relevant quote without keywords

    let bestQuote = null;

    // First pass: Find a sentence that contains a keyword.
    for (const sentence of sentences) {
        const cleanSentence = sentence.trim();
        // A good quote is not too short and not excessively long.
        if (cleanSentence.length > 20 && cleanSentence.length < 250) {
            for (const keyword of keywords) {
                // Use your whole-word matching regex for precision
                if (getWordMatchRegex(keyword).test(cleanSentence)) {
                    return cleanSentence; // Found a great match, return it immediately.
                }
            }
        }
    }

    // Fallback: If no keyword-matched sentence was found, just return the first sentence
    // of the post as it often contains the main point.
    if (sentences.length > 0) {
        const firstSentence = sentences[0].trim();
        if (firstSentence.length > 20 && firstSentence.length < 250) {
            return firstSentence;
        }
    }

    return null; // Could not find any suitable quote.
}

// =============================================================
// NEW: Quote Bubble Renderer
// =============================================================
/**
 * Finds top posts for a finding, extracts quotes, and renders them as bubbles.
 * @param {number} findingIndex - The 0-based index of the finding.
 * @param {object} finding - The summary/finding object.
 * @param {Array} allPosts - The complete list of filtered Reddit posts.
 */
function renderQuoteBubbles(findingIndex, finding, allPosts) {
    const container = document.getElementById(`quote-float-container-${findingIndex + 1}`);
    if (!container) return; // Exit if the container div doesn't exist

    // Find the top 4 most relevant posts for this specific finding
    const topPosts = allPosts
        .map(post => ({
            post: post,
            score: calculateRelevanceScore(post, finding)
        }))
        .filter(item => item.score > 0) // Only consider posts with some relevance
        .sort((a, b) => b.score - a.score) // Sort by best score
        .slice(0, 4) // Get the top 4
        .map(item => item.post);

    // Extract one quote from each of the top posts
    const quotes = topPosts.map(post => extractRelevantQuote(post, finding))
        .filter(quote => quote !== null); // Filter out any null results

    let html = '';
    if (quotes.length > 0) {
        // We have quotes, let's build the bubbles
        html = quotes.map(quote => `
        <div class="quote-bubble">
          "${quote}"
        </div>
      `).join('');
    } else {
        // Optional: handle cases where no relevant quotes could be found
        html = '<!-- No specific quotes found for this finding. -->';
    }

    container.innerHTML = html;
}

function calculateRelevanceScore(post, finding) {
    let score = 0;
    const postTitle = post.data.title || "";
    const postBody = post.data.selftext || "";

    // Get the most important words from the finding's title.
    const findingTitleWords = finding.title.toLowerCase().split(' ').filter(word => word.length > 3 && !stopWords.includes(word));
    // Get the supplemental keywords for the finding.
    const findingKeywords = (finding.keywords || []).map(k => k.toLowerCase());

    let titleWordMatched = false;
    let keywordMatched = false;

    // --- Score based on Finding Title words (high value) ---
    for (const word of findingTitleWords) {
        const regex = getWordMatchRegex(word);
        if (regex.test(postTitle)) {
            score += 5; // Major bonus for a title-in-title match.
            titleWordMatched = true;
        }
        if (regex.test(postBody)) {
            score += 2; // Standard bonus for title-in-body match.
            titleWordMatched = true;
        }
    }

    // --- Score based on Finding Keywords (medium value) ---
    for (const keyword of findingKeywords) {
        const regex = getWordMatchRegex(keyword);
        if (regex.test(postTitle)) {
            score += 3; // Good bonus for keyword-in-title match.
            keywordMatched = true;
        }
        if (regex.test(postBody)) {
            score += 1; // Basic bonus for keyword-in-body match.
            keywordMatched = true;
        }
    }

    // --- Massive "Combo" Bonus ---
    // If a post matches BOTH a title word AND a keyword, it's very likely to be relevant.
    if (titleWordMatched && keywordMatched) {
        score += 10;
    }

    return score;
}

function calculateFindingMetrics(validatedSummaries, filteredPosts) {
    const metrics = {};
    const allProblemPostIds = new Set();

    // Initialize metrics object for each finding
    validatedSummaries.forEach((finding, index) => {
        metrics[index] = {
            supportCount: 0
        };
    });

    // For each post, find the SINGLE best finding it belongs to
    filteredPosts.forEach(post => {
        let bestFindingIndex = -1;
        let maxScore = 0;

        // Calculate score for this post against every finding
        validatedSummaries.forEach((finding, index) => {
            const score = calculateRelevanceScore(post, finding);
            if (score > maxScore) {
                maxScore = score;
                bestFindingIndex = index;
            }
        });

        // If the post was a good match for at least one finding...
        // We use a minimum score of 1 to ensure it's a real match.
        if (bestFindingIndex !== -1 && maxScore > 0) {
            // ...increment the count for ONLY the winning finding
            metrics[bestFindingIndex].supportCount++;
            allProblemPostIds.add(post.data.id);
        }
    });

    metrics.totalProblemPosts = allProblemPostIds.size;

    return metrics;
}
// NEW: Quote Extraction Engine
async function populateFindingsWithRealQuotes(findings, allPosts) {
    const MAX_QUOTES_PER_FINDING = 3;
    const POSTS_TO_SCAN_PER_FINDING = 5; // Scan top 5 posts for quotes to be efficient

    // Use a map to avoid re-fetching comments for the same post if it's relevant to multiple findings
    const commentCache = new Map();

    for (const finding of findings) {
        const findingKeywords = [...(finding.summary.keywords || []), ...finding.summary.title.toLowerCase().split(' ')];
        const uniqueKeywords = [...new Set(findingKeywords)].filter(k => k.length > 3 && !stopWords.includes(k));

        // Find the most relevant posts for THIS specific finding using your relevance score
        const relevantPosts = allPosts
            .map(post => ({
                post,
                score: calculateRelevanceScore(post, finding.summary)
            }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, POSTS_TO_SCAN_PER_FINDING)
            .map(item => item.post);

        let potentialQuotes = [];

        // Go through the top posts to find quotes
        for (const post of relevantPosts) {
            const postId = post.data.id;
            let comments = [];

            // Fetch comments if we haven't already for this post
            if (commentCache.has(postId)) {
                comments = commentCache.get(postId);
            } else {
                comments = await fetchCommentsForPost(post.data.subreddit, postId);
                commentCache.set(postId, comments);
            }

            // Combine the post's own text with all its comments
            const allTextSources = [post.data.selftext, ...comments];

            // Search for sentences containing our keywords
            for (const text of allTextSources) {
                if (!text) continue;
                // Split text into sentences for better quote extraction
                const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
                for (const sentence of sentences) {
                    for (const keyword of uniqueKeywords) {
                        const regex = getWordMatchRegex(keyword); // Use your existing helper for whole-word matching
                        if (regex.test(sentence)) {
                            const cleanedSentence = sentence.trim();
                            // Add quote if it's a reasonable length
                            if (cleanedSentence.length > 15 && cleanedSentence.length < 200) {
                                potentialQuotes.push(cleanedSentence);
                            }
                            break; // Move to the next sentence once one keyword is found
                        }
                    }
                }
            }
        }

        // Deduplicate and select the best quotes
        const uniqueQuotes = [...new Set(potentialQuotes)];
        finding.summary.quotes = uniqueQuotes.slice(0, MAX_QUOTES_PER_FINDING);
    }

    // The 'findings' array is now updated with real quotes!
    return findings;
}

function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) {
    const MIN_POSTS = 3; // It's better to show 3 great posts than 4 mediocre ones.
    const MAX_POSTS = 6;
    const MINIMUM_RELEVANCE_SCORE = 5; // The QUALITY GATE. A post MUST score at least this high to be shown as a fallback.

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

    // --- Step 1: Add AI-Assigned Posts ---
    // These are considered the highest quality and bypass the score check.
    const assignedPostNumbers = assignments.filter(a => a.finding === (summaryIndex + 1)).map(a => a.postNumber);
    assignedPostNumbers.forEach(postNum => {
        // Find the post in the `postsForAssignment` list that the AI actually saw
        const post = window._postsForAssignment[postNum - 1];
        addPost(post);
    });

    // --- Step 2: If we need more, run the scoring engine on ALL posts ---
    if (relevantPosts.length < MIN_POSTS) {
        const candidatePool = allPosts.filter(p => !usedPostIds.has(p.data.id) && !addedPostIds.has(p.data.id));

        const scoredCandidates = candidatePool.map(post => ({
            post: post,
            score: calculateRelevanceScore(post, finding) // Use our powerful new engine
        }))
        .filter(item => item.score >= MINIMUM_RELEVANCE_SCORE) // Apply the quality gate
        .sort((a, b) => b.score - a.score); // Sort by the best score

        // Add the best-scoring candidates until we reach our minimum
        for (const candidate of scoredCandidates) {
            if (relevantPosts.length >= MIN_POSTS) break;
            addPost(candidate.post);
        }
    }

    // --- Step 3: Final Display ---
    let html;
    if (relevantPosts.length === 0) {
        html = `<div style="font-style: italic; color: #555;">Could not find any highly relevant Reddit posts for this finding.</div>`;
    } else {
        const finalPosts = relevantPosts.slice(0, MAX_POSTS);
        finalPosts.forEach(post => usedPostIds.add(post.data.id)); // Mark as used globally

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

document.getElementById("pulse-search").addEventListener("click", async function(event) {
    event.preventDefault();

    // --- 1. CLEAR OLD RESULTS ---
    const toClear = [
        "count-header", "filter-header", "findings-1", "findings-2", "findings-3",
        "findings-4", "findings-5", "pulse-results", "posts-container"
    ];
    toClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
    });
    document.querySelectorAll('.reddit-samples-posts, .reddit-samples-header, .quote-float-container').forEach(el => {
        el.innerHTML = '';
    });
    for (let i = 1; i <= 5; i++) {
        const block = document.getElementById(`findings-block${i}`);
        if (block) block.style.display = "none";
    }

    // --- 2. GET USER INPUT AND SET UP UI ---
    const nicheElement = document.getElementById("niche-input");
    let userNiche = (typeof nicheElement.value !== 'undefined') ? nicheElement.value.trim() : nicheElement.innerText.trim();
    if (!userNiche) {
        alert("Please enter a niche.");
        return;
    }

    const redditDiv = document.getElementById("pulse-results");
    const findingElements = [1, 2, 3, 4, 5].map(i => document.getElementById(`findings-${i}`));
    const resultsMessageDiv = document.getElementById("results-message");
    const countHeaderDiv = document.getElementById("count-header");
    const loadingBlock = document.getElementById("loading-code-1");
    if (resultsMessageDiv) resultsMessageDiv.innerHTML = "";
    if (loadingBlock) loadingBlock.style.display = "flex";

    const loadingMessages = ["Insight brewing...", "Drama detected...", "Tea being spilled...", "Juice incoming...", "Gossip loading..."];
    findingElements.forEach((el, index) => {
        if (el) el.innerHTML = `<p class='loading'>${loadingMessages[index]}</p>`;
    });

    const timeRadios = document.getElementsByName("timePosted");
    let selectedTimeRaw = "all";
    for (const radio of timeRadios) {
        if (radio.checked) {
            selectedTimeRaw = radio.value;
            break;
        }
    }

    const minVotesRadios = document.getElementsByName("minVotes");
    let selectedMinUpvotes = 20;
    for (const radio of minVotesRadios) {
        if (radio.checked) {
            selectedMinUpvotes = parseInt(radio.value, 10);
            break;
        }
    }

    const filterHeaderDiv = document.getElementById("filter-header");
    if (filterHeaderDiv) {
        filterHeaderDiv.innerText = formatFilterHeader(selectedTimeRaw, selectedMinUpvotes);
    }
    
    // --- 3. MAIN LOGIC BLOCK ---
    try {
        const searchTerms = [
            "struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve", "annoyance",
            "frustration", "disappointed", "fed up", "drives me mad", "hate when", "help", "advice", "solution to",
            "workaround", "how do I", "how to fix", "how to stop", "can’t find", "nothing works", "tried everything",
            "too expensive", "takes too long", "vent", "rant", "so annoying"
        ];
        const timeMap = { week: "week", month: "month", "6months": "year", year: "year", all: "all" };
        const selectedTime = timeMap[selectedTimeRaw] || "all";

        // --- 4. FETCH AND FILTER REDDIT DATA ---
        let allPosts = await fetchMultipleRedditDataBatched(userNiche, searchTerms, 100, selectedTime);

        if (allPosts.length === 0) {
            if (loadingBlock) loadingBlock.style.display = "none";
            resultsMessageDiv.innerHTML = "<p>😔 No results found on Reddit.</p>";
            findingElements.forEach(el => { if (el) el.innerHTML = ""; });
            if (countHeaderDiv) countHeaderDiv.textContent = "";
            return;
        }

        const reorderedPosts = reorderPostsAdvanced(allPosts, userNiche, searchTerms);
        const filteredPosts = filterPosts(reorderedPosts, selectedMinUpvotes);
        window._filteredPosts = filteredPosts;

        if (filteredPosts.length === 0 || filteredPosts.length < 10) {
            if (loadingBlock) loadingBlock.style.display = "none";
            resultsMessageDiv.innerHTML = "<p class='no-results-message'>😔 Not enough high-quality results found. Try broader terms or different filters.</p>";
            findingElements.forEach(el => { if (el) el.innerHTML = ""; });
            if (countHeaderDiv) countHeaderDiv.textContent = "";
            return;
        }
        
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
        const userNicheCount = allPosts.filter(p => ((p.data.title || '') + (p.data.selftext || '')).toLowerCase().includes(userNiche.toLowerCase())).length;
        if (countHeaderDiv) {
            countHeaderDiv.textContent = formatMentionCount(userNicheCount, userNiche);
            if (countHeaderDiv.textContent.includes('Over')) {
                window.scrollTo({ top: countHeaderDiv.getBoundingClientRect().top + window.pageYOffset - 20, behavior: "smooth" });
            }
        }
        resultsMessageDiv.innerHTML = "";

        // --- 5. GET AI SUMMARIES (WITHOUT QUOTES) ---
        const topKeywords = getTopKeywords(filteredPosts, 10);
        const keywordsString = topKeywords.join(', ');
        const topPosts = filteredPosts.slice(0, 80);
        const combinedTexts = topPosts.map(p => `${p.data.title || ""}. ${p.data.selftext ? p.data.selftext.substring(0, 300) : ""}`).join("\n\n");

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [{
                role: "system",
                content: "You are an assistant that summarizes text into 1-5 common struggles, providing a title, body, and relevant keywords for each. You do NOT provide quotes."
            }, {
                role: "user",
                content: `Using top keywords [${keywordsString}], summarize the content into 1-5 struggles in the niche "${userNiche}". For each, provide a title, summary, and 2-3 keywords. Ensure the summary includes "${userNiche}". Output strict JSON.
                {"summaries": [{"title": "T1", "body": "B1", "count": 0, "keywords": ["k1"]}, ...]}
                ---
                ${combinedTexts}`
            }],
            temperature: 0.0,
            max_tokens: 1000
        };
        const openAIResponse = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!openAIResponse.ok) throw new Error(`OpenAI API Error: ${await openAIResponse.text()}`);
        const openAIData = await openAIResponse.json();
        const summaries = parseAISummary(openAIData.openaiResponse);

        // --- 6. VALIDATE, CALCULATE METRICS, AND SORT ---
        const MIN_SUPPORTING_POSTS = 3;
        const validatedSummaries = summaries.filter(finding => filteredPosts.filter(post => calculateRelevanceScore(post, finding) > 0).length >= MIN_SUPPORTING_POSTS);
        if (validatedSummaries.length === 0) {
            throw new Error("While posts were found, none formed a clear, common problem. Try a broader niche.");
        }

        const metrics = calculateFindingMetrics(validatedSummaries, filteredPosts);
        const sortedFindings = validatedSummaries.map((summary, index) => {
            const findingMetrics = metrics[index];
            const totalProblemPosts = metrics.totalProblemPosts || 1;
            const prevalence = totalProblemPosts > 0 ? Math.round((findingMetrics.supportCount / totalProblemPosts) * 100) : 0;
            return { summary, prevalence, supportCount: findingMetrics.supportCount };
        }).sort((a, b) => b.prevalence - a.prevalence);

        // --- 7. POPULATE FINDINGS WITH REAL QUOTES (for main card) ---
        const findingsWithRealQuotes = await populateFindingsWithRealQuotes(sortedFindings, filteredPosts);

        // --- 8. RENDER THE FINDINGS AND QUOTES ---
        findingsWithRealQuotes.forEach((findingData, index) => {
            const displayIndex = index + 1;
            const block = document.getElementById(`findings-block${displayIndex}`);
            const content = document.getElementById(`findings-${displayIndex}`);
            const btn = document.getElementById(`button-sample${displayIndex}`);
            const redditDiv = document.getElementById(`reddit-div${displayIndex}`);
            if (!block || !content) return;

            block.style.display = "flex";
            const { summary, prevalence, supportCount } = findingData;

            const mainCardQuotesHtml = summary.quotes.map(quote => `<div class="quote">“${quote}”</div>`).join('');
            renderQuoteBubbles(index, summary, window._filteredPosts);

            const summaryId = `summary-body-${displayIndex}-${Date.now()}`;
            const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;

            let metricsHtml = '';
            if (sortedFindings.length === 1) {
                metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">Primary Finding</div><div class="single-finding-metric" style="font-size: 1.2rem; font-weight: bold; color: #333; margin-top: 4px;">Supported by ${supportCount} Posts</div><div class="prevalence-subtitle">This was the only significant problem theme identified.</div></div>`;
            } else {
                let barColor, prevalenceLabel;
                if (prevalence >= 30) { prevalenceLabel = "High Prevalence"; barColor = "#296fd3"; } 
                else if (prevalence >= 15) { prevalenceLabel = "Medium Prevalence"; barColor = "#8ab4f3"; } 
                else { prevalenceLabel = "Low Prevalence"; barColor = "#b5cef3"; }
                metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">${prevalenceLabel}</div><div class="prevalence-bar-background"><div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${barColor};">${prevalence}%</div></div><div class="prevalence-subtitle">Represents ${prevalence}% of all identified problems.</div></div>`;
            }

            content.innerHTML = `
                <div class="section-title">${summary.title}</div>
                <div class="summary-expand-container">
                    <span class="summary-teaser" id="${summaryId}">${summaryShort}</span>
                    ${summary.body.length > 95 ? `<button class="see-more-btn" data-summary="${summaryId}">See more</button>` : ""}
                    <span class="summary-full" id="${summaryId}-full" style="display:none">${summary.body}</span>
                </div>
                <div class="quotes-container">${mainCardQuotesHtml}</div>
                ${metricsHtml}`;

            if (summary.body.length > 95) {
                content.querySelector(`.see-more-btn`)?.addEventListener('click', function(e) {
                    const teaser = content.querySelector(`#${summaryId}`);
                    const full = content.querySelector(`#${summaryId}-full`);
                    const isHidden = teaser.style.display !== 'none';
                    teaser.style.display = isHidden ? 'none' : 'inline';
                    full.style.display = isHidden ? 'inline' : 'none';
                    e.target.textContent = isHidden ? 'See less' : 'See more';
                });
            }

            if (redditDiv) redditDiv.innerHTML = "";
            if (btn) {
                btn.onclick = function() {
                    showSamplePosts(index, window._assignments, window._filteredPosts, window._usedPostIds);
                };
            }
        });

        // --- 9. SETUP FOR "SEE MORE POSTS" BUTTONS ---
        const finalSummaries = findingsWithRealQuotes.map(item => item.summary);
        window._summaries = finalSummaries;
        const postsForAssignment = filteredPosts.map(post => {
            let bestScore = 0;
            finalSummaries.forEach(finding => { bestScore = Math.max(bestScore, calculateRelevanceScore(post, finding)); });
            return { post, score: bestScore };
        }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 75).map(item => item.post);
        window._postsForAssignment = postsForAssignment;

        const assignments = await assignPostsToFindings(finalSummaries, postsForAssignment, keywordsString, userNiche, combinedTexts, 5);
        window._assignments = assignments;
        window._usedPostIds = new Set();

        for (let index = 0; index < finalSummaries.length; index++) {
            showSamplePosts(index, assignments, filteredPosts, window._usedPostIds);
        }

        if (loadingBlock) loadingBlock.style.display = "none";

    } catch (err) {
        if (loadingBlock) loadingBlock.style.display = "none";
        console.error("Error:", err);
        resultsMessageDiv.innerHTML = `<p class='error'>❌ ${err.message}</p>`;
        findingElements.forEach(el => { if(el) el.innerHTML = ""; });
    }
});

// Add click listeners to sample buttons
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
