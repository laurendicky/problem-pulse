// =================================================================================
// FINAL, COMPLETE, ALL-IN-ONE SCRIPT (VERSION 2 - ENHANCED CLOUD)
// BLOCK 1 of 4: GLOBAL VARIABLES & SENTIMENT LISTS
// =================================================================================

// --- 1. GLOBAL VARIABLES & CONSTANTS ---
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy';
let originalGroupName = '';
const suggestions = ["Dog Lovers", "Start-up Founders", "Fitness Beginners", "AI Enthusiasts", "Home Bakers", "Gamers", "Content Creators", "Developers", "Brides To Be"];
const colorPalette = ['#F26B6B', '#F19047', '#F5C943', '#3AB795', '#298ABF']; // Pink, Orange, Yellow, Teal, Blue

// --- WORD LISTS FOR CLOUD ---
const sentimentWords = [
    // Positive High Arousal
    'love', 'loved', 'loving', 'amazing', 'awesome', 'beautiful', 'best', 'brilliant', 'celebrate', 'charming', 'dope', 'excellent',
    'excited', 'exciting', 'epic', 'fantastic', 'flawless', 'gorgeous', 'happy', 'impressed', 'incredible', 'insane', 'joy', 'keen', 'lit',
    'perfect', 'phenomenal', 'proud', 'rad', 'super', 'stoked', 'thrilled', 'vibrant', 'wow', 'wonderful',
    // Positive Low Arousal
    'blessed', 'calm', 'chill', 'comfortable', 'cozy', 'grateful', 'loyal', 'peaceful', 'pleased', 'relaxed', 'relieved', 'satisfied', 'secure', 'thankful',
    // Negative High Arousal
    'angry', 'annoyed', 'anxious', 'awful', 'bad', 'broken', 'hate', 'challenge', 'confused', 'crazy', 'critical', 'danger', 'desperate',
    'disappointed', 'disappointing', 'disgusted', 'dreadful', 'fear', 'frustrated', 'frustrating', 'furious', 'horrible', 'irritated', 'jealous',
    'nightmare', 'outraged', 'pain', 'panic', 'problem', 'rage', 'rant', 'scared', 'shocked', 'stressful', 'terrible', 'terrified', 'trash', 'worst',
    // Negative Low Arousal
    'alone', 'ashamed', 'bored', 'depressed', 'discouraged', 'dull', 'empty', 'exhausted', 'failure', 'guilty',
    'heartbroken', 'hopeless', 'hurt', 'insecure', 'lonely', 'miserable', 'sad', 'sorry', 'tired', 'unhappy', 'upset', 'weak',
    // Verbs of Desire/Need
    'need', 'needs', 'want', 'wants', 'wish', 'wishing', 'hope', 'hoping', 'desire', 'craving',
    // Nouns of Quality/Value
    'advantage', 'benefit', 'bonus', 'deal', 'disadvantage', 'issue', 'flaw', 'hack', 'improvement', 'quality', 'solution', 'strength', 'weakness',
    'advice', 'tip', 'trick', 'recommend', 'recommendation'
];
const stopWords = ["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves", "like", "just", "dont", "can", "people", "help", "hes", "shes", "thing", "stuff", "really", "actually", "even", "know", "still", "post", "posts", "subreddit", "redditor", "redditors", "comment", "comments"];

// --- 2. ALL HELPER AND LOGIC FUNCTIONS ---
// (Functions are defined first, before they are ever called)
function deduplicatePosts(posts) { const seen = new Set(); return posts.filter(post => { if (!post.data || !post.data.id) return false; if (seen.has(post.data.id)) return false; seen.add(post.data.id); return true; }); }
function formatDate(utcSeconds) { const date = new Date(utcSeconds * 1000); return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all') { let allPosts = []; let after = null; try { while (allPosts.length < totalLimit) { const response = await fetch(REDDIT_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ searchTerm: term, niche: niche, limit: 25, timeFilter: timeFilter, after: after }) }); if (!response.ok) { throw new Error(`Proxy Error: Server returned status ${response.status}`); } const data = await response.json(); if (!data.data || !data.data.children || !data.data.children.length) break; allPosts = allPosts.concat(data.data.children); after = data.data.after; if (!after) break; } } catch (err) { console.error(`Failed to fetch posts for term "${term}" via proxy:`, err.message); return []; } return allPosts.slice(0, totalLimit); }
async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all') { const allResults = []; for (let i = 0; i < searchTerms.length; i += 8) { const batchTerms = searchTerms.slice(i, i + 8); const batchPromises = batchTerms.map(term => fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter)); const batchResults = await Promise.all(batchPromises); batchResults.forEach(posts => { if (Array.isArray(posts)) { allResults.push(...posts); } }); if (i + 8 < searchTerms.length) { await new Promise(resolve => setTimeout(resolve, 500)); } } return deduplicatePosts(allResults); }
function parseAISummary(aiResponse) { try { aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim(); const jsonMatch = aiResponse.match(/{[\s\S]*}/); if (!jsonMatch) { throw new Error("No JSON object in AI response."); } const parsed = JSON.parse(jsonMatch[0]); if (!parsed.summaries || !Array.isArray(parsed.summaries) || parsed.summaries.length < 1) { throw new Error("AI response lacks a 'summaries' array."); } parsed.summaries.forEach((summary, idx) => { const missingFields = []; if (!summary.title) missingFields.push("title"); if (!summary.body) missingFields.push("body"); if (typeof summary.count !== 'number') missingFields.push("count"); if (!summary.quotes || !Array.isArray(summary.quotes) || summary.quotes.length < 1) missingFields.push("quotes"); if (!summary.keywords || !Array.isArray(summary.keywords) || summary.keywords.length === 0) missingFields.push("keywords"); if (missingFields.length > 0) throw new Error(`Summary ${idx + 1} is missing required fields: ${missingFields.join(", ")}.`); }); return parsed.summaries; } catch (error) { console.error("Parsing Error:", error); console.log("Raw AI Response:", aiResponse); throw new Error("Failed to parse AI response."); } }
function parseAIAssignments(aiResponse) { try { aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim(); const jsonMatch = aiResponse.match(/{[\s\S]*}/); if (!jsonMatch) { throw new Error("No JSON object in AI response."); } const parsed = JSON.parse(jsonMatch[0]); if (!parsed.assignments || !Array.isArray(parsed.assignments)) { throw new Error("AI response lacks an 'assignments' array."); } parsed.assignments.forEach((assignment, idx) => { const missingFields = []; if (typeof assignment.postNumber !== 'number') missingFields.push("postNumber"); if (typeof assignment.finding !== 'number') missingFields.push("finding"); if (missingFields.length > 0) throw new Error(`Assignment ${idx + 1} is missing required fields: ${missingFields.join(", ")}.`); }); return parsed.assignments; } catch (error) { console.error("Parsing Error:", error); console.log("Raw AI Response:", aiResponse); throw new Error("Failed to parse AI response."); } }
function filterPosts(posts, minUpvotes = 20) { return posts.filter(post => { const title = post.data.title.toLowerCase(); const selftext = post.data.selftext || ''; if (title.includes('[ad]') || title.includes('sponsored') || post.data.upvote_ratio < 0.2 || post.data.ups < minUpvotes || !selftext || selftext.length < 100) return false; const isRamblingOrNoisy = (text) => { if (!text) return false; return /&#x[0-9a-fA-F]+;/g.test(text) || /[^a-zA-Z0-9\s]{5,}/g.test(text) || /(.)\1{6,}/g.test(text); }; return !isRamblingOrNoisy(title) && !isRamblingOrNoisy(selftext); }); }
function getTopKeywords(posts, topN = 10) { const freqMap = {}; posts.forEach(post => { const cleanedText = `${post.data.title} ${post.data.selftext}`.replace(/<[^>]+>/g, '').replace(/[^a-zA-Z0-9\s.,!?]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); const words = cleanedText.split(/\s+/); words.forEach(word => { if (!stopWords.includes(word) && word.length > 2) { freqMap[word] = (freqMap[word] || 0) + 1; } }); }); return Object.keys(freqMap).sort((a, b) => freqMap[b] - freqMap[a]).slice(0, topN); }
function getFirstTwoSentences(text) { if (!text) return ''; const sentences = text.match(/[^\.!\?]+[\.!\?]+(?:\s|$)/g); return sentences ? sentences.slice(0, 2).join(' ').trim() : text; }
async function assignPostsToFindings(summaries, posts) { const postsForAI = posts.slice(0, 75); const prompt = `You are an expert data analyst. Your task is to categorize Reddit posts into the most relevant "Finding" from a provided list.\n\nHere are the ${summaries.length} findings:\n${summaries.map((s, i) => `Finding ${i + 1}: ${s.title}`).join('\n')}\n\nHere are the ${postsForAI.length} Reddit posts:\n${postsForAI.map((p, i) => `Post ${i + 1}: ${p.data.title}`).join('\n')}\n\nINSTRUCTIONS: For each post, assign it to the most relevant Finding (from 1 to ${summaries.length}). Respond ONLY with a JSON object with a single key "assignments", which is an array of objects like {"postNumber": 1, "finding": 2}.`; const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a precise data categorization engine that outputs only JSON." }, { role: "user", content: prompt }], temperature: 0, max_tokens: 1500, response_format: { "type": "json_object" } }; try { const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) }); if (!response.ok) throw new Error(`OpenAI API Error for assignments: ${response.statusText}`); const data = await response.json(); return parseAIAssignments(data.openaiResponse); } catch (error) { console.error("Assignment function error:", error); return []; } }
function calculateRelevanceScore(post, finding) { let score = 0; const postTitle = post.data.title || ""; const postBody = post.data.selftext || ""; const findingTitleWords = finding.title.toLowerCase().split(' ').filter(word => word.length > 3 && !stopWords.includes(word)); const findingKeywords = (finding.keywords || []).map(k => k.toLowerCase()); let titleWordMatched = false, keywordMatched = false; for (const word of findingTitleWords) { const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); if (regex.test(postTitle)) { score += 5; titleWordMatched = true; } if (regex.test(postBody)) { score += 2; titleWordMatched = true; } } for (const keyword of findingKeywords) { const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); if (regex.test(postTitle)) { score += 3; keywordMatched = true; } if (regex.test(postBody)) { score += 1; keywordMatched = true; } } if (titleWordMatched && keywordMatched) { score += 10; } return score; }
function calculateFindingMetrics(validatedSummaries, filteredPosts) { const metrics = {}; const allProblemPostIds = new Set(); validatedSummaries.forEach((finding, index) => { metrics[index] = { supportCount: 0 }; }); filteredPosts.forEach(post => { let bestFindingIndex = -1; let maxScore = 0; validatedSummaries.forEach((finding, index) => { const score = calculateRelevanceScore(post, finding); if (score > maxScore) { maxScore = score; bestFindingIndex = index; } }); if (bestFindingIndex !== -1 && maxScore > 0) { metrics[bestFindingIndex].supportCount++; allProblemPostIds.add(post.data.id); } }); metrics.totalProblemPosts = allProblemPostIds.size; return metrics; }
function renderPosts(posts) { const container = document.getElementById("posts-container"); if (!container) { return; } container.innerHTML = posts.map(post => ` <div class="insight" style="border:1px solid #ccc; padding:12px; margin-bottom:12px; background:#fafafa; border-radius:8px;"> <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1.1rem; color:#007bff; text-decoration:none;"> ${post.data.title} </a> <p style="font-size:0.9rem; margin:0.75rem 0; color:#333; line-height:1.5;"> ${post.data.selftext ? post.data.selftext.substring(0, 200) + '...' : 'No additional content.'} </p> <small style="color:#555; font-size:0.8rem;"> r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 💬 ${post.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)} </small> </div> `).join(''); }
function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) { if (!assignments) return; const finding = window._summaries[summaryIndex]; if (!finding) return; let relevantPosts = []; const addedPostIds = new Set(); const addPost = (post) => { if (post && post.data && !usedPostIds.has(post.data.id) && !addedPostIds.has(post.data.id)) { relevantPosts.push(post); addedPostIds.add(post.data.id); } }; const assignedPostNumbers = assignments.filter(a => a.finding === (summaryIndex + 1)).map(a => a.postNumber); assignedPostNumbers.forEach(postNum => { if (postNum - 1 < window._postsForAssignment.length) { addPost(window._postsForAssignment[postNum - 1]); } }); if (relevantPosts.length < 8) { const candidatePool = allPosts.filter(p => !usedPostIds.has(p.data.id) && !addedPostIds.has(p.data.id)); const scoredCandidates = candidatePool.map(post => ({ post: post, score: calculateRelevanceScore(post, finding) })).filter(item => item.score >= 4).sort((a, b) => b.score - a.score); for (const candidate of scoredCandidates) { if (relevantPosts.length >= 8) break; addPost(candidate.post); } } let html; if (relevantPosts.length === 0) { html = `<div style="font-style: italic; color: #555;">Could not find any highly relevant Reddit posts for this finding.</div>`; } else { const finalPosts = relevantPosts.slice(0, 8); finalPosts.forEach(post => usedPostIds.add(post.data.id)); html = finalPosts.map(post => ` <div class="insight" style="border:1px solid #ccc; padding:8px; margin-bottom:8px; background:#fafafa; border-radius:4px;"> <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1rem; color:#007bff;">${post.data.title}</a> <p style="font-size:0.9rem; margin:0.5rem 0; color:#333;">${post.data.selftext ? post.data.selftext.substring(0, 150) + '...' : 'No content.'}</p> <small>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 💬 ${post.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</small> </div> `).join(''); } const container = document.getElementById(`reddit-div${summaryIndex + 1}`); if (container) { container.innerHTML = `<div class="reddit-samples-header" style="font-weight:bold; margin-bottom:6px;">Real Stories from Reddit: "${finding.title}"</div><div class="reddit-samples-posts">${html}</div>`; } }
async function findSubredditsForGroup(groupName) { const prompt = `Given the user-defined group "${groupName}", suggest up to 10 relevant and active Reddit subreddits. Provide your response ONLY as a JSON object with a single key "subreddits" which contains an array of subreddit names (without "r/").`; const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an expert Reddit community finder providing answers in strict JSON format." }, { role: "user", content: prompt }], temperature: 0.2, max_tokens: 200, response_format: { "type": "json_object" } }; try { const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) }); if (!response.ok) throw new Error('OpenAI API request failed.'); const data = await response.json(); const parsed = JSON.parse(data.openaiResponse); if (!parsed.subreddits || !Array.isArray(parsed.subreddits)) throw new Error("AI response did not contain a 'subreddits' array."); return parsed.subreddits; } catch (error) { console.error("Error finding subreddits:", error); alert("Sorry, I couldn't find any relevant communities. Please try another group name."); return []; } }
function displaySubredditChoices(subreddits) { const choicesDiv = document.getElementById('subreddit-choices'); if (!choicesDiv) return; choicesDiv.innerHTML = ''; if (subreddits.length === 0) { choicesDiv.innerHTML = '<p class="loading-text">No communities found.</p>'; return; } choicesDiv.innerHTML = subreddits.map(sub => `<div class="subreddit-choice"><input type="checkbox" id="sub-${sub}" value="${sub}" checked><label for="sub-${sub}">r/${sub}</label></div>`).join(''); }
// =================================================================================
// BLOCK 2 of 4: REPLACED LANGUAGE CLOUD FUNCTIONS
// =================================================================================

// NEW VERSION: Filters for specific sentiment words for a more useful cloud.
function generatePsychographicsCloudData(posts, topN = 60) {
    const freqMap = {};
    const sentimentSet = new Set(sentimentWords); // Faster lookups

    posts.forEach(post => {
        const text = `${post.data.title} ${post.data.selftext || ''}`;
        const words = text.toLowerCase().replace(/[^a-z\s']/g, '').split(/\s+/);

        words.forEach(word => {
            // Check if the word is in our curated sentiment list AND not a stop word
            if (sentimentSet.has(word) && !stopWords.includes(word)) {
                freqMap[word] = (freqMap[word] || 0) + 1;
            }
        });
    });

    return Object.entries(freqMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
}

// NEW VERSION: Renders cloud with colors and rotation for a more attractive look.
function renderLanguageCloud(wordData) {
    const container = document.getElementById('language-cloud');
    if (!container) return;
    
    if (wordData.length < 5) { // Need at least a few words to make a cloud
        container.innerHTML = '<p style="font-family: sans-serif; color: #777;">Not enough emotive language found to build a psychographics cloud.</p>';
        return;
    }

    const counts = wordData.map(item => item[1]);
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);

    const minFontSize = 16; // pixels
    const maxFontSize = 50; // pixels

    const cloudHTML = wordData
        .map(([word, count]) => {
            // Normalize font size based on frequency
            const fontSize = minFontSize + 
                ( (count - minCount) / (maxCount - minCount || 1) ) * 
                (maxFontSize - minFontSize);
            
            // Get a random color from our palette
            const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            
            // Get a slight random rotation
            const rotation = Math.random() * 10 - 5; // -5 to +5 degrees

            return `<span class="cloud-word" style="font-size: ${fontSize.toFixed(1)}px; color: ${color}; transform: rotate(${rotation.toFixed(1)}deg);">${word}</span>`;
        })
        .join('');

    container.innerHTML = cloudHTML;
}
// =================================================================================
// BLOCK 3 of 4: MAIN ANALYSIS FUNCTION (UNCHANGED)
// =================================================================================

async function runProblemFinder() {
    const searchButton = document.getElementById('search-selected-btn');
    if (!searchButton) { console.error("Could not find the 'Find Their Problems' button."); return; }

    const selectedCheckboxes = document.querySelectorAll('#subreddit-choices input:checked');
    if (selectedCheckboxes.length === 0) {
        alert("Please select at least one community.");
        return;
    }
    const selectedSubreddits = Array.from(selectedCheckboxes).map(cb => cb.value);
    const subredditQueryString = selectedSubreddits.map(sub => `subreddit:${sub}`).join(' OR ');

    searchButton.classList.add('is-loading');
    searchButton.disabled = true;

    // --- Search Depth Logic ---
    const quickSearchTerms = [ "problem", "challenge", "frustration", "annoyance", "wish I could", "hate that", "help with", "solution for" ];
    const deepSearchTerms = [ "struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve", "annoyance", "frustration", "disappointed", "help", "advice", "solution", "workaround", "how to", "fix", "rant", "vent" ];
    const searchDepth = document.querySelector('input[name="search-depth"]:checked')?.value || 'quick';
    let searchTerms;
    let limitPerTerm;
    if (searchDepth === 'deep') {
        console.log("Starting a Deep Dive analysis...");
        searchTerms = deepSearchTerms;
        limitPerTerm = 100;
    } else {
        console.log("Starting a Quick Scan analysis...");
        searchTerms = quickSearchTerms;
        limitPerTerm = 50;
    }

    // --- Reset UI elements before starting a new search ---
    const resultsWrapper = document.getElementById('results-wrapper-b');
    if (resultsWrapper) {
        resultsWrapper.style.display = 'none';
        resultsWrapper.style.opacity = '0';
    }
    
    // MODIFIED IN PREVIOUS STEP: Includes "language-cloud"
    ["count-header", "filter-header", "findings-1", "findings-2", "findings-3", "findings-4", "findings-5", "pulse-results", "posts-container", "language-cloud"].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
    for (let i = 1; i <= 5; i++) { const block = document.getElementById(`findings-block${i}`); if (block) block.style.display = "none"; }
    const findingDivs = [document.getElementById("findings-1"), document.getElementById("findings-2"), document.getElementById("findings-3"), document.getElementById("findings-4"), document.getElementById("findings-5")];
    const resultsMessageDiv = document.getElementById("results-message");
    const countHeaderDiv = document.getElementById("count-header");
    if (resultsMessageDiv) resultsMessageDiv.innerHTML = "";
    findingDivs.forEach(div => { if (div) div.innerHTML = "<p class='loading'>Brewing insights...</p>"; });

    const selectedTimeRaw = document.querySelector('input[name="timePosted"]:checked')?.value || "all";
    const selectedMinUpvotes = parseInt(document.querySelector('input[name="minVotes"]:checked')?.value || "20", 10);
    const timeMap = { week: "week", month: "month", "6months": "year", year: "year", all: "all" };
    const selectedTime = timeMap[selectedTimeRaw] || "all";

    try {
        let allPosts = await fetchMultipleRedditDataBatched(subredditQueryString, searchTerms, limitPerTerm, selectedTime);
        if (allPosts.length === 0) { throw new Error("No results found in the selected communities for these problem keywords."); }
        
        const filteredPosts = filterPosts(allPosts, selectedMinUpvotes);
        if (filteredPosts.length < 10) { throw new Error("Not enough high-quality posts found for analysis. Try selecting more communities or adjusting filters."); }
        
        window._filteredPosts = filteredPosts;
        renderPosts(filteredPosts);

        // --- LANGUAGE CLOUD CALLS ---
        const cloudData = generatePsychographicsCloudData(filteredPosts, 60); 
        renderLanguageCloud(cloudData);
        // --- END OF LANGUAGE CLOUD ---

        const userNicheCount = allPosts.filter(p => ((p.data.title + p.data.selftext).toLowerCase()).includes(originalGroupName.toLowerCase())).length;
        if (countHeaderDiv) {
            countHeaderDiv.textContent = userNicheCount === 1 
                ? `Found 1 post discussing problems related to "${originalGroupName}".` 
                : `Found over ${userNicheCount.toLocaleString()} posts discussing problems related to "${originalGroupName}".`;
        }
        
        const topKeywords = getTopKeywords(filteredPosts, 10);
        const topPosts = filteredPosts.slice(0, 30);
        const combinedTexts = topPosts.map(post => `${post.data.title}. ${getFirstTwoSentences(post.data.selftext)}`).join("\n\n");
        const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a helpful assistant that summarizes user-provided text into between 1 and 5 core common struggles and provides authentic quotes." }, { role: "user", content: `Your task is to analyze the provided text about the niche "${originalGroupName}" and identify 1 to 5 common problems. You MUST provide your response in a strict JSON format. The JSON object must have a single top-level key named "summaries". The "summaries" key must contain an array of objects. Each object in the array represents one common problem and must have the following keys: "title", "body", "count", "quotes", and "keywords". Here are the top keywords to guide your analysis: [${topKeywords.join(', ')}]. Make sure the niche "${originalGroupName}" is naturally mentioned in each "body". Example of the required output format: { "summaries": [ { "title": "Example Title 1", "body": "Example body text about the problem.", "count": 50, "quotes": ["Quote A", "Quote B", "Quote C"], "keywords": ["keyword1", "keyword2"] } ] }. Here is the text to analyze: \`\`\`${combinedTexts}\`\`\`` }], temperature: 0.0, max_tokens: 1500, response_format: { "type": "json_object" } };
        const openAIResponse = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!openAIResponse.ok) throw new Error('OpenAI summary generation failed.');
        const openAIData = await openAIResponse.json();
        const summaries = parseAISummary(openAIData.openaiResponse);
        const validatedSummaries = summaries.filter(finding => filteredPosts.filter(post => calculateRelevanceScore(post, finding) > 0).length >= 3);
        if (validatedSummaries.length === 0) { throw new Error("While posts were found, none formed a clear, common problem. Try a broader search."); }
        const metrics = calculateFindingMetrics(validatedSummaries, filteredPosts);
        const sortedFindings = validatedSummaries.map((summary, index) => ({ summary, prevalence: Math.round((metrics[index].supportCount / (metrics.totalProblemPosts || 1)) * 100), supportCount: metrics[index].supportCount })).sort((a, b) => b.prevalence - a.prevalence);
        window._summaries = sortedFindings.map(item => item.summary);
        
        sortedFindings.forEach((findingData, index) => {
            const displayIndex = index + 1;
            if (displayIndex > 5) return;
            const block = document.getElementById(`findings-block${displayIndex}`);
            const content = document.getElementById(`findings-${displayIndex}`);
            const btn = document.getElementById(`button-sample${displayIndex}`);
            if (block) block.style.display = "flex";
            if (content) {
                const { summary, prevalence, supportCount } = findingData;
                const summaryId = `summary-body-${displayIndex}-${Date.now()}`;
                const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;
                let metricsHtml = (sortedFindings.length === 1) ? `<div class="prevalence-container"><div class="prevalence-header">Primary Finding</div><div class="single-finding-metric">Supported by ${supportCount} Posts</div><div class="prevalence-subtitle">This was the only significant problem theme identified.</div></div>` : `<div class="prevalence-container"><div class="prevalence-header">${prevalence >= 30 ? "High" : prevalence >= 15 ? "Medium" : "Low"} Prevalence</div><div class="prevalence-bar-background"><div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${prevalence >= 30 ? "#296fd3" : prevalence >= 15 ? "#5b98eb" : "#aecbfa"};">${prevalence}%</div></div><div class="prevalence-subtitle">Represents ${prevalence}% of all identified problems.</div></div>`;
                content.innerHTML = `<div class="section-title">${summary.title}</div><div class="summary-expand-container"><span class="summary-teaser" id="${summaryId}">${summaryShort}</span>${summary.body.length > 95 ? `<button class="see-more-btn" data-summary="${summaryId}">See more</button>` : ""}<span class="summary-full" id="${summaryId}-full" style="display:none">${summary.body}</span></div><div class="quotes-container">${summary.quotes.map(quote => `<div class="quote">"${quote}"</div>`).join('')}</div>${metricsHtml}`;
                if (summary.body.length > 95) {
                    const seeMoreBtn = content.querySelector(`.see-more-btn`);
                    if(seeMoreBtn) seeMoreBtn.addEventListener('click', function() { const teaser = content.querySelector(`#${summaryId}`), full = content.querySelector(`#${summaryId}-full`); const isHidden = teaser.style.display !== 'none'; teaser.style.display = isHidden ? 'none' : 'inline'; full.style.display = isHidden ? 'inline' : 'none'; seeMoreBtn.textContent = isHidden ? 'See less' : 'See more'; });
                }
            }
            if (btn) btn.onclick = function() { showSamplePosts(index, window._assignments, window._filteredPosts, window._usedPostIds); };
        });
        window._postsForAssignment = filteredPosts.slice(0, 75);
        window._usedPostIds = new Set();
        const assignments = await assignPostsToFindings(window._summaries, window._postsForAssignment);
        window._assignments = assignments;
        for (let i = 0; i < window._summaries.length; i++) {
            if (i >= 5) break;
            showSamplePosts(i, assignments, filteredPosts, window._usedPostIds);
        }

        // --- REVEAL AND SCROLL LOGIC ---
        if (countHeaderDiv && countHeaderDiv.textContent.trim() !== "") {
            if (resultsWrapper) {
                resultsWrapper.style.setProperty('display', 'flex', 'important');
            }
            setTimeout(() => {
                if (resultsWrapper) {
                    resultsWrapper.style.opacity = '1';
                }
                countHeaderDiv.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }, 50); 
        }

    } catch (err) {
        console.error("Error in main analysis:", err);
        if (resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error' style="color: red; text-align: center;">❌ ${err.message}</p>`;
        findingDivs.forEach(div => { if (div) div.innerHTML = ""; });
        if (countHeaderDiv) countHeaderDiv.innerHTML = "";

        if (resultsWrapper) {
            resultsWrapper.style.setProperty('display', 'flex', 'important');
            resultsWrapper.style.opacity = '1';
        }

    } finally {
        searchButton.classList.remove('is-loading');
        searchButton.disabled = false;
    }
}
// =================================================================================
// BLOCK 4 of 4: INITIALIZATION LOGIC (UNCHANGED)
// =================================================================================

function initializeProblemFinderTool() {
    console.log("Problem Finder elements found. Initializing...");

    const pillsContainer = document.getElementById('pf-suggestion-pills');
    const groupInput = document.getElementById('group-input');
    const findCommunitiesBtn = document.getElementById('find-communities-btn');
    const searchSelectedBtn = document.getElementById('search-selected-btn');
    const step1Container = document.getElementById('step-1-container');
    const step2Container = document.getElementById('subreddit-selection-container');
    const inspireButton = document.getElementById('inspire-me-button');
    const choicesContainer = document.getElementById('subreddit-choices');
    const audienceTitle = document.getElementById('pf-audience-title');
    const backButton = document.getElementById('back-to-step1-btn');

    if (!findCommunitiesBtn || !searchSelectedBtn || !backButton || !choicesContainer) {
        console.error("Critical error: A key element was null even after polling. Aborting initialization.");
        return;
    }

    const transitionToStep2 = () => {
        if (step2Container.classList.contains('visible')) return;
        step1Container.classList.add('hidden');
        step2Container.classList.add('visible');
        choicesContainer.innerHTML = '<p class="loading-text">Finding relevant communities...</p>';
        audienceTitle.textContent = `Select Subreddits For: ${originalGroupName}`;
    };
    
    const transitionToStep1 = () => {
        step2Container.classList.remove('visible');
        step1Container.classList.remove('hidden');
        const resultsWrapper = document.getElementById('results-wrapper-b');
        if (resultsWrapper) { resultsWrapper.classList.remove('is-visible'); }
    };

    pillsContainer.innerHTML = suggestions.map(s => `<div class="pf-suggestion-pill" data-value="${s}">${s}</div>`).join('');
    
    pillsContainer.addEventListener('click', (event) => {
        if (event.target.classList.contains('pf-suggestion-pill')) {
            groupInput.value = event.target.getAttribute('data-value');
            findCommunitiesBtn.click();
        }
    });

    inspireButton.addEventListener('click', () => {
        pillsContainer.classList.toggle('visible');
    });

    findCommunitiesBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        const groupName = groupInput.value.trim();
        if (!groupName) {
            alert("Please enter a group of people or select a suggestion.");
            return;
        }
        originalGroupName = groupName;
        transitionToStep2();
        const subreddits = await findSubredditsForGroup(groupName);
        displaySubredditChoices(subreddits);
    });

    searchSelectedBtn.addEventListener("click", (event) => {
        event.preventDefault();
        runProblemFinder();
    });
    
    backButton.addEventListener('click', () => {
        transitionToStep1();
    });

    choicesContainer.addEventListener('click', (event) => {
        const choiceDiv = event.target.closest('.subreddit-choice');
        if (choiceDiv) {
            const checkbox = choiceDiv.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
            }
        }
    });

    console.log("Problem Finder tool successfully initialized and all listeners are active.");
}

function waitForElementAndInit() {
    const keyElementId = 'find-communities-btn';
    let retries = 0;
    const maxRetries = 50;

    const intervalId = setInterval(() => {
        const keyElement = document.getElementById(keyElementId);

        if (keyElement) {
            clearInterval(intervalId);
            initializeProblemFinderTool();
        } else {
            retries++;
            if (retries > maxRetries) {
                clearInterval(intervalId);
                console.error(`Problem Finder initialization FAILED. The key element "#${keyElementId}" was not found in the DOM after 5 seconds. Please check that the HTML embed is correct and is loading on the page.`);
            } else {
                 console.log(`Waiting for Problem Finder tool... (Attempt ${retries})`);
            }
        }
    }, 100);
}

// --- SCRIPT ENTRY POINT ---
document.addEventListener('DOMContentLoaded', waitForElementAndInit);
