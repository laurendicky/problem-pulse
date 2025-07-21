

// The single URL for our new, simplified Netlify function
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy';

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


const MAX_CONCURRENT_BATCH = 8; // Number of simultaneous requests per batch
const PAGINATION_BATCH_SIZE = 25; // Posts fetched per page during pagination
const MAX_RETRIES = 3; // Max retries on rate limit/error per request

// Fetch posts for one term with pagination and retries
// +++ THIS IS THE NEW REPLACEMENT FUNCTION +++
async function fetchFromSubreddits(subreddits, filterTerms, totalLimit = 100, timeFilter = 'all') {
    let allPosts = [];
    let after = null;

    // The user's subreddits, e.g., ['saas', 'smallbusiness']
    const subredditQuery = subreddits.join('+'); 

    // The "problem" keywords, e.g., ['problem', 'challenge', 'frustrated']
    const searchTermQuery = filterTerms.join(' OR '); 

    try {
        while (allPosts.length < totalLimit) {
            const response = await fetch(REDDIT_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // NEW PAYLOAD STRUCTURE
                    subreddits: subredditQuery, // e.g., "saas+smallbusiness"
                    searchTerm: searchTermQuery, // e.g., "problem OR challenge OR frustrated"
                    limit: PAGINATION_BATCH_SIZE,
                    timeFilter: timeFilter,
                    after: after
                })
            });

        if (!response.ok) {
            // The error handling is now much simpler
            throw new Error(`Proxy Error: Server returned status ${response.status}`);
        }

        const data = await response.json();

        if (!data.data || !data.data.children || !data.data.children.length) {
            break; // No more results
        }

        allPosts = allPosts.concat(data.data.children);
        after = data.data.after;

        if (!after) {
            break; // Reached the last page
        }
    }
} catch (err) {
    console.error(`Failed to fetch posts for term "${term}" via proxy:`, err.message);
    return []; // Return an empty array so the rest of the script doesn't crash
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
      if (!summary.quotes || !Array.isArray(summary.quotes) || summary.quotes.length < 1) missingFields.push("quotes");
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
// =============================================================
// NEW: Precision Regex Helper
// =============================================================
// Creates a case-insensitive regex that only matches whole words.
function getWordMatchRegex(word) {
// Escape special regex characters in the word, then wrap with word boundaries (\b).
const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
return new RegExp(`\\b${escapedWord}\\b`, 'i');
}
// New Helper Function: Calculate Relevance Score
// =============================================================
// NEW: The Intelligent Relevance Scoring Engine
// =============================================================
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
// New Helper Function: Calculate Prevalence Metrics
// =============================================================
// NEW & IMPROVED: "Best Fit" Metrics Calculation
// =============================================================
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
// Show Sample Posts Function
// =============================================================
// FINAL: Upgraded showSamplePosts with Quality Gate
// =============================================================
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

    // --- FIX: Get the results wrapper element ---
const resultsWrapper = document.getElementById('results-wrapper');
if(resultsWrapper) {
  // Hide it initially on new search, in case it was visible from a previous search
  resultsWrapper.style.display = 'none';
  resultsWrapper.style.opacity = '0';
}
  const toClear = [
    "count-header",
    "filter-header",
    "findings-1",
    "findings-2",
    "findings-3",
    "findings-4",
    "findings-5",
    "pulse-results",
    "posts-container"
  ];

  toClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
  document.querySelectorAll('.reddit-samples-posts').forEach(container => {
    container.innerHTML = '';
  });
  document.querySelectorAll('.reddit-samples-header').forEach(header => {
    header.innerHTML = '';
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
  if (filterHeaderDiv) {
    filterHeaderDiv.innerText = formatFilterHeader(selectedTimeRaw, selectedMinUpvotes);
  }

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

  const selectedTime = timeMap[selectedTimeRaw] || "all";

  redditDiv.innerHTML = "";
  finding1.innerHTML = "<p class='loading'>Insight brewing...</p>";
  finding2.innerHTML = "<p class='loading'>Drama detected...</p>";
  finding3.innerHTML = "<p class='loading'>Tea being spilled...</p>";
  finding4.innerHTML = "<p class='loading'>Juice incoming...</p>";
  finding5.innerHTML = "<p class='loading'>Gossip loading...</p>";

  // Show animated code loading block
  const loadingBlock = document.getElementById("loading-code-1");
  if (loadingBlock) loadingBlock.style.display = "flex";

  const searchTerms = [
    "struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve",
    "annoyance", "annoyed", "frustration", "disappointed", "fed up", "drives me mad", "hate when",
    "help", "advice", "solution to", "workaround", "how do I", "how to fix", "how to stop",
    "can’t find", "nothing works", "tried everything", "too expensive", "takes too long",
    "vent", "rant", "so annoying", "makes me want to scream"
  ];

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
      ["findings-1", "findings-2", "findings-3", "findings-4", "findings-5"].forEach(id => {
        const d = document.getElementById(id);
        if (d) d.innerHTML = "";
      });
      if (countHeaderDiv) countHeaderDiv.textContent = "";
      return;
    }

    const reorderedPosts = reorderPostsAdvanced(allPosts, userNiche, searchTerms);
    const filteredPosts = filterPosts(reorderedPosts, selectedMinUpvotes);

    if (filteredPosts.length === 0) {
      if (loadingBlock) loadingBlock.style.display = "none";
      resultsMessageDiv.innerHTML = "<p class='no-results-message'>😔 No high-quality results found on Reddit. Check your spelling or try a broader search term.</p>";
      ["findings-1", "findings-2", "findings-3", "findings-4", "findings-5"].forEach(id => {
        const d = document.getElementById(id);
        if (d) d.innerHTML = "";
      });
      if (countHeaderDiv) countHeaderDiv.textContent = "";
      return;
    }

    if (filteredPosts.length < 10) {
      if (loadingBlock) loadingBlock.style.display = "none";
      resultsMessageDiv.innerHTML = "<p class='no-results-message'>😔 No high-quality results found on Reddit.</p>";
      ["findings-1", "findings-2", "findings-3", "findings-4", "findings-5"].forEach(id => {
        const d = document.getElementById(id);
        if (d) d.innerHTML = "";
      });
      for (let i = 1; i <= 5; i++) {
        let div = document.getElementById(`reddit-div${i}`);
        if (div) div.innerHTML = "";
      }
      if (countHeaderDiv) countHeaderDiv.textContent = "";
      if (document.getElementById("posts-container")) {
        document.getElementById("posts-container").innerHTML = "";
      }
      return;
    }

    window._filteredPosts = filteredPosts;
    renderPosts(filteredPosts);

    function formatPercentageMention(count, total, term) {
      if (total === 0) return `No Reddit posts mention struggles with “${term}” right now.`;
      const percent = Math.round((count / total) * 100);
      return `Found in ${percent}% of posts.`;
    }

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
      if (countHeaderDiv.textContent.trim() !== "") {
        const offset = 20;
        const y = countHeaderDiv.getBoundingClientRect().top + window.pageYOffset - offset;
        
        if (resultsWrapper) {
// --- THIS IS THE CORRECTED LOGIC BLOCK ---

// 1. Make the wrapper take up space in the layout first.
if (resultsWrapper) {
resultsWrapper.style.display = 'block';
}

// 2. Give the browser a moment to render the new layout.
setTimeout(() => {
// Now that the layout is stable, we can proceed.

// 2a. Fade the wrapper in.
if (resultsWrapper) {
  resultsWrapper.style.opacity = '1';
}

// 2b. Get the CORRECT position of the header.
const offset = 20;
const y = countHeaderDiv.getBoundingClientRect().top + window.pageYOffset - offset;

// 2c. Scroll to that correct position.
// --- Scroll command is now INSIDE ---
window.scrollTo({
top: y,
behavior: "smooth"
});

}, 50); 
}
}


    resultsMessageDiv.innerHTML = "";

    const topKeywords = getTopKeywords(filteredPosts, 10);
    const keywordsString = topKeywords.join(', ');
    const countsForTopKeywords = countKeywordMentions(allPosts, topKeywords);

    const postScores = filteredPosts.map(post => {
      const combinedText = `${post.data.title} ${post.data.selftext}`.toLowerCase();
      let score = 0;
      topKeywords.forEach(word => {
        if (combinedText.includes(word.toLowerCase())) score++;
      });
      return {
        post,
        score
      };
    });
    postScores.sort((a, b) => b.score - a.score);

    const topPosts = postScores.slice(0, 80).map(item => item.post);

    const combinedTexts = topPosts.map(post => {
      const title = post.data.title || "";
      const selftext = post.data.selftext ? post.data.selftext.substring(0, 300) : "";
      return `${title}. ${selftext}`;
    }).join("\n\n");

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
      {
        "title": "SummaryTitle1",
        "body": "SummaryBody1",
        "count": 60,
        "quotes": ["Quote1","Quote2","Quote3"],
        "keywords": ["keyword1","synonym1"]
      },
      {
        "title": "SummaryTitle2",
        "body": "SummaryBody2",
        "count": 45,
        "quotes": ["Quote1","Quote2","Quote3"],
        "keywords": ["keyword2a","synonym2a"]
      },
      {
        "title": "SummaryTitle3",
        "body": "SummaryBody3",
        "count": 30,
        "quotes": ["Quote1","Quote2","Quote3"],
        "keywords": ["keyword3a","synonym3a"]
      }
    ]
  }
  Ensure the quotes and keywords sound realistic and reflect genuine user language.

  \`\`\`
  ${combinedTexts}
  \`\`\`
  `
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
    // =================================================================
    // NEW: VALIDATION STEP - Filter out findings with no evidence
    // =================================================================
    const MIN_SUPPORTING_POSTS_PER_FINDING = 3; // <--- You can adjust this threshold!
    
    const validatedSummaries = summaries.filter(finding => {
        // For each finding, let's see how many posts are relevant.
        const supportingPosts = filteredPosts.filter(post => {
            // We use our existing relevance score! A score > 0 means it's a match.
            return calculateRelevanceScore(post, finding) > 0;
        });
        
        // Keep the finding ONLY if it has enough supporting posts.
        return supportingPosts.length >= MIN_SUPPORTING_POSTS_PER_FINDING;
    });

    if (validatedSummaries.length === 0) {
        if (loadingBlock) loadingBlock.style.display = "none";
        resultsMessageDiv.innerHTML = "<p class='no-results-message'>😔 While posts were found, none formed a clear, common problem. Try a broader niche.</p>";
        ["findings-1", "findings-2", "findings-3", "findings-4", "findings-5"].forEach(id => {
            const d = document.getElementById(id);
            if(d) d.innerHTML = "";
        });
        if (countHeaderDiv) countHeaderDiv.textContent = "";
        return; // Stop execution if no valid findings remain
    }
    // =================================================================
    // END of new validation step
    // =================================================================
 

// =================================================================
// START OF THE REPLACEMENT BLOCK
// =================================================================

// Calculate metrics based on the original validated summaries
const metrics = calculateFindingMetrics(validatedSummaries, filteredPosts);

// Combine findings with their scores and sort them by prevalence
const sortedFindings = validatedSummaries.map((summary, index) => {
const findingMetrics = metrics[index];
const totalProblemPosts = metrics.totalProblemPosts || 1;
const prevalence = Math.round((findingMetrics.supportCount / totalProblemPosts) * 100);
// We return an object containing ALL the data we need for each finding
return {
    summary: summary,
    prevalence: prevalence,
    supportCount: findingMetrics.supportCount
};
}).sort((a, b) => b.prevalence - a.prevalence); // Sort by prevalence, highest to lowest

// Get a simple array of the summaries in their new sorted order
const sortedSummaries = sortedFindings.map(item => item.summary);

// Hide all finding blocks initially to ensure a clean slate
for (let i = 1; i <= 5; i++) {
const block = document.getElementById(`findings-block${i}`);
if (block) block.style.display = "none";
}

// Loop through the SORTED findings and display them in the correct order
sortedFindings.forEach((findingData, index) => {
const displayIndex = index + 1; // This is the visual position (1, 2, 3...)

const block = document.getElementById(`findings-block${displayIndex}`);
const content = document.getElementById(`findings-${displayIndex}`);
const btn = document.getElementById(`button-sample${displayIndex}`);
const redditDiv = document.getElementById(`reddit-div${displayIndex}`);

if (block) block.style.display = "flex";

if (content) {
    const { summary, prevalence, supportCount } = findingData; // Destructure our data object
    const summaryId = `summary-body-${displayIndex}-${Date.now()}`;
    const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;

    let metricsHtml = '';

    // CONTEXTUAL LOGIC: Check if there is only ONE finding
    if (sortedFindings.length === 1) {
        metricsHtml = `
            <div class="prevalence-container">
                <div class="prevalence-header">Primary Finding</div>
                <div class="single-finding-metric" style="font-size: 1.2rem; font-weight: bold; color: #333; margin-top: 4px;">
                    Supported by ${supportCount} Posts
                </div>
                <div class="prevalence-subtitle">
                    This was the only significant problem theme identified.
                </div>
            </div>
        `;
    } 
    // ELSE: If there are multiple findings, show the comparative prevalence bar.
// ...
else {
let barColor, prevalenceLabel;

// --- NEW HYBRID LOGIC ---
if (prevalence >= 30) {
    prevalenceLabel = "High Prevalence";
    barColor = "#296fd3"; 
} else if (prevalence >= 15) {
    prevalenceLabel = "Medium Prevalence";
    barColor = "#5b98eb"; 
} else {
    prevalenceLabel = "Low Prevalence";
    barColor = "#ffffff"; 
}
// --- END OF NEW LOGIC ---

metricsHtml = `
    <div class="prevalence-container">
        <div class="prevalence-header">${prevalenceLabel}</div>
        <div class="prevalence-bar-background">
            <div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${barColor};">
                ${prevalence}%
            </div>
        </div>
        <div class="prevalence-subtitle">
            Represents ${prevalence}% of all identified problems.
        </div>
    </div>
`;
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
        ${metricsHtml}
    `;
    
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
}

if (redditDiv) redditDiv.innerHTML = "";
if (btn) {
    btn.onclick = function() {
        showSamplePosts(index, window._assignments, window._filteredPosts, window._usedPostIds);
    };
}
});

// Update the global summaries to be in the new sorted order
window._summaries = sortedSummaries;

// Create the smart candidate list for AI assignment using the sorted data
const MAX_POSTS_FOR_ASSIGNMENT = 75;
window._postsForAssignment = filteredPosts.map(post => {
let bestScore = 0;
sortedSummaries.forEach(finding => {
    const score = calculateRelevanceScore(post, finding);
    if (score > bestScore) { bestScore = score; }
});
return { post, score: bestScore };
}).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, MAX_POSTS_FOR_ASSIGNMENT).map(item => item.post);

// Call AI for assignment using the SORTED summaries
const assignments = await assignPostsToFindings(
sortedSummaries,
window._postsForAssignment,
keywordsString,
userNiche,
combinedTexts,
5
);
window._assignments = assignments;
window._usedPostIds = new Set();

// Finally, show the initial set of samples for the sorted summaries
for (let index = 0; index < sortedSummaries.length; index++) {
showSamplePosts(index, assignments, filteredPosts, window._usedPostIds);
}

if (loadingBlock) loadingBlock.style.display = "none";
}

  } catch (err) {
    if (loadingBlock) loadingBlock.style.display = "none";
    console.error("Error:", err);
    resultsMessageDiv.innerHTML = `<p class='error'>❌ ${err.message}</p>`;
    finding1.innerHTML = "<p class='error'>❌ Unable to load summary 1.</p>";
    finding2.innerHTML = "<p class='error'>❌ Unable to load summary 2.</p>";
    finding3.innerHTML = "<p class='error'>❌ Unable to load summary 3.</p>";
    finding4.innerHTML = "<p class='error'>❌ Unable to load summary 4.</p>";
    finding5.innerHTML = "<p class='error'>❌ Unable to load summary 5.</p>";
    if (countHeaderDiv) countHeaderDiv.textContent = "";
  }
});

// Add click listeners to sample buttons
['button-sample1', 'button-sample2', 'button-sample3'].forEach((buttonId, idx) => {
  const btn = document.getElementById(buttonId);
  if (btn) {
    btn.addEventListener('click', () => {
      showSamplePosts(idx, window._assignments, window._filteredPosts, window._usedPostIds);
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
