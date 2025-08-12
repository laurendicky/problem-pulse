// =================================================================================
// COMPLETE AND VERIFIED SCRIPT (VERSION 14.3 - UI FLOW FIXED & RESILIENT)
// This version corrects the product/brand discovery UI flow to be non-destructive.
// It now displays a status message above the initial results instead of replacing them.
// =================================================================================

// --- 1. GLOBAL VARIABLES & CONSTANTS ---
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy';
const HARD_MIN_SUBSCRIBERS = 1000; // A low bar to filter out tiny/test subreddits.
const HARD_MIN_ACTIVE_USERS = 5;    // Ensures the sub isn't completely inactive.
let originalGroupName = '';
let _allRankedSubreddits = []; // Global state for the "Load More" feature.

const suggestions = ["Dog Lovers", "Start-up Founders", "Fitness Beginners", "AI Enthusiasts", "Home Bakers", "Gamers", "Content Creators", "Developers", "Brides To Be"];
const positiveColors = ['#2E7D32', '#388E3C', '#43A047', '#1B5E20'];
const negativeColors = ['#C62828', '#D32F2F', '#E53935', '#B71C1C'];

const lemmaMap = { 'needs': 'need', 'wants': 'want', 'loves': 'love', 'loved': 'love', 'loving': 'love', 'hates': 'hate', 'wishes': 'wish', 'wishing': 'wish', 'solutions': 'solution', 'challenges': 'challenge', 'recommended': 'recommend', 'disappointed': 'disappoint', 'frustrated': 'frustrate', 'annoyed': 'annoy' };
const positiveWords = new Set(['love', 'amazing', 'awesome', 'beautiful', 'best', 'brilliant', 'celebrate', 'charming', 'dope', 'excellent', 'excited', 'exciting', 'epic', 'fantastic', 'flawless', 'gorgeous', 'happy', 'impressed', 'incredible', 'insane', 'joy', 'keen', 'lit', 'perfect', 'phenomenal', 'proud', 'rad', 'super', 'stoked', 'thrilled', 'vibrant', 'wow', 'wonderful', 'blessed', 'calm', 'chill', 'comfortable', 'cozy', 'grateful', 'loyal', 'peaceful', 'pleased', 'relaxed', 'relieved', 'satisfied', 'secure', 'thankful', 'want', 'wish', 'hope', 'desire', 'craving', 'benefit', 'bonus', 'deal', 'hack', 'improvement', 'quality', 'solution', 'strength', 'advice', 'tip', 'trick', 'recommend']);
const negativeWords = new Set(['angry', 'annoy', 'anxious', 'awful', 'bad', 'broken', 'hate', 'challenge', 'confused', 'crazy', 'critical', 'danger', 'desperate', 'disappoint', 'disgusted', 'dreadful', 'fear', 'frustrate', 'furious', 'horrible', 'irritated', 'jealous', 'nightmare', 'outraged', 'pain', 'panic', 'problem', 'rant', 'scared', 'shocked', 'stressful', 'terrible', 'terrified', 'trash', 'alone', 'ashamed', 'bored', 'depressed', 'discouraged', 'dull', 'empty', 'exhausted', 'failure', 'guilty', 'heartbroken', 'hopeless', 'hurt', 'insecure', 'lonely', 'miserable', 'sad', 'sorry', 'tired', 'unhappy', 'upset', 'weak', 'need', 'disadvantage', 'issue', 'flaw']);
const emotionalIntensityScores = { 'annoy': 3, 'irritated': 3, 'bored': 2, 'issue': 3, 'sad': 4, 'bad': 3, 'confused': 4, 'tired': 3, 'upset': 5, 'unhappy': 5, 'disappoint': 6, 'frustrate': 6, 'stressful': 6, 'awful': 7, 'hate': 8, 'angry': 7, 'broken': 5, 'exhausted': 5, 'pain': 7, 'miserable': 8, 'terrible': 8, 'worst': 9, 'horrible': 8, 'furious': 9, 'outraged': 9, 'dreadful': 8, 'terrified': 10, 'nightmare': 10, 'heartbroken': 9, 'desperate': 8, 'rage': 10, 'problem': 4, 'challenge': 5, 'critical': 6, 'danger': 7, 'fear': 7, 'panic': 8, 'scared': 6, 'shocked': 7, 'trash': 5, 'alone': 4, 'ashamed': 5, 'depressed': 8, 'discouraged': 5, 'dull': 2, 'empty': 6, 'failure': 7, 'guilty': 6, 'hopeless': 8, 'insecure': 5, 'lonely': 6, 'weak': 4, 'need': 5, 'disadvantage': 4, 'flaw': 4 };
const stopWords = ["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves", "like", "just", "dont", "can", "people", "help", "hes", "shes", "thing", "stuff", "really", "actually", "even", "know", "still", "post", "posts", "subreddit", "redditor", "redditors", "comment", "comments"];

// --- 2. ALL HELPER AND LOGIC FUNCTIONS ---
function deduplicatePosts(posts) { const seen = new Set(); return posts.filter(post => { if (!post.data || !post.data.id) return false; if (seen.has(post.data.id)) return false; seen.add(post.data.id); return true; }); }
function formatDate(utcSeconds) { const date = new Date(utcSeconds * 1000); return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all', searchInComments = false) { let allPosts = []; let after = null; try { while (allPosts.length < totalLimit) { const payload = { searchTerm: term, niche: niche, limit: 25, timeFilter: timeFilter, after: after }; if (searchInComments) { payload.includeComments = true; } const response = await fetch(REDDIT_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) { throw new Error(`Proxy Error: Server returned status ${response.status}`); } const data = await response.json(); if (!data.data || !data.data.children || !data.data.children.length) break; allPosts = allPosts.concat(data.data.children); after = data.data.after; if (!after) break; } } catch (err) { console.error(`Failed to fetch posts for term "${term}" via proxy:`, err.message); return []; } return allPosts.slice(0, totalLimit); }
async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all', searchInComments = false) { const allResults = []; for (let i = 0; i < searchTerms.length; i += 8) { const batchTerms = searchTerms.slice(i, i + 8); const batchPromises = batchTerms.map(term => fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter, searchInComments)); const batchResults = await Promise.all(batchPromises); batchResults.forEach(posts => { if (Array.isArray(posts)) { allResults.push(...posts); } }); if (i + 8 < searchTerms.length) { await new Promise(resolve => setTimeout(resolve, 500)); } } return deduplicatePosts(allResults); }
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
function renderPosts(posts) { const container = document.getElementById("posts-container"); if (!container) { return; } container.innerHTML = posts.map(post => { const content = post.data.selftext || post.data.body || 'No additional content.'; const title = post.data.title || post.data.link_title || 'View Comment Thread'; const num_comments = post.data.num_comments ? `| 💬 ${post.data.num_comments.toLocaleString()}` : ''; return ` <div class="insight" style="border:1px solid #ccc; padding:12px; margin-bottom:12px; background:#fafafa; border-radius:8px;"> <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1.1rem; color:#007bff; text-decoration:none;"> ${title} </a> <p style="font-size:0.9rem; margin:0.75rem 0; color:#333; line-height:1.5;"> ${content.substring(0, 200) + '...'} </p> <small style="color:#555; font-size:0.8rem;"> r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} ${num_comments} | 🗓️ ${formatDate(post.data.created_utc)} </small> </div> `}).join(''); }
function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) { if (!assignments) return; const finding = window._summaries[summaryIndex]; if (!finding) return; let relevantPosts = []; const addedPostIds = new Set(); const addPost = (post) => { if (post && post.data && !usedPostIds.has(post.data.id) && !addedPostIds.has(post.data.id)) { relevantPosts.push(post); addedPostIds.add(post.data.id); } }; const assignedPostNumbers = assignments.filter(a => a.finding === (summaryIndex + 1)).map(a => a.postNumber); assignedPostNumbers.forEach(postNum => { if (postNum - 1 < window._postsForAssignment.length) { addPost(window._postsForAssignment[postNum - 1]); } }); if (relevantPosts.length < 8) { const candidatePool = allPosts.filter(p => !usedPostIds.has(p.data.id) && !addedPostIds.has(p.data.id)); const scoredCandidates = candidatePool.map(post => ({ post: post, score: calculateRelevanceScore(post, finding) })).filter(item => item.score >= 4).sort((a, b) => b.score - a.score); for (const candidate of scoredCandidates) { if (relevantPosts.length >= 8) break; addPost(candidate.post); } } let html; if (relevantPosts.length === 0) { html = `<div style="font-style: italic; color: #555;">Could not find any highly relevant Reddit posts for this finding.</div>`; } else { const finalPosts = relevantPosts.slice(0, 8); finalPosts.forEach(post => usedPostIds.add(post.data.id)); html = finalPosts.map(post => { const content = post.data.selftext || post.data.body || 'No content.'; const title = post.data.title || post.data.link_title || 'View Comment'; const num_comments = post.data.num_comments ? `| 💬 ${post.data.num_comments.toLocaleString()}` : ''; return ` <div class="insight" style="border:1px solid #ccc; padding:8px; margin-bottom:8px; background:#fafafa; border-radius:4px;"> <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1rem; color:#007bff;">${title}</a> <p style="font-size:0.9rem; margin:0.5rem 0; color:#333;">${content.substring(0, 150) + '...'}</p> <small>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} ${num_comments} | 🗓️ ${formatDate(post.data.created_utc)}</small> </div> `}).join(''); } const container = document.getElementById(`reddit-div${summaryIndex + 1}`); if (container) { container.innerHTML = `<div class="reddit-samples-header" style="font-weight:bold; margin-bottom:6px;">Real Stories from Reddit: "${finding.title}"</div><div class="reddit-samples-posts">${html}</div>`; } }
async function findSubredditsForGroup(groupName) { const prompt = `Given the user-defined group "${groupName}", suggest up to 20 relevant and active Reddit subreddits. Provide your response ONLY as a JSON object with a single key "subreddits" which contains an array of subreddit names (without "r/").`; const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an expert Reddit community finder providing answers in strict JSON format." }, { role: "user", content: prompt }], temperature: 0.2, max_tokens: 300, response_format: { "type": "json_object" } }; try { const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) }); if (!response.ok) throw new Error('OpenAI API request failed.'); const data = await response.json(); const parsed = JSON.parse(data.openaiResponse); if (!parsed.subreddits || !Array.isArray(parsed.subreddits)) throw new Error("AI response did not contain a 'subreddits' array."); return parsed.subreddits; } catch (error) { console.error("Error finding subreddits:", error); alert("Sorry, I couldn't find any relevant communities. Please try another group name."); return []; } }
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
function renderEmotionMap(data) { const container = document.getElementById('emotion-map-container'); if (!container) return; if (window.myEmotionChart) { window.myEmotionChart.destroy(); } if (data.length < 3) { container.innerHTML = '<h3 class="dashboard-section-title">Problem Polarity Map</h3><p style="font-family: Inter, sans-serif; color: #777; padding: 1rem;">Not enough distinct problems were found to build a map.</p>'; return; } container.innerHTML = `<h3 class="dashboard-section-title">Problem Polarity Map</h3><p id="problem-map-description">The most frequent and emotionally intense problems appear in the top-right quadrant.</p><div id="emotion-map-wrapper"><div id="emotion-map" style="height: 400px; padding: 10px; border-radius: 8px;"><canvas id="emotion-chart-canvas"></canvas></div><button id="chart-zoom-btn" style="display: none;"></button></div>`; const ctx = document.getElementById('emotion-chart-canvas')?.getContext('2d'); if (!ctx) return; const maxFreq = Math.max(...data.map(p => p.x)); const allFrequencies = data.map(p => p.x); const minObservedFreq = Math.min(...allFrequencies); const collapsedMinX = 5; const isCollapseFeatureEnabled = minObservedFreq >= collapsedMinX; const initialMinX = isCollapseFeatureEnabled ? collapsedMinX : 0; window.myEmotionChart = new Chart(ctx, { type: 'scatter', data: { datasets: [{ label: 'Problems/Topics', data: data, backgroundColor: 'rgba(52, 152, 219, 0.9)', borderColor: 'rgba(41, 128, 185, 1)', borderWidth: 1, pointRadius: (context) => 5 + (context.raw.x / maxFreq) * 20, pointHoverRadius: (context) => 8 + (context.raw.x / maxFreq) * 20, }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'nearest', intersect: false, callbacks: { title: function(tooltipItems) { return tooltipItems[0].raw.label; }, label: function(context) { return ''; }, afterBody: function(tooltipItems) { const point = tooltipItems[0].raw; return `Frequency: ${point.x}, Intensity: ${point.y.toFixed(1)}`; } }, displayColors: false, titleFont: { size: 14, weight: 'bold' }, bodyFont: { size: 12 }, backgroundColor: 'rgba(0, 0, 0, 0.8)', titleColor: '#ffffff', bodyColor: '#dddddd', } }, scales: { x: { title: { display: true, text: 'Frequency (1-10)', color: 'white', font: { weight: 'bold' } }, min: initialMinX, max: 10, grid: { color: 'rgba(255, 255, 255, 0.15)' }, ticks: { color: 'white' } }, y: { title: { display: true, text: 'Problem Intensity (1-10)', color: 'white', font: { weight: 'bold' } }, min: 0, max: 10, grid: { color: 'rgba(255, 255, 255, 0.15)' }, ticks: { color: 'white' } } } } }); const zoomButton = document.getElementById('chart-zoom-btn'); if (isCollapseFeatureEnabled) { zoomButton.style.display = 'block'; const updateButtonText = () => { const isCurrentlyCollapsed = window.myEmotionChart.options.scales.x.min !== 0; zoomButton.textContent = isCurrentlyCollapsed ? 'Zoom Out to See Full Range' : 'Zoom In to High-Frequency'; }; zoomButton.addEventListener('click', () => { const chart = window.myEmotionChart; const isCurrentlyCollapsed = chart.options.scales.x.min !== 0; chart.options.scales.x.min = isCurrentlyCollapsed ? 0 : collapsedMinX; chart.update('none'); updateButtonText(); }); updateButtonText(); } }
function generateSentimentData(posts) { const data = { positive: {}, negative: {} }; let positiveCount = 0; let negativeCount = 0; posts.forEach(post => { const text = `${post.data.title || post.data.link_title || ''} ${post.data.selftext || post.data.body || ''}`; const words = text.toLowerCase().replace(/[^a-z\s']/g, '').split(/\s+/); words.forEach(rawWord => { if (rawWord.length < 3 || stopWords.includes(rawWord)) return; const lemma = lemmatize(rawWord); let category = null; if (positiveWords.has(lemma)) { category = 'positive'; positiveCount++; } else if (negativeWords.has(lemma)) { category = 'negative'; negativeCount++; } if (category) { if (!data[category][lemma]) { data[category][lemma] = { count: 0, posts: new Set() }; } data[category][lemma].count++; data[category][lemma].posts.add(post); } }); }); window._sentimentData = data; return { positive: Object.entries(data.positive).sort((a, b) => b[1].count - a[1].count).slice(0, 30), negative: Object.entries(data.negative).sort((a, b) => b[1].count - a[1].count).slice(0, 30), positiveCount, negativeCount }; }
function renderSentimentCloud(containerId, wordData, colors) { const container = document.getElementById(containerId); if (!container) return; if (wordData.length < 3) { container.innerHTML = `<p style="font-family: sans-serif; color: #777; padding: 1rem; text-align: center;">Not enough distinct terms found.</p>`; return; } const counts = wordData.map(item => item[1].count); const maxCount = Math.max(...counts); const minCount = Math.min(...counts); const minFontSize = 16, maxFontSize = 42; const cloudHTML = wordData.map(([word, data]) => { const fontSize = minFontSize + ((data.count - minCount) / (maxCount - minCount || 1)) * (maxFontSize - minFontSize); const color = colors[Math.floor(Math.random() * colors.length)]; const rotation = Math.random() * 8 - 4; return `<span class="cloud-word" data-word="${word}" style="font-size: ${fontSize.toFixed(1)}px; color: ${color}; transform: rotate(${rotation.toFixed(1)}deg);">${word}</span>`; }).join(''); container.innerHTML = cloudHTML; }
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
function renderDiscoveryList(containerId, data, title, type) { const container = document.getElementById(containerId); if(!container) return; let listItems = '<p style="font-family: Inter, sans-serif; color: #777; padding: 0 1rem;">No significant mentions found.</p>'; if (data.length > 0) { listItems = data.map(([name, details], index) => `<li class="discovery-list-item" data-word="${name}" data-type="${type}"><span class="rank">${index + 1}.</span><span class="name">${name}</span><span class="count">${details.count} mentions</span></li>`).join(''); } container.innerHTML = `<h3 class="dashboard-section-title">${title}</h3><ul class="discovery-list">${listItems}</ul>`; }
function renderFAQs(faqs) { const container = document.getElementById('faq-container'); if(!container) return; let faqItems = '<p style="font-family: Inter, sans-serif; color: #777; padding: 0 1rem;">Could not generate common questions from the text.</p>'; if (faqs.length > 0) { faqItems = faqs.map((faq) => `<div class="faq-item"><button class="faq-question">${faq}</button><div class="faq-answer"><p><em>This question was commonly found in discussions. Addressing it in your content or product can directly meet user needs.</em></p></div></div>`).join(''); } container.innerHTML = `<h3 class="dashboard-section-title">Frequently Asked Questions</h3>${faqItems}`; container.querySelectorAll('.faq-question').forEach(button => { button.addEventListener('click', () => { const answer = button.nextElementSibling; button.classList.toggle('active'); if (answer.style.maxHeight) { answer.style.maxHeight = null; answer.style.padding = '0 1.5rem'; } else { answer.style.padding = '1rem 1.5rem'; answer.style.maxHeight = answer.scrollHeight + "px"; } }); }); }

// =================================================================================
// === NEW & CORRECTED FUNCTIONS FOR SUBREDDIT VALIDATION & DISPLAY ===
// =================================================================================

/**
 * Fetches detailed information about a specific subreddit with a retry mechanism for server errors.
 * @param {string} subredditName The name of the subreddit.
 * @returns {Promise<Object|null>} A promise that resolves to the subreddit's data object or null on error.
 */
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

            if (response.status >= 500) {
                throw new Error(`Server error: ${response.status}`);
            }

            if (!response.ok) {
                console.warn(`Subreddit r/${subredditName} not found or failed to load. Status: ${response.status}`);
                return null;
            }

            const data = await response.json();
            return data && data.data ? data.data : null;

        } catch (error) {
            console.error(`Attempt ${attempt} failed for r/${subredditName}:`, error.message);
            if (attempt === MAX_RETRIES) {
                return null;
            }
            await new Promise(r => setTimeout(r, 200 * attempt));
        }
    }
    return null;
}

/**
 * Formats a number into a human-friendly string (e.g., 12345 -> '12.3k', 1234567 -> '1.2m').
 * @param {number} num The number to format.
 * @returns {string} The formatted string.
 */
function formatMemberCount(num) {
    if (num === null || num === undefined) return 'N/A';
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return num.toLocaleString();
}

/**
 * Determines an activity label based on active users and total members.
 * @param {number} activeUsers Number of users currently active.
 * @param {number} totalMembers Total number of subscribers.
 * @returns {string} An activity label with an emoji.
 */
function getActivityLabel(activeUsers, totalMembers) {
    if (!totalMembers || totalMembers === 0 || activeUsers === null || activeUsers === undefined) {
        return '💤 Cool';
    }
    const ratio = activeUsers / totalMembers;

    if (activeUsers > 5000 || (ratio > 0.01 && totalMembers > 1000)) {
        return '🔥 Hot';
    }
    if (activeUsers < 10 || (totalMembers > 20000 && activeUsers < 50)) {
        return '💤 Cool';
    }
    return '🌤️ Warm';
}

/**
 * Fetches details in batches, filters duds, ranks the rest, and returns a rich object for display.
 * @param {string[]} subredditNames - An array of subreddit names from the AI.
 * @returns {Promise<Object[]>} A promise that resolves to a ranked array of rich subreddit objects.
 */
async function fetchAndRankSubreddits(subredditNames) {
    console.log(`AI suggested ${subredditNames.length} subreddits. Validating and ranking in batches...`);
    const BATCH_SIZE = 5;
    let allDetails = [];

    for (let i = 0; i < subredditNames.length; i += BATCH_SIZE) {
        const batchNames = subredditNames.slice(i, i + BATCH_SIZE);
        const batchPromises = batchNames.map(name => fetchSubredditDetails(name));
        const batchResults = await Promise.all(batchPromises);
        allDetails.push(...batchResults);
    }

    const rankedSubreddits = allDetails
        .filter(details => {
            if (!details) return false;
            const isBigEnough = details.subscribers >= HARD_MIN_SUBSCRIBERS;
            const isActiveEnough = (details.active_user_count || 0) >= HARD_MIN_ACTIVE_USERS;
            return isBigEnough && isActiveEnough;
        })
        .map(details => ({
            name: details.display_name,
            members: details.subscribers,
            activityLabel: getActivityLabel(details.active_user_count, details.subscribers)
        }))
        .sort((a, b) => b.members - a.members);

    console.log(`Found ${rankedSubreddits.length} valid communities. Ready to display.`);
    return rankedSubreddits;
}


/**
 * Helper function to generate the HTML for a list of subreddit choices with a single unified pill.
 * @param {Object[]} subreddits - An array of rich subreddit objects.
 * @returns {string} The generated HTML string.
 */
function renderSubredditChoicesHTML(subreddits) {
    const activityColors = { '🔥 Hot': '#f0fff4', '🌤️ Warm': '#fffbeb', '💤 Cool': '#f9fafb' };
    const activityTextColors = { '🔥 Hot': '#2f855a', '🌤️ Warm': '#b45309', '💤 Cool': '#4b5563' };
    
    return subreddits.map(sub => `
        <div class="subreddit-choice">
            <input type="checkbox" id="sub-${sub.name}" value="${sub.name}" checked>
            <label for="sub-${sub.name}">
                <span class="sub-name">r/${sub.name}</span>
                <span class="sub-pills">
                    <span class="pill members-pill">
                        ${formatMemberCount(sub.members)}
                    </span>
                    <span class="pill activity-pill" style="background-color: ${activityColors[sub.activityLabel]}; color: ${activityTextColors[sub.activityLabel]};">
                        ${sub.activityLabel}
                    </span>
                </span>
            </label>
        </div>
    `).join('');
}

/**
 * Displays the initial list of subreddits and a "Load More" button if applicable.
 * @param {Object[]} rankedSubreddits - The full, sorted list of rich subreddit objects.
 */
function displaySubredditChoices(rankedSubreddits) {
    const choicesDiv = document.getElementById('subreddit-choices');
    const loadMoreContainer = document.getElementById('load-more-container');
    if (!choicesDiv || !loadMoreContainer) return;

    loadMoreContainer.innerHTML = '';
    _allRankedSubreddits = rankedSubreddits;

    if (_allRankedSubreddits.length === 0) {
        choicesDiv.innerHTML = '<p class="loading-text">No suitable communities found. Try a different group.</p>';
        return;
    }

    const initialToShow = _allRankedSubreddits.slice(0, 8);
    choicesDiv.innerHTML = renderSubredditChoicesHTML(initialToShow);

    if (_allRankedSubreddits.length > 8) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'load-more-subs-btn';
        loadMoreBtn.textContent = 'Load More Communities';
        loadMoreBtn.style.cssText = "padding: 8px 20px; border-radius: 50px; border: 1px solid var(--minky-glass-border); background-color: var(--minky-glass-bg-hover); color: var(--minky-text-primary); cursor: pointer; font-weight: 500; font-family: var(--pf-font-family); font-size: 1rem;";
        loadMoreBtn.onclick = loadMoreSubreddits;
        loadMoreContainer.appendChild(loadMoreBtn);
    }
}

/**
 * Loads the next batch of subreddits and appends them to the list.
 */
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

    container.innerHTML = `<h3 class="dashboard-section-title">Analysis Based On</h3><div class="subreddit-tag-list" style="display: flex; flex-wrap: wrap; justify-content: center; align-items: stretch;"><p class="loading-text" style="font-family: Inter, sans-serif; color: #777; padding: 1rem;">Loading community details...</p></div>`;

    try {
        const detailPromises = subreddits.map(sub => fetchSubredditDetails(sub));
        const detailsArray = await Promise.all(detailPromises);

        const tagsHTML = detailsArray.map((details, index) => {
            const subName = subreddits[index];
            
            if (!details) {
                return `<div class="subreddit-tag-detailed" style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 12px; margin: 8px; width: 280px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: center;">
                            <div class="tag-header" style="font-weight: bold; color: #007bff;">r/${subName}</div>
                            <div class="tag-body" style="font-style: italic; color: #6c757d; font-size: 0.9rem; margin-top: 8px;">Details could not be loaded.</div>
                        </div>`;
            }

            const description = details.public_description || 'No public description available.';
            const members = formatMemberCount(details.subscribers);
            const activityData = getActivityLabel(details.active_user_count, details.subscribers).split(' ');
            const activityEmoji = activityData[0];
            const activityText = activityData[1];

            return `<div class="subreddit-tag-detailed" style="background: #ffffff; border: 1px solid #dee2e6; border-radius: 8px; padding: 12px; margin: 8px; width: 280px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column;">
                        <div class="tag-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span class="tag-name" style="font-weight: bold; font-size: 1rem; color: #0056b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">r/${subName}</span>
                            <span class="tag-activity" style="font-size: 0.8rem; background: #e9ecef; color: #495057; padding: 3px 8px; border-radius: 12px; flex-shrink: 0; margin-left: 8px;">${activityEmoji} ${activityText}</span>
                        </div>
                        <p class="tag-description" style="font-size: 0.85rem; color: #495057; margin: 0 0 10px 0; line-height: 1.4; flex-grow: 1;">${description.substring(0, 150)}${description.length > 150 ? '...' : ''}</p>
                        <div class="tag-footer" style="font-size: 0.8rem; color: #6c757d; text-align: right; border-top: 1px solid #f1f3f5; padding-top: 8px; margin-top: auto;">
                            <span class="tag-members"><strong>${members}</strong> members</span>
                        </div>
                    </div>`;
        }).join('');

        container.innerHTML = `<h3 class="dashboard-section-title">Analysis Based On</h3><div class="subreddit-tag-list" style="display: flex; flex-wrap: wrap; justify-content: center; align-items: stretch;">${tagsHTML}</div>`;

    } catch (error) {
        console.error("Error rendering subreddit details:", error);
        const tags = subreddits.map(sub => `<div class="subreddit-tag">r/${sub}</div>`).join('');
        container.innerHTML = `<h3 class="dashboard-section-title">Analysis Based On</h3><div class="subreddit-tag-list">${tags}<p style="width: 100%; text-align: center; color: #dc3545; font-style: italic; margin-top: 10px;">Could not load community details.</p></div>`;
    }
}

// =================================================================================
// === NEW FEATURE: RELATED SUBREDDIT SUGGESTIONS (ADDED PER REQUEST) ===
// =================================================================================

/**
 * Uses AI to find related subreddits based on an existing list of communities.
 * @param {Array<Object>} analyzedSubsData - Array of objects with {name, description} for each analyzed sub.
 * @returns {Promise<string[]>} A promise that resolves to an array of new subreddit names.
 */
async function findRelatedSubredditsAI(analyzedSubsData) {
    const subNames = analyzedSubsData.map(d => d.name).join(', ');
    const descriptions = analyzedSubsData.map(d => `r/${d.name}: ${d.description.substring(0, 300)}...`).join('\n');

    const prompt = `You are an expert Reddit community finder. Based on the following user-selected communities and their public descriptions, suggest up to 8 new but highly related subreddits for them to explore.

    CRITICAL: Do NOT include any of the original subreddits in your suggestions. The user is already analyzing them.
    Original Subreddits: ${subNames}

    Their Descriptions:
    ${descriptions}

    Provide your response ONLY as a JSON object with a single key "subreddits", containing an array of subreddit names (without "r/").`;

    const openAIParams = {
        model: "gpt-4o-mini",
        messages: [{
            role: "system",
            content: "You are an expert Reddit community finder providing answers in strict JSON format."
        }, {
            role: "user",
            content: prompt
        }],
        temperature: 0.3,
        max_tokens: 300,
        response_format: {
            "type": "json_object"
        }
    };

    try {
        const response = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: openAIParams })
        });
        if (!response.ok) throw new Error('OpenAI related subreddits request failed.');
        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        if (!parsed.subreddits || !Array.isArray(parsed.subreddits)) {
            throw new Error("AI response for related subs did not contain a 'subreddits' array.");
        }
        return parsed.subreddits;
    } catch (error) {
        console.error("Error finding related subreddits via AI:", error);
        return [];
    }
}

/**
 * Handles the click event for adding a related subreddit to the analysis.
 * @param {Event} event - The click event object.
 */
async function handleAddRelatedSubClick(event) {
    if (!event.target.classList.contains('add-related-sub-btn')) return;

    const button = event.target;
    const subName = button.dataset.subname;
    const subDetailsJSON = button.dataset.subDetails;

    if (!subName || !subDetailsJSON) {
        console.error("Missing subreddit data on the 'Add' button.");
        return;
    }

    button.textContent = 'Adding...';
    button.disabled = true;

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

        await runProblemFinder({ isUpdate: true });
    } catch (error) {
        console.error("Failed to add related sub and re-run analysis:", error);
        alert("An error occurred while adding the community. Please try again.");
    } finally {
        button.textContent = '+ Add to Analysis';
        button.disabled = false;
    }
}


/**
 * Orchestrates fetching, ranking, and rendering of related subreddits after an analysis.
 * @param {string[]} analyzedSubs - An array of subreddit names that were just analyzed.
 */
async function renderAndHandleRelatedSubreddits(analyzedSubs) {
    const container = document.getElementById('similar-subreddits-container');
    if (!container) return;

    container.innerHTML = `
        <h3 class="dashboard-section-title" style="margin-top: 2.5rem; margin-bottom: 1rem;">Related Communities to Explore</h3>
        <div class="subreddit-tag-list" style="display: flex; flex-wrap: wrap; justify-content: center; align-items: stretch;">
            <p class="loading-text" style="font-family: Inter, sans-serif; color: #777; padding: 1rem;">Finding similar communities...</p>
        </div>`;
    container.removeEventListener('click', handleAddRelatedSubClick);
    container.addEventListener('click', handleAddRelatedSubClick);

    try {
        const detailPromises = analyzedSubs.map(sub => fetchSubredditDetails(sub));
        const detailsArray = await Promise.all(detailPromises);
        const validDetails = detailsArray.filter(Boolean).map(d => ({
            name: d.display_name,
            description: d.public_description || ''
        }));

        if (validDetails.length === 0) throw new Error("Could not get details for source subreddits.");

        const relatedSubNames = await findRelatedSubredditsAI(validDetails);
        const newSubNames = relatedSubNames.filter(name => !analyzedSubs.some(s => s.toLowerCase() === name.toLowerCase()));

        if (newSubNames.length === 0) {
            container.querySelector('.subreddit-tag-list').innerHTML = `<p style="font-style: italic; color: #777; padding: 1rem;">No new related communities were found.</p>`;
            return;
        }

        const rankedRelatedSubs = await fetchAndRankSubreddits(newSubNames);

        if (rankedRelatedSubs.length === 0) {
            container.querySelector('.subreddit-tag-list').innerHTML = `<p style="font-style: italic; color: #777; padding: 1rem;">No suitable communities found after validation.</p>`;
            return;
        }

        const tagsHTML = rankedRelatedSubs.slice(0, 6).map(
