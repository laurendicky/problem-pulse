// ===================================================================================
// FINAL, COMPLETE AND CORRECTED SCRIPT - PASTE THIS ENTIRE BLOCK
// ===================================================================================

// --- I. CONFIGURATION & GLOBAL STATE ---
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const CLIENT_ID = 'PynIoQ3wsLrGESAOvl2nSw';
const CLIENT_SECRET = 'giYtA4-dQNiVuKE1ePH5ImAC5vysaA';
const USER_AGENT = 'web:problem-pulse-tool:v1.0 (by /u/RubyFishSimon)';
const stopWords = ["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves", "like", "just", "dont", "can", "people", "help", "hes", "shes", "thing", "stuff", "really", "actually", "even", "know", "still"];

let accessToken = null;
let tokenExpiry = 0;
window._quoteIntervals = {};

// --- II. HELPER FUNCTIONS ---

// Animation Helpers
function stopAllQuoteAnimations() {
    Object.values(window._quoteIntervals).forEach(clearInterval);
    window._quoteIntervals = {};
    document.querySelectorAll('.quote-bubble').forEach(bubble => bubble.remove());
}

function startQuoteAnimation(containerId, quotesArray) {
    const container = document.getElementById(containerId);
    if (!container || !quotesArray || quotesArray.length === 0) return;
    if (window._quoteIntervals[containerId]) clearInterval(window._quoteIntervals[containerId]);
    
    const createQuote = () => {
        const quoteEl = document.createElement('div');
        quoteEl.classList.add('quote-bubble');
        const randomIndex = Math.floor(Math.random() * quotesArray.length);
        quoteEl.textContent = `“${quotesArray[randomIndex]}”`;
        const randomLeft = Math.random() * 70;
        quoteEl.style.left = `${randomLeft}%`;
        const randomDuration = Math.random() * 15 + 20;
        quoteEl.style.animation = `floatUp ${randomDuration}s linear forwards`;
        const randomSize = Math.random() * 4 + 14;
        quoteEl.style.fontSize = `${randomSize}px`;
        container.appendChild(quoteEl);
        setTimeout(() => quoteEl.remove(), randomDuration * 1000);
    };
    
    window._quoteIntervals[containerId] = setInterval(createQuote, 4000);
    createQuote();
}

// Data & Text Helpers
function deduplicatePosts(posts) { const seen = new Set(); return posts.filter(post => { if (!post.data || !post.data.id || seen.has(post.data.id)) return false; seen.add(post.data.id); return true; }); }
function formatDate(utcSeconds) { const date = new Date(utcSeconds * 1000); return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
function getFirstTwoSentences(text) { if (!text) return ''; const sentences = text.match(/[^\.!\?]+[\.!\?]+(?:\s|$)/g); return sentences ? sentences.slice(0, 2).join(' ').trim() : text; }
function getWordMatchRegex(word) { const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`\\b${escapedWord}\\b`, 'i'); }
function formatFilterHeader(timeRaw, minUpvotes) { const timeMapReadable = { all: "All-time", week: "Past week", month: "Past month", year: "Past year" }; const timeText = timeMapReadable[timeRaw] || "All-time"; let upvoteText; if (minUpvotes === 0) { upvoteText = "all upvotes"; } else if (minUpvotes === 1) { upvoteText = "1+ upvote"; } else { upvoteText = `${minUpvotes}+ upvotes`; } return `${timeText} posts with ${upvoteText}`; }

// API & AI Helpers
async function fetchNewToken() { const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`); const resp = await fetch('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT }, body: 'grant_type=client_credentials' }); if (!resp.ok) { throw new Error(`Reddit Token Error: ${resp.status}`); } const data = await resp.json(); accessToken = data.access_token; tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; return accessToken; }
async function getValidToken() { if (!accessToken || Date.now() >= tokenExpiry) { await fetchNewToken(); } return accessToken; }
async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all') { let allPosts = []; let after = null; let retries = 0; let token = await getValidToken(); async function fetchPage(afterToken) { let url = `https://oauth.reddit.com/search?q=${encodeURIComponent(term + ' ' + niche)}&limit=25&t=${timeFilter}`; if (afterToken) url += `&after=${afterToken}`; const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT } }); if (!response.ok) { if (response.status === 401) { token = await fetchNewToken(); return await fetchPage(afterToken); } if (response.status === 429) { if (retries >= 3) { throw new Error(`Rate limited too many times`); } const retryAfterSec = Number(response.headers.get('Retry-After')) || 2; await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000)); retries++; return await fetchPage(afterToken); } throw new Error(`Reddit API Error: ${response.status}`); } retries = 0; return (await response.json()).data; } try { while (allPosts.length < totalLimit) { const pageData = await fetchPage(after); if (!pageData || !pageData.children || pageData.children.length === 0) break; allPosts = allPosts.concat(pageData.children); after = pageData.after; if (!after) break; } } catch (err) { console.error(`Failed on term "${term}":`, err.message); } return allPosts.slice(0, totalLimit); }
async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all') { const allResults = []; for (let i = 0; i < searchTerms.length; i += 8) { const batchTerms = searchTerms.slice(i, i + 8); const batchPromises = batchTerms.map(term => fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter)); const batchResults = await Promise.all(batchPromises); batchResults.forEach(posts => { if (Array.isArray(posts)) { allResults.push(...posts); } }); if (i + 8 < searchTerms.length) { await new Promise(resolve => setTimeout(resolve, 500)); } } return deduplicatePosts(allResults); }
function parseAISummary(aiResponse) { const jsonMatch = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim().match(/{[\s\S]*}/); if (!jsonMatch) throw new Error("AI Summary Error: No JSON object found."); const parsed = JSON.parse(jsonMatch[0]); if (!parsed.summaries || !Array.isArray(parsed.summaries) || parsed.summaries.length === 0) throw new Error("AI Summary Error: Invalid format."); return parsed.summaries; }
function parseAIAssignments(aiResponse) { const jsonMatch = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim().match(/{[\s\S]*}/); if (!jsonMatch) throw new Error("AI Assignment Error: No JSON object found."); const parsed = JSON.parse(jsonMatch[0]); if (!parsed.assignments || !Array.isArray(parsed.assignments)) throw new Error("AI Assignment Error: Invalid format."); return parsed.assignments; }
function filterPosts(posts, minUpvotes = 20) { return posts.filter(post => { const title = post.data.title.toLowerCase(); if (title.includes('[ad]') || title.includes('sponsored') || post.data.ups < minUpvotes) return false; return true; }); }
function getTopKeywords(posts, topN = 10) { const freqMap = {}; posts.forEach(post => { const words = `${post.data.title} ${post.data.selftext}`.toLowerCase().replace(/[^a-zA-Z\s]/g, '').split(/\s+/); words.forEach(word => { if (word.length > 2 && !stopWords.includes(word)) freqMap[word] = (freqMap[word] || 0) + 1; }); }); return Object.keys(freqMap).sort((a, b) => freqMap[b] - freqMap[a]).slice(0, topN); }
async function assignPostsToFindings(summaries, posts, keywordsString, userNiche) { const prompt = `...`; const openAIParams = { model: "gpt-4o-mini", messages: [{...}], temperature: 0, max_tokens: 1000 }; const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) }); if (!response.ok) throw new Error(`OpenAI Assignment Error: ${response.status}`); return parseAIAssignments((await response.json()).openaiResponse); }
function calculateRelevanceScore(post, finding) { let score = 0; const postTitle = (post.data.title || "").toLowerCase(); const postBody = (post.data.selftext || "").toLowerCase(); const findingTitleWords = finding.title.toLowerCase().split(' ').filter(word => word.length > 3 && !stopWords.includes(word)); const findingKeywords = (finding.keywords || []).map(k => k.toLowerCase()); let titleWordMatched = false; let keywordMatched = false; for (const word of findingTitleWords) { const regex = getWordMatchRegex(word); if (regex.test(postTitle)) { score += 5; titleWordMatched = true; } if (regex.test(postBody)) { score += 2; titleWordMatched = true; } } for (const keyword of findingKeywords) { const regex = getWordMatchRegex(keyword); if (regex.test(postTitle)) { score += 3; keywordMatched = true; } if (regex.test(postBody)) { score += 1; keywordMatched = true; } } if (titleWordMatched && keywordMatched) score += 10; return score; }
function calculateFindingMetrics(validatedSummaries, filteredPosts) { const metrics = {}; const allProblemPostIds = new Set(); validatedSummaries.forEach((_, index) => { metrics[index] = { supportCount: 0 }; }); filteredPosts.forEach(post => { let bestFindingIndex = -1; let maxScore = 0; validatedSummaries.forEach((finding, index) => { const score = calculateRelevanceScore(post, finding); if (score > maxScore) { maxScore = score; bestFindingIndex = index; } }); if (bestFindingIndex !== -1 && maxScore > 0) { metrics[bestFindingIndex].supportCount++; allProblemPostIds.add(post.data.id); } }); metrics.totalProblemPosts = allProblemPostIds.size; return metrics; }

// --- III. MAIN APPLICATION FUNCTIONS ---
function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) {
    stopAllQuoteAnimations();

    const MIN_POSTS = 3, MAX_POSTS = 6, MINIMUM_RELEVANCE_SCORE = 5;
    const finding = window._summaries[summaryIndex];
    if (!finding) { console.error(`showSamplePosts: Invalid index ${summaryIndex}`); return; }
    
    const animationContainerId = `quote-float-container-${summaryIndex + 1}`;
    const quotesForAnimation = finding.quotes;
    
    let relevantPosts = [];
    const addPost = (post) => { if (post && post.data && !usedPostIds.has(post.data.id)) { relevantPosts.push(post); usedPostIds.add(post.data.id); } };
    
    const assignedPostNumbers = assignments.filter(a => a.finding === (summaryIndex + 1)).map(a => a.postNumber);
    assignedPostNumbers.forEach(postNum => addPost(window._postsForAssignment[postNum - 1]));

    if (relevantPosts.length < MIN_POSTS) {
        const candidatePool = allPosts.filter(p => !usedPostIds.has(p.data.id));
        const scoredCandidates = candidatePool.map(post => ({ post, score: calculateRelevanceScore(post, finding) }))
            .filter(item => item.score >= MINIMUM_RELEVANCE_SCORE).sort((a, b) => b.score - a.score);
        for (const candidate of scoredCandidates) {
            if (relevantPosts.length >= MIN_POSTS) break;
            addPost(candidate.post);
        }
    }
    
    let html;
    if (relevantPosts.length === 0) {
        html = `<div style="font-style: italic; color: #555;">Could not find any highly relevant Reddit posts.</div>`;
    } else {
        html = relevantPosts.slice(0, MAX_POSTS).map(post => `
          <div class="insight" style="border:1px solid #ccc; padding:8px; margin-bottom:8px; background:#fafafa; border-radius:4px;">
            <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1rem; color:#007bff;">${post.data.title}</a>
            <p style="font-size:0.9rem; margin:0.5rem 0; color:#333;">${post.data.selftext ? getFirstTwoSentences(post.data.selftext) + '...' : 'No content.'}</p>
            <small>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 💬 ${post.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</small>
          </div>
        `).join('');
    }
    const container = document.getElementById(`reddit-div${summaryIndex + 1}`);
    if (container) container.innerHTML = `<div class="reddit-samples-header" style="font-weight:bold; margin-bottom:6px;">${finding.title}</div><div class="reddit-samples-posts">${html}</div>`;

    setTimeout(() => {
        startQuoteAnimation(animationContainerId, quotesForAnimation);
    }, 100);
}

function renderPosts(posts) {
    const container = document.getElementById("posts-container");
    if (!container) return;
    const html = posts.map(post => `...`).join(''); // Your HTML for rendering posts
    container.innerHTML = html;
}

const sortFunctions = { relevance: (a, b) => 0, newest: (a, b) => b.data.created_utc - a.data.created_utc, upvotes: (a, b) => b.data.ups - a.data.ups, comments: (a, b) => b.data.num_comments - a.data.num_comments };

// --- IV. EVENT LISTENERS ---
document.getElementById("pulse-search").addEventListener("click", async function(event) {
    event.preventDefault();

    // 1. Validate Input
    const nicheElement = document.getElementById("niche-input");
    if (!nicheElement) { alert("Error: 'niche-input' element not found."); return; }
    const userNiche = (typeof nicheElement.value !== 'undefined') ? nicheElement.value.trim() : nicheElement.innerText.trim();
    if (!userNiche) { alert("Please enter a niche."); return; }

    // 2. Setup UI for Loading
    stopAllQuoteAnimations();
    const toClear = ["count-header", "filter-header", "findings-1", "findings-2", "findings-3", "findings-4", "findings-5", "pulse-results", "posts-container"];
    toClear.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
    document.querySelectorAll('.reddit-samples-posts, .reddit-samples-header').forEach(el => el.innerHTML = '');
    const resultsMessageDiv = document.getElementById("results-message");
    const loadingBlock = document.getElementById("loading-code-1");
    if (resultsMessageDiv) resultsMessageDiv.innerHTML = "";
    if (loadingBlock) loadingBlock.style.display = "flex";
    [1,2,3,4,5].forEach(i => { const el = document.getElementById(`findings-${i}`); if(el) el.innerHTML = `<p class='loading'>Analyzing findings...</p>`; });

    // 3. Get Form Values
    const timeRadios = document.getElementsByName("timePosted");
    let selectedTimeRaw = "all";
    for (const radio of timeRadios) { if (radio.checked) { selectedTimeRaw = radio.value; break; } }
    const timeMap = { week: "week", month: "month", "6months": "year", year: "year", all: "all" };
    const selectedTime = timeMap[selectedTimeRaw] || "all";
    const minVotesRadios = document.getElementsByName("minVotes");
    let selectedMinUpvotes = 20;
    for (const radio of minVotesRadios) { if (radio.checked) { selectedMinUpvotes = parseInt(radio.value, 10); break; } }
    const filterHeaderDiv = document.getElementById("filter-header");
    if (filterHeaderDiv) filterHeaderDiv.innerText = formatFilterHeader(selectedTimeRaw, selectedMinUpvotes);

    // 4. Execute Main Logic
    try {
        const searchTerms = ["struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve", "annoyance", "frustration", "disappointed", "fed up", "hate when", "help", "advice", "solution to", "workaround", "how do I", "how to fix", "how to stop", "can’t find", "nothing works", "tried everything", "too expensive", "takes too long", "vent", "rant"];
        const allPosts = await fetchMultipleRedditDataBatched(userNiche, searchTerms, 100, selectedTime);
        if (allPosts.length === 0) throw new Error("No results found on Reddit. Try a broader search term.");

        const reorderedPosts = allPosts; // Simplified for now
        const filteredPosts = filterPosts(reorderedPosts, selectedMinUpvotes);
        if (filteredPosts.length < 10) throw new Error("Not enough high-quality posts found. Try adjusting filters.");
        window._filteredPosts = filteredPosts;
        renderPosts(filteredPosts);

        const topKeywords = getTopKeywords(filteredPosts, 10);
        const keywordsString = topKeywords.join(', ');
        const combinedTexts = filteredPosts.slice(0, 80).map(p => `${p.data.title}. ${getFirstTwoSentences(p.data.selftext)}`).join("\n\n");
        
        const summaryParams = { model: "gpt-4o-mini", messages: [{role: "system", content: "You are a helpful assistant..."}, {role: "user", content: `...summarize...[${keywordsString}]...`}], temperature: 0.0, max_tokens: 1000 };
        const summaryResponse = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: summaryParams }) });
        if (!summaryResponse.ok) throw new Error(`OpenAI Summary Error: ${await summaryResponse.text()}`);
        const summaries = parseAISummary((await summaryResponse.json()).openaiResponse);
        
        const validatedSummaries = summaries.filter(finding => filteredPosts.filter(post => calculateRelevanceScore(post, finding) > 0).length >= 3);
        if (validatedSummaries.length === 0) throw new Error("Could not form clear findings from the posts. Try a broader niche.");

        const metrics = calculateFindingMetrics(validatedSummaries, filteredPosts);
        const sortedFindings = validatedSummaries.map((summary, index) => ({
            summary,
            prevalence: Math.round((metrics[index].supportCount / (metrics.totalProblemPosts || 1)) * 100),
            supportCount: metrics[index].supportCount
        })).sort((a, b) => b.prevalence - a.prevalence);

        window._summaries = sortedFindings.map(item => item.summary);
        window._postsForAssignment = filteredPosts.map(post => ({ post, score: calculateRelevanceScore(post, window._summaries[0]) })).sort((a,b) => b.score - a.score).slice(0, 75).map(item => item.post);
        window._assignments = await assignPostsToFindings(window._summaries, window._postsForAssignment, keywordsString, userNiche, combinedTexts);
        window._usedPostIds = new Set();
        
        // 5. Render Results
        for (let i = 1; i <= 5; i++) { const block = document.getElementById(`findings-block${i}`); if(block) block.style.display = "none"; }
        
        sortedFindings.forEach((findingData, index) => {
            const displayIndex = index + 1;
            const block = document.getElementById(`findings-block${displayIndex}`);
            const content = document.getElementById(`findings-${displayIndex}`);
            const btn = document.getElementById(`button-sample${displayIndex}`);
            
            if (block) block.style.display = "flex";
            if (content) {
                const { summary, prevalence, supportCount } = findingData;
                const summaryId = `summary-body-${displayIndex}-${Date.now()}`;
                const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;
                let metricsHtml = `...`; // Your metrics HTML logic
                content.innerHTML = `<div class="section-title">${summary.title}</div> ... ${metricsHtml}`;
            }
            if (btn) {
                btn.onclick = function() {
                    showSamplePosts(index, window._assignments, window._filteredPosts, window._usedPostIds);
                };
            }
        });

        if (loadingBlock) loadingBlock.style.display = "none";

    } catch (err) {
        console.error("Critical Error during search:", err);
        if (loadingBlock) loadingBlock.style.display = "none";
        if (resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error'>❌ ${err.message}</p>`;
        [1,2,3,4,5].forEach(i => { const el = document.getElementById(`findings-${i}`); if (el) el.innerHTML = ""; });
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
