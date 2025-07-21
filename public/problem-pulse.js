

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
      const title = post.data.title || "";
      const selftext = post.data.selftext || '';
  
      // Basic spam/ad filtering
      if (title.toLowerCase().includes('[ad]') || title.toLowerCase().includes('sponsored')) return false;
      if (post.data.upvote_ratio < 0.2) return false;
      if (post.data.ups < minUpvotes) return false;
  
      // A post is "high-quality" if its title AND body COMBINED have enough text.
      // This correctly includes posts with long, descriptive titles but no body.
      const combinedTextLength = title.length + selftext.length;
      if (combinedTextLength < 80) {
          return false;
      }
  
      if (isRamblingOrNoisy(title) || isRamblingOrNoisy(selftext)) return false;
  
      return true; // If it passes all checks, keep the post.
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
// ====================================================================
// START: NEW UNIFIED EVENT HANDLING
// ====================================================================

// --- Define Element References ---
const searchButton = document.getElementById("pulse-search");
const topicInput = document.getElementById("niche-input");
const audienceContainer = document.getElementById("audience-selection-container");
const audienceChoicesDiv = document.getElementById("audience-choices");
const analyzeButton = document.getElementById("analyze-button");
const resultsWrapper = document.getElementById('results-wrapper');
const resultsMessageDiv = document.getElementById("results-message");
const loadingBlock = document.getElementById("loading-code-1");

// --- Global state to store our data ---
let allFetchedPosts = [];

// =============================================================
//  HELPER: Main function to run the problem analysis
// =============================================================
async function runProblemAnalysis(selectedSubreddits) {
  // --- UI & State Reset for the results part ---
  if (resultsWrapper) {
    resultsWrapper.style.display = 'none';
    resultsWrapper.style.opacity = '0';
  }
  const toClear = ["count-header", "filter-header", "findings-1", "findings-2", "findings-3", "findings-4", "findings-5", "posts-container"];
  toClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
  document.querySelectorAll('.reddit-samples-posts, .reddit-samples-header').forEach(el => el.innerHTML = '');

  // --- Get Filter Settings ---
  const timeRadios = document.getElementsByName("timePosted");
  let selectedTimeRaw = "all";
  for (const radio of timeRadios) { if (radio.checked) { selectedTimeRaw = radio.value; break; } }
  const timeMap = { week: "week", month: "month", "6months": "year", year: "year", all: "all" };
  const selectedTime = timeMap[selectedTimeRaw] || "all";

  const minVotesRadios = document.getElementsByName("minVotes");
  let selectedMinUpvotes = 20;
  for (const radio of minVotesRadios) { if (radio.checked) { selectedMinUpvotes = parseInt(radio.value, 10); break; } }

  // --- Show Loading State ---
  if (resultsMessageDiv) resultsMessageDiv.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const findingEl = document.getElementById(`findings-${i}`);
    if (findingEl) findingEl.innerHTML = `<p class='loading'>Analyzing problems...</p>`;
  }
  if (loadingBlock) loadingBlock.style.display = "flex";

  try {
    // --- 1. Prepare for API Call ---
    const subredditsForAPI = selectedSubreddits.join('+');
    const problemTerms = ["struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve", "annoyance", "annoyed", "frustration", "disappointed", "fed up", "drives me mad", "hate when", "help", "advice", "solution to", "workaround", "how do I", "how to fix", "how to stop", "can’t find", "nothing works", "tried everything", "too expensive", "takes too long", "vent", "rant", "so annoying", "makes me want to scream"];
    const combinedSearchTerm = problemTerms.join(' OR ');

    // --- 2. Fetch Posts ---
    allFetchedPosts = []; // Reset the global posts array
    let after = null;
    const totalLimit = 500;
    while (allFetchedPosts.length < totalLimit) {
      const response = await fetch(REDDIT_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'find_problems', subreddits: subredditsForAPI, searchTerm: combinedSearchTerm, limit: 100, timeFilter: selectedTime, after: after })
      });
      if (!response.ok) throw new Error(`Server error (${response.status}). Please check subreddit names.`);
      const data = await response.json();
      if (!data.data?.children?.length) break;
      allFetchedPosts.push(...data.data.children);
      after = data.data.after;
      if (!after) break;
    }
    allFetchedPosts = deduplicatePosts(allFetchedPosts);

    // --- 3. Filter and Validate Data ---
    const filteredPosts = filterPosts(allFetchedPosts, selectedMinUpvotes);
    if (filteredPosts.length < 10) {
      const message = allFetchedPosts.length > 0 ?
        "Found some posts, but not enough high-quality ones to analyze. Try a broader timeframe or different subreddits." :
        "Couldn't find any relevant posts. Check subreddit spelling or try other communities.";
      throw new Error(message);
    }
    window._filteredPosts = filteredPosts;
    renderPosts(filteredPosts);

    // --- 4. Render Headers and Animate ---
    const countHeaderDiv = document.getElementById("count-header");
    if (countHeaderDiv) {
        const subCount = selectedSubreddits.length;
        const subText = subCount > 1 ? `${subCount} communities` : `r/${selectedSubreddits[0]}`;
        countHeaderDiv.textContent = `Found over ${Math.round(allFetchedPosts.length / 10) * 10} relevant posts in ${subText}.`;
    }
    if (resultsWrapper) {
      resultsWrapper.style.display = 'block';
      setTimeout(() => {
        resultsWrapper.style.opacity = '1';
        window.scrollTo({ top: resultsWrapper.offsetTop - 20, behavior: "smooth" });
      }, 50);
    }

    // --- 5. AI Analysis ---
    const topKeywords = getTopKeywords(filteredPosts, 10);
    const keywordsString = topKeywords.join(', ');
    const topPosts = filteredPosts.slice(0, 80);
    const combinedTexts = topPosts.map(p => `${p.data.title || ""}. ${p.data.selftext ? p.data.selftext.substring(0, 300) : ""}`).join("\n\n");

    const openAIParams = {
        model: "gpt-4o-mini",
        messages: [{
            role: "system", content: `You are a market research expert, summarizing online discussions into 1-5 core user problems. For each, provide a title, summary, quotes, and keywords in strict JSON format.`
        }, {
            role: "user", content: `From the communities [r/${selectedSubreddits.join(', r/') }], analyze the following content using keywords like [${keywordsString}]. Identify 1-5 core problems. For each problem, provide:
            1.  "title": A concise title.
            2.  "body": A brief summary.
            3.  "count": An estimated number of mentions.
            4.  "quotes": Three authentic, raw, short (max 8 words) quotes.
            5.  "keywords": 2-3 relevant keywords/synonyms.
            Content: \`\`\`${combinedTexts}\`\`\``
        }],
        temperature: 0.0, max_tokens: 1500
    };
    const openAIResponse = await fetch(OPENAI_PROXY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams })
    });
    if (!openAIResponse.ok) throw new Error(`OpenAI API Error: ${openAIResponse.statusText}`);
    const openAIData = await openAIResponse.json();
    let summaries = parseAISummary(openAIData.openaiResponse);

    // --- 6. Validate and Render AI Summaries ---
    const validatedSummaries = summaries.filter(finding => {
        return filteredPosts.filter(post => calculateRelevanceScore(post, finding) > 0).length >= 3;
    });
    if (validatedSummaries.length === 0) {
        throw new Error("While posts were found, no clear, common problems emerged. Try different communities.");
    }
    
    // ... The rest of your rendering logic is great, so we'll just use it ...
    const metrics = calculateFindingMetrics(validatedSummaries, filteredPosts);
    const sortedFindings = validatedSummaries.map((summary, index) => {
        const findingMetrics = metrics[index];
        const prevalence = Math.round((findingMetrics.supportCount / (metrics.totalProblemPosts || 1)) * 100);
        return { summary, prevalence, supportCount: findingMetrics.supportCount };
    }).sort((a, b) => b.prevalence - a.prevalence);
    
    window._summaries = sortedFindings.map(item => item.summary);
    for (let i = 1; i <= 5; i++) { document.getElementById(`findings-block${i}`)?.style.display = "none"; }
    
    sortedFindings.forEach((findingData, index) => {
      const displayIndex = index + 1;
      const block = document.getElementById(`findings-block${displayIndex}`);
      const content = document.getElementById(`findings-${displayIndex}`);
      if (block) block.style.display = "flex";
      if (content) {
        const { summary, prevalence, supportCount } = findingData;
        const summaryId = `summary-body-${displayIndex}-${Date.now()}`;
        const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;
        let metricsHtml = '';
        if (sortedFindings.length === 1) {
            metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">Primary Finding</div><div class="single-finding-metric">Supported by ${supportCount} Posts</div><div class="prevalence-subtitle">This was the only significant problem identified.</div></div>`;
        } else {
            let barColor, prevalenceLabel;
            if (prevalence >= 30) { prevalenceLabel = "High Prevalence"; barColor = "#296fd3"; } 
            else if (prevalence >= 15) { prevalenceLabel = "Medium Prevalence"; barColor = "#5b98eb"; } 
            else { prevalenceLabel = "Low Prevalence"; barColor = "#aecbfa"; }
            metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">${prevalenceLabel}</div><div class="prevalence-bar-background"><div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${barColor};">${prevalence > 5 ? prevalence + '%' : ''}</div></div><div class="prevalence-subtitle">Represents ${prevalence}% of all identified problems.</div></div>`;
        }
        content.innerHTML = `<div class="section-title">${summary.title}</div><div class="summary-expand-container"><span class="summary-teaser" id="${summaryId}">${summaryShort}</span>${summary.body.length > 95 ? `<button class="see-more-btn" data-summary="${summaryId}">See more</button>` : ""}<span class="summary-full" id="${summaryId}-full" style="display:none">${summary.body}</span></div><div class="quotes-container">${summary.quotes.map(quote => `<div class="quote">"${quote}"</div>`).join('')}</div>${metricsHtml}`;
        if (summary.body.length > 95) {
          setTimeout(() => {
            const seeMoreBtn = content.querySelector(`.see-more-btn[data-summary="${summaryId}"]`);
            if (seeMoreBtn) {
              const teaser = content.querySelector(`#${summaryId}`);
              const full = content.querySelector(`#${summaryId}-full`);
              seeMoreBtn.addEventListener('click', function() { if (teaser.style.display !== 'none') { teaser.style.display = 'none'; full.style.display = ''; seeMoreBtn.textContent = 'See less'; } else { teaser.style.display = ''; full.style.display = 'none'; seeMoreBtn.textContent = 'See more'; } });
            }
          }, 0);
        }
      }
    });
    
    window._postsForAssignment = filteredPosts.map(post => ({ post, score: window._summaries.reduce((max, s) => Math.max(max, calculateRelevanceScore(post, s)), 0) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 75).map(item => item.post);
    const assignments = await assignPostsToFindings(window._summaries, window._postsForAssignment, keywordsString, selectedSubreddits.join(', '), combinedTexts, 5);
    window._assignments = assignments;
    window._usedPostIds = new Set();
    for (let index = 0; index < window._summaries.length; index++) {
        showSamplePosts(index, assignments, filteredPosts, window._usedPostIds);
    }

  } catch (err) {
    console.error("Analysis Error:", err);
    if (resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error'>😔 ${err.message}</p>`;
    for (let i = 1; i <= 5; i++) { document.getElementById(`findings-${i}`)?.innerHTML = ""; }
  } finally {
    if (loadingBlock) loadingBlock.style.display = "none";
  }
}

// =============================================================
//  PRIMARY EVENT LISTENERS
// =============================================================

// --- 1. User searches for a topic to find audiences ---
searchButton.addEventListener("click", async function(event) {
  event.preventDefault();
  const topic = topicInput.value.trim();
  if (!topic) {
    alert("Please enter a topic to discover communities.");
    return;
  }
  
  // Reset previous results
  if (resultsWrapper) resultsWrapper.style.display = 'none';
  audienceChoicesDiv.innerHTML = "<p class='loading'>Discovering communities...</p>";
  audienceContainer.style.display = 'block';

  try {
    const response = await fetch(REDDIT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'find_subreddits', topic: topic })
    });
    if (!response.ok) throw new Error("Could not fetch communities.");
    const data = await response.json();
    
    // Reddit API for subreddit search returns {subreddits: [...]}, not data.subreddits
    const subreddits = data.subreddits; 
    
    if (!subreddits || subreddits.length === 0) {
      audienceChoicesDiv.innerHTML = "<p class='error'>😔 No communities found for that topic. Try another keyword.</p>";
      document.getElementById('analyze-button').style.display = 'none'; // Hide analyze button if no results
      return;
    }

    // Display choices to the user
    audienceChoicesDiv.innerHTML = subreddits.map((sub, index) => {
      const isChecked = index < 3 ? 'checked' : ''; // Pre-check the top 3
      return `
        <div class="checkbox-wrapper">
          <input type="checkbox" id="sub-${index}" name="subreddit" value="${sub.name}" ${isChecked}>
          <label for="sub-${index}">
            <strong>r/${sub.name}</strong> (${sub.subscriber_count.toLocaleString()} members)
          </label>
        </div>
      `;
    }).join('');
    document.getElementById('analyze-button').style.display = 'block'; // Show the analyze button
  } catch (err) {
    audienceChoicesDiv.innerHTML = `<p class='error'>😔 ${err.message}</p>`;
  }
});

// --- 2. User clicks "Analyze" to run the full analysis ---
analyzeButton.addEventListener("click", function(event) {
  event.preventDefault();
  const selectedCheckboxes = document.querySelectorAll('#audience-choices input[name="subreddit"]:checked');
  if (selectedCheckboxes.length === 0) {
    alert("Please select at least one community to analyze.");
    return;
  }
  const selectedSubreddits = Array.from(selectedCheckboxes).map(cb => cb.value);
  
  // Hide the audience selection and run the main analysis function
  audienceContainer.style.display = 'none';
  runProblemAnalysis(selectedSubreddits);
});

// --- 3. The "Sort Posts" dropdown functionality ---
document.getElementById("sort-posts").addEventListener("change", (event) => {
    const sortBy = event.target.value;
    // Use window._filteredPosts, which is the list the user is actually seeing.
    if (sortBy in sortFunctions && window._filteredPosts && window._filteredPosts.length > 0) {
      const sortedPosts = [...window._filteredPosts]; // Create a copy to sort
      sortedPosts.sort(sortFunctions[sortBy]);
      renderPosts(sortedPosts);
    }
  });

// ====================================================================
// END: NEW UNIFIED EVENT HANDLING
// ====================================================================
