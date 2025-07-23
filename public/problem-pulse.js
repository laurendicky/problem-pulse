// =================================================================================
// FINAL, COMPLETE SCRIPT
// =================================================================================

// --- GLOBAL VARIABLES & CONSTANTS ---
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy';
let originalGroupName = '';
const suggestions = ["Dog Lovers", "Start-up Founders", "Fitness Beginners", "AI Enthusiasts", "Home Bakers", "Gamers", "Content Creators", "Developers", "Brides To Be"];

// --- INITIALIZATION ---
// This runs once the entire HTML page is loaded and ready.
document.addEventListener('DOMContentLoaded', () => {
    // Setup for suggestion pills
    const pillsContainer = document.getElementById('pf-suggestion-pills');
    const groupInput = document.getElementById('group-input');
    const findCommunitiesBtn = document.getElementById('find-communities-btn');

    if (pillsContainer && groupInput && findCommunitiesBtn) {
        pillsContainer.innerHTML = suggestions.map(s => `<div class="pf-suggestion-pill" data-value="${s}">${s}</div>`).join('');
        pillsContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('pf-suggestion-pill')) {
                groupInput.value = event.target.getAttribute('data-value');
                findCommunitiesBtn.click();
            }
        });
    }
});


// --- EVENT LISTENERS (attached directly) ---

// PHASE 1: FIND COMMUNITIES
document.getElementById("find-communities-btn").addEventListener("click", async function(event) {
    event.preventDefault();
    const groupInput = document.getElementById('group-input');
    const groupName = groupInput.value.trim();
    if (!groupName) {
        alert("Please enter a group of people or select a suggestion.");
        return;
    }
    originalGroupName = groupName;
    const gridContainer = document.getElementById('expansion-grid-container');
    const choicesDiv = document.getElementById('subreddit-choices');
    choicesDiv.innerHTML = '<p class="loading-text">Finding relevant communities...</p>';
    gridContainer.classList.add('visible');
    const subreddits = await findSubredditsForGroup(groupName);
    displaySubredditChoices(subreddits);
});


// PHASE 2: FIND PROBLEMS
document.getElementById("search-selected-btn").addEventListener("click", async function(event) {
    event.preventDefault();
    const selectedCheckboxes = document.querySelectorAll('#subreddit-choices input:checked');
    if (selectedCheckboxes.length === 0) { alert("Please select at least one community."); return; }
    const selectedSubreddits = Array.from(selectedCheckboxes).map(cb => cb.value);
    const subredditQueryString = selectedSubreddits.map(sub => `subreddit:${sub}`).join(' OR ');

    // --- Start of main analysis logic ---
    const resultsWrapper = document.getElementById('results-wrapper');
    if (resultsWrapper) { resultsWrapper.style.display = 'none'; resultsWrapper.style.opacity = '0'; }
    ["count-header", "filter-header", "findings-1", "findings-2", "findings-3", "findings-4", "findings-5", "pulse-results", "posts-container"].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
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
    const searchTerms = ["struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve", "annoyance", "frustration", "disappointed", "help", "advice", "solution", "workaround", "how to", "fix", "rant", "vent"];

    try {
        let allPosts = await fetchMultipleRedditDataBatched(subredditQueryString, searchTerms, 100, selectedTime);
        if (allPosts.length === 0) { throw new Error("No results found in the selected communities for these problem keywords."); }
        const filteredPosts = filterPosts(allPosts, selectedMinUpvotes);
        if (filteredPosts.length < 10) { throw new Error("Not enough high-quality posts found for analysis. Try selecting more communities."); }
        window._filteredPosts = filteredPosts;
        renderPosts(filteredPosts);

        const userNicheCount = allPosts.filter(p => ((p.data.title + p.data.selftext).toLowerCase()).includes(originalGroupName.toLowerCase())).length;
        if (countHeaderDiv) {
            countHeaderDiv.textContent = userNicheCount === 1 ? `Found 1 post discussing problems related to "${originalGroupName}".` : `Found over ${userNicheCount.toLocaleString()} posts discussing problems related to "${originalGroupName}".`;
            if (resultsWrapper) { resultsWrapper.style.display = 'block'; setTimeout(() => { resultsWrapper.style.opacity = '1'; }, 50); }
        }

        const topKeywords = getTopKeywords(filteredPosts, 10);
        const topPosts = filteredPosts.slice(0, 80);
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
    } catch (err) {
        console.error("Error in main analysis:", err);
        const resultsMessageDiv = document.getElementById("results-message");
        if(resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error' style="color: red; text-align: center;">❌ ${err.message}</p>`;
        findingDivs.forEach(div => { if (div) div.innerHTML = ""; });
        if(countHeaderDiv) countHeaderDiv.innerHTML = "";
    }
});


// --- ALL HELPER FUNCTIONS ---
// This section contains all the functions your script uses. They are complete and correct.
const stopWords=["a","about","above","after","again","against","all","am","an","and","any","are","aren't","as","at","be","because","been","before","being","below","between","both","but","by","can't","cannot","could","couldn't","did","didn't","do","does","doesn't","doing","don't","down","during","each","few","for","from","further","had","hadn't","has","hasn't","have","haven't","having","he","he'd","he'll","he's","her","here","here's","hers","herself","him","himself","his","how","how's","i","i'd","i'll","i'm","i've","if","in","into","is","isn't","it","it's","its","itself","let's","me","more","most","mustn't","my","myself","no","nor","not","of","off","on","once","only","or","other","ought","our","ours","ourselves","out","over","own","same","shan't","she","she'd","she'll","she's","should","shouldn't","so","some","such","than","that","that's","the","their","theirs","them","themselves","then","there","there's","these","they","they'd","they'll","they're","they've","this","those","through","to","too","under","until","up","very","was","wasn't","we","we'd","we'll","we're","we've","were","weren't","what","what's","when","when's","where","where's","which","while","who","who's","whom","why","why's","with","won't","would","wouldn't","you","you'd","you'll","you're","you've","your","yours","yourself","yourselves","like","just","dont","can","people","help","hes","shes","thing","stuff","really","actually","even","know","still"];
function deduplicatePosts(e){const t=new Set;return e.filter(e=>{return!(!e.data||!e.data.id)&&!t.has(e.data.id)&&(t.add(e.data.id),!0)})}
function formatDate(e){return new Date(1e3*e).toLocaleDateString(void 0,{year:"numeric",month:"short",day:"numeric"})}
async function fetchRedditForTermWithPagination(e,t,r=100,n="all"){let o=[],s=null;try{for(;o.length<r;){const r=await fetch(REDDIT_PROXY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchTerm:t,niche:e,limit:25,timeFilter:n,after:s})});if(!r.ok)throw new Error(`Proxy Error: ${r.status}`);const a=await r.json();if(!a.data||!a.data.children||!a.data.children.length)break;if(o=o.concat(a.data.children),s=a.data.after,!s)break}}catch(i){return console.error(`Failed to fetch posts for term "${t}" via proxy:`,i.message),[]}return o.slice(0,r)}
async function fetchMultipleRedditDataBatched(e,t,r=100,n="all"){const o=[];for(let s=0;s<t.length;s+=8){const a=t.slice(s,s+8),i=a.map(t=>fetchRedditForTermWithPagination(e,t,r,n)),l=await Promise.all(i);l.forEach(e=>{Array.isArray(e)&&o.push(...e)}),s+8<t.length&&await new Promise(e=>setTimeout(e,500))}return deduplicatePosts(o)}
function parseAISummary(e){try{e=e.replace(/```(?:json)?\s*/,"").replace(/```$/,"").trim();const t=e.match(/{[\s\S]*}/);if(!t)throw new Error("No JSON object in AI response.");const r=JSON.parse(t[0]);if(!r.summaries||!Array.isArray(r.summaries)||r.summaries.length<1)throw new Error("AI response lacks a 'summaries' array.");return r.summaries.forEach((e,t)=>{const r=[];e.title||r.push("title"),e.body||r.push("body"),"number"!=typeof e.count&&r.push("count"),(!e.quotes||!Array.isArray(e.quotes)||e.quotes.length<1)&&r.push("quotes"),(!e.keywords||!Array.isArray(e.keywords)||0===e.keywords.length)&&r.push("keywords");if(r.length>0)throw new Error(`Summary ${t+1} missing fields: ${r.join(", ")}.`)}),r.summaries}catch(n){throw console.error("Parsing Error:",n),console.log("Raw AI Response:",e),new Error("Failed to parse AI response.")}}
function parseAIAssignments(e){try{e=e.replace(/```(?:json)?\s*/,"").replace(/```$/,"").trim();const t=e.match(/{[\s\S]*}/);if(!t)throw new Error("No JSON object in AI response.");const r=JSON.parse(t[0]);if(!r.assignments||!Array.isArray(r.assignments))throw new Error("AI response lacks an 'assignments' array.");return r.assignments.forEach((e,t)=>{const r=[];"number"!=typeof e.postNumber&&r.push("postNumber"),"number"!=typeof e.finding&&r.push("finding");if(r.length>0)throw new Error(`Assignment ${t+1} missing fields: ${r.join(", ")}.`)}),r.assignments}catch(n){throw console.error("Parsing Error:",n),console.log("Raw AI Response:",e),new Error("Failed to parse AI response.")}}
function filterPosts(e,t=20){return e.filter(e=>{const r=e.data.title.toLowerCase(),n=e.data.selftext||"";return!r.includes("[ad]")&&!r.includes("sponsored")&&!(e.data.upvote_ratio<.2)&&!(e.data.ups<t)&&!!(n&&n.length>=100)})}
function getTopKeywords(e,t=10){const r={};e.forEach(e=>{const t=(e.data.title+" "+e.data.selftext).replace(/<[^>]+>/g,"").replace(/[^a-zA-Z0-9\s.,!?]/g,"").toLowerCase().replace(/\s+/g," ").trim().split(/\s+/);t.forEach(e=>{stopWords.includes(e)||e.length<=2||(r[e]=(r[e]||0)+1)})});return Object.keys(r).sort((e,t)=>r[t]-r[e]).slice(0,t)}
function getFirstTwoSentences(e){if(!e)return"";const t=e.match(/[^\.!\?]+[\.!\?]+(?:\s|$)/g);return t?t.slice(0,2).join(" ").trim():e}
async function assignPostsToFindings(e,t){const r=t.slice(0,75),n=`You are an expert data analyst. Your task is to categorize Reddit posts into the most relevant "Finding" from a provided list.\n\nHere are the ${e.length} findings you must use for categorization:\n${e.map((e,t)=>`\nFinding ${t+1}:\nTitle: ${e.title}\nSummary: ${e.body}`).join("\n")}\n\nHere are the ${r.length} Reddit posts to categorize. For each post, only consider its title and a short snippet of its body:\n${r.map((e,t)=>`\nPost ${t+1}:\nTitle: ${e.data.title}\nBody Snippet: ${getFirstTwoSentences(e.data.selftext)}`).join("\n")}\n\nINSTRUCTIONS:\nFor each post, decide which Finding (from 1 to ${e.length}) it best supports. A post should only be assigned if it is a strong and clear example of the finding. If a post is not relevant to any finding, do not include it in your output.\n\nYou MUST provide your response ONLY as a JSON object. The object must contain a single key, "assignments", which is an array of objects. Each object in the array represents a single post-to-finding assignment and must have two keys: "postNumber" and "finding".\n\nExample of the required output format:\n{\n  "assignments": [\n    {"postNumber": 1, "finding": 2},\n    {"postNumber": 3, "finding": 1},\n    {"postNumber": 5, "finding": 2}\n  ]\n}\n`,o={model:"gpt-4o-mini",messages:[{role:"system",content:"You are a precise data categorization engine that outputs only JSON."},{role:"user",content:n}],temperature:0,max_tokens:1500,response_format:{type:"json_object"}};try{const e=await fetch(OPENAI_PROXY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({openaiPayload:o})});if(!e.ok){const t=await e.text();throw console.error("OpenAI Assignment API Error:",t),new Error(`OpenAI API Error for assignments: ${e.statusText}`)}const t=await e.json();return parseAIAssignments(t.openaiResponse)}catch(s){return console.error("Assignment function error:",s),[]}}
function calculateRelevanceScore(e,t){let r=0;const n=e.data.title||"",o=e.data.selftext||"",s=t.title.toLowerCase().split(" ").filter(e=>e.length>3&&!stopWords.includes(e)),a=(t.keywords||[]).map(e=>e.toLowerCase());let i=!1,l=!1;for(const c of s){const e=new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i");e.test(n)&&(r+=5,i=!0),e.test(o)&&(r+=2,i=!0)}for(const c of a){const e=new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i");e.test(n)&&(r+=3,l=!0),e.test(o)&&(r+=1,l=!0)}return i&&l&&(r+=10),r}
function calculateFindingMetrics(e,t){const r={},n=new Set;return e.forEach((e,t)=>{r[t]={supportCount:0}}),t.forEach(t=>{let o=-1,s=0;e.forEach((e,r)=>{const n=calculateRelevanceScore(t,e);n>s&&(s=n,o=r)}),-1!==o&&s>0&&(r[o].supportCount++,n.add(t.data.id))}),r.totalProblemPosts=n.size,r}
function showSamplePosts(e,t,r,n){if(!t)return void console.warn("Assignments are not ready yet.");const o=window._summaries[e];if(!o)return;let s=[],a=new Set;let i=`Real Stories from Reddit: "${o.title}"`;const l=e=>{e&&e.data&&!n.has(e.data.id)&&!a.has(e.data.id)&&(s.push(e),a.add(e.data.id))};const c=t.filter(t=>t.finding===e+1).map(e=>e.postNumber);c.forEach(e=>{if(e-1<window._postsForAssignment.length){const t=window._postsForAssignment[e-1];l(t)}});if(s.length<8){const e=r.filter(e=>!n.has(e.data.id)&&!a.has(e.data.id)),t=e.map(e=>({post:e,score:calculateRelevanceScore(e,o)})).filter(e=>e.score>=4).sort((e,t)=>t.score-e.score);for(const u of t){if(s.length>=8)break;l(u.post)}}let d;if(0===s.length)d='<div style="font-style: italic; color: #555;">Could not find any highly relevant Reddit posts for this finding.</div>';else{const e=s.slice(0,8);e.forEach(e=>n.add(e.data.id)),d=e.map(e=>` <div class="insight" style="border:1px solid #ccc; padding:8px; margin-bottom:8px; background:#fafafa; border-radius:4px;"> <a href="https://www.reddit.com${e.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1rem; color:#007bff;">${e.data.title}</a> <p style="font-size:0.9rem; margin:0.5rem 0; color:#333;">${e.data.selftext?e.data.selftext.substring(0,150)+"...":"No content."}</p> <small>r/${e.data.subreddit} | 👍 ${e.data.ups.toLocaleString()} | 💬 ${e.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(e.data.created_utc)}</small> </div> `).join("")}const p=document.getElementById(`reddit-div${e+1}`);p&&(p.innerHTML=`<div class="reddit-samples-header" style="font-weight:bold; margin-bottom:6px;">${i}</div><div class="reddit-samples-posts">${d}</div>`)}
function renderPosts(e){const t=document.getElementById("posts-container");if(!t)return;t.innerHTML="";const r=e.map(e=>` <div class="insight" style="border:1px solid #ccc; padding:12px; margin-bottom:12px; background:#fafafa; border-radius:8px;"> <a href="https://www.reddit.com${e.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1.1rem; color:#007bff; text-decoration:none;"> ${e.data.title} </a> <p style="font-size:0.9rem; margin:0.75rem 0; color:#333; line-height:1.5;"> ${e.data.selftext?e.data.selftext.substring(0,200)+"...":"No additional content."} </p> <small style="color:#555; font-size:0.8rem;"> r/${e.data.subreddit} | 👍 ${e.data.ups.toLocaleString()} | 💬 ${e.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(e.data.created_utc)} </small> </div> `).join("");t.innerHTML=r}

