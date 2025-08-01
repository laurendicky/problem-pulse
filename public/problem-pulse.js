// =================================================================================
// FINAL SCRIPT (VERSION 10.4 - FIXED & MERGED)
// Contains the new AI Topic Polarity Map AND all other restored dashboard functions.
// =================================================================================

// --- 1. GLOBAL VARIABLES & CONSTANTS ---
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy';
let originalGroupName = '';
const suggestions = ["Dog Lovers", "Start-up Founders", "Fitness Beginners", "AI Enthusiasts", "Home Bakers", "Gamers", "Content Creators", "Developers", "Brides To Be"];
const positiveColors = ['#2E7D32', '#388E3C', '#43A047', '#1B5E20', '#66BB6A', '#81C784'];
const negativeColors = ['#C62828', '#D32F2F', '#E53935', '#B71C1C', '#EF5350', '#F44336'];
const lemmaMap = { 'needs': 'need', 'wants': 'want', 'loves': 'love', 'loved': 'love', 'loving': 'love', 'hates': 'hate', 'wishes': 'wish', 'wishing': 'wish', 'solutions': 'solution', 'challenges': 'challenge', 'recommended': 'recommend', 'disappointed': 'disappoint', 'frustrated': 'frustrate', 'annoyed': 'annoy' };
const positiveWords = new Set(['love', 'amazing', 'awesome', 'beautiful', 'best', 'brilliant', 'celebrate', 'charming', 'dope', 'excellent', 'excited', 'exciting', 'epic', 'fantastic', 'flawless', 'gorgeous', 'happy', 'impressed', 'incredible', 'insane', 'joy', 'keen', 'lit', 'perfect', 'phenomenal', 'proud', 'rad', 'super', 'stoked', 'thrilled', 'vibrant', 'wow', 'wonderful', 'blessed', 'calm', 'chill', 'comfortable', 'cozy', 'grateful', 'loyal', 'peaceful', 'pleased', 'relaxed', 'relieved', 'satisfied', 'secure', 'thankful', 'want', 'wish', 'hope', 'desire', 'craving', 'benefit', 'bonus', 'deal', 'hack', 'improvement', 'quality', 'solution', 'strength', 'advice', 'tip', 'trick', 'recommend']);
const negativeWords = new Set(['angry', 'annoy', 'anxious', 'awful', 'bad', 'broken', 'hate', 'challenge', 'confused', 'crazy', 'critical', 'danger', 'desperate', 'disappoint', 'disgusted', 'dreadful', 'fear', 'frustrate', 'furious', 'horrible', 'irritated', 'jealous', 'nightmare', 'outraged', 'pain', 'panic', 'problem', 'rant', 'scared', 'shocked', 'stressful', 'terrible', 'terrified', 'trash', 'worst', 'alone', 'ashamed', 'bored', 'depressed', 'discouraged', 'dull', 'empty', 'exhausted', 'failure', 'guilty', 'heartbroken', 'hopeless', 'hurt', 'insecure', 'lonely', 'miserable', 'sad', 'sorry', 'tired', 'unhappy', 'upset', 'weak', 'need', 'disadvantage', 'issue', 'flaw']);
const emotionalIntensityScores = { 'annoy': 3, 'irritated': 3, 'bored': 2, 'issue': 3, 'sad': 4, 'bad': 3, 'confused': 4, 'tired': 3, 'upset': 5, 'unhappy': 5, 'disappoint': 6, 'frustrate': 6, 'stressful': 6, 'awful': 7, 'hate': 8, 'angry': 7, 'broken': 5, 'exhausted': 5, 'pain': 7, 'miserable': 8, 'terrible': 8, 'worst': 9, 'horrible': 8, 'furious': 9, 'outraged': 9, 'dreadful': 8, 'terrified': 10, 'nightmare': 10, 'heartbroken': 9, 'desperate': 8, 'rage': 10, 'problem': 4, 'challenge': 5, 'critical': 6, 'danger': 7, 'fear': 7, 'panic': 8, 'scared': 6, 'shocked': 7, 'trash': 5, 'alone': 4, 'ashamed': 5, 'depressed': 8, 'discouraged': 5, 'dull': 2, 'empty': 6, 'failure': 7, 'guilty': 6, 'hopeless': 8, 'insecure': 5, 'lonely': 6, 'weak': 4, 'need': 5, 'disadvantage': 4, 'flaw': 4 };
const stopWords = ["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves", "like", "just", "dont", "can", "people", "help", "hes", "shes", "thing", "stuff", "really", "actually", "even", "know", "still", "post", "posts", "subreddit", "redditor", "redditors", "comment", "comments"];

// --- 2. ALL HELPER AND LOGIC FUNCTIONS ---
function deduplicatePosts(posts) { const seen = new Set(); return posts.filter(post => { if (!post.data || !post.data.id) return false; if (seen.has(post.data.id)) return false; seen.add(post.data.id); return true; }); }
function formatDate(utcSeconds) { const date = new Date(utcSeconds * 1000); return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
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
async function findSubredditsForGroup(groupName) { const prompt = `Given the user-defined group "${groupName}", suggest up to 15 relevant and active Reddit subreddits. Provide your response ONLY as a JSON object with a single key "subreddits" which contains an array of subreddit names (without "r/").`; const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an expert Reddit community finder providing answers in strict JSON format." }, { role: "user", content: prompt }], temperature: 0.2, max_tokens: 250, response_format: { "type": "json_object" } }; try { const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) }); if (!response.ok) throw new Error('OpenAI API request failed.'); const data = await response.json(); const parsed = JSON.parse(data.openaiResponse); if (!parsed.subreddits || !Array.isArray(parsed.subreddits)) throw new Error("AI response did not contain a 'subreddits' array."); return parsed.subreddits; } catch (error) { console.error("Error finding subreddits:", error); alert("Sorry, I couldn't find any relevant communities. Please try another group name."); return []; } }
function displaySubredditChoices(subreddits) { const choicesDiv = document.getElementById('subreddit-choices'); if (!choicesDiv) return; choicesDiv.innerHTML = ''; if (subreddits.length === 0) { choicesDiv.innerHTML = '<p class="loading-text">No communities found.</p>'; return; } choicesDiv.innerHTML = subreddits.map(sub => `<div class="subreddit-choice"><input type="checkbox" id="sub-${sub}" value="${sub}" checked><label for="sub-${sub}">r/${sub}</label></div>`).join(''); }

// --- BLOCK 2: ALL DASHBOARD FUNCTIONS (RESTORED & MERGED) ---
function lemmatize(word) {
    const lowerWord = word.toLowerCase();
    if (lemmaMap[lowerWord]) return lemmaMap[lowerWord];
    if (lowerWord.endsWith('s') && !lowerWord.endsWith('ss')) return lowerWord.slice(0, -1);
    return lowerWord;
}

// THIS IS YOUR NEW, WORKING EMOTION MAP FUNCTION
async function generateEmotionMapData(posts) {
    const topPostsText = posts.slice(0, 50).map(p => `Title: ${p.data.title}\nBody: ${p.data.selftext.substring(0, 800)}`).join('\n---\n');
    const prompt = `You are a market research analyst. From the following text about '${originalGroupName}', identify up to 20 key TOPICS of discussion (e.g., "wedding dress", "family issues", "catering"). Respond ONLY with a JSON object with a single key "topics", containing an array of these topic strings.`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You extract key topics from text and respond in JSON." }, { role: "user", content: prompt }], temperature: 0.1, max_tokens: 400, response_format: { "type": "json_object" } };
    
    let topics = [];
    try {
        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!response.ok) throw new Error('AI topic extraction failed.');
        const data = await response.json();
        const parsed = JSON.parse(data.openaiResponse);
        topics = parsed.topics || [];
    } catch (error) {
        console.error("Emotion Map topic extraction error:", error);
        return [];
    }

    if (topics.length === 0) return [];

    const topicData = topics.map(topic => {
        const topicRegex = new RegExp(`\\b${topic.replace(/ /g, '\\s')}(s?)\\b`, 'i');
        let totalIntensity = 0;
        let emotionCount = 0;
        let mentionCount = 0;

        posts.forEach(post => {
            const postText = `${post.data.title} ${post.data.selftext || ''}`.toLowerCase();
            if (topicRegex.test(postText)) {
                mentionCount++;
                const words = postText.replace(/[^a-z\s']/g, '').split(/\s+/);
                words.forEach(rawWord => {
                    const lemma = lemmatize(rawWord);
                    if (emotionalIntensityScores[lemma]) {
                        totalIntensity += emotionalIntensityScores[lemma];
                        emotionCount++;
                    }
                });
            }
        });
        
        if (mentionCount > 0 && emotionCount > 0) {
            return {
                x: mentionCount,
                y: totalIntensity / emotionCount,
                label: topic
            };
        }
        return null;
    }).filter(Boolean);

    return topicData.sort((a, b) => b.x - a.x).slice(0, 25);
}

// THIS IS YOUR NEW, WORKING RENDER MAP FUNCTION
function renderEmotionMap(data) {
    const container = document.getElementById('emotion-map-container');
    if (!container) return;
    container.innerHTML = '<h3 class="dashboard-section-title">Topic Polarity Map</h3><div id="emotion-map"><canvas id="emotion-chart-canvas"></canvas></div>';
    const ctx = document.getElementById('emotion-chart-canvas')?.getContext('2d');
    if (!ctx) return;
    if (window.myEmotionChart) { window.myEmotionChart.destroy(); }
    if (data.length < 3) {
        container.innerHTML = '<h3 class="dashboard-section-title">Topic Polarity Map</h3><p style="font-family: Inter, sans-serif; color: #777; padding: 1rem;">Not enough data to build a polarity map.</p>';
        return;
    }
    const maxFreq = Math.max(...data.map(p => p.x));
    window.myEmotionChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Topics',
                data: data,
                backgroundColor: 'rgba(2, 119, 189, 0.7)',
                borderColor: 'rgba(1, 87, 155, 1)',
                borderWidth: 1,
                pointRadius: (context) => 5 + (context.raw.x / maxFreq) * 20,
                pointHoverRadius: (context) => 8 + (context.raw.x / maxFreq) * 20,
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const point = context.raw;
                            return `${point.label}: Frequency=${point.x}, Avg. Intensity=${point.y.toFixed(1)}`;
                        }
                    },
                    displayColors: false,
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 12 }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Frequency of Topic Mention', font: { weight: 'bold' } }, min: 0, grid: { color: '#f0f0f0' } },
                y: { title: { display: true, text: 'Average Emotional Intensity', font: { weight: 'bold' } }, min: 0, max: 10, grid: { color: '#f0f0f0' } }
            }
        }
    });
}

// THE REST OF THE DASHBOARD FUNCTIONS ARE NOW RESTORED
function generateSentimentData(posts) {
    const sentiment = { positive: {}, negative: {}, positiveCount: 0, negativeCount: 0 };
    posts.forEach(post => {
        const text = `${post.data.title} ${post.data.selftext || ''}`;
        const words = text.replace(/[^a-zA-Z\s']/g, '').toLowerCase().split(/\s+/);
        const uniqueWordsInPost = new Set();
        words.forEach(word => { const lemma = lemmatize(word); if (stopWords.includes(lemma)) return; uniqueWordsInPost.add(lemma); });
        uniqueWordsInPost.forEach(lemma => {
            if (positiveWords.has(lemma)) { sentiment.positiveCount++; if (!sentiment.positive[lemma]) sentiment.positive[lemma] = { count: 0, posts: new Set() }; sentiment.positive[lemma].count++; sentiment.positive[lemma].posts.add(post); }
            else if (negativeWords.has(lemma)) { sentiment.negativeCount++; if (!sentiment.negative[lemma]) sentiment.negative[lemma] = { count: 0, posts: new Set() }; sentiment.negative[lemma].count++; sentiment.negative[lemma].posts.add(post); }
        });
    });
    return sentiment;
}

function renderSentimentCloud(containerId, wordData, colors) {
    const container = document.getElementById(containerId); if (!container) return;
    const words = Object.entries(wordData).sort(([, a], [, b]) => b.count - a.count).slice(0, 30);
    if (words.length === 0) { container.innerHTML = `<p style="font-family: Inter, sans-serif; color: #777; text-align: center;">No significant terms found.</p>`; return; }
    const maxCount = Math.max(...words.map(([, data]) => data.count)); const minCount = Math.min(...words.map(([, data]) => data.count));
    const cloudHTML = words.map(([word, data]) => { const fontSize = 12 + 28 * ((data.count - minCount) / (maxCount - minCount || 1)); const color = colors[Math.floor(Math.random() * colors.length)]; return `<span class="cloud-word" data-word="${word}" style="font-size:${fontSize}px; color:${color}; margin: 2px 5px; cursor: pointer; display: inline-block;">${word}</span>`; }).join('');
    container.innerHTML = `<div style="display: flex; flex-wrap: wrap; justify-content: center; align-items: center;">${cloudHTML}</div>`;
}

function renderContextContent(word, posts) {
    const container = document.getElementById('context-box'); if (!container) return;
    const uniquePosts = Array.from(new Set(posts.map(p => p.data.id))).map(id => posts.find(p => p.data.id === id)).slice(0, 5);
    const regex = new RegExp(`\\b(${word})\\b`, 'gi');
    const html = uniquePosts.map(post => { const textSnippet = getFirstTwoSentences(post.data.selftext || post.data.title); const highlightedSnippet = textSnippet.replace(regex, `<mark>$1</mark>`); return ` <div class="context-item" style="border-bottom: 1px solid #eee; padding: 8px 0; margin-bottom: 8px;"> <a href="https://reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight: bold; color: #007bff; text-decoration: none;">${post.data.title}</a> <p style="font-size: 0.9em; color: #555; margin: 4px 0 0;">...${highlightedSnippet}...</p> </div> `; }).join('');
    container.innerHTML = `<h4 style="margin-top:0; margin-bottom: 12px;">Context for "${word}"</h4>${html || '<p>No specific context found.</p>'}`;
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function generateFAQs(posts) {
    const content = posts.slice(0, 15).map(p => `Title: ${p.data.title}\nContent: ${p.data.selftext}`).join('\n\n---\n\n');
    const prompt = `Based on the following Reddit posts about "${originalGroupName}", generate 3-5 frequently asked questions (FAQs) that a person in this group might have. For each question, provide a concise, helpful answer derived from the posts. Respond ONLY in a JSON format with a single key "faqs", containing an array of objects. Each object must have a "question" and an "answer" key. \n\nPOSTS:\n${content}`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an FAQ generation assistant. Output ONLY valid JSON." }, { role: "user", content: prompt }], temperature: 0.2, max_tokens: 1000, response_format: { "type": "json_object" } };
    try { const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', body: JSON.stringify({ openaiPayload: openAIParams }), headers: { 'Content-Type': 'application/json' } }); if (!response.ok) return []; const data = await response.json(); const parsed = JSON.parse(data.openaiResponse); return (parsed && parsed.faqs) ? parsed.faqs : []; } catch (e) { console.error("FAQ generation failed:", e); return []; }
}

async function extractAndValidateEntities(posts, nicheContext) {
    const content = posts.slice(0, 25).map(p => p.data.title + ". " + p.data.selftext).join("\n");
    const prompt = `Analyze the following text from discussions about "${nicheContext}". Extract specific brand names and common generic product types mentioned. Respond ONLY in a JSON format with two keys: "brands" and "products". Each key should contain an array of strings. - "brands": List specific company or brand names (e.g., "Nike", "Sony", "Canva"). - "products": List generic product categories (e.g., "running shoes", "camera", "graphic design tool"). TEXT: ${content}`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.1, response_format: { "type": "json_object" } };
    try { const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', body: JSON.stringify({ openaiPayload: openAIParams }), headers: { 'Content-Type': 'application/json' } }); if (!response.ok) return { topBrands: [], topProducts: [] }; const data = await response.json(); const parsed = JSON.parse(data.openaiResponse); const processEntities = (entityList) => { const counts = {}; entityList.forEach(entity => { const e = entity.trim().toLowerCase(); if (e && e.length > 2 && !stopWords.includes(e)) { counts[e] = (counts[e] || 0) + 1; } }); return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10); }; const topBrands = processEntities(parsed.brands || []); const topProducts = processEntities(parsed.products || []); return { topBrands, topProducts }; } catch (e) { console.error("Entity extraction failed:", e); return { topBrands: [], topProducts: [] }; }
}

function renderDiscoveryList(containerId, data, title, type) {
    const container = document.getElementById(containerId); if (!container) return;
    let html = `<h3 class="dashboard-section-title">${title}</h3>`;
    if (data.length > 0) { html += `<ul class="discovery-list">` + data.map(([name, count]) => `<li class="discovery-list-item" data-word="${name}" data-type="${type}" style="cursor: pointer;"> <span class="discovery-item-name">${name}</span> <span class="discovery-item-count">${count}</span> </li>`).join('') + `</ul>`; }
    else { html += `<p style="font-family: Inter, sans-serif; color: #777;">None discovered.</p>`; }
    container.innerHTML = html;
}

function renderFAQs(faqs) {
    const container = document.getElementById('faq-container'); if (!container) return;
    let html = '<h3 class="dashboard-section-title">Common Questions</h3>';
    if (faqs && faqs.length > 0) { html += faqs.map(faq => `<div class="faq-item"> <p class="faq-question">${faq.question}</p> <p class="faq-answer">${faq.answer}</p> </div>`).join(''); }
    else { html += `<p style="font-family: Inter, sans-serif; color: #777;">No common questions could be generated.</p>`; }
    container.innerHTML = html;
}

function renderIncludedSubreddits(subreddits) {
    const container = document.getElementById('included-subreddits-container'); if (!container) return;
    let html = '<h3 class="dashboard-section-title">Communities Analyzed</h3>';
    if (subreddits && subreddits.length > 0) { html += `<div class="subreddit-pills-container">` + subreddits.map(sub => `<span class="subreddit-pill">r/${sub}</span>`).join('') + `</div>`; }
    else { html += `<p>No subreddits were analyzed.</p>`; }
    container.innerHTML = html;
}

function renderSentimentScore(positiveCount, negativeCount) {
    const container = document.getElementById('sentiment-score-container'); if (!container) return;
    const total = positiveCount + negativeCount; if (total === 0) { container.innerHTML = '<h3 class="dashboard-section-title">Problem Score</h3><p>Not enough data.</p>'; return; }
    const score = Math.round((negativeCount / total) * 100); const scoreColor = score > 60 ? '#D32F2F' : score > 40 ? '#F57C00' : '#388E3C';
    container.innerHTML = ` <h3 class="dashboard-section-title">Problem Score</h3> <div class="sentiment-score-value" style="color: ${scoreColor};">${score}</div> <div class="sentiment-score-bar-background"> <div class="sentiment-score-bar-foreground" style="width: ${score}%; background-color: ${scoreColor};"></div> </div> <p class="sentiment-score-label">A higher score indicates a higher proportion of negative sentiment in the discussions.</p> `;
}


// =================================================================================
// BLOCK 3 of 4: MAIN ANALYSIS FUNCTION
// =================================================================================
async function runProblemFinder() {
    const searchButton = document.getElementById('search-selected-btn');
    if (!searchButton) { console.error("Could not find button."); return; }

    const selectedCheckboxes = document.querySelectorAll('#subreddit-choices input:checked');
    if (selectedCheckboxes.length === 0) { alert("Please select at least one community."); return; }
    const selectedSubreddits = Array.from(selectedCheckboxes).map(cb => cb.value);
    const subredditQueryString = selectedSubreddits.map(sub => `subreddit:${sub}`).join(' OR ');

    searchButton.classList.add('is-loading');
    searchButton.disabled = true;

    const quickSearchTerms = [ "problem", "challenge", "frustration", "annoyance", "wish I could", "hate that", "help with", "solution for" ];
    const deepSearchTerms = [ "struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve", "annoyance", "frustration", "disappointed", "help", "advice", "solution", "workaround", "how to", "fix", "rant", "vent" ];
    const searchDepth = document.querySelector('input[name="search-depth"]:checked')?.value || 'quick';
    let searchTerms = (searchDepth === 'deep') ? deepSearchTerms : quickSearchTerms;
    let limitPerTerm = (searchDepth === 'deep') ? 100 : 50;
    
    const resultsWrapper = document.getElementById('results-wrapper-b');
    if (resultsWrapper) { resultsWrapper.style.display = 'none'; resultsWrapper.style.opacity = '0'; }
    
    // Clear all dashboard containers
    ["count-header", "filter-header", "findings-1", "findings-2", "findings-3", "findings-4", "findings-5", "pulse-results", "posts-container", "emotion-map-container", "sentiment-score-container", "positive-cloud", "negative-cloud", "top-brands-container", "top-products-container", "faq-container", "included-subreddits-container", "context-box"].forEach(id => { const el = document.getElementById(id); if (el) { el.innerHTML = ""; } });
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
        if (allPosts.length === 0) { throw new Error("No results found."); }
        
        const filteredPosts = filterPosts(allPosts, selectedMinUpvotes);
        if (filteredPosts.length < 10) { throw new Error("Not enough high-quality posts found to analyze."); }
        
        window._filteredPosts = filteredPosts;
        renderPosts(filteredPosts);

        // --- RENDER ALL DASHBOARD COMPONENTS ---
        const sentimentData = generateSentimentData(filteredPosts);
        window._sentimentData = sentimentData;
        renderSentimentScore(sentimentData.positiveCount, sentimentData.negativeCount);
        renderSentimentCloud('positive-cloud', sentimentData.positive, positiveColors);
        renderSentimentCloud('negative-cloud', sentimentData.negative, negativeColors);
        
        // This now uses your new AI-powered function
        generateEmotionMapData(filteredPosts).then(emotionMapData => {
            renderEmotionMap(emotionMapData);
        });

        renderIncludedSubreddits(selectedSubreddits);
        
        extractAndValidateEntities(filteredPosts, originalGroupName).then(entities => {
            renderDiscoveryList('top-brands-container', entities.topBrands, 'Top Brands & Specific Products', 'brands');
            renderDiscoveryList('top-products-container', entities.topProducts, 'Top Generic Products', 'products');
        });
        generateFAQs(filteredPosts).then(faqs => renderFAQs(faqs));

        const userNicheCount = allPosts.filter(p => ((p.data.title + p.data.selftext).toLowerCase()).includes(originalGroupName.toLowerCase())).length;
        if (countHeaderDiv) countHeaderDiv.textContent = `Found over ${userNicheCount.toLocaleString()} posts discussing problems related to "${originalGroupName}".`;
        
        const topKeywords = getTopKeywords(filteredPosts, 10);
        const topPosts = filteredPosts.slice(0, 30);
        const combinedTexts = topPosts.map(post => `${post.data.title}. ${getFirstTwoSentences(post.data.selftext)}`).join("\n\n");
        const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a helpful assistant that summarizes user-provided text into between 1 and 5 core common struggles and provides authentic quotes." }, { role: "user", content: `Your task is to analyze the provided text about the niche "${originalGroupName}" and identify 1 to 5 common problems. You MUST provide your response in a strict JSON format. The JSON object must have a single top-level key named "summaries". The "summaries" key must contain an array of objects. Each object in the array represents one common problem and must have the following keys: "title", "body", "count", "quotes", "keywords". Here are the top keywords to guide your analysis: [${topKeywords.join(', ')}]. Make sure the niche "${originalGroupName}" is naturally mentioned in each "body". Example of the required output format: { "summaries": [ { "title": "Example Title 1", "body": "Example body text about the problem.", "count": 50, "quotes": ["Quote A", "Quote B", "Quote C"], "keywords": ["keyword1", "keyword2"] } ] }. Here is the text to analyze: \`\`\`${combinedTexts}\`\`\`` }], temperature: 0.0, max_tokens: 1500, response_format: { "type": "json_object" } };
        const openAIResponse = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
        if (!openAIResponse.ok) throw new Error('OpenAI summary generation failed.');
        const openAIData = await openAIResponse.json();
        const summaries = parseAISummary(openAIData.openaiResponse);
        const validatedSummaries = summaries.filter(finding => filteredPosts.filter(post => calculateRelevanceScore(post, finding) > 0).length >= 3);
        if (validatedSummaries.length === 0) { throw new Error("While posts were found, none formed a clear, common problem."); }
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

        if (countHeaderDiv && countHeaderDiv.textContent.trim() !== "") {
            if (resultsWrapper) resultsWrapper.style.setProperty('display', 'flex', 'important');
            setTimeout(() => {
                if (resultsWrapper) {
                    resultsWrapper.style.opacity = '1';
                    resultsWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 50); 
        }

    } catch (err) {
        console.error("Error in main analysis:", err);
        const resultsMessageDiv = document.getElementById("results-message");
        if (resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error' style="color: red; text-align: center; padding: 1rem; background-color: #fff0f0; border: 1px solid red; border-radius: 8px;">❌ ${err.message}</p>`;
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
// BLOCK 4 of 4: INITIALIZATION LOGIC
// =================================================================================
function initializeDashboardInteractivity() {
    const dashboard = document.getElementById('results-wrapper-b');
    if (!dashboard) return;
    dashboard.addEventListener('click', (e) => {
        const cloudWordEl = e.target.closest('.cloud-word');
        if (cloudWordEl) {
            const word = cloudWordEl.dataset.word;
            const category = cloudWordEl.closest('#positive-cloud') ? 'positive' : 'negative';
            const postsData = window._sentimentData?.[category]?.[word]?.posts;
            if (postsData) {
                renderContextContent(word, Array.from(postsData));
            }
        }
    });
}

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
    if (!findCommunitiesBtn || !searchSelectedBtn || !backButton || !choicesContainer) { console.error("Critical error: A key element for the tool's UI was not found. Aborting initialization."); return; }
    const transitionToStep2 = () => { if (!step1Container || !step2Container || !choicesContainer || !audienceTitle) return; if (step2Container.classList.contains('visible')) return; step1Container.classList.add('hidden'); step2Container.classList.add('visible'); choicesContainer.innerHTML = '<p class="loading-text">Finding relevant communities...</p>'; audienceTitle.textContent = `Select Subreddits For: ${originalGroupName}`; };
    const transitionToStep1 = () => { if (!step1Container || !step2Container) return; step2Container.classList.remove('visible'); step1Container.classList.remove('hidden'); const resultsWrapper = document.getElementById('results-wrapper-b'); if (resultsWrapper) { resultsWrapper.style.display = 'none'; } };
    if (pillsContainer) {
        pillsContainer.innerHTML = suggestions.map(s => `<div class="pf-suggestion-pill" data-value="${s}">${s}</div>`).join('');
        pillsContainer.addEventListener('click', (event) => { if (event.target.classList.contains('pf-suggestion-pill') && groupInput) { groupInput.value = event.target.getAttribute('data-value'); findCommunitiesBtn.click(); } });
    }
    if (inspireButton) { inspireButton.addEventListener('click', () => { if (pillsContainer) pillsContainer.classList.toggle('visible'); }); }
    findCommunitiesBtn.addEventListener("click", async (event) => { event.preventDefault(); const groupName = groupInput ? groupInput.value.trim() : ''; if (!groupName) { alert("Please enter a group of people or select a suggestion."); return; } originalGroupName = groupName; transitionToStep2(); const subreddits = await findSubredditsForGroup(groupName); displaySubredditChoices(subreddits); });
    searchSelectedBtn.addEventListener("click", (event) => { event.preventDefault(); runProblemFinder(); });
    backButton.addEventListener('click', (e) => { e.preventDefault(); transitionToStep1(); });
    choicesContainer.addEventListener('click', (event) => { const choiceDiv = event.target.closest('.subreddit-choice'); if (choiceDiv) { const checkbox = choiceDiv.querySelector('input[type="checkbox"]'); if (checkbox) { if (event.target.tagName !== 'INPUT') { checkbox.checked = !checkbox.checked; } } } });
    initializeDashboardInteractivity();
    console.log("Problem Finder tool successfully initialized.");
}

function waitForElementAndInit() {
    const keyElementId = 'find-communities-btn';
    let retries = 0;
    const maxRetries = 50;
    const intervalId = setInterval(() => {
        const keyElement = document.getElementById(keyElementId);
        if (keyElement) { clearInterval(intervalId); initializeProblemFinderTool(); }
        else { retries++; if (retries > maxRetries) { clearInterval(intervalId); console.error(`Initialization FAILED. Key element "#${keyElementId}" not found after ${maxRetries} retries.`); } }
    }, 100);
}

// --- SCRIPT ENTRY POINT ---
document.addEventListener('DOMContentLoaded', waitForElementAndInit);
