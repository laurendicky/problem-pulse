

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
async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all') {
let allPosts = [];
let after = null;
try {
    while (allPosts.length < totalLimit) {
        // It now calls YOUR proxy URL, not Reddit's
        const response = await fetch(REDDIT_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                searchTerm: term,
                niche: niche,
                limit: PAGINATION_BATCH_SIZE, // Your existing constant
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
// Place these new functions near your other utility functions

/**
 * Finds subreddits related to a user's query.
 * @param {string} query The audience term (e.g., "dog lovers")
 * @returns {Promise<Array>} A promise that resolves to an array of subreddit objects.
 */
async function findSubreddits(query) {
    try {
        const response = await fetch(REDDIT_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                searchType: 'subreddits', // The new parameter for our proxy
                query: query
            })
        });

        if (!response.ok) {
            throw new Error(`Proxy Error: Server returned status ${response.status}`);
        }

        const data = await response.json();
        // Filter for active communities and sort by subscribers
        return (data.subreddits || [])
               .filter(sub => sub.data.subscribers > 1000) // Ignore tiny/dead subs
               .sort((a, b) => b.data.subscribers - a.data.subscribers);

    } catch (err) {
        console.error('Failed to find subreddits:', err);
        return []; // Return empty array on failure
    }
}

/**
 * Renders the list of found subreddits as interactive checkboxes.
 * @param {Array} subreddits - Array of subreddit objects from findSubreddits.
 * @param {string} audienceTerm - The original term the user searched for.
 */
function renderSubreddits(subreddits, audienceTerm) {
    const container = document.getElementById('audience-findings');
    const header = document.getElementById('audience-discovery-header');
    const analyzeBtn = document.getElementById('analyze-button');

    header.innerText = `We found these communities related to "${audienceTerm}". Select the audiences you want to analyze:`;
    
    if (subreddits.length === 0) {
        container.innerHTML = `<p>Couldn't find any large communities for "${audienceTerm}". Try a broader term.</p>`;
        return;
    }

    // Helper to format large numbers (e.g., 9100000 -> 9.1M)
    const formatMembers = (num) => {
        if (num > 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num > 1000) return `${(num / 1000).toFixed(0)}K`;
        return num;
    };

    const html = subreddits.map((sub, index) => {
        const subData = sub.data;
        // Pre-check the top 3 most relevant subreddits
        const isChecked = index < 3 ? 'checked' : ''; 
        return `
            <div class="subreddit-option">
                <input type="checkbox" id="sub-${subData.name}" name="subreddit" value="${subData.name}" ${isChecked}>
                <label for="sub-${subData.name}">
                    <strong>r/${subData.name}</strong> (${formatMembers(subData.subscribers)} members)
                </label>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
    
    // Add event listeners to all checkboxes to update the button state
    container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', updateAnalyzeButtonState);
    });
    
    // Initial call to set the button state correctly
    updateAnalyzeButtonState();
}


/**
 * Updates the text and disabled state of the "Analyze" button.
 */
function updateAnalyzeButtonState() {
    const analyzeBtn = document.getElementById('analyze-button');
    const selectedCount = document.querySelectorAll('#audience-findings input[type="checkbox"]:checked').length;
    
    if (selectedCount > 0) {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = `Analyze Problems in ${selectedCount} Selected Communities`;
        analyzeBtn.style.backgroundColor = ''; // Revert to CSS default color
    } else {
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Select communities to analyze';
        analyzeBtn.style.backgroundColor = '#ccc';
    }
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

// =================== THIS IS THE NEW REPLACEMENT CODE ===================

document.getElementById("pulse-search").addEventListener("click", async function(event) {
    event.preventDefault();

    // --- STAGE 1: AUDIENCE DISCOVERY ---

    // 1. Get user input for the audience (e.g., "dog lovers")
    const nicheElement = document.getElementById("niche-input");
    const userAudience = nicheElement.value.trim();

    if (!userAudience) {
        alert("Please enter a topic, industry, or audience.");
        return;
    }

    // Store the audience term globally so the next stage can use it for headers.
    // This is how the "analyze" button will know what the user originally typed.
    window._userAudience = userAudience;

    // 2. Get the HTML elements we need to show/hide
    const audienceWrapper = document.getElementById('audience-discovery-wrapper');
    const audienceFindingsDiv = document.getElementById('audience-findings');
    const resultsWrapper = document.getElementById('results-wrapper');
    
    // 3. Set the initial UI state for discovery
    resultsWrapper.style.display = 'none'; // Hide the main problem results area
    audienceFindingsDiv.innerHTML = `<p class="loading">Scanning 100,000+ communities...</p>`; // Show loading message
    audienceWrapper.style.display = 'block'; // <<< THIS MAKES THE NEW SECTION VISIBLE
    
    // Call a function (that we'll define later) to make sure the "Analyze" button is correctly disabled
    updateAnalyzeButtonState();

    // 4. Find and Render the Subreddits
    try {
        const subreddits = await findSubreddits(userAudience); // This calls the new function from Step 3
        renderSubreddits(subreddits, userAudience); // This displays the checkboxes
    } catch (error) {
        audienceFindingsDiv.innerHTML = `<p class="error">❌ Failed to find communities. Please try again.</p>`;
        console.error(error);
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
