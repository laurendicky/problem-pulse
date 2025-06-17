    const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
    
    const stopWords = [
      "a","about","above","after","again","against","all","am","an","and","any","are","aren't","as","at","be","because","been","before","being","below","between","both","but","by","can't","cannot","could","couldn't","did","didn't","do","does","doesn't","doing","don't","down","during","each","few","for","from","further","had","hadn't","has","hasn't","have","haven't","having","he","he'd","he'll","he's","her","here","here's","hers","herself","him","himself","his","how","how's","i","i'd","i'll","i'm","i've","if","in","into","is","isn't","it","it's","its","itself","let's","me","more","most","mustn't","my","myself","no","nor","not","of","off","on","once","only","or","other","ought","our","ours","ourselves","out","over","own","same","shan't","she","she'd","she'll","she's","should","shouldn't","so","some","such","than","that","that's","the","their","theirs","them","themselves","then","there","there's","these","they","they'd","they'll","they're","they've","this","those","through","to","too","under","until","up","very","was","wasn't","we","we'd","we'll","we're","we've","were","weren't","what","what's","when","when's","where","where's","which","while","who","who's","whom","why","why's","with","won't","would","wouldn't","you","you'd","you'll","you're","you've","your","yours","yourself","yourselves","like","just","dont","can","people","help","hes","shes","thing","stuff","really","actually","even","know","still"
    ];
    const CLIENT_ID = 'PynIoQ3wsLrGESAOvl2nSw';
    const CLIENT_SECRET = 'giYtA4-dQNiVuKE1ePH5ImAC5vysaA';
    const USER_AGENT = 'web:problem-pulse-tool:v1.0 (by /u/RubyFishSimon)';
    
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
      return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
    
    let accessToken = null;
    let tokenExpiry = 0;
    
    async function fetchNewToken() {
      const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: 'grant_type=client_credentials'
      });
      if (!resp.ok) { const text = await resp.text(); throw new Error(`Failed to get Reddit token: ${resp.status} ${resp.statusText} - ${text}`); }
      const data = await resp.json();
      accessToken = data.access_token;
      tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      return accessToken;
    }
    
    async function getValidToken() {
      if (!accessToken || Date.now() >= tokenExpiry) { await fetchNewToken(); }
      return accessToken;
    }

    const MAX_CONCURRENT_BATCH = 8;
    const PAGINATION_BATCH_SIZE = 25;
    const MAX_RETRIES = 3;
    
    async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all') {
      let allPosts = [];
      let after = null;
      let retries = 0;
      let token = await getValidToken();
      async function fetchPage(afterToken) {
        let url = `https://oauth.reddit.com/search?q=${encodeURIComponent(term + ' ' + niche)}&limit=${PAGINATION_BATCH_SIZE}&t=${timeFilter}&after=${afterToken||''}`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT } });
        if (!response.ok) {
          if (response.status === 401) { token = await fetchNewToken(); return fetchPage(afterToken); }
          if (response.status === 429) {
            if (retries >= MAX_RETRIES) throw new Error(`Rate limited by Reddit API too many times for term "${term}".`);
            const retryAfterSec = Number(response.headers.get('Retry-After')) || 2;
            await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000));
            retries++;
            return fetchPage(afterToken);
          }
          throw new Error(`Error fetching posts for term "${term}": ${response.status} ${response.statusText}`);
        }
        retries = 0;
        return await response.json();
      }
      while (allPosts.length < totalLimit) {
        const pageJson = await fetchPage(after);
        const pageData = pageJson.data;
        if (!pageData || !pageData.children || pageData.children.length === 0) break;
        allPosts.push(...pageData.children);
        after = pageData.after;
        if (!after) break;
      }
      return allPosts.slice(0, totalLimit);
    }
    
    async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all') {
      const allResults = [];
      for (let i = 0; i < searchTerms.length; i += MAX_CONCURRENT_BATCH) {
        const batchTerms = searchTerms.slice(i, i + MAX_CONCURRENT_BATCH);
        const batchPromises = batchTerms.map(term => fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter));
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(posts => { if (Array.isArray(posts)) allResults.push(...posts); });
        if (i + MAX_CONCURRENT_BATCH < searchTerms.length) await new Promise(resolve => setTimeout(resolve, 500));
      }
      return deduplicatePosts(allResults);
    }

    async function fetchCommentsForPost(subreddit, postId) {
      try {
        const token = await getValidToken();
        const url = `https://oauth.reddit.com/r/${subreddit}/comments/${postId}.json?sort=top&limit=25`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT } });
        if (!response.ok) return [];
        const data = await response.json();
        const commentsData = data[1]?.data?.children || [];
        return commentsData.map(c => c.data?.body).filter(body => body && body !== '[deleted]' && body !== '[removed]');
      } catch (error) { return []; }
    }
    
    function parseAISummary(aiResponse) {
      try {
        const jsonMatch = aiResponse.match(/{[\s\S]*}/);
        if (!jsonMatch) throw new Error("No JSON object found in summary response.");
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.summaries || !Array.isArray(parsed.summaries) || parsed.summaries.length < 1) throw new Error("Summary response does not contain at least one summary.");
        parsed.summaries.forEach((summary, idx) => {
          const missing = ["title", "body", "count", "keywords"].filter(field => !(field in summary));
          if (missing.length > 0) throw new Error(`Summary ${idx + 1} is missing fields: ${missing.join(", ")}.`);
        });
        return parsed.summaries;
      } catch (e) { throw new Error(`Failed to parse AI summary. ${e.message}`); }
    }
    
    function parseAIAssignments(aiResponse) {
      try {
        const jsonMatch = aiResponse.match(/{[\s\S]*}/);
        if (!jsonMatch) throw new Error("No JSON object found in assignment response.");
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.assignments || !Array.isArray(parsed.assignments)) throw new Error("Assignment response does not contain an 'assignments' array.");
        return parsed.assignments;
      } catch (e) { throw new Error(`Failed to parse AI assignments. ${e.message}`); }
    }
    
    function isRamblingOrNoisy(text) {
      return !text || /&#x[0-9a-fA-F]+;/g.test(text) || /[^a-zA-Z0-9\s]{5,}/g.test(text) || /(.)\1{6,}/g.test(text);
    }
    
    function filterPosts(posts, minUpvotes = 20) {
      return posts.filter(p => {
        const d = p.data;
        return d && d.title && d.selftext && d.selftext.length > 100 && d.ups >= minUpvotes && d.upvote_ratio > 0.2 && !isRamblingOrNoisy(d.title) && !isRamblingOrNoisy(d.selftext) && !d.title.toLowerCase().includes('[ad]') && !d.title.toLowerCase().includes('sponsored');
      });
    }

    function getTopKeywords(posts, topN = 10) {
      const freqMap = {};
      posts.forEach(p => {
        const text = `${p.data.title} ${p.data.selftext}`.toLowerCase().replace(/[^a-z\s]/g, '');
        text.split(/\s+/).forEach(word => {
          if (word.length > 3 && !stopWords.includes(word)) freqMap[word] = (freqMap[word] || 0) + 1;
        });
      });
      return Object.keys(freqMap).sort((a, b) => freqMap[b] - freqMap[a]).slice(0, topN);
    }
    
    function getFirstTwoSentences(text) {
      if (!text) return '';
      const sentences = text.match(/[^.!?]+[.!?]+/g);
      return sentences ? sentences.slice(0, 2).join(' ').trim() : text;
    }
    
    async function assignPostsToFindings(summaries, posts, userNiche) {
        const prompt = `You are an assistant that categorizes Reddit posts by assigning each to the most relevant of up to ${summaries.length} findings for the niche "${userNiche}". Provide your response only as a JSON object.\n\nHere are the findings:\n${summaries.map((s, i) => `Finding ${i + 1}: ${s.title} - ${s.body}`).join('\n')}\n\nHere are the posts:\n${posts.map((p, i) => `Post ${i + 1}: ${p.data.title}`).join('\n')}\n\nAssign each post to the most relevant finding number. If a post is irrelevant, omit it. Respond in this JSON format: {"assignments": [{"postNumber": 1, "finding": 2}]}`;
        const assignmentParams = {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You categorize Reddit posts into findings." }, { role: "user", content: prompt }],
            temperature: 0,
            max_tokens: 1000
        };
        const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: assignmentParams }) });
        if (!response.ok) { const err = await response.json(); throw new Error(`OpenAI Assignment Error: ${err.error || response.statusText}`); }
        const data = await response.json();
        return parseAIAssignments(data.openaiResponse);
    }

    function getWordMatchRegex(word) {
      return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    }

    function calculateRelevanceScore(post, finding) {
        let score = 0;
        const postText = `${post.data.title} ${post.data.selftext}`.toLowerCase();
        const findingWords = [...new Set([...(finding.keywords || []), ...finding.title.toLowerCase().split(' ')])].filter(k => k.length > 3 && !stopWords.includes(k));
        findingWords.forEach(word => { if (postText.includes(word)) score++; });
        return score;
    }

    function calculateFindingMetrics(summaries, posts) {
        const metrics = Array(summaries.length).fill(0).map(() => ({ supportCount: 0 }));
        let totalProblemPosts = 0;
        const countedPostIds = new Set();
        posts.forEach(post => {
            let bestFindingIndex = -1;
            let maxScore = 0;
            summaries.forEach((summary, index) => {
                const score = calculateRelevanceScore(post, summary);
                if (score > maxScore) { maxScore = score; bestFindingIndex = index; }
            });
            if (bestFindingIndex !== -1 && maxScore > 0) {
                metrics[bestFindingIndex].supportCount++;
                if (!countedPostIds.has(post.data.id)) {
                    totalProblemPosts++;
                    countedPostIds.add(post.data.id);
                }
            }
        });
        return { metrics, totalProblemPosts };
    }

    async function populateFindingsWithRealQuotes(findings, allPosts) {
      const commentCache = new Map();
      for (const finding of findings) {
        const findingKeywords = [...new Set([...(finding.summary.keywords || []), ...finding.summary.title.toLowerCase().split(' ')])].filter(k => k.length > 3 && !stopWords.includes(k));
        const relevantPosts = allPosts.map(p => ({ p, score: calculateRelevanceScore(p, finding.summary) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(item => item.p);
        let potentialQuotes = [];
        for (const post of relevantPosts) {
          if (potentialQuotes.length >= 3) break;
          const comments = commentCache.has(post.data.id) ? commentCache.get(post.data.id) : await fetchCommentsForPost(post.data.subreddit, post.data.id);
          commentCache.set(post.data.id, comments);
          [post.data.selftext, ...comments].forEach(text => {
            if (!text) return;
            const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
            sentences.forEach(sentence => {
              if (findingKeywords.some(kw => getWordMatchRegex(kw).test(sentence))) {
                const cleaned = sentence.trim();
                if (cleaned.length > 15 && cleaned.length < 200 && !potentialQuotes.includes(cleaned)) potentialQuotes.push(cleaned);
              }
            });
          });
        }
        finding.summary.quotes = potentialQuotes.slice(0, 3);
      }
      return findings;
    }

    function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) {
        const finding = window._summaries[summaryIndex];
        if (!finding) return;
        let relevantPosts = [];
        const addPost = p => { if (p && p.data && !usedPostIds.has(p.data.id)) { relevantPosts.push(p); usedPostIds.add(p.data.id); }};
        assignments.filter(a => a.finding === summaryIndex + 1).forEach(a => addPost(window._postsForAssignment[a.postNumber - 1]));
        if (relevantPosts.length < 3) {
            allPosts.map(p => ({ p, score: calculateRelevanceScore(p, finding) })).filter(i => i.score >= 1 && !usedPostIds.has(i.p.data.id)).sort((a,b) => b.score - a.score).forEach(i => { if (relevantPosts.length < 3) addPost(i.p); });
        }
        const html = relevantPosts.length === 0 ? `<i>No relevant posts found.</i>` : relevantPosts.map(p => `<div class="insight"><a href="https://www.reddit.com${p.data.permalink}" target="_blank" rel="noopener noreferrer">${p.data.title}</a><p>${p.data.selftext ? p.data.selftext.substring(0, 150) + '...' : ''}</p><small>r/${p.data.subreddit} | 👍 ${p.data.ups.toLocaleString()}</small></div>`).join('');
        const container = document.getElementById(`reddit-div${summaryIndex + 1}`);
        if (container) container.innerHTML = `<div class="reddit-samples-header">Real Stories from Reddit: "${finding.title}"</div><div class="reddit-samples-posts">${html}</div>`;
    }

    const sortFunctions = { relevance: (a, b) => 0, newest: (a, b) => b.data.created_utc - a.data.created_utc, upvotes: (a, b) => b.data.ups - a.data.ups, comments: (a, b) => b.data.num_comments - a.data.num_comments };
    
    function renderPosts(posts) {
        const container = document.getElementById("posts-container");
        if(container) container.innerHTML = posts.map(p => `<div class="insight"><a href="https://www.reddit.com${p.data.permalink}" target="_blank" rel="noopener noreferrer">${p.data.title}</a><p>${p.data.selftext ? p.data.selftext.substring(0, 200) + '...' : ''}</p><small>r/${p.data.subreddit} | 👍 ${p.data.ups.toLocaleString()} | 🗓️ ${formatDate(p.data.created_utc)}</small></div>`).join('');
    }
    
    document.getElementById("pulse-search").addEventListener("click", async function(event) {
        event.preventDefault();
        
        document.querySelectorAll("#count-header, #filter-header, #findings-1, #findings-2, #findings-3, #findings-4, #findings-5, #pulse-results, #posts-container, .reddit-samples-posts, .reddit-samples-header, .quote-float-container-1, .quote-float-container-2, .quote-float-container-3, .quote-float-container-4, .quote-float-container-5").forEach(el => { if(el) el.innerHTML = ''; });
        
        const userNiche = document.getElementById("niche-input").value.trim();
        if (!userNiche) return alert("Please enter a niche.");

        const loadingBlock = document.getElementById("loading-code-1");
        if (loadingBlock) loadingBlock.style.display = "flex";
        
        const findingElements = [1, 2, 3, 4, 5].map(i => document.getElementById(`findings-${i}`));
        findingElements.forEach((el, i) => { if (el) el.innerHTML = `<p class='loading'>Brewing insight ${i+1}...</p>`; });
        const resultsMessageDiv = document.getElementById("results-message");

        try {
            const selectedTime = document.querySelector('input[name="timePosted"]:checked')?.value || 'all';
            const selectedMinUpvotes = parseInt(document.querySelector('input[name="minVotes"]:checked')?.value || '20', 10);
            
            const searchTerms = ["struggle","challenge","problem","issue","difficulty","pain point","pet peeve","annoyance","annoyed","frustration","disappointed","fed up","hate when","help","advice","solution to","workaround","how do I","how to fix","how to stop","can’t find","nothing works","too expensive","takes too long","vent","rant"];
            
            const allPosts = await fetchMultipleRedditDataBatched(userNiche, searchTerms, 100, selectedTime);
            if (allPosts.length === 0) throw new Error("No results found on Reddit for this niche.");

            const filteredPosts = filterPosts(allPosts, selectedMinUpvotes);
            if (filteredPosts.length < 10) throw new Error("Not enough high-quality posts found. Please try a broader niche or different filters.");

            window._filteredPosts = filteredPosts;
            renderPosts(filteredPosts);

            const topKeywords = getTopKeywords(filteredPosts, 10);
            const summaryParams = {
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: "You are an expert market researcher. You summarize text into 1-5 core struggles for a niche, providing a title, body, and keywords for each. You only output valid JSON." }, { role: "user", content: `From the following text about the niche "${userNiche}" (using keywords like [${topKeywords.join(', ')}]), identify 1-5 core user struggles. For each, provide a "title", a "body" (which must naturally include the niche "${userNiche}"), a "count" (set to 0), and 2-3 "keywords". Respond in strict JSON format: {"summaries": [...]}\n\nTEXT:\n${filteredPosts.slice(0, 80).map(p => p.data.title + ". " + p.data.selftext.substring(0,300)).join("\n\n")}` }],
                temperature: 0.0,
                max_tokens: 1500
            };
            
            const openAIResponse = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: summaryParams }) });
            if (!openAIResponse.ok) { const err = await openAIResponse.json(); throw new Error(`OpenAI Summary Error: ${err.error || openAIResponse.statusText}`); }
            const openAIData = await openAIResponse.json();
            const summaries = parseAISummary(openAIData.openaiResponse);
            
            const validatedSummaries = summaries.filter(s => filteredPosts.filter(p => calculateRelevanceScore(p, s) > 0).length >= 3);
            if (validatedSummaries.length === 0) throw new Error("Could not identify significant common problems from the posts found.");
            
            const { metrics, totalProblemPosts } = calculateFindingMetrics(validatedSummaries, filteredPosts);
            let sortedFindings = validatedSummaries.map((summary, index) => ({ summary, prevalence: Math.round((metrics[index].supportCount / (totalProblemPosts || 1)) * 100), supportCount: metrics[index].supportCount })).sort((a, b) => b.prevalence - a.prevalence);

            sortedFindings = await populateFindingsWithRealQuotes(sortedFindings, filteredPosts);
            window._summaries = sortedFindings.map(item => item.summary);

            document.querySelectorAll('[id^="findings-block"]').forEach(el => el.style.display = "none");

            sortedFindings.forEach((findingData, index) => {
                const displayIndex = index + 1;
                const block = document.getElementById(`findings-block${displayIndex}`);
                if (block) block.style.display = "flex";
                const content = document.getElementById(`findings-${displayIndex}`);
                const quoteContainer = document.getElementById(`quote-float-container-${displayIndex}`);
                
                if (content) {
                    const { summary, prevalence, supportCount } = findingData;
                    const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;
                    let barColor = prevalence >= 30 ? "#296fd3" : (prevalence >= 15 ? "#8ab4f3" : "#b5cef3");
                    let prevalenceLabel = prevalence >= 30 ? "High Prevalence" : (prevalence >= 15 ? "Medium Prevalence" : "Low Prevalence");
                    const metricsHtml = sortedFindings.length === 1 ? `<div class="prevalence-container"><div class="prevalence-header">Primary Finding</div><div class="single-finding-metric">Supported by ${supportCount} Posts</div></div>` : `<div class="prevalence-container"><div class="prevalence-header">${prevalenceLabel}</div><div class="prevalence-bar-background"><div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${barColor};">${prevalence}%</div></div><div class="prevalence-subtitle">Represents ${prevalence}% of all problems.</div></div>`;
                    content.innerHTML = `<div class="section-title">${summary.title}</div><p>${summary.body}</p>${metricsHtml}`;
                }

                if (quoteContainer) {
                    quoteContainer.innerHTML = summary.quotes.length > 0 ? summary.quotes.map(q => `<div class="quote-bubble">“${q}”</div>`).join('') : `<div class="quote-bubble-empty">No specific quotes found.</div>`;
                }
            });

            window._postsForAssignment = filteredPosts.map(p => ({ p, score: window._summaries.reduce((max, s) => Math.max(max, calculateRelevanceScore(p, s)), 0) })).filter(i => i.score > 0).sort((a, b) => b.score - a.score).slice(0, 75).map(i => i.p);
            window._assignments = await assignPostsToFindings(window._summaries, window._postsForAssignment, userNiche);
            window._usedPostIds = new Set();
            window._summaries.forEach((_, i) => showSamplePosts(i, window._assignments, filteredPosts, window._usedPostIds));

        } catch (err) {
            if (resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error'>❌ ${err.message}</p>`;
            findingElements.forEach(el => { if (el) el.innerHTML = ""; });
        } finally {
            if (loadingBlock) loadingBlock.style.display = "none";
        }
    });

    document.getElementById("sort-posts").addEventListener("change", (event) => {
        const sortBy = event.target.value;
        const posts = window._filteredPosts || [];
        if (sortBy in sortFunctions) {
            renderPosts([...posts].sort(sortFunctions[sortBy]));
        }
    });
