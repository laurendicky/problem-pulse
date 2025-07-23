// =================================================================================
// COMPLETE JAVASCRIPT CODE - COPY AND PASTE THIS ENTIRE BLOCK
// =================================================================================

// The single URL for our new, simplified Netlify function
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy';

// NEW: Global variable to store the original group name for use in prompts and display text
let originalGroupName = '';

// =============================================================
// NEW: Function to find subreddits for a group using OpenAI
// =============================================================
async function findSubredditsForGroup(groupName) {
    const prompt = `
    Given the user-defined group of people "${groupName}", suggest up to 10 highly relevant and active Reddit subreddits where these people discuss their interests and problems.
    
    Provide your response ONLY as a JSON object with a single key "subreddits" which contains an array of subreddit names (without the "r/").
    
    Example for "car enthusiasts":
    {
      "subreddits": ["cars", "autos", "CarTalk", "whatcarshouldIbuy", "projectcar"]
    }
  `;

    const openAIParams = {
        model: "gpt-4o-mini",
        messages: [{
            role: "system",
            content: "You are an expert Reddit community finder. You provide answers in strict JSON format."
        }, {
            role: "user",
            content: prompt
        }],
        temperature: 0.2,
        max_tokens: 200,
        response_format: { "type": "json_object" }
    };

    try {
        const response = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: openAIParams })
        });
        if (!response.ok) throw new Error('OpenAI API request failed to find subreddits.');

        const data = await response.json();
        const aiResponse = data.openaiResponse;
        
        // The response should already be JSON because of response_format
        const parsed = JSON.parse(aiResponse);

        if (!parsed.subreddits || !Array.isArray(parsed.subreddits)) {
            throw new Error("AI response did not contain a 'subreddits' array.");
        }
        return parsed.subreddits;

    } catch (error) {
        console.error("Error finding subreddits:", error);
        alert("Sorry, I couldn't find any relevant communities. Please try a different group name.");
        return [];
    }
}

// =============================================================
// NEW: Function to display the subreddit choices to the user
// =============================================================
function displaySubredditChoices(subreddits) {
    const container = document.getElementById('subreddit-selection-container');
    const choicesDiv = document.getElementById('subreddit-choices');
    choicesDiv.innerHTML = ''; // Clear previous choices

    if (subreddits.length === 0) {
        choicesDiv.innerHTML = '<p>No communities found. Please try another group.</p>';
        container.style.display = 'block';
        return;
    }

    subreddits.forEach(sub => {
        const checkboxId = `sub-${sub}`;
        const checkboxHTML = `
            <div class="subreddit-choice" style="background: #fff; border: 1px solid #ddd; padding: 5px 10px; border-radius: 5px;">
                <input type="checkbox" id="${checkboxId}" value="${sub}" checked>
                <label for="${checkboxId}" style="margin-left: 5px; cursor: pointer;">r/${sub}</label>
            </div>
        `;
        choicesDiv.innerHTML += checkboxHTML;
    });

    container.style.display = 'block';
}


// =================================================================================
// UNCHANGED HELPER FUNCTIONS (Your original code is preserved here)
// =================================================================================

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

const MAX_CONCURRENT_BATCH = 8;
const PAGINATION_BATCH_SIZE = 25;
const MAX_RETRIES = 3;

async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all') {
    let allPosts = [];
    let after = null;
    try {
        while (allPosts.length < totalLimit) {
            const response = await fetch(REDDIT_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    searchTerm: term,
                    niche: niche,
                    limit: PAGINATION_BATCH_SIZE,
                    timeFilter: timeFilter,
                    after: after
                })
            });

            if (!response.ok) {
                throw new Error(`Proxy Error: Server returned status ${response.status}`);
            }

            const data = await response.json();
            if (!data.data || !data.data.children || !data.data.children.length) break;
            allPosts = allPosts.concat(data.data.children);
            after = data.data.after;
            if (!after) break;
        }
    } catch (err) {
        console.error(`Failed to fetch posts for term "${term}" via proxy:`, err.message);
        return [];
    }
    return allPosts.slice(0, totalLimit);
}

async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all') {
    const allResults = [];
    for (let i = 0; i < searchTerms.length; i += MAX_CONCURRENT_BATCH) {
        const batchTerms = searchTerms.slice(i, i + MAX_CONCURRENT_BATCH);
        const batchPromises = batchTerms.map(term =>
            fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter)
        );
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
    return deduplicatePosts(allResults);
}

function parseAISummary(aiResponse) {
    try {
        aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim();
        const jsonMatch = aiResponse.match(/{[\s\S]*}/);
        if (!jsonMatch) throw new Error("No JSON object found in the AI response.");
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

// ... All your other helper functions like `parseAIAssignments`, `filterPosts`, `calculateRelevanceScore`, `showSamplePosts`, etc., go here.
// I am including them all to ensure completeness.

function parseAIAssignments(aiResponse) {
      try {
        aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim();
        const jsonMatch = aiResponse.match(/{[\s\S]*}/);
        if (!jsonMatch) throw new Error("No JSON object found in the AI response.");
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
    
    function getFirstTwoSentences(text) {
      if (!text) return '';
      const sentences = text.match(/[^\.!\?]+[\.!\?]+(?:\s|$)/g);
      if (!sentences) return text;
      return sentences.slice(0, 2).join(' ').trim();
    }

   // ====================================================================================
// PASTE THIS ENTIRE FUNCTION TO REPLACE THE EMPTY `assignPostsToFindings`
// ====================================================================================

async function assignPostsToFindings(summaries, posts, keywordsString, userNiche, combinedTexts, maxFindings = 5) {
    // Limit the number of posts sent to the AI to avoid overly long prompts
    const postsForAI = posts.slice(0, 75);

    const prompt = `
You are an expert data analyst. Your task is to categorize Reddit posts into the most relevant "Finding" from a provided list.

Here are the ${summaries.length} findings you must use for categorization:
${summaries.map((summary, index) => `
Finding ${index + 1}:
Title: ${summary.title}
Summary: ${summary.body}`).join('\n')}

Here are the ${postsForAI.length} Reddit posts to categorize. For each post, only consider its title and a short snippet of its body:
${postsForAI.map((post, index) => `
Post ${index + 1}:
Title: ${post.data.title}
Body Snippet: ${getFirstTwoSentences(post.data.selftext)}`).join('\n')}

INSTRUCTIONS:
For each post, decide which Finding (from 1 to ${summaries.length}) it best supports. A post should only be assigned if it is a strong and clear example of the finding. If a post is not relevant to any finding, do not include it in your output.

You MUST provide your response ONLY as a JSON object. The object must contain a single key, "assignments", which is an array of objects. Each object in the array represents a single post-to-finding assignment and must have two keys: "postNumber" and "finding".

Example of the required output format:
{
  "assignments": [
    {"postNumber": 1, "finding": 2},
    {"postNumber": 3, "finding": 1},
    {"postNumber": 5, "finding": 2}
  ]
}
`;

    const openAIParams = {
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content: "You are a precise data categorization engine that outputs only JSON."
            }, 
            {
                role: "user",
                content: prompt
            }
        ],
        temperature: 0,
        max_tokens: 1500, // Allow enough tokens for a decent list of assignments
        response_format: { "type": "json_object" }
    };

    try {
        const response = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: openAIParams })
        });

        if (!response.ok) {
            const errorDetail = await response.text();
            console.error("OpenAI Assignment API Error:", errorDetail);
            throw new Error(`OpenAI API Error for assignments: ${response.statusText}`);
        }

        const data = await response.json();
        // The `parseAIAssignments` function you already have will handle the response
        return parseAIAssignments(data.openaiResponse);

    } catch (error) {
        console.error("Assignment function error:", error);
        // Return an empty array on failure so the app doesn't crash
        // The fallback logic in `showSamplePosts` will take over.
        return []; 
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
            if (regex.test(postTitle)) { score += 5; titleWordMatched = true; }
            if (regex.test(postBody)) { score += 2; titleWordMatched = true; }
        }
        for (const keyword of findingKeywords) {
            const regex = getWordMatchRegex(keyword);
            if (regex.test(postTitle)) { score += 3; keywordMatched = true; }
            if (regex.test(postBody)) { score += 1; keywordMatched = true; }
        }
        if (titleWordMatched && keywordMatched) { score += 10; }
        return score;
    }

    function calculateFindingMetrics(validatedSummaries, filteredPosts) {
        const metrics = {};
        const allProblemPostIds = new Set();
        validatedSummaries.forEach((finding, index) => {
            metrics[index] = { supportCount: 0 };
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

  // This is the CORRECTED code
// ====================================================================================
// PASTE THIS ENTIRE FUNCTION TO REPLACE THE BUGGY `showSamplePosts`
// ====================================================================================

function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) {
    // Guard Clause to prevent crash if assignments aren't ready
    if (!assignments) {
        console.warn("Assignments are not ready yet. Please wait a moment and try again.");
        return; 
    }

    const MIN_POSTS = 3; 
    const MAX_POSTS = 6;
    const MINIMUM_RELEVANCE_SCORE = 5; 

    const finding = window._summaries[summaryIndex];
    if (!finding) return;

    // =======================================================
    // *** THE FIX IS HERE ***
    // These variables are now declared at the top of the function's scope,
    // making them visible to the `addPost` helper function below.
    let relevantPosts = [];
    const addedPostIds = new Set();
    // =======================================================

    let headerMessage = `Real Stories from Reddit: "${finding.title}"`;

    const addPost = (post) => {
        // This function can now correctly see `relevantPosts` and `addedPostIds`
        if (post && post.data && !usedPostIds.has(post.data.id) && !addedPostIds.has(post.data.id)) {
            relevantPosts.push(post);
            addedPostIds.add(post.data.id);
        }
    };

    // --- Step 1: Add AI-Assigned Posts ---
    const assignedPostNumbers = assignments.filter(a => a.finding === (summaryIndex + 1)).map(a => a.postNumber);
    assignedPostNumbers.forEach(postNum => {
        const post = window._postsForAssignment[postNum - 1]; 
        addPost(post);
    });

    // --- Step 2: If we need more, run the scoring engine on ALL posts ---
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
    
    // --- Step 3: Final Display ---
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

// =============================================================
// NEW & MODIFIED EVENT LISTENERS (The main logic controllers)
// =============================================================

// PHASE 1: User enters a group and clicks "Find Communities"
document.getElementById("find-communities-btn").addEventListener("click", async function(event) {
    event.preventDefault();

    const groupInputElement = document.getElementById("group-input");
    const groupName = groupInputElement.value.trim();

    if (!groupName) {
        alert("Please enter a group of people (e.g., 'dog lovers').");
        return;
    }
    
    originalGroupName = groupName; // Save the name for later

    const selectionContainer = document.getElementById('subreddit-selection-container');
    const choicesDiv = document.getElementById('subreddit-choices');
    
    selectionContainer.style.display = 'block';
    choicesDiv.innerHTML = '<p class="loading" style="font-style: italic; color: #555;">Finding relevant communities...</p>';

    const subreddits = await findSubredditsForGroup(groupName);
    displaySubredditChoices(subreddits);
});

// PHASE 2: User selects subreddits and clicks "Find Their Problems"
// =================================================================================
// PASTE THIS ENTIRE BLOCK TO REPLACE YOUR EXISTING "search-selected-btn" LISTENER
// =================================================================================

document.getElementById("search-selected-btn").addEventListener("click", async function(event) {
    event.preventDefault();

    const selectedCheckboxes = document.querySelectorAll('#subreddit-choices input:checked');
    if (selectedCheckboxes.length === 0) {
        alert("Please select at least one community to search in.");
        return;
    }
    const selectedSubreddits = Array.from(selectedCheckboxes).map(cb => cb.value);
    const subredditQueryString = selectedSubreddits.map(sub => `subreddit:${sub}`).join(' OR ');

    // --- Standard UI Clearing ---
    const resultsWrapper = document.getElementById('results-wrapper');
    if (resultsWrapper) {
        resultsWrapper.style.display = 'none';
        resultsWrapper.style.opacity = '0';
    }
    const toClear = ["count-header", "filter-header", "findings-1", "findings-2", "findings-3", "findings-4", "findings-5", "pulse-results", "posts-container"];
    toClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
    });
    // Hide the individual finding blocks too
    for (let i = 1; i <= 5; i++) {
        const block = document.getElementById(`findings-block${i}`);
        if (block) block.style.display = "none";
    }
    const findingDivs = [document.getElementById("findings-1"), document.getElementById("findings-2"), document.getElementById("findings-3"), document.getElementById("findings-4"), document.getElementById("findings-5")];
    const resultsMessageDiv = document.getElementById("results-message");
    const countHeaderDiv = document.getElementById("count-header");
    if (resultsMessageDiv) resultsMessageDiv.innerHTML = "";

    const selectedTimeRaw = document.querySelector('input[name="timePosted"]:checked')?.value || "all";
    const selectedMinUpvotes = parseInt(document.querySelector('input[name="minVotes"]:checked')?.value || "20", 10);
    const timeMap = { week: "week", month: "month", "6months": "year", year: "year", all: "all" };
    const selectedTime = timeMap[selectedTimeRaw] || "all";
    
    findingDivs.forEach(div => { if (div) div.innerHTML = "<p class='loading'>Brewing insights...</p>"; });
    const loadingBlock = document.getElementById("loading-code-1");
    if (loadingBlock) loadingBlock.style.display = "flex";

    const searchTerms = ["struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve", "annoyance", "frustration", "disappointed", "help", "advice", "solution", "workaround", "how to", "fix", "rant", "vent"];

    try {
        let allPosts = await fetchMultipleRedditDataBatched(subredditQueryString, searchTerms, 100, selectedTime);
        if (allPosts.length === 0) {
            throw new Error("No results found in the selected communities for the common problem keywords.");
        }
        const filteredPosts = filterPosts(allPosts, selectedMinUpvotes);
        if (filteredPosts.length < 10) {
            throw new Error("Not enough high-quality posts found for analysis. Try selecting more communities.");
        }
        window._filteredPosts = filteredPosts;
        renderPosts(filteredPosts);

        // ===============================================
        // *** START: CORRECTED COUNT HEADER LOGIC ***
        // ===============================================
        const userNicheCount = allPosts.filter(p => ((p.data.title + p.data.selftext).toLowerCase()).includes(originalGroupName.toLowerCase())).length;
        if (countHeaderDiv) {
            if (userNicheCount === 1) {
                countHeaderDiv.textContent = `Found 1 post discussing problems related to "${originalGroupName}".`;
            } else {
                countHeaderDiv.textContent = `Found over ${userNicheCount.toLocaleString()} posts discussing problems related to "${originalGroupName}".`;
            }
            if (resultsWrapper) {
                resultsWrapper.style.display = 'block';
                setTimeout(() => { resultsWrapper.style.opacity = '1'; }, 50);
            }
        }
        // ===============================================
        // *** END: CORRECTED COUNT HEADER LOGIC ***
        // ===============================================

        const topKeywords = getTopKeywords(filteredPosts, 10);
        const keywordsString = topKeywords.join(', ');
        const topPosts = filteredPosts.slice(0, 80);
        const combinedTexts = topPosts.map(post => `${post.data.title}. ${getFirstTwoSentences(post.data.selftext)}`).join("\n\n");

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are a helpful assistant that summarizes user-provided text into between 1 and 5 core common struggles and provides authentic quotes." }, { role: "user", content: `Your task is to analyze the provided text about the niche "${originalGroupName}" and identify 1 to 5 common problems. You MUST provide your response in a strict JSON format. The JSON object must have a single top-level key named "summaries". The "summaries" key must contain an array of objects. Each object in the array represents one common problem and must have the following keys: "title", "body", "count", "quotes", and "keywords". Here are the top keywords to guide your analysis: [${keywordsString}]. Make sure the niche "${originalGroupName}" is naturally mentioned in each "body". Example of the required output format: { "summaries": [ { "title": "Example Title 1", "body": "Example body text about the problem.", "count": 50, "quotes": ["Quote A", "Quote B", "Quote C"], "keywords": ["keyword1", "keyword2"] } ] }. Here is the text to analyze: \`\`\`${combinedTexts}\`\`\`` }],
            temperature: 0.0,
            max_tokens: 1500,
            response_format: { "type": "json_object" }
        };
        
        const openAIResponse = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: openAIParams })
        });
        if (!openAIResponse.ok) throw new Error('OpenAI summary generation failed.');
        
        const openAIData = await openAIResponse.json();
        const summaries = parseAISummary(openAIData.openaiResponse);

        const MIN_SUPPORTING_POSTS_PER_FINDING = 3;
        const validatedSummaries = summaries.filter(finding => {
            const supportingPosts = filteredPosts.filter(post => calculateRelevanceScore(post, finding) > 0);
            return supportingPosts.length >= MIN_SUPPORTING_POSTS_PER_FINDING;
        });

        if (validatedSummaries.length === 0) {
            throw new Error("While posts were found, none formed a clear, common problem. Try a broader search.");
        }

        const metrics = calculateFindingMetrics(validatedSummaries, filteredPosts);
        const sortedFindings = validatedSummaries.map((summary, index) => {
            const findingMetrics = metrics[index];
            const totalProblemPosts = metrics.totalProblemPosts || 1;
            const prevalence = Math.round((findingMetrics.supportCount / totalProblemPosts) * 100);
            return { summary, prevalence, supportCount: findingMetrics.supportCount };
        }).sort((a, b) => b.prevalence - a.prevalence);

        const sortedSummaries = sortedFindings.map(item => item.summary);
        window._summaries = sortedSummaries;

        // =================================================================
        // *** START: RESTORED FINDINGS RENDERING LOGIC (THE CRITICAL FIX) ***
        // =================================================================
        sortedFindings.forEach((findingData, index) => {
            const displayIndex = index + 1;
            if (displayIndex > 5) return; // Don't try to render more than 5 findings

            const block = document.getElementById(`findings-block${displayIndex}`);
            const content = document.getElementById(`findings-${displayIndex}`);
            const btn = document.getElementById(`button-sample${displayIndex}`);
            const redditDiv = document.getElementById(`reddit-div${displayIndex}`);

            if (block) block.style.display = "flex";

            if (content) {
                const { summary, prevalence, supportCount } = findingData;
                const summaryId = `summary-body-${displayIndex}-${Date.now()}`;
                const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;
                let metricsHtml = '';

                if (sortedFindings.length === 1) {
                    metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">Primary Finding</div><div class="single-finding-metric">Supported by ${supportCount} Posts</div><div class="prevalence-subtitle">This was the only significant problem theme identified.</div></div>`;
                } else {
                    let barColor, prevalenceLabel;
                    if (prevalence >= 30) { prevalenceLabel = "High Prevalence"; barColor = "#296fd3"; }
                    else if (prevalence >= 15) { prevalenceLabel = "Medium Prevalence"; barColor = "#5b98eb"; }
                    else { prevalenceLabel = "Low Prevalence"; barColor = "#aecbfa"; }
                    metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">${prevalenceLabel}</div><div class="prevalence-bar-background"><div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${barColor};">${prevalence}%</div></div><div class="prevalence-subtitle">Represents ${prevalence}% of all identified problems.</div></div>`;
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
                    const seeMoreBtn = content.querySelector(`.see-more-btn[data-summary="${summaryId}"]`);
                    if (seeMoreBtn) {
                        seeMoreBtn.addEventListener('click', function() {
                            const teaser = content.querySelector(`#${summaryId}`);
                            const full = content.querySelector(`#${summaryId}-full`);
                            if (teaser.style.display !== 'none') {
                                teaser.style.display = 'none';
                                full.style.display = 'inline';
                                seeMoreBtn.textContent = 'See less';
                            } else {
                                teaser.style.display = 'inline';
                                full.style.display = 'none';
                                seeMoreBtn.textContent = 'See more';
                            }
                        });
                    }
                }
            }

            if (redditDiv) redditDiv.innerHTML = "";
            if (btn) {
                btn.onclick = function() {
                    // This uses the correct index from the sorted list
                    showSamplePosts(index, window._assignments, window._filteredPosts, window._usedPostIds);
                };
            }
        });
        // =================================================================
        // *** END: RESTORED FINDINGS RENDERING LOGIC ***
        // =================================================================

        window._postsForAssignment = filteredPosts.slice(0, 75);
        const assignments = await assignPostsToFindings(sortedSummaries, window._postsForAssignment, keywordsString, originalGroupName, combinedTexts);
        window._assignments = assignments;
        window._usedPostIds = new Set();
        
        // This will now correctly trigger sample posts for the displayed findings
        for (let index = 0; index < sortedSummaries.length; index++) {
            if (index >= 5) break; // Only show initial samples for the visible blocks
            showSamplePosts(index, assignments, filteredPosts, window._usedPostIds);
        }

        if (loadingBlock) loadingBlock.style.display = "none";

    } catch (err) {
        if (loadingBlock) loadingBlock.style.display = "none";
        console.error("Error:", err);
        if (resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error' style="color: red; text-align: center;">❌ ${err.message}</p>`;
        findingDivs.forEach(div => { if (div) div.innerHTML = ""; });
        if (countHeaderDiv) countHeaderDiv.textContent = "";
    }
});


// Unchanged listener for sorting posts
document.addEventListener('DOMContentLoaded', (event) => {
    const sortDropdown = document.getElementById("sort-posts");
    if(sortDropdown) {
        const sortFunctions = {
          relevance: (a, b) => 0, // Placeholder
          newest: (a, b) => b.data.created_utc - a.data.created_utc,
          upvotes: (a, b) => b.data.ups - a.data.ups,
          comments: (a, b) => b.data.num_comments - a.data.num_comments,
        };

        sortDropdown.addEventListener("change", (event) => {
          const sortBy = event.target.value;
          let posts = window._filteredPosts || [];
          if (sortBy in sortFunctions && posts.length > 0) {
            const sortedPosts = [...posts].sort(sortFunctions[sortBy]);
            renderPosts(sortedPosts);
          }
        });
    }
});
