// =================================================================================
// FINAL SCRIPT WITH HIGHCHARTS SPLIT PACKED BUBBLE CHART (WITH CLICK EVENT)
// =================================================================================

// --- 1. GLOBAL VARIABLES & CONSTANTS ---
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy';
const HARD_MIN_SUBSCRIBERS = 1000;
const HARD_MIN_ACTIVE_USERS = 5;
const LENIENT_MIN_SUBSCRIBERS = 500;
const LENIENT_MIN_ACTIVE_USERS = 1;
let originalGroupName = '';
let _allRankedSubreddits = [];

const suggestions = ["Dog Lovers", "Start-up Founders", "Fitness Freaks", "AI Enthusiasts", "Home Bakers", "Gamers", "Content Creators", "Software Developers", "Brides To Be"];
const positiveColors = ['#00a5ce', '#0090b5', '#00c0e6', '#7bd9ec', '#b3e8f3', '#006d85'];
const negativeColors = ['#fd80c7', '#d6539d', '#ff4fa3', '#ff99d6', '#fbb6ce', '#f472b6'];
const lemmaMap = { 'needs': 'need', 'wants': 'want', 'loves': 'love', 'loved': 'love', 'loving': 'love', 'hates': 'hate', 'wishes': 'wish', 'wishing': 'wish', 'solutions': 'solution', 'challenges': 'challenge', 'recommended': 'recommend', 'disappointed': 'disappoint', 'frustrated': 'frustrate', 'annoyed': 'annoy' };
const positiveWords = new Set(['love', 'amazing', 'awesome', 'beautiful', 'best', 'brilliant', 'celebrate', 'charming', 'dope', 'excellent', 'excited', 'exciting', 'epic', 'fantastic', 'flawless', 'gorgeous', 'happy', 'impressed', 'incredible', 'insane', 'joy', 'keen', 'lit', 'perfect', 'phenomenal', 'proud', 'rad', 'super', 'stoked', 'thrilled', 'vibrant', 'wow', 'wonderful', 'blessed', 'calm', 'chill', 'comfortable', 'cozy', 'grateful', 'loyal', 'peaceful', 'pleased', 'relaxed', 'relieved', 'satisfied', 'secure', 'thankful', 'want', 'wish', 'hope', 'desire', 'craving', 'benefit', 'bonus', 'deal', 'hack', 'improvement', 'quality', 'solution', 'strength', 'advice', 'tip', 'trick', 'recommend']);
const negativeWords = new Set(['angry', 'annoy', 'anxious', 'awful', 'bad', 'broken', 'hate', 'challenge', 'confused', 'crazy', 'critical', 'danger', 'desperate', 'disappoint', 'disgusted', 'dreadful', 'fear', 'frustrate', 'furious', 'horrible', 'irritated', 'jealous', 'nightmare', 'outraged', 'pain', 'panic', 'problem', 'rant', 'scared', 'shocked', 'stressful', 'terrible', 'terrified', 'trash', 'alone', 'ashamed', 'bored', 'depressed', 'discouraged', 'dull', 'empty', 'exhausted', 'failure', 'guilty', 'heartbroken', 'hopeless', 'hurt', 'insecure', 'lonely', 'miserable', 'sad', 'sorry', 'tired', 'unhappy', 'upset', 'weak', 'need', 'disadvantage', 'issue', 'flaw']);
const emotionalIntensityScores = { 'annoy': 3, 'irritated': 3, 'bored': 2, 'issue': 3, 'sad': 4, 'bad': 3, 'confused': 4, 'tired': 3, 'upset': 5, 'unhappy': 5, 'disappoint': 6, 'frustrate': 6, 'stressful': 6, 'awful': 7, 'hate': 8, 'angry': 7, 'broken': 5, 'exhausted': 5, 'pain': 7, 'miserable': 8, 'terrible': 8, 'worst': 9, 'horrible': 8, 'furious': 9, 'outraged': 9, 'dreadful': 8, 'terrified': 10, 'nightmare': 10, 'heartbroken': 9, 'desperate': 8, 'rage': 10, 'problem': 4, 'challenge': 5, 'critical': 6, 'danger': 7, 'fear': 7, 'panic': 8, 'scared': 6, 'shocked': 7, 'trash': 5, 'alone': 4, 'ashamed': 5, 'depressed': 8, 'discouraged': 5, 'dull': 2, 'empty': 6, 'failure': 7, 'guilty': 6, 'hopeless': 8, 'insecure': 5, 'lonely': 6, 'weak': 4, 'need': 5, 'disadvantage': 4, 'flaw': 4 };
const stopWords = ["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves", "like", "just", "dont", "can", "people", "help", "hes", "shes", "thing", "stuff", "really", "actually", "even", "know", "still", "post", "posts", "subreddit", "redditor", "redditors", "comment", "comments"];



// =================================================================================
// === NEW HELPER FUNCTION: classifySentimentWithAI (Add this to your script) ===
// =================================================================================
async function classifySentimentWithAI(posts) {
    const BATCH_SIZE = 25; // Process 25 posts per AI call to stay within token limits
    let allSentiments = [];

    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
        const batch = posts.slice(i, i + BATCH_SIZE);
        const postsForAI = batch.map((p, index) => ({
            index: index,
            text: `Title: ${p.data.title || ''}. Body: ${(p.data.selftext || p.data.body || '').substring(0, 400)}`
        }));

        const prompt = `You are a sentiment analysis engine. For each post provided, classify its overall sentiment towards the main subject as "Positive", "Negative", or "Neutral". Respond ONLY with a valid JSON object with a single key "sentiments", which is an array of objects. Each object must have two keys: "post_index" and "sentiment".

        Example Response:
        { "sentiments": [ {"post_index": 0, "sentiment": "Positive"}, {"post_index": 1, "sentiment": "Negative"} ] }

        Posts to analyze:
        ${JSON.stringify(postsForAI)}`;

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are a precise JSON-only sentiment classifier." }, { role: "user", content: prompt }],
            temperature: 0,
            max_tokens: 1500,
            response_format: { "type": "json_object" }
        };

        try {
            const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
            if (response.ok) {
                const data = await response.json();
                const parsed = JSON.parse(data.openaiResponse);
                if (parsed.sentiments && Array.isArray(parsed.sentiments)) {
                    // Create a temporary map to easily align results with original batch
                    const sentimentMap = new Map(parsed.sentiments.map(s => [s.post_index, s.sentiment]));
                    const batchSentiments = postsForAI.map(p => sentimentMap.get(p.index) || 'Neutral');
                    allSentiments.push(...batchSentiments);
                }
            } else {
                 // If AI fails for a batch, classify all as Neutral to not skew results
                 allSentiments.push(...Array(batch.length).fill('Neutral'));
            }
        } catch (error) {
            console.error("AI sentiment classification batch failed:", error);
            allSentiments.push(...Array(batch.length).fill('Neutral'));
        }
    }
    return allSentiments;
}
// =================================================================================
// === NEW HELPER FUNCTION: generateSentimentContextWithAI (Add this to your script) ===
// =================================================================================
async function generateSentimentContextWithAI(posts, brandName) {
    // Take a representative sample of up to 25 posts for the summary
    const samplePosts = posts.slice(0, 25);
    if (samplePosts.length === 0) {
        return { positive_theme: "", negative_theme: "", verdict: "No discussion found for this period." };
    }

    const postsForAI = samplePosts.map(p => `"${(p.data.title || '')} - ${(p.data.selftext || p.data.body || '').substring(0, 250)}"`).join('\n');

    const prompt = `You are a market research analyst. Below is a sample of user comments about "${brandName}".
    Your task is to provide a brief, insightful summary of the discussion.

    Respond ONLY with a valid JSON object with three keys:
    1.  "positive_theme": A single, short sentence describing the main reason for positive sentiment. If none, return "".
    2.  "negative_theme": A single, short sentence describing the main reason for negative sentiment. If none, return "".
    3.  "verdict": A single concluding sentence that explains the overall sentiment balance.

    User Comments:
    ${postsForAI}`;

    const openAIParams = {
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a concise market analyst outputting only JSON." }, { role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { "type": "json_object" }
    };

    try {
        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (response.ok) {
            const data = await response.json();
            return JSON.parse(data.openaiResponse);
        }
    } catch (error) {
        console.error("AI context generation failed:", error);
    }
    // Return a default object on failure
    return { positive_theme: "N/A", negative_theme: "N/A", verdict: "Could not generate context." };
}

function deduplicatePosts(posts) { const seen = new Set(); return posts.filter(post => { if (!post.data || !post.data.id) return false; if (seen.has(post.data.id)) return false; seen.add(post.data.id); return true; }); }
function formatDate(utcSeconds) { const date = new Date(utcSeconds * 1000); return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all', searchInComments = false) { let allPosts = []; let after = null; try { while (allPosts.length < totalLimit) { const payload = { searchTerm: term, niche: niche, limit: 25, timeFilter: timeFilter, after: after }; if (searchInComments) { payload.includeComments = true; } const response = await fetch(REDDIT_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) { throw new Error(`Proxy Error: Server returned status ${response.status}`); } const data = await response.json(); if (!data.data || !data.data.children || !data.data.children.length) break; allPosts = allPosts.concat(data.data.children); after = data.data.after; if (!after) break; } } catch (err) { console.error(`Failed to fetch posts for term "${term}" via proxy:`, err.message); return []; } return allPosts.slice(0, totalLimit); }
async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all', searchInComments = false) { const allResults = []; for (let i = 0; i < searchTerms.length; i += 8) { const batchTerms = searchTerms.slice(i, i + 8); const batchPromises = batchTerms.map(term => fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter, searchInComments)); const batchResults = await Promise.all(batchPromises); batchResults.forEach(posts => { if (Array.isArray(posts)) { allResults.push(...posts); } }); if (i + 8 < searchTerms.length) { await new Promise(resolve => setTimeout(resolve, 500)); } } return deduplicatePosts(allResults); }

// =================================================================================
// === ADD THIS NEW, AGGRESSIVE DE-DUPLICATION FUNCTION ===
// =================================================================================

/**
 * Aggressively de-duplicates posts and comments based on their content.
 * It creates a "signature" of the content to catch bots, copypasta, and quotes.
 * @param {Array} items - An array of Reddit post or comment objects.
 * @returns {Array} A new array with content-based duplicates removed.
 */
// =================================================================================
// === REPLACE THE OLD FUNCTION WITH THIS NEW, HYPER-AGGRESSIVE VERSION ===
// =================================================================================

/**
 * Aggressively de-duplicates posts and comments based on a robust content signature.
 * This version is designed to catch bots, copypasta, and quote-replies by normalizing the text.
 * @param {Array} items - An array of Reddit post or comment objects.
 * @returns {Array} A new array with content-based duplicates removed.
 */
function deduplicateByContent(items) {
    const seenContentSignatures = new Set();
    const uniqueIds = new Set(); // Also track IDs to prevent accidental removal of different comments with same short content
    
    return items.filter(item => {
        const id = item.data.id;
        const content = (item.data.selftext || item.data.body || '').trim();

        // If there's no content or we've already seen this exact ID, filter it out.
        if (!content || uniqueIds.has(id)) {
            return false;
        }

        // Create a robust signature: lowercase, first 500 chars, all whitespace removed.
        // This makes it very difficult for slightly reformatted copypasta to get through.
        const signature = content.substring(0, 500).toLowerCase().replace(/\s+/g, '');

        // We only consider very short comments (like "this" or "lol") as duplicates if they are truly identical.
        // For longer comments, the signature is very reliable.
        if (signature.length < 20) {
            if (seenContentSignatures.has(content)) {
                return false; // For short comments, require an exact match
            }
            seenContentSignatures.add(content);
        } else {
            if (seenContentSignatures.has(signature)) {
                return false; // For longer content, the signature is enough
            }
            seenContentSignatures.add(signature);
        }
        
        uniqueIds.add(id);
        return true;
    });
}
function parseAISummary(aiResponse) { try { aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim(); const jsonMatch = aiResponse.match(/{[\s\S]*}/); if (!jsonMatch) { throw new Error("No JSON object in AI response."); } const parsed = JSON.parse(jsonMatch[0]); if (!parsed.summaries || !Array.isArray(parsed.summaries) || parsed.summaries.length < 1) { throw new Error("AI response lacks a 'summaries' array."); } parsed.summaries.forEach((summary, idx) => { const missingFields = []; if (!summary.title) missingFields.push("title"); if (!summary.body) missingFields.push("body"); if (typeof summary.count !== 'number') missingFields.push("count"); if (!summary.quotes || !Array.isArray(summary.quotes) || summary.quotes.length < 1) missingFields.push("quotes"); if (!summary.keywords || !Array.isArray(summary.keywords) || summary.keywords.length === 0) missingFields.push("keywords"); if (missingFields.length > 0) throw new Error(`Summary ${idx + 1} is missing required fields: ${missingFields.join(", ")}.`); }); return parsed.summaries; } catch (error) { console.error("Parsing Error:", error); console.log("Raw AI Response:", aiResponse); throw new Error("Failed to parse AI response."); } }
function parseAIAssignments(aiResponse) { try { aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim(); const jsonMatch = aiResponse.match(/{[\s\S]*}/); if (!jsonMatch) { throw new Error("No JSON object in AI response."); } const parsed = JSON.parse(jsonMatch[0]); if (!parsed.assignments || !Array.isArray(parsed.assignments)) { throw new Error("AI response lacks an 'assignments' array."); } parsed.assignments.forEach((assignment, idx) => { const missingFields = []; if (typeof assignment.postNumber !== 'number') missingFields.push("postNumber"); if (typeof assignment.finding !== 'number') missingFields.push("finding"); if (missingFields.length > 0) throw new Error(`Assignment ${idx + 1} is missing required fields: ${missingFields.join(", ")}.`); }); return parsed.assignments; } catch (error) { console.error("Parsing Error:", error); console.log("Raw AI Response:", aiResponse); throw new Error("Failed to parse AI response."); } }
function filterPosts(posts, minUpvotes = 20) { return posts.filter(post => { const title = (post.data.title || post.data.link_title || '').toLowerCase(); const selftext = post.data.selftext || post.data.body || ''; if (title.includes('[ad]') || title.includes('sponsored') || post.data.upvote_ratio < 0.2 || post.data.ups < minUpvotes || !selftext || selftext.length < 20) return false; const isRamblingOrNoisy = (text) => { if (!text) return false; return /&#x[0-9a-fA-F]+;/g.test(text) || /[^a-zA-Z0-9\s]{5,}/g.test(text) || /(.)\1{6,}/g.test(text); }; return !isRamblingOrNoisy(title) && !isRamblingOrNoisy(selftext); }); }
function getTopKeywords(posts, topN = 10) { const freqMap = {}; posts.forEach(post => { const cleanedText = `${post.data.title || post.data.link_title || ''} ${post.data.selftext || post.data.body || ''}`.replace(/<[^>]+>/g, '').replace(/[^a-zA-Z0-9\s.,!?]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); const words = cleanedText.split(/\s+/); words.forEach(word => { if (!stopWords.includes(word) && word.length > 2) { freqMap[word] = (freqMap[word] || 0) + 1; } }); }); return Object.keys(freqMap).sort((a, b) => freqMap[b] - freqMap[a]).slice(0, topN); }
function getFirstTwoSentences(text) { if (!text) return ''; const sentences = text.match(/[^\.!\?]+[\.!\?]+(?:\s|$)/g); return sentences ? sentences.slice(0, 2).join(' ').trim() : text; }

async function assignPostsToFindings(summaries, posts) {
    const postsForAI = posts.slice(0, 50);
    const prompt = `You are an expert data analyst. Your task is to categorize Reddit posts into the most relevant "Finding" from a provided list.\n\nHere are the ${summaries.length} findings:\n${summaries.map((s, i) => `Finding ${i + 1}: ${s.title}`).join('\n')}\n\nHere are the ${postsForAI.length} Reddit posts:\n${postsForAI.map((p, i) => `Post ${i + 1}: ${(p.data.title || p.data.link_title || '').substring(0, 150)}`).join('\n')}\n\nINSTRUCTIONS: For each post, assign it to the most relevant Finding (from 1 to ${summaries.length}). Respond ONLY with a JSON object with a single key "assignments", which is an array of objects like {"postNumber": 1, "finding": 2}.`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a precise data categorization engine that outputs only JSON." }, { role: "user", content: prompt }], temperature: 0, max_tokens: 1500, response_format: { "type": "json_object" } };
    try {
        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!response.ok) throw new Error(`OpenAI API Error for assignments: ${response.statusText}`);
        const data = await response.json();
        return parseAIAssignments(data.openaiResponse);
    } catch (error) {
        console.error("Assignment function error:", error);
        return [];
    }
}
function calculateRelevanceScore(post, finding) { let score = 0; const postTitle = (post.data.title || post.data.link_title || "").toLowerCase(); const postBody = (post.data.selftext || post.data.body || "").toLowerCase(); const findingTitleWords = finding.title.toLowerCase().split(' ').filter(word => word.length > 3 && !stopWords.includes(word)); const findingKeywords = (finding.keywords || []).map(k => k.toLowerCase()); let titleWordMatched = false, keywordMatched = false; for (const word of findingTitleWords) { const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); if (regex.test(postTitle)) { score += 5; titleWordMatched = true; } if (regex.test(postBody)) { score += 2; titleWordMatched = true; } } for (const keyword of findingKeywords) { const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); if (regex.test(postTitle)) { score += 3; keywordMatched = true; } if (regex.test(postBody)) { score += 1; keywordMatched = true; } } if (titleWordMatched && keywordMatched) { score += 10; } return score; }
function calculateFindingMetrics(validatedSummaries, filteredPosts) { const metrics = {}; const allProblemPostIds = new Set(); validatedSummaries.forEach((finding, index) => { metrics[index] = { supportCount: 0 }; }); filteredPosts.forEach(post => { let bestFindingIndex = -1; let maxScore = 0; validatedSummaries.forEach((finding, index) => { const score = calculateRelevanceScore(post, finding); if (score > maxScore) { maxScore = score; bestFindingIndex = index; } }); if (bestFindingIndex !== -1 && maxScore > 0) { metrics[bestFindingIndex].supportCount++; allProblemPostIds.add(post.data.id); } }); metrics.totalProblemPosts = allProblemPostIds.size; return metrics; }

function renderPosts(posts) {
    const container = document.getElementById("posts-container");
    if (!container) {
        return;
    }
    container.innerHTML = posts.map(post => {
        const content = post.data.selftext || post.data.body || 'No additional content.';
        const title = post.data.title || post.data.link_title || 'View Comment Thread';
        const num_comments = post.data.num_comments ? `| 💬 ${post.data.num_comments.toLocaleString()}` : '';
        
        // All inline styles have been removed and replaced with CSS classes.
        return `
            <div class="insight">
                <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" class="insight-title">
                    ${title}
                </a>
                <p class="insight-content">
                    ${content.substring(0, 200) + '...'}
                </p>
                <small class="insight-meta">
                    r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} ${num_comments} | 🗓️ ${formatDate(post.data.created_utc)}
                </small>
            </div>
        `;
    }).join('');
}

function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) {
    if (!assignments) return;
    const finding = window._summaries[summaryIndex];
    if (!finding) return;

    let relevantPosts = [];
    const addedPostIds = new Set();

    const addPost = (post) => {
        if (post && post.data && !usedPostIds.has(post.data.id) && !addedPostIds.has(post.data.id)) {
            relevantPosts.push(post);
            addedPostIds.add(post.data.id);
        }
    };

    const assignedPostNumbers = assignments.filter(a => a.finding === (summaryIndex + 1)).map(a => a.postNumber);
    assignedPostNumbers.forEach(postNum => {
        if (postNum - 1 < window._postsForAssignment.length) {
            addPost(window._postsForAssignment[postNum - 1]);
        }
    });

    if (relevantPosts.length < 8) {
        const candidatePool = allPosts.filter(p => !usedPostIds.has(p.data.id) && !addedPostIds.has(p.data.id));
        const scoredCandidates = candidatePool.map(post => ({
            post: post,
            score: calculateRelevanceScore(post, finding)
        })).filter(item => item.score >= 4).sort((a, b) => b.score - a.score);

        for (const candidate of scoredCandidates) {
            if (relevantPosts.length >= 8) break;
            addPost(candidate.post);
        }
    }

    let html;
    if (relevantPosts.length === 0) {
        // Replaced inline style with a class
        html = `<div class="no-posts-found">Could not find any highly relevant Reddit posts for this finding.</div>`;
    } else {
        const finalPosts = relevantPosts.slice(0, 8);
        finalPosts.forEach(post => usedPostIds.add(post.data.id));
        html = finalPosts.map(post => {
            const content = post.data.selftext || post.data.body || 'No content.';
            const title = post.data.title || post.data.link_title || 'View Comment';
            const num_comments = post.data.num_comments ? `| 💬 ${post.data.num_comments.toLocaleString()}` : '';
            
            // Note: The sample posts use a slightly different class "sample-insight"
            // to allow for different styling than the main post list.
            return `
                <div class="sample-insight">
                    <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" class="sample-insight-title">
                        ${title}
                    </a>
                    <p class="sample-insight-content">
                        ${content.substring(0, 150) + '...'}
                    </p>
                    <small class="sample-insight-meta">
                        r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} ${num_comments} | 🗓️ ${formatDate(post.data.created_utc)}
                    </small>
                </div>
            `;
        }).join('');
    }

    const container = document.getElementById(`reddit-div${summaryIndex + 1}`);
    if (container) {
        container.innerHTML = `
            <div class="reddit-samples-header">Real Stories from Reddit: "${finding.title}"</div>
            <div class="reddit-samples-posts">${html}</div>
        `;
    }
}

async function getRelatedSearchTermsAI(audience) {
    const prompt = `Given the target audience "${audience}", generate up to 5 related but distinct search terms or concepts that would help find communities for them. Think about activities, problems, life stages, and related interests. Respond ONLY with a valid JSON object with a single key "terms", which is an array of strings.`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a creative brainstorming assistant that outputs only JSON." }, { role: "user", content: prompt }], temperature: 0.4, max_tokens: 150, response_format: { "type": "json_object" } };
    try {
        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!response.ok) throw new Error('AI keyword generation failed.');
        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        return parsed.terms || [];
    } catch (error) {
        console.error("Error generating related search terms:", error);
        return [];
    }
}
async function findSubredditsForGroup(groupName) {
    const relatedTerms = await getRelatedSearchTermsAI(groupName);
    const allTerms = [groupName, ...relatedTerms];
    const prompt = `Based on the following audience and related keywords: [${allTerms.join(', ')}], suggest up to 20 relevant and active Reddit subreddits. Prioritize a variety of communities, including both large general ones and smaller niche ones. Provide your response ONLY as a JSON object with a single key "subreddits" which contains an array of subreddit names (without "r/").`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an expert Reddit community finder providing answers in strict JSON format." }, { role: "user", content: prompt }], temperature: 0.2, max_tokens: 300, response_format: { "type": "json_object" } };
    try {
        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!response.ok) throw new Error('OpenAI API request failed.');
        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        if (!parsed.subreddits || !Array.isArray(parsed.subreddits)) throw new Error("AI response did not contain a 'subreddits' array.");
        return parsed.subreddits;
    } catch (error) {
        console.error("Error finding subreddits:", error);
        alert("Sorry, I couldn't find any relevant communities. Please try another group name.");
        return [];
    }
}
async function fetchCommentsForPosts(postIds, batchSize = 5) {
    let allComments = [];
    console.log(`Fetching comments for ${postIds.length} posts...`);
    for (let i = 0; i < postIds.length; i += batchSize) {
        const batchIds = postIds.slice(i, i + batchSize);
        const batchPromises = batchIds.map(postId => {
            const payload = { type: 'comments', postId: postId };
            return fetch(REDDIT_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(res => res.json()).then(data => {
                if (Array.isArray(data) && data.length > 1 && data[1].data && data[1].data.children) {
                    return data[1].data.children.filter(comment => comment.kind === 't1');
                }
                return [];
            }).catch(err => {
                console.error(`Failed to fetch comments for post ${postId}:`, err);
                return [];
            });
        });
        const results = await Promise.all(batchPromises);
        results.forEach(comments => allComments.push(...comments));
        if (i + batchSize < postIds.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
    console.log(`Successfully fetched ${allComments.length} comments.`);
    return allComments;
}
function lemmatize(word) { if (lemmaMap[word]) return lemmaMap[word]; if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); return word; }
async function generateEmotionMapData(posts) { try { const topPostsText = posts.slice(0, 40).map(p => `Title: ${p.data.title || p.data.link_title}\nBody: ${(p.data.selftext || p.data.body).substring(0, 1000)}`).join('\n---\n'); const prompt = `You are a world-class market research analyst for '${originalGroupName}'. Analyze the following text to identify the 15 most significant problems, pain points, or key topics.\n\nFor each one, provide:\n1. "problem": A short, descriptive name for the problem (e.g., "Finding Reliable Vendors", "Budgeting Anxiety").\n2. "intensity": A score from 1 (mild) to 10 (severe) of how big a problem this is.\n3. "frequency": A score from 1 (rarely mentioned) to 10 (frequently mentioned) based on its prevalence in the text.\n\nRespond ONLY with a valid JSON object with a single key "problems", which is an array of these objects.\nExample: { "problems": [{ "problem": "Catering Costs", "intensity": 8, "frequency": 9 }] }`; const openAIParams = { model: "gpt-4o", messages: [{ role: "system", content: "You are a market research analyst that outputs only valid JSON." }, { role: "user", content: prompt }], temperature: 0.2, max_tokens: 1500, response_format: { "type": "json_object" } }; const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) }); if (!response.ok) { throw new Error(`AI API failed with status: ${response.status}`); } const data = await response.json(); const parsed = JSON.parse(data.openaiResponse); const aiProblems = parsed.problems || []; if (aiProblems.length >= 3) { console.log("Successfully used AI analysis for Problem Map."); const chartData = aiProblems.map(item => { if (!item.problem || typeof item.intensity !== 'number' || typeof item.frequency !== 'number') return null; return { x: item.frequency, y: item.intensity, label: item.problem }; }).filter(Boolean); return chartData.sort((a, b) => b.x - a.x); } else { console.warn("AI analysis returned too few problems. Falling back to keyword analysis."); } } catch (error) { console.error("AI analysis for Problem Map failed:", error, "Falling back to reliable keyword-based analysis."); } const emotionFreq = {}; posts.forEach(post => { const text = `${post.data.title || post.data.link_title || ''} ${post.data.selftext || post.data.body || ''}`.toLowerCase(); const words = text.replace(/[^a-z\s']/g, '').split(/\s+/); words.forEach(rawWord => { const lemma = lemmatize(rawWord); if (emotionalIntensityScores[lemma]) { emotionFreq[lemma] = (emotionFreq[lemma] || 0) + 1; } }); }); const chartData = Object.entries(emotionFreq).map(([word, freq]) => ({ x: freq, y: emotionalIntensityScores[word], label: word })); return chartData.sort((a, b) => b.x - a.x).slice(0, 25); }

function renderEmotionMap(data) {
    const container = document.getElementById('emotion-map-container');
    if (!container) return;

    if (window.myEmotionChart) {
        window.myEmotionChart.destroy();
    }

    if (data.length < 3) {
        container.innerHTML = `
            <h3 class="dashboard-section-title">Problem Polarity Map</h3>
            <p class="chart-placeholder-text">Not enough distinct problems were found to build a map.</p>
        `;
        return;
    }

    // HTML with classes instead of inline styles
    container.innerHTML = `
        <h3 class="dashboard-section-title">Problem Polarity Map</h3>
        <p id="problem-map-description" class="chart-description">Top Right = The most frequent & emotionally intense problems.</p>
        <div id="emotion-map-wrapper">
            <div id="emotion-map">
                <canvas id="emotion-chart-canvas"></canvas>
            </div>
            <button id="chart-zoom-btn"></button>
        </div>
    `;

    const ctx = document.getElementById('emotion-chart-canvas')?.getContext('2d');
    if (!ctx) return;

    const maxFreq = Math.max(...data.map(p => p.x));
    const allFrequencies = data.map(p => p.x);
    const minObservedFreq = Math.min(...allFrequencies);
    const collapsedMinX = 5;
    const isCollapseFeatureEnabled = minObservedFreq >= collapsedMinX;
    const initialMinX = isCollapseFeatureEnabled ? collapsedMinX : 0;

    window.myEmotionChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Problems/Topics',
                data: data,
                backgroundColor: 'rgba(52, 152, 219, 0.9)',
                borderColor: 'rgba(41, 128, 185, 1)',
                borderWidth: 1,
                pointRadius: (context) => 5 + (context.raw.x / maxFreq) * 20,
                pointHoverRadius: (context) => 8 + (context.raw.x / maxFreq) * 20,
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'nearest',
                    intersect: false,
                    callbacks: {
                        title: function(tooltipItems) {
                            return tooltipItems[0].raw.label;
                        },
                        label: function(context) {
                            return '';
                        },
                        afterBody: function(tooltipItems) {
                            const point = tooltipItems[0].raw;
                            return `Frequency: ${point.x}, Intensity: ${point.y.toFixed(1)}`;
                        }
                    },
                    displayColors: false,
                    titleFont: {
                        size: 14,
                        weight: 'bold'
                    },
                    bodyFont: {
                        size: 12
                    },
                    backgroundColor: '#ff7ce2',
                    titleColor: '#ffffff',
                    bodyColor: '#dddddd',
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Frequency (1-10)',
                        color: 'white',
                        font: {
                            weight: 'bold'
                        }
                    },
                    min: initialMinX,
                    max: 10,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.15)'
                    },
                    ticks: {
                        color: 'white'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Problem Intensity (1-10)',
                        color: 'white',
                        font: {
                            weight: 'bold'
                        }
                    },
                    min: 0,
                    max: 10,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.15)'
                    },
                    ticks: {
                        color: 'white'
                    }
                }
            }
        }
    });

    const zoomButton = document.getElementById('chart-zoom-btn');
    // This style is dynamic based on logic, so it's correct to keep it here.
    zoomButton.style.display = 'none';

    if (isCollapseFeatureEnabled) {
        zoomButton.style.display = 'block'; // Or 'inline-block', etc.
        const updateButtonText = () => {
            const isCurrentlyCollapsed = window.myEmotionChart.options.scales.x.min !== 0;
            zoomButton.textContent = isCurrentlyCollapsed ? 'Zoom Out to See Full Range' : 'Zoom In to High-Frequency';
        };

        zoomButton.addEventListener('click', () => {
            const chart = window.myEmotionChart;
            const isCurrentlyCollapsed = chart.options.scales.x.min !== 0;
            chart.options.scales.x.min = isCurrentlyCollapsed ? 0 : collapsedMinX;
            chart.update('none');
            updateButtonText();
        });

        updateButtonText();
    }
}

// =================================================================================
// === REVISED HYBRID FUNCTION V5: DEFINITIVE UNIQUE POST COUNTING ===
// =================================================================================
async function generateAndRenderHybridSentiment(posts, audienceContext) {
    const positiveContainer = document.getElementById('positive-cloud');
    const negativeContainer = document.getElementById('negative-cloud');

    if (!positiveContainer || !negativeContainer) {
        console.error("Sentiment cloud containers not found.");
        return;
    }

    // Set a loading state (with headers removed)
    positiveContainer.innerHTML = `<p class="loading-text">Analyzing sentiment...</p>`;
    negativeContainer.innerHTML = `<p class="loading-text">Analyzing sentiment...</p>`;

    // --- PART 1: Word Counting (Corrected for unique posts) ---
    let positiveCount = 0, negativeCount = 0;
    const wordFreq = { positive: new Map(), negative: new Map() };

    posts.forEach(post => {
        const text = `${post.data.title || post.data.link_title || ''} ${post.data.
selftext || post.data.body || ''}`.toLowerCase();
        const words = text.replace(/[^a-z\s']/g, '').split(/\s+/);
        
        const uniqueWordsInPost = { positive: new Set(), negative: new Set() };

        words.forEach(rawWord => {
            if (rawWord.length < 3 || stopWords.includes(rawWord)) return;
            const lemma = lemmatize(rawWord);
            if (positiveWords.has(lemma)) {
                uniqueWordsInPost.positive.add(lemma);
            } else if (negativeWords.has(lemma)) {
                uniqueWordsInPost.negative.add(lemma);
            }
        });

        uniqueWordsInPost.positive.forEach(word => {
            if (!wordFreq.positive.has(word)) wordFreq.positive.set(word, new Set());
            wordFreq.positive.get(word).add(post);
        });
        uniqueWordsInPost.negative.forEach(word => {
            if (!wordFreq.negative.has(word)) wordFreq.negative.set(word, new Set());
            wordFreq.negative.get(word).add(post);
        });
    });

    // Calculate total counts for the score bar based on all occurrences
    posts.forEach(post => {
        const words = `${post.data.title || ''} ${post.data.selftext || ''}`.toLowerCase().split(/\s+/);
        words.forEach(word => {
            if (positiveWords.has(word)) positiveCount++;
            if (negativeWords.has(word)) negativeCount++;
        });
    });
    renderSentimentScore(positiveCount, negativeCount);


    // --- PART 2: SCRIPT-FIRST - Programmatically Find All Common Phrases (Corrected for unique posts) ---
    const phraseFreq = new Map();
    posts.forEach(post => {
        const text = `${post.data.title || ''} ${post.data.selftext || ''}`.toLowerCase().replace(/[^a-z\s']/g, '');
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const ngrams = [...generateNgrams(words, 2), ...generateNgrams(words, 3), ...generateNgrams(words, 4)];
        
        // ** THE CRITICAL FIX **
        // Get only the UNIQUE ngrams for this post before counting.
        const uniqueNgramsInPost = new Set(ngrams);

        uniqueNgramsInPost.forEach(ngram => {
            if (!phraseFreq.has(ngram)) phraseFreq.set(ngram, new Set());
            phraseFreq.get(ngram).add(post); // Add the post to the set for this phrase
        });
    });

    // The value is now a Set of posts, so we use its .size property for counting
    const candidatePhrases = Array.from(phraseFreq.entries())
        .filter(([_, postSet]) => postSet.size >= 2) // A phrase must appear in at least 2 unique posts
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 100)
        .map(item => item[0]);

    // --- PART 3: AI-FILTER (Unchanged) ---
    let finalPositivePhrases = [], finalNegativePhrases = [];
    if (candidatePhrases.length > 0) {
        try {
            const prompt = `You are a market research analyst. Below is a list of common phrases from the "${audienceContext}" community. Your task is to filter this list. Identify phrases that express clear **positive sentiment** and **negative sentiment**. Ignore neutral phrases. Respond ONLY with a valid JSON object with two keys: "positive_phrases" and "negative_phrases", holding an array of the relevant strings you selected. Candidate Phrases: ${JSON.stringify(candidatePhrases)}`;
            const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an expert sentiment filter that only outputs JSON." }, { role: "user", content: prompt }], temperature: 0.1, max_tokens: 1000, response_format: { "type": "json_object" } };
            const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
            if (response.ok) {
                const data = await response.json();
                const parsed = JSON.parse(data.openaiResponse);
                finalPositivePhrases = parsed.positive_phrases || [];
                finalNegativePhrases = parsed.negative_phrases || [];
            }
        } catch (error) { console.error("AI phrase filtering failed, proceeding with words only.", error); }
    }

    // --- PART 4: Merge and Render (Now uses the correct counts) ---
    const renderCloud = (container, title, wordMap, phraseList, colors) => {
        const topWords = Array.from(wordMap.entries())
            .map(([word, postSet]) => [word, { count: postSet.size, posts: postSet }])
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 23);
        
        const topPhrases = phraseList.map(phrase => {
            const postSet = phraseFreq.get(phrase);
            return [phrase, { count: postSet.size, posts: postSet }];
        }).filter(item => item[1]);

        const combinedData = [...topWords, ...topPhrases];
        
        const category = title.includes('Positive') ? 'positive' : 'negative';
        window._sentimentData = window._sentimentData || {};
        window._sentimentData[category] = Object.fromEntries(combinedData.map(([key, value]) => [key, value]));
        
        // MODIFIED CODE (FIX)
container.innerHTML = ''; // Clear the "loading..." text
const cloudContainer = document.createElement('div');
container.appendChild(cloudContainer); // This will now be the only child
        
        if (combinedData.length < 3) {
            cloudContainer.innerHTML = `<p style="font-family: sans-serif; color: #777; padding: 1rem; text-align: center;">Not enough distinct terms found.</p>`; return;
        }

        const counts = combinedData.map(item => item[1].count);
        const maxCount = Math.max(...counts);
        const minCount = Math.min(...counts);
        const minFontSize = 16, maxFontSize = 42;
        const cloudHTML = combinedData.map(([word, data]) => {
            const fontSize = minFontSize + ((data.count - minCount) / (maxCount - minCount || 1)) * (maxFontSize - minFontSize);
            const color = colors[Math.floor(Math.random() * colors.length)];
            const rotation = Math.random() * 8 - 4;
            return `<span class="cloud-word" data-word="${word}" style="font-size: ${fontSize.toFixed(1)}px; color: ${color}; transform: rotate(${rotation.toFixed(1)}deg);">${word}</span>`;
        }).join('');
        cloudContainer.innerHTML = cloudHTML;
    };

    renderCloud(positiveContainer, 'Positive Words & Phrases', wordFreq.positive, finalPositivePhrases, positiveColors);
    renderCloud(negativeContainer, 'Negative Words & Phrases', wordFreq.negative, finalNegativePhrases, negativeColors);
}

function renderContextContent(word, posts) { const contextBox = document.getElementById('context-box'); if (!contextBox) return; const highlightRegex = new RegExp(`\\b(${word.replace(/ /g, '\\s')}[a-z]*)\\b`, 'gi'); const headerHTML = ` <div class="context-header"> <h3 class="context-title">Context for: "${word}"</h3> <button class="context-close-btn" id="context-close-btn">×</button> </div> `; const snippetsHTML = posts.slice(0, 10).map(post => { const fullText = `${post.data.title || post.data.link_title || ''}. ${post.data.selftext || post.data.body || ''}`; const sentences = fullText.match(/[^.!?]+[.!?]+/g) || []; const keywordRegex = new RegExp(`\\b${word.replace(/ /g, '\\s')}[a-z]*\\b`, 'i'); let relevantSentence = sentences.find(s => keywordRegex.test(s)); if (!relevantSentence) { relevantSentence = getFirstTwoSentences(fullText); } const textToShow = relevantSentence ? relevantSentence.replace(highlightRegex, `<strong>$1</strong>`) : "Snippet not available."; const metaHTML = ` <div class="context-snippet-meta"> <span>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</span> </div> `; return ` <div class="context-snippet"> <p class="context-snippet-text">... ${textToShow} ...</p> ${metaHTML} </div> `; }).join(''); contextBox.innerHTML = headerHTML + `<div class="context-snippets-wrapper">${snippetsHTML}</div>`; contextBox.style.display = 'block'; const closeBtn = document.getElementById('context-close-btn'); if(closeBtn) { closeBtn.addEventListener('click', () => { contextBox.style.display = 'none'; contextBox.innerHTML = ''; }); } contextBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function showSlidingPanel(word, posts, category) { const positivePanel = document.getElementById('positive-context-box'); const negativePanel = document.getElementById('negative-context-box'); const overlay = document.getElementById('context-overlay'); if (!positivePanel || !negativePanel || !overlay) { console.error("Sliding context panels or overlay not found in the DOM. Add the new HTML elements."); renderContextContent(word, posts); return; } const targetPanel = category === 'positive' ? positivePanel : negativePanel; const otherPanel = category === 'positive' ? negativePanel : positivePanel; const highlightRegex = new RegExp(`\\b(${word.replace(/ /g, '\\s')}[a-z]*)\\b`, 'gi'); const headerHTML = `<div class="context-header"><h3 class="context-title">Context for: "${word}"</h3><button class="context-close-btn">×</button></div>`; const snippetsHTML = posts.slice(0, 10).map(post => { const fullText = `${post.data.title || post.data.link_title || ''}. ${post.data.selftext || post.data.body || ''}`; const sentences = fullText.match(/[^.!?]+[.!?]+/g) || []; const keywordRegex = new RegExp(`\\b${word.replace(/ /g, '\\s')}[a-z]*\\b`, 'i'); let relevantSentence = sentences.find(s => keywordRegex.test(s)); if (!relevantSentence) { relevantSentence = getFirstTwoSentences(fullText); } const textToShow = relevantSentence ? relevantSentence.replace(highlightRegex, `<strong>$1</strong>`) : 'No relevant snippet found.'; const metaHTML = `<div class="context-snippet-meta"><span>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</span></div>`; return `<div class="context-snippet"><p class="context-snippet-text">... ${textToShow} ...</p>${metaHTML}</div>`; }).join(''); targetPanel.innerHTML = headerHTML + `<div class="context-snippets-wrapper">${snippetsHTML}</div>`; const close = () => { targetPanel.classList.remove('visible'); overlay.classList.remove('visible'); }; targetPanel.querySelector('.context-close-btn').onclick = close; overlay.onclick = close; otherPanel.classList.remove('visible'); targetPanel.classList.add('visible'); overlay.classList.add('visible'); }
async function generateFAQs(posts) { const topPostsText = posts.slice(0, 20).map(p => `Title: ${p.data.title || p.data.link_title || ''}\nContent: ${(p.data.selftext || p.data.body || '').substring(0, 500)}`).join('\n---\n'); const prompt = `Analyze the following Reddit posts from the "${originalGroupName}" community. Identify and extract up to 5 frequently asked questions. Respond ONLY with a JSON object with a single key "faqs", which is an array of strings. Example: {"faqs": ["How do I start with X?"]}\n\nPosts:\n${topPostsText}`; const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an expert at identifying user questions from text. Output only JSON." }, { role: "user", content: prompt }], temperature: 0.1, max_tokens: 500, response_format: { "type": "json_object" } }; try { const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) }); if (!response.ok) throw new Error('OpenAI FAQ generation failed.'); const data = await response.json(); const parsed = JSON.parse(data.openaiResponse); return parsed.faqs || []; } catch (error) { console.error("FAQ generation error:", error); return []; } }
async function extractAndValidateEntities(posts, nicheContext) {
    const topPostsText = posts.slice(0, 50).map(p => {
        const title = p.data.title || p.data.link_title;
        const body = p.data.selftext || p.data.body || '';
        if (title) {
            return `Title: ${title}\nBody: ${body.substring(0, 800)}`;
        }
        return `Body: ${body.substring(0, 800)}`;
    }).join('\n---\n');
    const prompt = `You are a market research analyst reviewing Reddit posts from the '${nicheContext}' community. Extract the following: 1. "brands": Specific, proper-noun company, brand, or service names (e.g., "KitchenAid", "Stripe"). 2. "products": Common, generic product categories (e.g., "stand mixer", "CRM software"). CRITICAL RULES: Be strict. Exclude acronyms (MOH, AITA), generic words (UPDATE), etc. Respond ONLY with a JSON object with two keys: "brands" and "products", holding an array of strings. If none, return an empty array. Text: ${topPostsText}`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a meticulous market research analyst that outputs only JSON." }, { role: "user", content: prompt }], temperature: 0, max_tokens: 1000, response_format: { "type": "json_object" } };
    try {
        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!response.ok) throw new Error('AI entity extraction failed.');
        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        const allEntities = { brands: parsed.brands || [], products: parsed.products || [] };
        window._entityData = {};
        for (const type in allEntities) {
            window._entityData[type] = {};
            allEntities[type].forEach(name => {
                const regex = new RegExp(`\\b${name.replace(/ /g, '\\s')}(s?)\\b`, 'gi');
                const mentioningPosts = posts.filter(post => regex.test(`${post.data.title || post.data.link_title || ''} ${post.data.selftext || post.data.body || ''}`));
                if (mentioningPosts.length > 0) {
                    window._entityData[type][name] = { count: mentioningPosts.length, posts: mentioningPosts };
                }
            });
        }
        return {
            topBrands: Object.entries(window._entityData.brands || {}).sort((a, b) => b[1].count - a[1].count).slice(0, 8),
            topProducts: Object.entries(window._entityData.products || {}).sort((a, b) => b[1].count - a[1].count).slice(0, 8)
        };
    } catch (error) {
        console.error("Entity extraction error:", error);
        return { topBrands: [], topProducts: [] };
    }
}

// =================================================================================
// === REPLACEMENT FUNCTION: renderDiscoveryList ===
// =================================================================================
function renderDiscoveryList(containerId, data, title, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let listItems = '<p class="discovery-list-placeholder">No significant mentions found.</p>';
    if (data.length > 0) {
        listItems = data.map(([name, details], index) => `
            <li class="discovery-list-item" data-word="${name}" data-type="${type}">
                <div class="discovery-item-info">
                    <span class="rank">${index + 1}.</span>
                    <span class="name">${name}</span>
                    <span class="count">${details.count} mentions</span>
                </div>
                <button class="brief-button">See Brief</button>
            </li>
        `).join('');
    }
    container.innerHTML = `<h3 class="dashboard-section-title">${title}</h3><ul class="discovery-list">${listItems}</ul>`;
}


function renderFAQs(faqs) {
    const container = document.getElementById('faq-container');
    if (!container) return;

    // Replaced inline style with a class
    let faqItems = '<p class="faq-placeholder">Could not generate common questions from the text.</p>';

    if (faqs.length > 0) {
        faqItems = faqs.map((faq) => `
            <div class="faq-item">
                <button class="faq-question">${faq}</button>
                <div class="faq-answer">
                    <div class="faq-answer-content">
                        <em>This question was commonly found in discussions. Addressing it in your content or product can directly meet user needs.</em>
                    </div>
                </div>
            </div>
        `).join('');
    }

    container.innerHTML = `
        <h3 class="dashboard-section-title">Frequently Asked Questions</h3>
        ${faqItems}
    `;

    // REFACTORED: JS now only toggles a class. CSS handles all animation.
    container.querySelectorAll('.faq-question').forEach(button => {
        button.addEventListener('click', () => {
            const faqItem = button.closest('.faq-item'); // Get the parent container
            faqItem.classList.toggle('active');
        });
    });
}

// =================================================================================
// === SUBREDDIT VALIDATION & DISPLAY FUNCTIONS ===
// =================================================================================
async function handleRemoveSubClick(event) {
    const button = event.target.closest('.remove-sub-btn');
    if (!button) return;

    const card = button.closest('.subreddit-tag-detailed');
    const destinationList = document.querySelector('#similar-subreddits-container .subreddit-tag-list');

    if (card && destinationList) {
        const actionContainer = card.querySelector('.tag-footer-action');
        const subName = button.dataset.subname;
        const subDetailsString = button.dataset.subDetails || '{}';

        if (actionContainer && subName) {
            const newButton = document.createElement('button');
            newButton.className = 'add-related-sub-btn';
            newButton.dataset.subname = subName;
            newButton.dataset.subDetails = subDetailsString;
            newButton.textContent = '+ Add to Analysis';
            
            // REMOVED: The long style.cssText line is no longer needed.
            // The button's appearance is now handled entirely by the '.add-related-sub-btn' class in your CSS.

            actionContainer.replaceChild(newButton, button);
            destinationList.prepend(card);
        }
    }

    const subName = button.dataset.subname;
    if (!subName) {
        console.error("Missing subreddit name on the 'Remove' button.");
        return;
    }

    const checkbox = document.getElementById(`sub-${subName}`);
    if (checkbox) {
        checkbox.checked = false;
    }

    const countHeaderDiv = document.getElementById("count-header");
    if (countHeaderDiv) {
        countHeaderDiv.innerHTML = 'Updating analysis... <span class="loader-dots"></span>';
    }

    await runProblemFinder({ isUpdate: true });
}

async function fetchSubredditDetails(subredditName) {
    const MAX_RETRIES = 2;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const payload = { type: 'about', subreddit: subredditName };
            const response = await fetch(REDDIT_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.status >= 500) { throw new Error(`Server error: ${response.status}`); }
            if (!response.ok) {
                console.warn(`Subreddit r/${subredditName} not found or failed to load. Status: ${response.status}`);
                return null;
            }
            const data = await response.json();
            return data && data.data ? data.data : null;
        } catch (error) {
            console.error(`Attempt ${attempt} failed for r/${subredditName}:`, error.message);
            if (attempt === MAX_RETRIES) { return null; }
            await new Promise(r => setTimeout(r, 200 * attempt));
        }
    }
    return null;
}
function formatMemberCount(num) {
    if (num === null || num === undefined) return 'N/A';
    if (num >= 1000000) { return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm'; }
    if (num >= 1000) { return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k'; }
    return num.toLocaleString();
}
function getActivityLabel(activeUsers, totalMembers) {
    if (!totalMembers || totalMembers === 0 || activeUsers === null || activeUsers === undefined) { return '💤 Cool'; }
    const ratio = activeUsers / totalMembers;
    if (activeUsers > 5000 || (ratio > 0.01 && totalMembers > 1000)) { return '🔥 Hot'; }
    if (activeUsers < 10 || (totalMembers > 20000 && activeUsers < 50)) { return '💤 Cool'; }
    return '🌤️ Warm';
}
async function fetchAndRankSubreddits(subredditNames) {
    console.log(`AI suggested ${subredditNames.length} subreddits. Validating and ranking in batches...`);
    const BATCH_SIZE = 5;
    let allDetails = [];
    for (let i = 0; i < subredditNames.length; i += BATCH_SIZE) {
        const batchNames = subredditNames.slice(i, i + BATCH_SIZE);
        const batchPromises = batchNames.map(name => fetchSubredditDetails(name));
        const batchResults = await Promise.all(batchPromises);
        allDetails.push(...batchResults.filter(Boolean));
    }
    const mapDetails = (details) => ({
        name: details.display_name,
        members: details.subscribers,
        activityLabel: getActivityLabel(details.active_user_count, details.subscribers),
        description: details.public_description || ''
    });
    let strictResults = allDetails.filter(d => d.subscribers >= HARD_MIN_SUBSCRIBERS && (d.active_user_count || 0) >= HARD_MIN_ACTIVE_USERS).map(mapDetails);
    if (strictResults.length < 10) {
        console.log(`Strict filter yielded only ${strictResults.length} subs. Running lenient filter as a safety net.`);
        const lenientResults = allDetails.filter(d => d.subscribers >= LENIENT_MIN_SUBSCRIBERS && (d.active_user_count || 0) >= LENIENT_MIN_ACTIVE_USERS).map(mapDetails);
        const strictResultNames = new Set(strictResults.map(r => r.name));
        lenientResults.forEach(lenientSub => {
            if (!strictResultNames.has(lenientSub.name)) {
                strictResults.push(lenientSub);
            }
        });
    }
    const finalResults = strictResults.sort((a, b) => b.members - a.members);
    console.log(`Found ${finalResults.length} valid communities. Ready to display.`);
    return finalResults;
}
function renderSubredditChoicesHTML(subreddits) {
    // The color logic has been moved to CSS. These objects are no longer needed.
    return subreddits.map(sub => {
        // Extract the key word (e.g., "Hot", "Warm", "Cool") from the label.
        const activityState = sub.activityLabel.split(' ')[1];

        return `
            <div class="subreddit-choice">
                <input type="checkbox" id="sub-${sub.name}" value="${sub.name}" checked>
                <label for="sub-${sub.name}">
                    <span class="sub-name">r/${sub.name}</span>
                    <span class="sub-pills">
                        <span class="pill members-pill">${formatMemberCount(sub.members)}</span>
                        
                        <!-- The inline style is replaced with a data-attribute -->
                        <span class="pill activity-pill" data-activity="${activityState}">
                            ${sub.activityLabel}
                        </span>
                    </span>
                </label>
            </div>
        `;
    }).join('');
}
function displaySubredditChoices(rankedSubreddits) {
    const choicesDiv = document.getElementById('subreddit-choices');
    const loadMoreContainer = document.getElementById('load-more-container');
    if (!choicesDiv || !loadMoreContainer) return;

    loadMoreContainer.innerHTML = '';
    _allRankedSubreddits = rankedSubreddits;

    if (_allRankedSubreddits.length === 0) {
        // The class 'loading-text' is already used, which is good.
        // We will provide a specific style for it in the CSS.
        choicesDiv.innerHTML = '<p class="loading-text">No suitable communities found. Try a different group.</p>';
        return;
    }

    const initialToShow = _allRankedSubreddits.slice(0, 8);
    choicesDiv.innerHTML = renderSubredditChoicesHTML(initialToShow);

    if (_allRankedSubreddits.length > 8) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'load-more-subs-btn';
        loadMoreBtn.className = 'load-more-button'; // Added a class for styling
        loadMoreBtn.textContent = 'Load More Communities';
        
        // REMOVED: The style.cssText line is now handled by the .load-more-button class in CSS.

        loadMoreBtn.onclick = loadMoreSubreddits;
        loadMoreContainer.appendChild(loadMoreBtn);
    }
}

function loadMoreSubreddits() {
    const choicesDiv = document.getElementById('subreddit-choices');
    const loadMoreBtn = document.getElementById('load-more-subs-btn');
    if (!choicesDiv || !loadMoreBtn) return;
    const currentlyShownCount = choicesDiv.querySelectorAll('.subreddit-choice').length;
    const nextBatch = _allRankedSubreddits.slice(currentlyShownCount, currentlyShownCount + 8);
    if (nextBatch.length > 0) {
        const newChoicesHTML = renderSubredditChoicesHTML(nextBatch);
        choicesDiv.insertAdjacentHTML('beforeend', newChoicesHTML);
    }
    const newTotalShown = choicesDiv.querySelectorAll('.subreddit-choice').length;
    if (newTotalShown >= _allRankedSubreddits.length) {
        loadMoreBtn.remove();
    }
}
async function renderIncludedSubreddits(subreddits) {
    const container = document.getElementById('included-subreddits-container');
    if (!container) return;

    // The initial loading state now uses CSS classes
    container.innerHTML = `
        <h3 class="dashboard-section-title">Analysis Based On</h3>
        <div class="subreddit-tag-list">
            <p class="placeholder-text">Loading community details...</p>
        </div>
    `;

    try {
        const detailPromises = subreddits.map(sub => fetchSubredditDetails(sub));
        const detailsArray = await Promise.all(detailPromises);
        const tagsHTML = detailsArray.map((details, index) => {
            const subName = subreddits[index];
            const detailsString = details ? JSON.stringify(details).replace(/'/g, "&apos;") : "{}";

            if (!details) {
                // The error card now uses a modifier class for its unique styles
                return `
                    <div class="subreddit-tag-detailed subreddit-tag-detailed--error">
                        <div class="tag-header">r/${subName}</div>
                        <div class="tag-body">Details could not be loaded.</div>
                    </div>
                `;
            }

            const description = details.public_description || 'No public description available.';
            const members = formatMemberCount(details.subscribers);
            const [activityEmoji, activityText] = getActivityLabel(details.active_user_count, details.subscribers).split(' ');

            return `
                <div class="subreddit-tag-detailed">
                    <div>
                        <div class="tag-header">
                            <span class="tag-name">r/${subName}</span>
                            <span class="tag-activity">${activityEmoji} ${activityText}</span>
                        </div>
                        <p class="tag-description">
                            ${description.substring(0, 150)}${description.length > 150 ? '...' : ''}
                        </p>
                        <div class="tag-footer">
                            <span class="tag-members"><strong>${members}</strong> members</span>
                        </div>
                    </div>
                    <div class="tag-footer-action">
                        <button class="remove-sub-btn" data-subname="${subName}" data-sub-details='${detailsString}'>
                            Remove
                        </button>
                        <a href="https://www.reddit.com/r/${subName}" target="_blank" rel="noopener noreferrer" class="view-sub-btn">
                            View on Reddit
                        </a>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <h3 class="dashboard-section-title">Analysis Based On</h3>
            <div class="subreddit-tag-list">${tagsHTML}</div>
        `;
    } catch (error) {
        console.error("Error rendering subreddit details:", error);
        const tags = subreddits.map(sub => `<div class="subreddit-tag">r/${sub}</div>`).join('');
        container.innerHTML = `
            <h3 class="dashboard-section-title">Analysis Based On</h3>
            <div class="subreddit-tag-list">
                ${tags}
                <p class="error-message">Could not load community details.</p>
            </div>
        `;
    }
}
async function findRelatedSubredditsAI(analyzedSubsData, audienceContext) {
    const subNames = analyzedSubsData.map(d => d.name).join(', ');
    const prompt = `You are a Reddit discovery expert. A user is analyzing communities for the audience "${audienceContext}", including: ${subNames}. Your task is to suggest up to 20 NEW, related subreddits that explore NICHE or ADJACENT topics. Think outside the box. For example, if the user is analyzing 'weddingplanning', suggest 'bridezillas', 'weddingdress', 'honeymoons', or 'UKweddings' instead of just another general wedding sub. CRITICAL: Do NOT include any of the original subreddits in your suggestions: ${subNames}. Provide your response ONLY as a JSON object with a single key "subreddits", containing an array of subreddit names (without "r/").`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an expert Reddit community finder providing answers in strict JSON format." }, { role: "user", content: prompt }], temperature: 0.4, max_tokens: 300, response_format: { "type": "json_object" } };
    try {
        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!response.ok) throw new Error('OpenAI related subreddits request failed.');
        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        if (!parsed.subreddits || !Array.isArray(parsed.subreddits)) { throw new Error("AI response for related subs did not contain a 'subreddits' array."); }
        return parsed.subreddits;
    } catch (error) {
        console.error("Error finding related subreddits via AI:", error);
        return [];
    }
}
async function handleAddRelatedSubClick(event) {
    if (!event.target.classList.contains('add-related-sub-btn')) return;

    const button = event.target;
    const subName = button.dataset.subname;
    const subDetailsJSON = button.dataset.subDetails;

    if (!subName || !subDetailsJSON) {
        console.error("Missing subreddit data on the 'Add' button.");
        return;
    }

    const card = button.closest('.subreddit-tag-detailed');
    const destinationList = document.querySelector('#included-subreddits-container .subreddit-tag-list');

    if (card && destinationList) {
        const actionContainer = card.querySelector('.tag-footer-action');
        if (actionContainer) {
            const newButton = document.createElement('button');
            newButton.className = 'remove-sub-btn';
            newButton.dataset.subname = subName;
            newButton.dataset.subDetails = subDetailsJSON;
            newButton.textContent = 'Remove';
            
            // REMOVED: The long style.cssText line is no longer needed.
            // The button's appearance is now handled entirely by the '.remove-sub-btn' class in your CSS.

            actionContainer.replaceChild(newButton, button);
            destinationList.prepend(card);
        }
    }

    try {
        const countHeaderDiv = document.getElementById("count-header");
        if (countHeaderDiv) {
            countHeaderDiv.innerHTML = 'Adding new audiences... <span class="loader-dots"></span>';
        }

        const currentSubTags = document.querySelectorAll('#included-subreddits-container .tag-name');
        const currentSubs = Array.from(currentSubTags).map(tag => tag.textContent.replace('r/', '').trim());
        const newSubList = [...new Set([...currentSubs, subName])];

        const choicesDiv = document.getElementById('subreddit-choices');
        let checkbox = document.getElementById(`sub-${subName}`);
        if (!checkbox && choicesDiv) {
            const subDetails = JSON.parse(subDetailsJSON);
            const newChoiceHTML = renderSubredditChoicesHTML([subDetails]);
            choicesDiv.insertAdjacentHTML('beforeend', newChoiceHTML);
        }

        const allCheckboxes = document.querySelectorAll('#subreddit-choices input[type="checkbox"]');
        allCheckboxes.forEach(cb => {
            cb.checked = newSubList.includes(cb.value);
        });

        await runProblemFinder({
            isUpdate: true
        });
    } catch (error) {
        console.error("Failed to add related sub and re-run analysis:", error);
        alert("An error occurred while adding the community. Please try again.");
    }
}
async function renderAndHandleRelatedSubreddits(analyzedSubs) {
    const container = document.getElementById('similar-subreddits-container');
    if (!container) return;

    // The initial loading state now uses CSS classes
    container.innerHTML = `
        <h3 class="dashboard-section-title related-communities-title">Related Communities to Explore</h3>
        <div class="subreddit-tag-list">
            <p class="placeholder-text">Finding similar communities...</p>
        </div>
    `;

    container.removeEventListener('click', handleAddRelatedSubClick);
    container.addEventListener('click', handleAddRelatedSubClick);

    try {
        const detailPromises = analyzedSubs.map(sub => fetchSubredditDetails(sub));
        const detailsArray = await Promise.all(detailPromises);
        const validDetails = detailsArray.filter(Boolean).map(d => ({ name: d.display_name, description: d.public_description || '' }));
        if (validDetails.length === 0) throw new Error("Could not get details for source subreddits.");

        const relatedSubNames = await findRelatedSubredditsAI(validDetails, originalGroupName);
        const newSubNames = relatedSubNames.filter(name => !analyzedSubs.some(s => s.toLowerCase() === name.toLowerCase()));

        if (newSubNames.length === 0) {
            container.querySelector('.subreddit-tag-list').innerHTML = `<p class="placeholder-text">No new related communities were found.</p>`;
            return;
        }

        const rankedRelatedSubs = await fetchAndRankSubreddits(newSubNames);
        if (rankedRelatedSubs.length === 0) {
            container.querySelector('.subreddit-tag-list').innerHTML = `<p class="placeholder-text">No suitable communities found after validation.</p>`;
            return;
        }

        const tagsHTML = rankedRelatedSubs.slice(0, 10).map(sub => {
            const subDetailsString = JSON.stringify(sub).replace(/'/g, "&apos;");
            const members = formatMemberCount(sub.members);
            const [activityEmoji, activityText] = sub.activityLabel.split(' ');
            const description = sub.description.trim() ? sub.description : `A community for discussions and content related to r/${sub.name}.`;
            
            return `
                <div class="subreddit-tag-detailed">
                    <div>
                        <div class="tag-header">
                            <span class="tag-name">r/${sub.name}</span>
                            <span class="tag-activity">${activityEmoji} ${activityText}</span>
                        </div>
                        <p class="tag-description">
                            ${description.substring(0, 150)}${description.length > 150 ? '...' : ''}
                        </p>
                        <div class="tag-footer">
                            <span class="tag-members"><strong>${members}</strong> members</span>
                        </div>
                    </div>
                    <div class="tag-footer-action">
                        <button class="add-related-sub-btn" data-subname="${sub.name}" data-sub-details='${subDetailsString}'>
                            + Add to Analysis
                        </button>
                        <a href="https://www.reddit.com/r/${sub.name}" target="_blank" rel="noopener noreferrer" class="view-sub-btn">
                            View on Reddit
                        </a>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelector('.subreddit-tag-list').innerHTML = tagsHTML;
    } catch (error) {
        console.error("Error in renderAndHandleRelatedSubreddits:", error);
        container.querySelector('.subreddit-tag-list').innerHTML = `<p class="error-message">Could not load related community suggestions.</p>`;
    }
}

const briefCache = new Map();

async function generateAndRenderBrandBrief(itemName, itemType) {
    const isBrand = itemType === 'brands';
    const targetPanel = document.getElementById(isBrand ? 'brand-detail-panel' : 'product-detail-panel');
    const overlay = document.getElementById('brief-overlay');

    if (!targetPanel || !overlay) {
        console.error("Brandscape detail panels or overlay not found in the DOM.");
        return;
    }

    document.querySelectorAll('.custom-side-panel.visible').forEach(p => p.classList.remove('visible'));

    targetPanel.innerHTML = '<div class="brief-content"><p class="loading-text">Analyzing... <span class="loader-dots"></span></p></div>';
    targetPanel.classList.add('visible');
    overlay.classList.add('visible');

    const close = () => {
        targetPanel.classList.remove('visible');
        overlay.classList.remove('visible');
    };
    overlay.onclick = close;

    if (briefCache.has(itemName)) {
        targetPanel.innerHTML = briefCache.get(itemName);
        if (targetPanel.querySelector('#brand-momentum-chart')) {
            const chartData = JSON.parse(targetPanel.querySelector('#brand-momentum-chart-data').textContent);
            renderBrandMomentumChart(chartData);
        }
        targetPanel.querySelector('.context-close-btn')?.addEventListener('click', close);
        return;
    }
    
    const postsForAnalysis = (window._entityData?.[itemType]?.[itemName]?.posts || []);
    if (postsForAnalysis.length < 3) {
        const htmlContent = `
            <div class="brief-content">
                <button class="context-close-btn">×</button>
                <h3 class="brief-header">Analysis for: ${itemName}</h3>
                <p class="error-message" style="text-align: center; padding: 2rem;">
                    Not enough mentions found (minimum 3 required) to generate a detailed brief.
                </p>
            </div>`;
        targetPanel.innerHTML = htmlContent;
        targetPanel.querySelector('.context-close-btn').addEventListener('click', close);
        return;
    }

    try {
        const top75Posts = postsForAnalysis.slice(0, 75);
        const topPostsText = top75Posts.map(p => `"${p.data.title || ''} - ${p.data.selftext || p.data.body || ''}"`).join('\n');
    

        const prompt = isBrand ?
            `You are an expert market research analyst creating a competitive brief for "${itemName}" based on user comments from the "${originalGroupName}" community. Analyze the provided text to generate insights.

            Respond ONLY with a valid JSON object with the following keys:
            1.  "what_it_is": A simple, one-line explanation of what the brand/product is. CRITICAL: Spell out any acronyms.
            2.  "use_case": A single sentence describing the primary job people hire this product for.
            3.  "loves": An array of 3 bullet points of key strengths. CRITICAL: Inject real, short user phrases from the text into these points (e.g., "Users rave about its ability to 'ship code fixes in seconds'").
            4.  "hates": An array of 3 bullet points. CRITICAL: Frame each pain point as an opportunity (e.g., "Endless scrolling UX → ripe for a plugin/UX layer fix.").
            5.  "verdict": A single, insightful sentence summarizing the brand's position in the market (e.g., "Loved for versatility, but vulnerable on transparency. A sticky but disruptable brand.").` :
            `You are a market validation analyst creating a category analysis for "${itemName}" based on user comments from the "${originalGroupName}" community. Analyze the provided text to generate insights.

            Respond ONLY with a valid JSON object with the following keys:
            1.  "what_it_is": A simple, one-line explanation of what this product category is. CRITICAL: Spell out any acronyms.
            2.  "job_to_be_done": A single sentence describing the fundamental goal people want to achieve with this type of product.
            3.  "table_stakes": An array of 3 bullet points describing the absolute must-have features or benefits for any product in this category.
            4.  "disruption_opportunities": An array of 3 bullet points describing common frustrations or unsolved problems across the entire category that a new product could solve.`;

        const openAIParams = { model: "gpt-4o", messages: [{ role: "system", content: "You are an analyst providing structured JSON output." }, { role: "user", content: `${prompt}\n\nUser Comments:\n${topPostsText}` }], temperature: 0.2, response_format: { "type": "json_object" } };

        const briefPromise = fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) }).then(res => res.json());

        const selectedSubreddits = Array.from(document.querySelectorAll('#subreddit-choices input:checked')).map(cb => cb.value);
        const subredditQueryString = selectedSubreddits.map(sub => `subreddit:${sub}`).join(' OR ');

        const trendPromise = isBrand ? fetchSentimentTrendData(itemName, subredditQueryString) : Promise.resolve(null);

        const [briefResult, trendResult] = await Promise.all([briefPromise, trendPromise]);

        const parsed = JSON.parse(briefResult.openaiResponse);

        let htmlContent = '';
        if (isBrand) {
            const latestSentiment = trendResult && trendResult.length > 0 ? trendResult[trendResult.length - 1]?.positivePercentage : 0;
            const trendlineText = latestSentiment ? `Trendline: Positive sentiment is currently at ${latestSentiment}%.` : "Not enough data for a sentiment trend.";
            const mentionCount = window._entityData?.[itemType]?.[itemName]?.count || 0;

            htmlContent = `
                <div class="brief-content">
                    <button class="context-close-btn">×</button>
                    <h3 class="brief-header">Competitive Brief: ${itemName}</h3>
                    
                    <!-- === NEW SECTION ADDED HERE === -->
                    <div class="brief-section">
                        <h4 class="brief-section-title"><span class="brief-section-icon">ℹ️</span>What It Is</h4>
                        <p class="brief-text">${parsed.what_it_is}</p>
                    </div>

                    <div class="brief-section">
                        <h4 class="brief-section-title"><span class="brief-section-icon">📈</span>Brand Momentum</h4>
                        <div id="brand-momentum-chart"></div>
                        <script type="application/json" id="brand-momentum-chart-data">${JSON.stringify(trendResult)}</script>
                        <p class="brief-ai-insight">Based on ${mentionCount} mentions. ${trendlineText}</p>
                    </div>
                    <div class="brief-section">
                        <h4 class="brief-section-title"><span class="brief-section-icon">💡</span>Primary Use Case</h4>
                        <p class="brief-text">${parsed.use_case}</p>
                    </div>
                    <div class="brief-section">
                        <h4 class="brief-section-title"><span class="brief-section-icon">🟢</span>What People Love</h4>
                        <ul class="brief-list loves">${parsed.loves.map(item => `<li>${item}</li>`).join('')}</ul>
                    </div>
                    <div class="brief-section">
                        <h4 class="brief-section-title"><span class="brief-section-icon">🔴</span>Pain Points & Opportunities</h4>
                        <ul class="brief-list hates">${parsed.hates.map(item => `<li>${item}</li>`).join('')}</ul>
                    </div>
                    <div class="brief-verdict">
                        <p><strong>🔮 Verdict:</strong> ${parsed.verdict}</p>
                    </div>
                </div>`;
        } else { // Generic Product
            htmlContent = `
                <div class="brief-content">
                    <button class="context-close-btn">×</button>
                    <h3 class="brief-header">Category Analysis: ${itemName}</h3>
                    
                    <!-- === NEW SECTION ADDED HERE === -->
                    <div class="brief-section">
                        <h4 class="brief-section-title"><span class="brief-section-icon">ℹ️</span>What It Is</h4>
                        <p class="brief-text">${parsed.what_it_is}</p>
                    </div>
                    
                    <div class="brief-section">
                        <h4 class="brief-section-title"><span class="brief-section-icon">💡</span>Primary Job-to-be-Done</h4>
                        <p class="brief-text">${parsed.job_to_be_done}</p>
                    </div>
                    <div class="brief-section">
                        <h4 class="brief-section-title"><span class="brief-section-icon">🔵</span>Table Stakes (Must-Haves)</h4>
                        <ul class="brief-list stakes">${parsed.table_stakes.map(item => `<li>${item}</li>`).join('')}</ul>
                    </div>
                    <div class="brief-section">
                        <h4 class="brief-section-title"><span class="brief-section-icon">🔴</span>Disruption Opportunities</h4>
                        <ul class="brief-list hates">${parsed.disruption_opportunities.map(item => `<li>${item}</li>`).join('')}</ul>
                    </div>
                </div>`;
        }

        targetPanel.innerHTML = htmlContent;
        briefCache.set(itemName, htmlContent);

        if (isBrand && trendResult && trendResult.length > 0) {
            renderBrandMomentumChart(trendResult);
        }

        targetPanel.querySelector('.context-close-btn').addEventListener('click', close);

    } catch (error) {
        console.error(`Failed to generate brief for ${itemName}:`, error);
        targetPanel.innerHTML = `<div class="brief-content"><button class="context-close-btn">×</button><p class="error-message">Could not generate brief for ${itemName}.</p></div>`;
        targetPanel.querySelector('.context-close-btn').addEventListener('click', close);
    }
}

// =================================================================================
// === REPLACEMENT FUNCTION: renderBrandMomentumChart (V2 - With Contextual Tooltip) ===
// =================================================================================
function renderBrandMomentumChart(data) {
    if (typeof Highcharts === 'undefined' || !data || data.length === 0) {
        // Display a message if no data is available
        const chartContainer = document.getElementById('brand-momentum-chart');
        if (chartContainer) {
            chartContainer.innerHTML = '<p class="chart-placeholder-text">Not enough data to generate a momentum chart.</p>';
        }
        return;
    }

    Highcharts.chart('brand-momentum-chart', {
        chart: { type: 'line', backgroundColor: 'transparent' },
        title: { text: null },
        credits: { enabled: false },
        xAxis: { categories: data.map(d => d.period), labels: { style: { color: '#555' } } },
        yAxis: { title: { text: '% Positive', style: { color: '#555' } }, min: 0, max: 100, labels: { style: { color: '#555' } } },
        legend: { enabled: false },
        series: [{
            name: '% Positive Sentiment',
            data: data.map(d => ({
                y: d.positivePercentage,
                context: d.context // Pass context to each point
            })),
            color: '#00a5ce'
        }],
        // --- KEY CHANGE: Replaced pointFormat with a more powerful formatter function ---
        tooltip: {
            useHTML: true,
            backgroundColor: '#FFFFFF',
            borderColor: '#E0E0E0',
            borderWidth: 1,
            padding: 12,
            shape: 'square',
            shadow: { color: 'rgba(0, 0, 0, 0.1)', opacity: 1, offsetX: 1, offsetY: 2 },
            formatter: function() {
                const context = this.point.options.context;
                if (!context) return 'No context available.';

                let html = `<div style="font-family: sans-serif; font-size: 14px;">`;
                html += `<b>${this.key}</b><br/>`;
                html += `<span style="color: ${this.series.color};">●</span> ${this.series.name}: <b>${this.y}%</b>`;
                html += `<hr style="margin: 6px 0; border-color: #f0f0f0;">`;
                
                // === THIS IS THE FIX ===
                // Added 'white-space: normal;' and 'overflow-wrap: break-word;' to the style attribute.
                html += `<div style="font-size: 12px; max-width: 250px; white-space: normal; overflow-wrap: break-word;">`;

                if (context.positive_theme) {
                    html += `<div style="margin-bottom: 5px;"><span style="color: #28a745;">🟢</span> <strong>Positive:</strong> ${context.positive_theme}</div>`;
                }
                if (context.negative_theme) {
                    html += `<div style="margin-bottom: 5px;"><span style="color: #dc3545;">🔴</span> <strong>Critical:</strong> ${context.negative_theme}</div>`;
                }
                html += `<div style="margin-top: 8px; font-style: italic;"><strong>Verdict:</strong> ${context.verdict}</div>`;

                html += `</div></div>`;
                return html;
            }
        }
    });
}

function renderSentimentScore(positiveCount, negativeCount) { const container = document.getElementById('sentiment-score-container'); if(!container) return; const total = positiveCount + negativeCount; if (total === 0) { container.innerHTML = ''; return; }; const positivePercent = Math.round((positiveCount / total) * 100); const negativePercent = 100 - positivePercent; container.innerHTML = `<h3 class="dashboard-section-title">Sentiment Score</h3><div id="sentiment-score-bar"><div class="score-segment positive" style="width:${positivePercent}%">${positivePercent}% Positive</div><div class="score-segment negative" style="width:${negativePercent}%">${negativePercent}% Negative</div></div>`; }

// =================================================================================
// === REPLACEMENT FUNCTION: fetchSentimentTrendData (V4 - With Context & Corrected Axis) ===
// =================================================================================
async function fetchSentimentTrendData(brandName, subredditQueryString) {
    let searchTerms = [`"${brandName}"`];
    if (brandName.toLowerCase() === 'openai') {
        searchTerms.push('"gpt-4o"', '"chatgpt"', '"gpt-5"');
    }

    const revisedTimePeriods = [
        { label: 'Past 6 Mos', value: '6month' },
        { label: 'Past 3 Mos', value: '3month' },
        { label: 'Last 30 Days', value: 'month' },
        { label: 'Last 7 Days', value: 'week' },
    ];

    const fetchPromises = revisedTimePeriods.map(period =>
        fetchMultipleRedditDataBatched(subredditQueryString, searchTerms, 50, period.value)
    );
    const results = await Promise.allSettled(fetchPromises);

    const trendData = [];

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const periodLabel = revisedTimePeriods[i].label;

        if (result.status === 'fulfilled' && result.value.length > 0) {
            const uniquePosts = deduplicatePosts(result.value);
            const sentimentResults = await classifySentimentWithAI(uniquePosts);
            
            // --- KEY CHANGE 1: Generate context for this time period ---
            const contextSummary = await generateSentimentContextWithAI(uniquePosts, brandName);

            const positiveMentions = sentimentResults.filter(s => s === 'Positive').length;
            const negativeMentions = sentimentResults.filter(s => s === 'Negative').length;
            const totalMentions = positiveMentions + negativeMentions;
            const positivePercentage = totalMentions > 0 ? Math.round((positiveMentions / totalMentions) * 100) : 50;

            trendData.push({
                period: periodLabel,
                positivePercentage: positivePercentage,
                context: contextSummary // Attach the context to the data point
            });
        } else {
            console.warn(`Could not fetch data for period: ${periodLabel}`);
        }
    }

    // --- KEY CHANGE 2: REMOVED .reverse() TO FIX X-AXIS ORDER ---
    // The data is now naturally ordered from oldest to newest.
    return trendData;
}

async function generateAndRenderConstellation(items) {
    console.log("[Highcharts] Starting full generation process with batching strategy...");
    const prioritizedItems = items.sort((a, b) => (b.data.ups || 0) - (a.data.ups || 0)).slice(0, 60);
    console.log(`[Highcharts] Prioritized top ${prioritizedItems.length} items for signal extraction.`);

    const BATCH_SIZE = 10;
    const batchPromises = [];

    for (let i = 0; i < prioritizedItems.length; i += BATCH_SIZE) {
        const batch = prioritizedItems.slice(i, i + BATCH_SIZE);
        const batchStartIndex = i;

        const extractionPrompt = `You are a market research analyst. From the following list of user comments, extract up to 5 quotes that express a strong purchase intent, an unsolved problem, or a significant pain point. Focus ONLY on phrases that directly mention: Willingness to pay, Frustration with a lack of a tool, A specific, unmet need, Mentions of high cost, Comparisons to other products, or A sense of urgency. CRITICAL: IGNORE general complaints or non-commercial emotional support. Here are the comments:\n${batch.map((item, index) => `${index}. ${((item.data.body || item.data.selftext || '')).substring(0, 1000)}`).join('\n---\n')}\nRespond ONLY with a valid JSON object: {"signals": [{"quote": "The extracted quote.", "source_index": 4}]}`;

        const apiCallPromise = fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                openaiPayload: {
                    model: "gpt-4o-mini",
                    messages: [{ role: "system", content: "You are a precise data extraction engine that outputs only valid JSON." }, { role: "user", content: extractionPrompt }],
                    temperature: 0.1,
                    max_tokens: 1500,
                    response_format: { "type": "json_object" }
                }
            })
        }).then(response => {
            if (!response.ok) throw new Error(`Batch from index ${batchStartIndex} failed.`);
            return response.json();
        }).then(data => {
            const parsedExtraction = JSON.parse(data.openaiResponse);
            if (parsedExtraction.signals && Array.isArray(parsedExtraction.signals)) {
                return parsedExtraction.signals.map(signal => ({
                    quote: signal.quote,
                    sourceItem: prioritizedItems[batchStartIndex + signal.source_index]
                })).filter(s => s.sourceItem);
            }
            return [];
        }).catch(error => {
            console.error(`[Highcharts] Error processing batch starting at index ${batchStartIndex}:`, error);
            return [];
        });
        batchPromises.push(apiCallPromise);
    }
    
    const results = await Promise.allSettled(batchPromises);
    let rawSignals = [];
    results.forEach(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            rawSignals.push(...result.value);
        }
    });

    console.log(`[Highcharts] AI extracted a total of ${rawSignals.length} high-quality signals from all batches.`);
    if (rawSignals.length === 0) {
        renderHighchartsBubbleChart([]);
        return;
    }

    const enrichedSignals = [];
    const validCategories = ["DemandSignals", "WillingnessToPay", "Frustration", "SubstituteComparisons", "Urgency", "CostConcerns"];
    for (const rawSignal of rawSignals) {
        try {
            const enrichmentPrompt = `You are a market research analyst. For the quote below, provide a short summary of the user's core problem and classify it into the MOST relevant category. Here are the categories: [${validCategories.join(', ')}]. Quote: "${rawSignal.quote}" Provide a JSON object with: 1. "problem_theme": A short, 4-5 word summary of the core problem. 2. "category": Classify into ONE of the categories. Respond ONLY with a valid JSON object.`;
            const enrichmentResponse = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a data enrichment engine that outputs only valid JSON." }, { role: "user", content: enrichmentPrompt }], temperature: 0.2, max_tokens: 250, response_format: { "type": "json_object" } } }) });
            if (enrichmentResponse.ok) {
                const enrichmentData = await enrichmentResponse.json();
                const parsedEnrichment = JSON.parse(enrichmentData.openaiResponse);
                if (parsedEnrichment.problem_theme && parsedEnrichment.category) {
                    enrichedSignals.push({ ...rawSignal, ...parsedEnrichment, source: rawSignal.sourceItem.data });
                } else { console.warn("Skipping a signal due to missing fields in AI enrichment response:", parsedEnrichment); }
            } else { console.warn(`Failed to enrich a signal. Status: ${enrichmentResponse.status}`); }
        } catch (error) { console.error("CRITICAL ERROR during individual signal enrichment:", error); }
    }

    console.log(`[Highcharts] AI successfully enriched ${enrichedSignals.length} signals. Rendering chart.`);
    renderHighchartsBubbleChart(enrichedSignals);
}

async function runConstellationAnalysis(subredditQueryString, demandSignalTerms, timeFilter) {
    console.log("--- Starting Delayed Highcharts Chart Analysis (in background) ---");
    try {
        const demandSignalPosts = await fetchMultipleRedditDataBatched(subredditQueryString, demandSignalTerms, 40, timeFilter, false);
        const postIds = demandSignalPosts.sort((a,b) => (b.data.ups || 0) - (a.data.ups || 0)).slice(0, 40).map(p => p.data.id);
        const highIntentComments = await fetchCommentsForPosts(postIds);
        const allItems = [...demandSignalPosts, ...highIntentComments];
        await generateAndRenderConstellation(allItems);
    } catch (error) {
        console.error("Highcharts analysis failed in the background:", error);
        renderHighchartsBubbleChart([]);
    } finally {
        console.log("--- Highcharts Analysis Complete. ---");
    }
}

function renderHighchartsBubbleChart(signals) {
    const container = document.getElementById('constellation-map-container');
    const panelContent = document.getElementById('bubble-content'); // Use the new ID

    if (typeof Highcharts === 'undefined') {
        console.error("Highcharts is not loaded. Please ensure the Highcharts script tags are in your HTML.");
        if (panelContent) panelContent.innerHTML = `<div class="panel-placeholder" style="color: red;">Chart Error: Highcharts library not found.</div>`;
        return;
    }

    if (!signals || signals.length === 0) {
        if (panelContent) panelContent.innerHTML = `<div class="panel-placeholder">No strong purchase signals found.<br/>Try different communities.</div>`;
        Highcharts.chart(container, { chart: { type: 'packedbubble' }, title: { text: '' }, series: [] });
        return;
    }

    const aggregatedSignals = {};
    signals.forEach(signal => {
        if (!signal.problem_theme || !signal.source || !signal.category) return;
        const theme = signal.problem_theme.trim();
        if (!aggregatedSignals[theme]) {
            aggregatedSignals[theme] = { ...signal, quotes: [], frequency: 0, totalUpvotes: 0 };
        }
        aggregatedSignals[theme].quotes.push(signal.quote);
        aggregatedSignals[theme].frequency++;
        aggregatedSignals[theme].totalUpvotes += (signal.source.ups || 0);
    });

    const groupedByCategory = new Map();
    Object.values(aggregatedSignals).forEach(d => {
        const category = d.category.replace(/([A-Z])/g, ' $1').trim();
        if (!groupedByCategory.has(category)) {
            groupedByCategory.set(category, []);
        }
        groupedByCategory.get(category).push({
            name: d.problem_theme,
            value: d.frequency,
            quote: d.quotes[0],
            source: d.source
        });
    });

    const chartSeries = Array.from(groupedByCategory, ([name, data]) => ({ name, data }));

    Highcharts.chart(container, {
        chart: {
            type: 'packedbubble',
            backgroundColor: 'transparent'
        },
        title: {
            text: null
        },
        credits: {
            enabled: false
        },
        tooltip: {
            useHTML: true,
            backgroundColor: '#FFFFFF',
            borderColor: '#E0E0E0',
            borderWidth: 1,
            shadow: {
                color: 'rgba(0, 0, 0, 0.15)',
                offsetX: 0,
                offsetY: 3,
                opacity: 1,
                width: 10
            },
            style: {
                color: '#333333',
                fontFamily: "'Plus Jakarta Sans', sans-serif"
            },
            formatter: function () {
                return `
                    <div style="font-weight: bold; font-size: 1rem; margin-bottom: 8px; border-bottom: 1px solid #E0E0E0; padding-bottom: 6px;">${this.point.name}</div>
                    <div style="font-size: 0.9rem; margin-bottom: 8px; max-width: 300px; white-space: normal;">“${this.point.options.quote}”</div>
                    <a href="https://www.reddit.com${this.point.options.source.permalink}" target="_blank" rel="noopener noreferrer" style="font-size: 0.8rem; color: #555555; text-decoration: none;">r/${this.point.options.source.subreddit} | 👍 ${this.point.options.source.ups.toLocaleString()}</a>
                `;
            }
        },
        plotOptions: {
            packedbubble: {
                minSize: '35%',
                maxSize: '140%',
                zMin: 0,
                zMax: 1000,
                layoutAlgorithm: {
                    splitSeries: true,
                    gravitationalConstant: 0.05,
                    seriesInteraction: false, 
                    dragBetweenSeries: true,
                    parentNodeLimit: true,
                    parentNodeOptions: {
                        bubblePadding: 3
                    }
                },
                dataLabels: {
                    enabled: true,
                    useHTML: true,
                    style: {
                        color: 'black',
                        textOutline: 'none',
                        fontWeight: 'normal',
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        textAlign: 'center'
                    },
                    formatter: function() {
                        const radius = this.point.marker.radius;
                        if (this.point.name.length * 6 > radius * 1.8) {
                             return null;
                        }
                        const fontSize = Math.max(8, radius / 3.5);
                        return `<div style="font-size: ${fontSize}px;">${this.point.name}</div>`;
                    }
                },
                // --- NEW FEATURE: Click Event Handler ---
                point: {
                    events: {
                        click: function() {
                            // isParentNode is true for the large category bubbles
                            if (!this.isParentNode) {
                                const bubbleContent = document.getElementById('bubble-content');
                                if (bubbleContent) {
                                    const { name, quote, source } = this.options;
                                    bubbleContent.innerHTML = `
                                    <h4 class="bubble-detail-title">${name}</h4>
                                    <p class="bubble-detail-quote">“${quote}”</p>
                                    
                                    <!-- This is the new element for the metadata -->
                                    <p class="bubble-detail-meta">r/${source.subreddit} | 👍 ${source.ups.toLocaleString()}</p>
                                    
                                    <!-- This is the modified link with only the button text -->
                                    <a href="https://www.reddit.com${source.permalink}" target="_blank" rel="noopener noreferrer" class="bubble-detail-source">
                                        View on Reddit
                                    </a>
                                `;
                                
                                }
                            }
                        }
                    }
                }
            }
        },
        series: chartSeries
    });
    
    if (panelContent) {
        panelContent.innerHTML = `<div class="panel-placeholder">Click a bubble to see details.</div>`;
    }
}

// =================================================================================
// === REVISED FUNCTION V2: AI MINDSET SUMMARY WITH DESCRIPTIVE POINTS ===
// =================================================================================

async function generateAndRenderMindsetSummary(posts, audienceContext) {
    // --- Find all your target Webflow elements ---
    const container = document.getElementById('mindset-summary-container');
    const archetypeHeadingEl = document.getElementById('archetype-heading');
    const archetypeDescEl = document.getElementById('archetype-d');
    const characteristicsEl = document.getElementById('characteristics-d');
    const rejectsEl = document.getElementById('reject-d');

    // Exit if the required elements aren't on the page
    if (!container || !archetypeHeadingEl || !archetypeDescEl || !characteristicsEl || !rejectsEl) {
        console.error("One or more target mindset elements are missing from the page. Aborting render.");
        if (container) container.innerHTML = '';
        return;
    }

    // --- Set a loading state ---
    archetypeHeadingEl.textContent = 'Analyzing...';
    archetypeDescEl.textContent = '';
    characteristicsEl.innerHTML = '<p class="loading-text">Extracting core values...</p>';
    rejectsEl.innerHTML = '<p class="loading-text">Identifying dislikes...</p>';

    try {
        const topPostsText = posts.slice(0, 40).map(p => `Title: ${p.data.title || ''}\nContent: ${p.data.selftext || p.data.body || ''}`.substring(0, 800)).join('\n---\n');

        // --- 1. THE NEW PROMPT ---
        // This prompt now asks for an array of objects, each with a "title" and a "description".
        const prompt = `You are an expert market psychologist specializing in the "${audienceContext}" community. Analyze the following Reddit posts to create a concise "Audience Mindset" summary.

        Respond ONLY with a valid JSON object with the following keys:
        1. "archetype": A short, 2-3 word evocative name for this audience (e.g., "The Pragmatic Dreamer").
        2. "summary": A 1-2 sentence summary explaining the core motivation of this archetype.
        3. "values": An array of 3 objects. Each object must have two keys: "title" (a short, 3-4 word summary of the value) and "description" (a single sentence explaining the title).
        4. "rejects": An array of 3 objects. Each object must have two keys: "title" (a short, 3-4 word summary of the rejection) and "description" (a single sentence explaining the title).

        Example for "values" format:
        "values": [
            { "title": "Value in Action, Not Theory", "description": "They respect builders, not just talkers, valuing demonstrable progress over ideas." },
            { "title": "Authenticity is Currency", "description": "They value transparent accounts of failure as much as stories of success." }
        ]

        Posts:
        ${topPostsText}`;

        const openAIParams = {
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are an expert market psychologist who provides structured analysis of audience mindsets in a strict JSON format." },
                { role: "user", content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 600,
            response_format: { "type": "json_object" }
        };

        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        
        if (!response.ok) throw new Error('Mindset analysis API call failed.');

        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        const { archetype, summary, values, rejects } = parsed;

        // --- 2. THE NEW RENDERING LOGIC ---
        // This now populates the elements based on the new "title" and "description" structure.
        archetypeHeadingEl.textContent = archetype;
        archetypeDescEl.textContent = summary;
        
        if (values && values.length > 0) {
            // Create a list item for each object, making the title bold.
            const characteristicsHTML = '<ul>' + values.map(item => 
                `<li><strong>${item.title}:</strong> ${item.description}</li>`
            ).join('') + '</ul>';
            characteristicsEl.innerHTML = characteristicsHTML;
        } else {
             characteristicsEl.innerHTML = '<p>Could not identify key characteristics.</p>';
        }

        if (rejects && rejects.length > 0) {
            const rejectsHTML = '<ul>' + rejects.map(item => 
                `<li><strong>${item.title}:</strong> ${item.description}</li>`
            ).join('') + '</ul>';
            rejectsEl.innerHTML = rejectsHTML;
        } else {
            rejectsEl.innerHTML = '<p>Could not identify dislikes.</p>';
        }

    } catch (error) {
        console.error("Mindset summary generation error:", error);
        archetypeHeadingEl.textContent = 'Analysis Failed';
        archetypeDescEl.textContent = 'Could not generate the audience mindset summary. Please try again.';
        characteristicsEl.innerHTML = '';
        rejectsEl.innerHTML = '';
    }
}
// =================================================================================
// === NEW FUNCTION: AI STRATEGIC PILLARS (GOALS & FEARS) ===
// ================================================================================
async function generateAndRenderStrategicPillars(posts, audienceContext) {
    const goalsContainer = document.getElementById('goals-pillar');
    const fearsContainer = document.getElementById('fears-pillar');
    if (!goalsContainer || !fearsContainer) return;

    // Set initial loading states
    goalsContainer.innerHTML = `<p class="placeholder-text">Analyzing goals...</p>`;
    fearsContainer.innerHTML = `<p class="placeholder-text">Analyzing fears...</p>`;

    try {
        const topPostsText = posts.slice(0, 40).map(p => `Title: ${p.data.title || ''}
\nContent: ${p.data.selftext || p.data.body || ''}`.substring(0, 800)).join('\n---\n');

        const prompt = `You are an expert market psychologist specializing in the "${audienceContext}" community. Based on the following user posts, identify their 3 core "Ultimate Goals" and their 3 "Greatest Fears". Respond ONLY with a valid JSON object with two keys: "goals" and "fears", holding an array of 3 short, insightful strings. Posts:\n${topPostsText}`;

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [{
                role: "system",
                content: "You are an expert market psychologist providing concise lists of audience goals and fears in strict JSON format."
            }, {
                role: "user",
                content: prompt
            }],
            temperature: 0.3,
            max_tokens: 400,
            response_format: { "type": "json_object" }
        };

        const response = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: openAIParams })
        });

        if (!response.ok) throw new Error('Strategic pillars API call failed.');

        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        const { goals, fears } = parsed;

        const createCustomListHTML = (items) => {
            if (!items || items.length === 0) return '';
            return items.map((item, index) => {
                const isLastItem = index === items.length - 1;
                return `
                    <div class="pillar-item">
                        <p class="pillar-item-text">${item}</p>
                        ${!isLastItem ? '<div class="pillar-separator"></div>' : ''}
                    </div>
                `;
            }).join('');
        };

        // Render Goals
        if (goals && goals.length > 0) {
            goalsContainer.innerHTML = createCustomListHTML(goals);
        } else {
            goalsContainer.innerHTML = `<p class="placeholder-text">Could not identify distinct goals.</p>`;
        }

        // Render Fears
        if (fears && fears.length > 0) {
            fearsContainer.innerHTML = createCustomListHTML(fears);
        } else {
            fearsContainer.innerHTML = `<p class="placeholder-text">Could not identify distinct fears.</p>`;
        }

    } catch (error) {
        console.error("Strategic pillars generation error:", error);
        // Replaced inline style with a dedicated error class
        goalsContainer.innerHTML = `<p class="placeholder-text placeholder-text--error">Analysis failed.</p>`;
        fearsContainer.innerHTML = `<p class="placeholder-text placeholder-text--error">Analysis failed.</p>`;
    }
}
// =================================================================================
// === NEW FUNCTION: AI GENERATIVE PROMPT ===
// =================================================================================

async function generateAndRenderAIPrompt(posts, audienceContext) {
    const container = document.getElementById('ai-prompt-container');
    if (!container) return;

    container.innerHTML = `<h3 class="dashboard-section-title">Generative AI Prompt</h3><p class="loading-text">Crafting a tone of voice prompt...</p>`;

    try {
        const topPostsText = posts.slice(0, 30).map(p => `"${p.data.title || ''} ${getFirstTwoSentences(p.data.selftext || p.data.body || '')}"`).join('\n');

        const prompt = `You are a world-class brand strategist and copywriter. Analyze the following sample of posts from the "${audienceContext}" community. Your task is to create a "Generative AI Prompt" that a marketer could use to write content in the authentic voice of this audience.

        Based on the text, identify the following:
        - **tone:** 3-4 descriptive adjectives for the overall emotional tone.
        - **vocabulary:** 3-5 key slang words, acronyms, or insider phrases they use.
        - **style:** 2-3 bullet points describing their writing style (e.g., sentence structure, use of humor, etc.).
        - **sentiment:** 1 sentence describing their general outlook (e.g., are they generally optimistic, critical, helpful?).

        Respond ONLY with a valid JSON object with the keys "tone", "vocabulary", "style", and "sentiment".

        Sample Posts:\n${topPostsText}`;

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a brand strategist who creates structured JSON output for AI prompts." },
                { role: "user", content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 500,
            response_format: { "type": "json_object" }
        };

        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        
        if (!response.ok) throw new Error('AI prompt generation API call failed.');

        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        
        const promptText = `Write a blog post about [YOUR TOPIC] for an audience of ${audienceContext}.

Your writing should adopt the following characteristics:

**TONE:**
- ${parsed.tone.join('\n- ')}

**VOCABULARY:**
- Use terms like: ${parsed.vocabulary.join(', ')}

**STYLE:**
- ${parsed.style.join('\n- ')}

**SENTIMENT:**
- ${parsed.sentiment}
`;

        container.innerHTML = `
            <h3 class="dashboard-section-title">Generative AI Prompt</h3>
            <div class="ai-prompt-content" id="ai-prompt-text">${promptText}</div>
        `;

    } catch (error) {
        console.error("AI prompt generation error:", error);
        container.innerHTML = `
            <h3 class="dashboard-section-title">Generative AI Prompt</h3>
            <p class="loading-text" style="color: red;">Could not generate AI prompt.</p>
        `;
    }
}
// =================================================================================
// === NEW FUNCTION: AI KEYWORD OPPORTUNITIES ===
// =================================================================================

async function generateAndRenderKeywords(posts, audienceContext) {
    const container = document.getElementById('keyword-opportunities-container');
    if (!container) return;

    container.innerHTML = `<h3 class="dashboard-section-title">Keyword Opportunities</h3><p class="loading-text">Extracting high-intent keywords...</p>`;

    try {
        const topPostsText = posts.slice(0, 50).map(p => `Title: ${p.data.title || ''}\nContent: ${p.data.selftext || p.data.body || ''}`.substring(0, 800)).join('\n---\n');

        const prompt = `You are an expert SEO strategist specializing in identifying user intent from raw text for the "${audienceContext}" audience.
        Analyze the following user posts and extract up to 15 high-value keywords and phrases. Categorize them into three distinct groups based on user intent:

        1.  "problem_aware": Keywords used by people who know they have a problem but are seeking information or understanding. (e.g., "how to fix...", "why is my...", "is it normal...")
        2.  "solution_seeking": Keywords used by people actively looking for and comparing types of solutions. (e.g., "best software for...", "alternatives to...", "[product category] reviews")
        3.  "purchase_intent": Keywords used by people close to making a purchase, often including brand names or commercial terms. (e.g., "[Brand A] vs [Brand B]", "[Product] pricing", "is [Brand] worth it")

        Respond ONLY with a valid JSON object with three keys: "problem_aware", "solution_seeking", and "purchase_intent", each holding an array of up to 5 relevant keyword strings.

        Posts:\n${topPostsText}`;

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an SEO strategist who outputs structured JSON with keyword categories." },
                { role: "user", content: prompt }
            ],
            temperature: 0.1,
            max_tokens: 600,
            response_format: { "type": "json_object" }
        };

        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        
        if (!response.ok) throw new Error('Keyword analysis API call failed.');

        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        const { problem_aware, solution_seeking, purchase_intent } = parsed;
        
        const renderCluster = (title, icon, description, keywords) => {
            if (!keywords || keywords.length === 0) return '';
            const keywordList = keywords.map(kw => `<li>${kw}</li>`).join('');
            return `
                <div class="keyword-cluster">
                    <div class="keyword-cluster-header">
                        <span class="keyword-cluster-icon">${icon}</span>
                        <div>
                            <h4 class="keyword-cluster-title">${title}</h4>
                            <p class="keyword-cluster-description">${description}</p>
                        </div>
                    </div>
                    <ul class="keyword-list">${keywordList}</ul>
                </div>
            `;
        };
        
        container.innerHTML = `
            <h3 class="dashboard-section-title">Keyword Opportunities</h3>
            <div class="keyword-clusters-grid">
                ${renderCluster('Problem-Aware', '🤔', 'For blog posts & guides', problem_aware)}
                ${renderCluster('Solution-Seeking', '🔍', 'For comparisons & reviews', solution_seeking)}
                ${renderCluster('Purchase-Intent', '💳', 'For landing pages & ads', purchase_intent)}
            </div>
        `;

    } catch (error) {
        console.error("Keyword generation error:", error);
        container.innerHTML = `
            <h3 class="dashboard-section-title">Keyword Opportunities</h3>
            <p class="loading-text" style="color: red;">Could not generate keyword opportunities.</p>
        `;
    }
}

// =================================================================================
// === OPTIMISED FUNCTION: SEO SUNBURST WITH CORRECT HIERARCHY & TOOLTIPS V7 ===
// =================================================================================
async function generateAndRenderSeoSunburst(posts, audienceContext) {
    const container = document.getElementById('keyword-sunburst');
    if (!container) {
        console.error('Sunburst container div "keyword-sunburst" not found.');
        return;
    }

    container.innerHTML = '<p class="loading-text">Building data-driven SEO plan...</p>';

    try {
        const topPostsText = posts.slice(0, 50).map(p => `Title: ${p.data.title || ''}\nContent: ${p.data.selftext || p.data.body || ''}`.substring(0, 800)).join('\n---\n');

        // *** CHANGE 1: The AI prompt is updated to match the new node count rules. ***
        const prompt = `You are an expert SEO strategist for the "${audienceContext}" audience. Create a comprehensive, multi-level SEO plan based on the provided text.

        Structure your response as a single, valid JSON object.

        For each of the three intents (problem_aware, solution_seeking, purchase_intent), provide an array of 2-5 primary keywords.

        - For EACH primary keyword, provide an array of 2-4 "secondary_keywords".
        - For EACH secondary keyword, provide an array of 2-3 "long_tail_keywords".
        - For EACH long-tail keyword, provide an array of 1-2 "content_examples".

        CRITICAL: Every keyword object (primary, secondary, long_tail) MUST contain:
        - "keyword": The keyword phrase.
        - "searchVolume": A realistic monthly search volume (integer).

        Each "content_examples" item should be an object with a single key: "title".

        Example JSON Structure:
        {
          "problem_aware": [
            {
              "keyword": "primary keyword A", "searchVolume": 5000,
              "secondary_keywords": [
                {
                  "keyword": "secondary keyword A1", "searchVolume": 1200,
                  "long_tail_keywords": [
                    {
                      "keyword": "long-tail keyword A1a", "searchVolume": 300,
                      "content_examples": [ { "title": "Example Blog Title 1" } ]
                    }
                  ]
                }
              ]
            }
          ],
          "solution_seeking": [ ... ], "purchase_intent": [ ... ]
        }`;

        const openAIParams = {
            model: "gpt-4o",
            messages: [{ role: "system", content: "You are a JSON-only SEO strategist." }, { role: "user", content: prompt }],
            temperature: 0.2,
            response_format: { "type": "json_object" }
        };

        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!response.ok) throw new Error('AI SEO plan generation failed.');

        const aiResult = await response.json();
        const seoPlan = JSON.parse(aiResult.openaiResponse);

        // Data transformation logic remains the same - it's robust enough for the new structure.
        const sunburstData = [{
            id: 'root', parent: '', name: 'SEO Plan'
        }, {
            id: 'pa', parent: 'root', name: 'Problem-Aware', color: '#6AA9FF'
        }, {
            id: 'ss', parent: 'root', name: 'Solution-Seeking', color: '#9B7CFF'
        }, {
            id: 'pi', parent: 'root', name: 'Purchase-Intent', color: '#5ED1B8'
        }];

        const processIntent = (intentId, intentName, intentData) => {
            if (!intentData || !Array.isArray(intentData)) return;
            // Level 3: Primary Keywords
            intentData.forEach((primary, i) => {
                const primaryId = `${intentId}_p_${i}`;
                sunburstData.push({ id: primaryId, parent: intentId, name: primary.keyword, value: primary.searchVolume, extra: { ...primary, intentName } });
                // Level 4: Secondary Keywords
                (primary.secondary_keywords || []).forEach((secondary, j) => {
                    const secondaryId = `${primaryId}_s_${j}`;
                    sunburstData.push({ id: secondaryId, parent: primaryId, name: secondary.keyword, value: secondary.searchVolume, extra: { ...secondary, intentName } });
                    // Level 5: Long-tail Keywords
                    (secondary.long_tail_keywords || []).forEach((longtail, k) => {
                        const longtailId = `${secondaryId}_l_${k}`;
                        sunburstData.push({ id: longtailId, parent: secondaryId, name: longtail.keyword, value: longtail.searchVolume, extra: { ...longtail, intentName } });
                        // Level 6: Content Examples
                        (longtail.content_examples || []).forEach((content, l) => {
                            const value = longtail.searchVolume / (longtail.content_examples.length || 1);
                            sunburstData.push({
                                id: `${longtailId}_c_${l}`,
                                parent: longtailId,
                                name: content.title,
                                value: Math.max(value, 1), // Ensure leaf nodes have a value
                                extra: { ...content, intentName, searchVolume: longtail.searchVolume }
                            });
                        });
                    });
                });
            });
        };

        processIntent('pa', 'Problem-Aware', seoPlan.problem_aware);
        processIntent('ss', 'Solution-Seeking', seoPlan.solution_seeking);
        processIntent('pi', 'Purchase-Intent', seoPlan.purchase_intent);

        // =========================================================================
        // === HIGHCHARTS CONFIGURATION ============================================
        // =========================================================================
        Highcharts.chart(container, {
            chart: { type: 'sunburst', height: '600px', backgroundColor: null },
            title: { text: 'Visual SEO Plan', align: 'left' },
            credits: { enabled: false },
            plotOptions: { sunburst: { animation: { duration: 1000 } } },
            series: [{
                type: 'sunburst',
                name: 'Wide View',
                data: sunburstData,
                allowDrillToNode: true,
                cursor: 'pointer',
                dataLabels: {
                    format: '{point.name}',
                    filter: { property: 'innerArcLength', operator: '>', value: 20 },
                    rotationMode: 'circular'
                },
                levels: [{
                    level: 1,
                    levelIsConstant: false,
                    dataLabels: { enabled: true, filter: { property: 'value', operator: '>', value: -1 }, style: { fontSize: '1.1em', fontWeight: 'bold' } }
                }, { level: 2, colorByPoint: true }, { level: 3, colorVariation: { key: 'brightness', to: -0.25 } }, { level: 4, colorVariation: { key: 'brightness', to: 0.25 } }, { level: 5, colorVariation: { key: 'brightness', to: -0.45 } }, { level: 6, colorVariation: { key: 'brightness', to: 0.45 } }]
            }],

            // Tooltip logic is updated with the minimum width requirement.
            tooltip: {
                useHTML: true,
                headerFormat: '',
                pointFormatter: function() {
                    const point = this;
                    const extra = point.options.extra || {};

                    const levelNameMap = {
                        1: 'SEO Plan',
                        2: 'Intent bucket',
                        3: 'Primary keyword',
                        4: 'Secondary keyword',
                        5: 'Long-tail keyword',
                        6: 'Content example / blog title / LP'
                    };
                    const levelName = levelNameMap[point.level];
                    const intentName = extra.intentName || (point.level === 2 ? point.name : null);

                    // *** CHANGE 2: Enforce a minimum width of 250px on the tooltip container. ***
                    let html = `<div style="min-width: 250px; max-width: 400px; font-size: 14px; white-space: normal; word-wrap: break-word;">`;

                    // Rule: Name: [node name]
                    html += `<b>Name:</b> ${point.name}<br/>`;

                    // Rule: Level: [exact level label]
                    if (levelName) {
                        html += `<b>Level:</b> ${levelName}<br/>`;
                    }

                    // Rule: Intent: [name] (if applicable)
                    if (point.level > 1 && intentName) {
                        html += `<b>Intent:</b> ${intentName}<br/>`;
                    }

                    // Rule: Search volume: [if available]
                    if (extra.searchVolume !== undefined) {
                        html += `<b>Search volume:</b> ${extra.searchVolume.toLocaleString()}<br/>`;
                    }

                    html += `</div>`;
                    return html;
                }
            },
            exporting: { enabled: true },
            accessibility: { enabled: true },
        });
    } catch (error) {
        console.error("Failed to generate or render SEO Sunburst chart:", error);
        container.innerHTML = `<p class="error-message">Could not generate the visual SEO plan.</p>`;
    }
}
async function enhanceDiscoveryWithComments(posts, nicheContext) {
    console.log("--- Starting PHASE 2: Enhancing discovery with comments ---");
    const brandContainer = document.getElementById('top-brands-container');
    if (!brandContainer) return;
    const statusMessageEl = document.createElement('div');
    statusMessageEl.id = 'discovery-status-message';
    statusMessageEl.style.cssText = "font-family: Inter, sans-serif; color: #555; padding: 0.5rem 1rem 1rem 1rem; font-style: italic; text-align: center;";
    statusMessageEl.innerHTML = 'Analyzing comments for more insights... <span class="loader-dots"></span>';
    brandContainer.before(statusMessageEl);
    try {
        const postIdsToFetch = posts.slice(0, 75).map(p => p.data.id);
        const comments = await fetchCommentsForPosts(postIdsToFetch);
        const allItemsForAnalysis = [...posts, ...comments];
        const enhancedEntities = await extractAndValidateEntities(allItemsForAnalysis, nicheContext);
        renderDiscoveryList('top-brands-container', enhancedEntities.topBrands, 'Top Brands & Specific Products', 'brands');
        renderDiscoveryList('top-products-container', enhancedEntities.topProducts, 'Top Generic Products', 'products');
    } catch (error) {
        console.error("Failed to enhance discovery lists with comments:", error);
        const statusMsg = document.getElementById('discovery-status-message');
        if (statusMsg) { statusMsg.style.color = 'red'; statusMsg.textContent = 'Could not load additional data from comments.'; }
    } finally {
        const statusMsg = document.getElementById('discovery-status-message');
        if (statusMsg) { statusMsg.remove(); }
    }
}
function generateNgrams(words, n) {
    const ngrams = [];
    if (n > words.length) return ngrams;
    for (let i = 0; i <= words.length - n; i++) {
        const ngram = words.slice(i, i + n);
        if (!stopWords.includes(ngram[0]) && !stopWords.includes(ngram[n - 1])) {
            ngrams.push(ngram.join(' '));
        }
    }
    return ngrams;
}
// =================================================================================
// === START: Replace this entire function in your script ===
// =================================================================================
// =================================================================================
// === REPLACEMENT FUNCTION: generateAndRenderPowerPhrases ===
// =================================================================================
async function generateAndRenderPowerPhrases(posts, audienceContext) {
    const container = document.getElementById('power-phrases');
    if (!container) return;

    // --- 1. Find Phrases (No changes to this part) ---
    const rawText = posts.map(p => `${p.data.title || ''} ${p.data.selftext || p.data.body || ''}`).join(' ');
    const stopAcronyms = new Set(['AITA', 'TLDR', 'IIRC', 'IMO', 'IMHO', 'LOL', 'LMAO', 'ROFL', 'NSFW', 'OP']);
    const acronymRegex = /\b[A-Z]{2,5}\b/g;
    const acronyms = rawText.match(acronymRegex) || [];
    const acronymFreq = {};
    acronyms.forEach(acronym => { if (!stopAcronyms.has(acronym)) { acronymFreq[acronym] = (acronymFreq[acronym] || 0) + 1; } });
    const topAcronyms = Object.entries(acronymFreq).filter(([_, count]) => count > 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(item => item[0]);
    const cleanedText = rawText.toLowerCase().replace(/[^a-z\s']/g, '').replace(/\s+/g, ' ');
    const words = cleanedText.split(' ');
    const bigrams = generateNgrams(words, 2);
    const trigrams = generateNgrams(words, 3);
    const phraseFreq = {};
    [...bigrams, ...trigrams].forEach(phrase => { phraseFreq[phrase] = (phraseFreq[phrase] || 0) + 1; });
    const topPhrases = Object.entries(phraseFreq).filter(([_, count]) => count > 2).sort((a, b) => b[1] - a[1]).slice(0, 12 - topAcronyms.length).map(item => item[0]);
    const finalResults = [...topAcronyms, ...topPhrases];

    if (finalResults.length < 3) {
        container.innerHTML = '<p style="font-family: Inter, sans-serif; color: #777; padding: 1rem;">Not enough common phrases found.</p>';
        return;
    }

    // --- 2. Generate Dropdown HTML Structure ---
    const phrasesHTML = finalResults.map((item, index) => `
        <details class="power-phrase-item" id="phrase-item-${index}">
            <summary class="power-phrase-summary">${item}</summary>
            <div class="power-phrase-definition" id="phrase-def-${index}">
                <p class="loading-text">Loading definition...</p>
            </div>
        </details>
    `).join('');

    // --- 3. Render the Dropdowns (Header is removed) ---
    container.innerHTML = `<div class="power-phrases-list">${phrasesHTML}</div>`;

    // --- 4. Fetch Definitions Asynchronously ---
    finalResults.forEach(async (phrase, index) => {
        try {
            const prompt = `For the target audience "${audienceContext}", what does the phrase or acronym "${phrase}" mean? Provide a single, concise sentence explanation.`;
            const openAIParams = {
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are an expert at defining niche community jargon. Provide only a single sentence." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 100,
            };
            const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
            if (!response.ok) throw new Error('Definition API call failed.');
            
            const data = await response.json();
            const definitionText = data.openaiResponse;
            
            const definitionDiv = document.getElementById(`phrase-def-${index}`);
            if (definitionDiv) {
                definitionDiv.innerHTML = `<p>${definitionText}</p>`;
            }
        } catch (error) {
            console.error(`Failed to get definition for "${phrase}":`, error);
            const definitionDiv = document.getElementById(`phrase-def-${index}`);
            if (definitionDiv) {
                definitionDiv.innerHTML = `<p class="loading-text" style="color: red;">Could not load definition.</p>`;
            }
        }
    });
}
// =================================================================================
// === CORE `runProblemFinder` FUNCTION ===
// =================================================================================
async function runProblemFinder(options = {}) {
    const { isUpdate = false } = options;
    const searchButton = document.getElementById('search-selected-btn');
    if (!searchButton) { console.error("Could not find button."); return; }
    const selectedCheckboxes = document.querySelectorAll('#subreddit-choices input:checked');
    if (selectedCheckboxes.length === 0) { alert("Please select at least one community."); return; }
    const selectedSubreddits = Array.from(selectedCheckboxes).map(cb => cb.value);
    const subredditQueryString = selectedSubreddits.map(sub => `subreddit:${sub}`).join(' OR ');
    if (!isUpdate) {
        searchButton.classList.add('is-loading');
        searchButton.disabled = true;
    }
    const problemTerms = ["problem", "challenge", "frustration", "annoyance", "wish I could", "hate that", "help with", "solution for"];
    const deepProblemTerms = ["struggle", "issue", "difficulty", "pain point", "pet peeve", "disappointed", "advice", "workaround", "how to", "fix", "rant", "vent"];
    const demandSignalTerms = ["i'd pay good money for", "buy it in a second", "i'd subscribe to", "throw money at it", "where can i buy", "happily pay", "shut up and take my money", "sick of doing this manually", "can't find anything that", "waste so much time on", "has to be a better way", "shouldn't be this hard", "why is there no tool for", "why is there no app for", "tried everything and nothing works", "tool almost did what i wanted", "it's missing", "tried", "gave up on it", "if only there was an app", "i wish someone would build", "why hasn't anyone made", "waste hours every week", "such a timesuck", "pay just to not have to think", "rather pay than do this myself"];
    const resultsWrapper = document.getElementById('results-wrapper-b');
    const resultsMessageDiv = document.getElementById("results-message");
    const countHeaderDiv = document.getElementById("count-header");
if (!isUpdate) {
    if (resultsWrapper) { resultsWrapper.style.display = 'none'; resultsWrapper.style.opacity = '0'; }
    ["count-header", "filter-header", "pulse-results", "posts-container", "emotion-map-container", "sentiment-score-container", "top-brands-container", "top-products-container", "faq-container", "included-subreddits-container", "similar-subreddits-container", "context-box", "positive-context-box", "negative-context-box", "power-phrases"].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
    
    if (resultsMessageDiv) resultsMessageDiv.innerHTML = "";
    
    // This loop safely puts a loading message inside the prevalence wrapper without destroying anything.
    for (let i = 1; i <= 5; i++) {
        const block = document.getElementById(`findings-block${i}`);
        if (block) {
            // Hide the block initially until it's ready to be shown
            block.style.display = 'none'; 
            const prevalenceWrapper = block.querySelector('.prevalence-container-wrapper');
            if (prevalenceWrapper) {
                prevalenceWrapper.innerHTML = "<p class='loading-text' style='text-align: center; padding: 2rem;'>Brewing insights...</p>";
            }
        }
    }
}
    try {
        console.log("--- STARTING PHASE 1: FAST ANALYSIS ---");
        
        const panelContent = document.getElementById('bubble-content');
        if (panelContent) {
            panelContent.innerHTML = `<div class="panel-placeholder">Loading purchase signals... <span class="loader-dots"></span></div>`;
        }

        const searchDepth = document.querySelector('input[name="search-depth"]:checked')?.value || 'quick';
        let generalSearchTerms = (searchDepth === 'deep') ? [...problemTerms, ...deepProblemTerms] : problemTerms;
        let limitPerTerm = (searchDepth === 'deep') ? 75 : 40;
        const selectedTimeRaw = document.querySelector('input[name="timePosted"]:checked')?.value || "all";
        const selectedMinUpvotes = parseInt(document.querySelector('input[name="minVotes"]:checked')?.value || "20", 10);
        const timeMap = { week: "week", month: "month", "6months": "year", year: "year", all: "all" };
        const selectedTime = timeMap[selectedTimeRaw] || "all";
        const problemItems = await fetchMultipleRedditDataBatched(subredditQueryString, generalSearchTerms, limitPerTerm, selectedTime, false);
        const allItems = deduplicatePosts(problemItems);
        if (allItems.length === 0) throw new Error("No initial problem posts found. Try different communities or a broader search.");
        const filteredItems = filterPosts(allItems, selectedMinUpvotes);
        if (filteredItems.length < 10) throw new Error("Not enough high-quality content found after filtering. Try a 'Deep' search or a longer time frame.");
        window._filteredPosts = filteredItems;
        renderPosts(filteredItems);

        // --- Start of Replacement ---

// 1. Generate counts and render the score bar (from the old logic)
generateAndRenderHybridSentiment(filteredItems, originalGroupName);


// --- End of Replacement ---

        generateEmotionMapData(filteredItems).then(renderEmotionMap);
        renderIncludedSubreddits(selectedSubreddits);
        generateAndRenderPowerPhrases(filteredItems, originalGroupName);

        generateAndRenderMindsetSummary(filteredItems, originalGroupName);
        generateAndRenderStrategicPillars(filteredItems, originalGroupName);
        generateAndRenderAIPrompt(filteredItems, originalGroupName);
        generateAndRenderKeywords(filteredItems, originalGroupName);
        generateAndRenderSeoSunburst(filteredItems, originalGroupName);
        extractAndValidateEntities(filteredItems, originalGroupName).then(entities => { renderDiscoveryList('top-brands-container', entities.topBrands, 'Top Brands & Specific Products', 'brands'); renderDiscoveryList('top-products-container', entities.topProducts, 'Top Generic Products', 'products'); });
        generateFAQs(filteredItems).then(faqs => renderFAQs(faqs));
        if (countHeaderDiv) { countHeaderDiv.innerHTML = `Distilled <span class="header-pill pill-insights">${filteredItems.length.toLocaleString()}</span> insights from <span class="header-pill pill-posts">${allItems.length.toLocaleString()}</span> posts for <span class="header-pill pill-audience">${originalGroupName}</span>`; }
        const topKeywords = getTopKeywords(filteredItems, 10);
        const topPosts = filteredItems.slice(0, 30);
        const combinedTexts = topPosts.map(post => `${post.data.title || post.data.link_title || ''}. ${getFirstTwoSentences(post.data.selftext || post.data.body || '')}`).join("\n\n");

    // REPLACE WITH THIS NEW BLOCK
const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a helpful assistant that summarizes user-provided text into between 1 and 5 core common struggles and provides authentic quotes." }, { role: "user", content: `Your task is to analyze the provided text about the niche "${originalGroupName}" and identify 1 to 5 common problems. You MUST provide your response in a strict JSON format. The JSON object must have a single top-level key named "summaries". The "summaries" key must contain an array of objects. Each object in the array represents one common problem and must have the following keys: "title", "body", "count", "quotes", "keywords". CRITICAL RULES FOR QUOTES: The "quotes" array must contain exactly 3 strings, and each string MUST be 63 characters or less. Here are the top keywords to guide your analysis: [${topKeywords.join(', ')}]. Make sure the niche "${originalGroupName}" is naturally mentioned in each "body". Example of the required output format: { "summaries": [ { "title": "Example Title 1", "body": "Example body text about the problem.", "count": 50, "quotes": ["A short quote under 63 chars.", "Another quote under 63 chars.", "A final quote under 63 chars."], "keywords": ["keyword1", "keyword2"] } ] }. Here is the text to analyze: \`\`\`${combinedTexts}\`\`\`` }], temperature: 0.0, max_tokens: 1500, response_format: { "type": "json_object" } };

        const openAIResponse = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!openAIResponse.ok) throw new Error('OpenAI summary generation failed.');
        const openAIData = await openAIResponse.json();
        const summaries = parseAISummary(openAIData.openaiResponse);
        const validatedSummaries = summaries.filter(finding => filteredItems.filter(post => calculateRelevanceScore(post, finding) > 0).length >= 3);
        if (validatedSummaries.length === 0) { throw new Error("While posts were found, none formed a clear, common problem."); }
        const metrics = calculateFindingMetrics(validatedSummaries, filteredItems);
        // REPLACE THE OLD SECTION WITH THIS NEW ONE
const sortedFindings = validatedSummaries.map((summary, index) => ({
    summary,
    prevalence: Math.round((metrics[index].supportCount / (metrics.totalProblemPosts || 1)) * 100),
    supportCount: metrics[index].supportCount
})).sort((a, b) => b.prevalence - a.prevalence);

// Process all quotes first to enforce length and count constraints
sortedFindings.forEach(finding => {
    const summary = finding.summary;
    
    // 1. Clean and trim all quotes provided by the AI.
    const cleanQuotes = (summary.quotes || [])
        .map(q => q.trim())
        .filter(q => q.length > 0)
        .map(q => (q.length > 63 ? q.substring(0, 60) + '...' : q));

    // 2. Start our final array with up to the first 3 clean quotes.
    const finalQuotes = cleanQuotes.slice(0, 3);

    // 3. Determine what to fill the empty spots with. Use the last valid quote, or an empty string if there are none.
    const fillerQuote = finalQuotes.length > 0 ? finalQuotes[finalQuotes.length - 1] : "";
    
    // 4. Fill the array until it has exactly 3 items. This is guaranteed to work.
    while (finalQuotes.length < 3) {
        finalQuotes.push(fillerQuote);
    }

    // 5. Assign the perfectly formatted array back to the summary.
    summary.quotes = finalQuotes;
});
window._summaries = sortedFindings.map(item => item.summary);

for (let i = 1; i <= 5; i++) {
    const block = document.getElementById(`findings-block${i}`);
    if (block) block.style.display = "none";
}

sortedFindings.forEach((findingData, index) => {
    const displayIndex = index + 1;
    if (displayIndex > 5) return;

    const block = document.getElementById(`findings-block${displayIndex}`);
    if (!block) return;

    const content = document.getElementById(`findings-${displayIndex}`);
    const btn = block.querySelector('.sample-posts-button');

    block.style.display = "flex";

    if (content) {
        const { summary, prevalence, supportCount } = findingData;

        const titleEl = content.querySelector('.section-title');
        if (titleEl) titleEl.textContent = summary.title;

        const teaserEl = content.querySelector('.summary-teaser');
        const fullEl = content.querySelector('.summary-full');
        const seeMoreBtn = content.querySelector('.see-more-btn');
        if (teaserEl && fullEl && seeMoreBtn) {
            if (summary.body.length > 95) {
                teaserEl.textContent = summary.body.substring(0, 95) + "…";
                fullEl.textContent = summary.body;
                teaserEl.style.display = 'inline';
                fullEl.style.display = 'none';
                seeMoreBtn.style.display = 'inline-block';
                seeMoreBtn.textContent = 'See more';
                const newBtn = seeMoreBtn.cloneNode(true);
                seeMoreBtn.parentNode.replaceChild(newBtn, seeMoreBtn);
                newBtn.addEventListener('click', function() {
                    const isHidden = teaserEl.style.display !== 'none';
                    teaserEl.style.display = isHidden ? 'none' : 'inline';
                    fullEl.style.display = isHidden ? 'inline' : 'none';
                    newBtn.textContent = isHidden ? 'See less' : 'See more';
                });
            } else {
                teaserEl.textContent = summary.body;
                teaserEl.style.display = 'inline';
                fullEl.style.display = 'none';
                seeMoreBtn.style.display = 'none';
            }
        }

        const quotesContainer = content.querySelector('.quotes-container');
        if (quotesContainer) {
            const quoteElements = quotesContainer.querySelectorAll('.quote');
            summary.quotes.forEach((quoteText, i) => {
                if (quoteElements[i]) {
                    if (quoteText) {
                        quoteElements[i].textContent = `"${quoteText}"`;
                        quoteElements[i].style.display = 'block';
                    } else {
                        quoteElements[i].style.display = 'none';
                    }
                }
            });
        }

        const metricsWrapper = content.querySelector('.prevalence-container-wrapper');
        if (metricsWrapper) {
            metricsWrapper.innerHTML = (sortedFindings.length === 1)
                ? `<div class="prevalence-container"><div class="prevalence-header">Primary Finding</div><div class="single-finding-metric">Supported by ${supportCount} Posts</div><div class="prevalence-subtitle">This was the only significant problem theme identified.</div></div>`
                : `<div class="prevalence-container"><div class="prevalence-header">${prevalence >= 30 ? "High" : prevalence >= 15 ? "Medium" : "Low"} Prevalence</div><div class="prevalence-bar-background"><div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${prevalence >= 30 ? "#296fd3" : prevalence >= 15 ? "#5b98eb" : "#aecbfa"};">${prevalence}%</div></div><div class="prevalence-subtitle">Represents ${prevalence}% of all identified problems.</div></div>`;
        }
    }

    if (btn) {
        btn.onclick = () => showSamplePosts(index, window._assignments, window._filteredPosts, window._usedPostIds);
    }
});


        try {
            window._postsForAssignment = filteredItems.slice(0, 75);
            window._usedPostIds = new Set();
            const assignments = await assignPostsToFindings(window._summaries, window._postsForAssignment);
            window._assignments = assignments;
            for (let i = 0; i < window._summaries.length; i++) {
                if (i >= 5) break;
                showSamplePosts(i, assignments, filteredItems, window._usedPostIds);
            }
        } catch (err) {
            console.error("CRITICAL (but isolated): Failed to assign posts to findings.", err);
            for (let i = 1; i <= 5; i++) { const redditDiv = document.getElementById(`reddit-div${i}`); if (redditDiv) { redditDiv.innerHTML = `<div style="font-style: italic; color: #999;">Could not load sample posts.</div>`; } }
        }
        if (countHeaderDiv && countHeaderDiv.textContent.trim() !== "") {
            if (resultsWrapper) {
                resultsWrapper.style.setProperty('display', 'flex', 'important');
                setTimeout(() => {
                    if (resultsWrapper) {
                        resultsWrapper.style.opacity = '1';
                        if (!isUpdate) {
                            resultsWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    
                            
                            const fullHeader = document.getElementById('full-header');
                            if (fullHeader) {
                                fullHeader.classList.add('header-hidden');
                                fullHeader.addEventListener('transitionend', () => {
                                    fullHeader.style.display = 'none';
                                }, { once: true });
                            }
                        }
                    }
                }, 50);
            }
        }
        setTimeout(() => runConstellationAnalysis(subredditQueryString, demandSignalTerms, selectedTime), 1500);
        setTimeout(() => renderAndHandleRelatedSubreddits(selectedSubreddits), 2500);
        setTimeout(() => enhanceDiscoveryWithComments(window._filteredPosts, originalGroupName), 5000);
    } catch (err) {
        console.error("A fatal error stopped the primary analysis:", err);
        if (resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error' style="color: red; text-align: center;">❌ ${err.message}</p>`;
        if (resultsWrapper) { resultsWrapper.style.setProperty('display', 'flex', 'important'); resultsWrapper.style.opacity = '1'; }
    } finally {
        if (!isUpdate) {
            searchButton.classList.remove('is-loading');
            searchButton.disabled = false;
        }
    }
}

// =================================================================================
// === REPLACEMENT FUNCTION: initializeDashboardInteractivity ===
// =================================================================================

function initializeDashboardInteractivity() {
    document.addEventListener('click', (e) => {
        const backButton = e.target.closest('#results-wrapper-b #back-to-step1-btn');
        if (backButton) {
            location.reload();
            return;
        }

        if (e.target.closest('#results-wrapper-b')) {
            const cloudWordEl = e.target.closest('.cloud-word');
            const briefButtonEl = e.target.closest('.brief-button'); //MODIFIED: Target the button now
            const removeBtnEl = e.target.closest('.remove-sub-btn');

            if (cloudWordEl) {
                const word = cloudWordEl.dataset.word;
                const category = cloudWordEl.closest('#positive-cloud') ? 'positive' : 'negative';
                const postsData = window._sentimentData?.[category]?.[word]?.posts;
                if (postsData) { showSlidingPanel(word, Array.from(postsData), category); }
            } else if (briefButtonEl) { // MODIFIED: Check for the button
                const parentItem = briefButtonEl.closest('.discovery-list-item');
                const word = parentItem.dataset.word;
                const type = parentItem.dataset.type;
                generateAndRenderBrandBrief(word, type);
            } else if (removeBtnEl) {
                handleRemoveSubClick(e);
            }
        }
    });
}


function initializeProblemFinderTool() {
    const style = document.createElement('style');
    document.head.appendChild(style);

    console.log("Problem Finder elements found. Initializing...");
    const welcomeDiv = document.getElementById('welcome-div');
    const pillsContainer = document.getElementById('pf-suggestion-pills');
    const groupInput = document.getElementById('group-input');
    const findCommunitiesBtn = document.getElementById('find-communities-btn');
    const searchSelectedBtn = document.getElementById('search-selected-btn');
    const step1Container = document.getElementById('step-1-container');
    const step2Container = document.getElementById('subreddit-selection-container');
    const inspireButton = document.getElementById('inspire-me-button');
    const choicesContainer = document.getElementById('subreddit-choices');
    const audienceTitle = document.getElementById('pf-audience-title');

    if (!findCommunitiesBtn || !searchSelectedBtn || !choicesContainer) {
        console.error("Critical error: A key element was null. Aborting initialization.");
        return;
    }

    const transitionToStep2 = () => {
        if (step2Container.classList.contains('visible')) return;
        if (welcomeDiv) { welcomeDiv.style.display = 'none'; }
        step1Container.classList.add('hidden');
        step2Container.classList.add('visible');
        choicesContainer.innerHTML = '<p class="loading-text">Finding & ranking relevant communities...</p>';
        audienceTitle.textContent = `Select Subreddits For: ${originalGroupName}`;
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
        try {
            const initialSuggestions = await findSubredditsForGroup(groupName);
            const rankedSubreddits = await fetchAndRankSubreddits(initialSuggestions);
            displaySubredditChoices(rankedSubreddits);
        } catch (error) {
            console.error("Failed during subreddit validation process:", error);
            displaySubredditChoices([]);
        }
    });

    searchSelectedBtn.addEventListener("click", (event) => {
        event.preventDefault();
        runProblemFinder();
    });

    choicesContainer.addEventListener('click', (event) => {
        const choiceDiv = event.target.closest('.subreddit-choice');
        if (choiceDiv) {
            const checkbox = choiceDiv.querySelector('input[type="checkbox"]');
            if (checkbox) checkbox.checked = !checkbox.checked;
        }
    });

    initializeDashboardInteractivity();
    console.log("Problem Finder tool successfully initialized.");
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
                console.error(`Initialization FAILED. Key element "#${keyElementId}" not found.`);
            }
        }
    }, 100);
}

// --- SCRIPT ENTRY POINT ---
document.addEventListener('DOMContentLoaded', waitForElementAndInit);
