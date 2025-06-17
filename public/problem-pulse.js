    const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
    
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
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
    
    let accessToken = null;
    let tokenExpiry = 0;
    
    async function fetchNewToken() {
      const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
    
      const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: 'grant_type=client_credentials'
      });
    
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Failed to get Reddit token: ${resp.status} ${resp.statusText} - ${text}`);
      }
    
      const data = await resp.json();
      accessToken = data.access_token;
      tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // expires_in is seconds
      return accessToken;
    }
    
    async function getValidToken() {
      if (!accessToken || Date.now() >= tokenExpiry) {
        await fetchNewToken();
      }
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
        let url = `https://oauth.reddit.com/search?q=${encodeURIComponent(term + ' ' + niche)}&limit=${PAGINATION_BATCH_SIZE}&t=${timeFilter}`;
        if (afterToken) url += `&after=${afterToken}`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT } });
        if (!response.ok) {
          if (response.status === 401) { token = await fetchNewToken(); return await fetchPage(afterToken); }
          if (response.status === 429) {
            if (retries >= MAX_RETRIES) throw new Error(`Rate limited by Reddit API too many times for term "${term}".`);
            const retryAfterSec = Number(response.headers.get('Retry-After')) || 2;
            console.warn(`Rate limited on term "${term}", retrying after ${retryAfterSec} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000));
            retries++;
            return await fetchPage(afterToken);
          }
          throw new Error(`Error fetching posts for term "${term}": ${response.status} ${response.statusText}`);
        }
        retries = 0;
        const data = await response.json();
        return data.data;
      }
    
      try {
        while (allPosts.length < totalLimit) {
          const pageData = await fetchPage(after);
          if (!pageData || !pageData.children || pageData.children.length === 0) break;
          allPosts = allPosts.concat(pageData.children);
          after = pageData.after;
          if (!after) break;
        }
      } catch (err) {
        console.error(`Failed to fetch posts for term "${term}":`, err.message);
      }
      return allPosts.slice(0, totalLimit);
    }
    
    async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all') {
      const allResults = [];
      for (let i = 0; i < searchTerms.length; i += MAX_CONCURRENT_BATCH) {
        const batchTerms = searchTerms.slice(i, i + MAX_CONCURRENT_BATCH);
        const batchPromises = batchTerms.map(term => fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter));
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(posts => { if (Array.isArray(posts)) { allResults.push(...posts); } });
        if (i + MAX_CONCURRENT_BATCH < searchTerms.length) { await new Promise(resolve => setTimeout(resolve, 500)); }
      }
      return deduplicatePosts(allResults);
    }

    async function fetchCommentsForPost(subreddit, postId) {
      try {
        const token = await getValidToken();
        const url = `https://oauth.reddit.com/r/${subreddit}/comments/${postId}.json?sort=top&limit=25`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': USER_AGENT } });
        if (!response.ok) {
          console.error(`Failed to fetch comments for post ${postId}: ${response.status}`);
          return [];
        }
        const data = await response.json();
        const commentsData = data[1]?.data?.children || [];
        return commentsData.map(comment => comment.data?.body).filter(body => body && body !== '[deleted]' && body !== '[removed]');
      } catch (error) {
        console.error(`Error in fetchCommentsForPost for post ${postId}:`, error);
        return [];
      }
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
          if (!summary.keywords || !Array.isArray(summary.keywords) || summary.keywords.length === 0) missingFields.push("keywords");
          if (missingFields.length > 0) throw new Error(`Summary ${idx + 1} is missing required fields: ${missingFields.join(", ")}.`);
        });
        return parsed.summaries;
      } catch (error) {
        console.error("Parsing Error:", error);
        console.log("Raw AI Response:", aiResponse);
        throw new Error("Failed to parse AI response. Ensure the response is in the correct JSON format.");
      }
    }
    
    function parseAIAssignments(aiResponse) {
      try {
        aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim();
        const jsonMatch = aiResponse.match(/{[\s\S]*}/);
        if (!jsonMatch) throw new Error("No JSON object found in the AI response.");
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.assignments || !Array.isArray(parsed.assignments)) throw new Error("AI response does not contain an 'assignments' array.");
        parsed.assignments.forEach((assignment, idx) => {
          const missingFields = [];
          if (typeof assignment.postNumber !== 'number') missingFields.push("postNumber");
          if (typeof assignment.finding !== 'number') missingFields.push("finding");
          if (missingFields.length > 0) throw new Error(`Assignment ${idx + 1} is missing required fields: ${missingFields.join(", ")}.`);
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
      if (/&#x[0-9a-fA-F]+;/g.test(text)) return true;
      if (/[^a-zA-Z0-9\s]{5,}/g.test(text)) return true;
      if (/(.)\1{6,}/g.test(text)) return true;
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

    function getTopKeywords(posts, topN = 10) {
      const freqMap = {};
      posts.forEach(post => {
        const combinedText = `${post.data.title} ${post.data.selftext}`;
        const cleanedText = combinedText.replace(/<[^>]+>/g, '').replace(/[^a-zA-Z0-9\s.,!?]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
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
      return sentences ? sentences.slice(0, 2).join(' ').trim() : text;
    }

    async function assignPostsToFindings(summaries, posts) {
      const prompt = `You are an assistant that carefully categorizes Reddit posts by assigning each to the most relevant of up to ${summaries.length} findings. Provide your response only as a JSON object listing assignments.\n\nHere are the findings:\n${summaries.map((summary, index) => `Finding ${index + 1}:\nTitle: ${summary.title}\nSummary: ${summary.body}`).join('\n\n')}\n\nHere are the Reddit posts:\n${posts.map((post, index) => `Post ${index + 1}:\nTitle: ${post.data.title}\nBody: ${getFirstTwoSentences(post.data.selftext)}`).join('\n\n')}\n\nFor each post, assign it to the most relevant finding number. If a post does not clearly relate to any finding, omit it.\n\nProvide the assignments in the following JSON format without any additional text, explanations, or code blocks:\n\n{"assignments": [{"postNumber": 1, "finding": 2},{"postNumber": 3, "finding": 1}]}`;
      const openAIParams = {
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a helpful assistant that categorizes Reddit posts into the most relevant findings based on their content." }, { role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 1000
      };
      const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
      if (!response.ok) { const errorDetail = await response.json(); throw new Error(`OpenAI API Error: ${errorDetail.error || response.statusText}`); }
      const data = await response.json();
      return parseAIAssignments(data.openaiResponse);
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
        validatedSummaries.forEach((_, index) => { metrics[index] = { supportCount: 0 }; });
        filteredPosts.forEach(post => {
            let bestFindingIndex = -1;
            let maxScore = 0;
            validatedSummaries.forEach((finding, index) => {
                const score = calculateRelevanceScore(post, finding);
                if (score > maxScore) { maxScore = score; bestFindingIndex = index; }
            });
            if (bestFindingIndex !== -1 && maxScore > 0) {
                metrics[bestFindingIndex].supportCount++;
                allProblemPostIds.add(post.data.id);
            }
        });
        metrics.totalProblemPosts = allProblemPostIds.size;
        return metrics;
    }

    async function populateFindingsWithRealQuotes(findings, allPosts) {
        const MAX_QUOTES_PER_FINDING = 3;
        const POSTS_TO_SCAN_PER_FINDING = 5;
        const commentCache = new Map();
        for (const finding of findings) {
            const findingKeywords = [...(finding.summary.keywords || []), ...finding.summary.title.toLowerCase().split(' ')];
            const uniqueKeywords = [...new Set(findingKeywords)].filter(k => k.length > 3 && !stopWords.includes(k));
            const relevantPosts = allPosts
                .map(post => ({ post, score: calculateRelevanceScore(post, finding.summary) }))
                .filter(item => item.score > 0).sort((a, b) => b.score - a.score)
                .slice(0, POSTS_TO_SCAN_PER_FINDING).map(item => item.post);
            let potentialQuotes = [];
            for (const post of relevantPosts) {
                const postId = post.data.id;
                let comments = commentCache.has(postId) ? commentCache.get(postId) : await fetchCommentsForPost(post.data.subreddit, postId);
                commentCache.set(postId, comments);
                const allTextSources = [post.data.selftext, ...comments];
                for (const text of allTextSources) {
                    if (!text) continue;
                    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
                    for (const sentence of sentences) {
                        for (const keyword of uniqueKeywords) {
                            if (getWordMatchRegex(keyword).test(sentence)) {
                                const cleanedSentence = sentence.trim();
                                if (cleanedSentence.length > 15 && cleanedSentence.length < 200) potentialQuotes.push(cleanedSentence);
                                break;
                            }
                        }
                    }
                }
            }
            finding.summary.quotes = [...new Set(potentialQuotes)].slice(0, MAX_QUOTES_PER_FINDING);
        }
        return findings;
    }

    function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) {
        const MIN_POSTS = 3;
        const MAX_POSTS = 6;
        const MINIMUM_RELEVANCE_SCORE = 5;
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
        assignedPostNumbers.forEach(postNum => addPost(window._postsForAssignment[postNum - 1]));

        if (relevantPosts.length < MIN_POSTS) {
            const candidatePool = allPosts.filter(p => !usedPostIds.has(p.data.id) && !addedPostIds.has(p.data.id));
            const scoredCandidates = candidatePool.map(post => ({ post, score: calculateRelevanceScore(post, finding) }))
                .filter(item => item.score >= MINIMUM_RELEVANCE_SCORE)
                .sort((a, b) => b.score - a.score);
            for (const candidate of scoredCandidates) {
                if (relevantPosts.length >= MIN_POSTS) break;
                addPost(candidate.post);
            }
        }
        
        const finalPosts = relevantPosts.slice(0, MAX_POSTS);
        finalPosts.forEach(post => usedPostIds.add(post.data.id));

        const html = finalPosts.length === 0 ? `<div style="font-style: italic; color: #555;">Could not find any highly relevant Reddit posts for this finding.</div>` :
            finalPosts.map(post => `
              <div class="insight" style="border:1px solid #ccc; padding:8px; margin-bottom:8px; background:#fafafa; border-radius:4px;">
                <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1rem; color:#007bff;">${post.data.title}</a>
                <p style="font-size:0.9rem; margin:0.5rem 0; color:#333;">${post.data.selftext ? post.data.selftext.substring(0, 150) + '...' : 'No content.'}</p>
                <small>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 💬 ${post.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</small>
              </div>`).join('');
      
        const container = document.getElementById(`reddit-div${summaryIndex + 1}`);
        if (container) {
            container.innerHTML = `<div class="reddit-samples-header" style="font-weight:bold; margin-bottom:6px;">Real Stories from Reddit: "${finding.title}"</div><div class="reddit-samples-posts">${html}</div>`;
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
      container.innerHTML = posts.map(post => `
        <div class="insight" style="border:1px solid #ccc; padding:8px; margin-bottom:8px; background:#fafafa; border-radius:4px;">
          <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size:1rem; color:#007bff;">${post.data.title}</a>
          <p style="font-size:0.9rem; margin:0.5rem 0; color:#333;">${post.data.selftext ? post.data.selftext.substring(0,200) + '...' : 'No content.'}</p>
          <small>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 💬 ${post.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</small>
        </div>`).join('');
    }
    
    document.getElementById("pulse-search").addEventListener("click", async function(event) {
        event.preventDefault();
        
        const toClear = ["count-header", "filter-header", "findings-1", "findings-2", "findings-3", "findings-4", "findings-5", "pulse-results", "posts-container"];
        toClear.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
        document.querySelectorAll('.reddit-samples-posts, .reddit-samples-header').forEach(el => { el.innerHTML = ''; });
        
        const nicheElement = document.getElementById("niche-input");
        if (!nicheElement) return alert("Error: 'niche-input' element not found.");
        const userNiche = nicheElement.value.trim() || nicheElement.innerText.trim();
        if (!userNiche) return alert("Please enter a niche.");

        const loadingBlock = document.getElementById("loading-code-1");
        if (loadingBlock) loadingBlock.style.display = "flex";
        
        const findingElements = [1, 2, 3, 4, 5].map(i => document.getElementById(`findings-${i}`));
        findingElements.forEach((el, i) => { if(el) el.innerHTML = `<p class='loading'>Loading finding ${i+1}...</p>`; });
        const resultsMessageDiv = document.getElementById("results-message");

        try {
            const timeRadios = document.getElementsByName("timePosted");
            let selectedTimeRaw = "all";
            for (const radio of timeRadios) { if (radio.checked) { selectedTimeRaw = radio.value; break; } }
            const timeMap = { week: "week", month: "month", "6months": "year", year: "year", all: "all" };
            const selectedTime = timeMap[selectedTimeRaw] || "all";

            const minVotesRadios = document.getElementsByName("minVotes");
            let selectedMinUpvotes = 20;
            for (const radio of minVotesRadios) { if (radio.checked) { selectedMinUpvotes = parseInt(radio.value, 10); break; } }
            
            const searchTerms = ["struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve", "annoyance", "annoyed", "frustration", "disappointed", "fed up", "drives me mad", "hate when", "help", "advice", "solution to", "workaround", "how do I", "how to fix", "how to stop", "can’t find", "nothing works", "tried everything", "too expensive", "takes too long", "vent", "rant", "so annoying", "makes me want to scream"];
            
            let allPosts = await fetchMultipleRedditDataBatched(userNiche, searchTerms, 100, selectedTime);
            if (allPosts.length === 0) throw new Error("No results found on Reddit.");

            const filteredPosts = filterPosts(allPosts, selectedMinUpvotes);
            if (filteredPosts.length < 10) throw new Error("Not enough high-quality results found on Reddit. Please broaden your search.");

            window._filteredPosts = filteredPosts;
            renderPosts(filteredPosts);

            const topKeywords = getTopKeywords(filteredPosts, 10);
            const keywordsString = topKeywords.join(', ');
            const topPosts = filteredPosts.slice(0, 80);
            const combinedTexts = topPosts.map(post => `${post.data.title}. ${post.data.selftext ? post.data.selftext.substring(0, 300) : ""}`).join("\n\n");

            const openAIParams = {
                model: "gpt-4o-mini",
                messages: [{
                  role: "system",
                  content: "You are an assistant that summarizes text into 1-5 core struggles in a niche and provides relevant keywords for each."
                }, {
                  role: "user",
                  content: `Using top keywords [${keywordsString}], summarize the following content into 1-5 core struggles in the niche "${userNiche}". Provide a concise title, a brief summary, and 2-3 relevant keywords for each. The summary's "body" must naturally include "${userNiche}". Output strict JSON:\n\n{"summaries": [{"title": "Title1", "body": "Body1", "count": 0, "keywords": ["kw1", "syn1"]}]}`
                }],
                temperature: 0.0,
                max_tokens: 1000
            };
            
            const openAIResponse = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
            if (!openAIResponse.ok) { const errorDetail = await openAIResponse.json(); throw new Error(`OpenAI API Error: ${errorDetail.error || openAIResponse.statusText}`); }
            const openAIData = await openAIResponse.json();
            const summaries = parseAISummary(openAIData.openaiResponse);
            
            const MIN_SUPPORTING_POSTS_PER_FINDING = 3;
            const validatedSummaries = summaries.filter(finding => filteredPosts.filter(post => calculateRelevanceScore(post, finding) > 0).length >= MIN_SUPPORTING_POSTS_PER_FINDING);
            if (validatedSummaries.length === 0) throw new Error("While posts were found, none formed a clear, common problem. Try a broader niche.");
            
            const metrics = calculateFindingMetrics(validatedSummaries, filteredPosts);
            const sortedFindings = validatedSummaries.map((summary, index) => ({ summary, prevalence: Math.round((metrics[index].supportCount / (metrics.totalProblemPosts || 1)) * 100), supportCount: metrics[index].supportCount })).sort((a, b) => b.prevalence - a.prevalence);

            const findingsWithRealQuotes = await populateFindingsWithRealQuotes(sortedFindings, filteredPosts);
            window._summaries = findingsWithRealQuotes.map(item => item.summary);

            for (let i = 1; i <= 5; i++) {
                const block = document.getElementById(`findings-block${i}`);
                if (block) block.style.display = "none";
                const quoteContainer = document.getElementById(`quote-float-container-${i}`);
                if (quoteContainer) quoteContainer.innerHTML = "";
            }

            findingsWithRealQuotes.forEach((findingData, index) => {
                const displayIndex = index + 1;
                const block = document.getElementById(`findings-block${displayIndex}`);
                if (block) block.style.display = "flex";
                const content = document.getElementById(`findings-${displayIndex}`);
                const quoteContainer = document.getElementById(`quote-float-container-${displayIndex}`);
                const { summary, prevalence, supportCount } = findingData;

                if (content) {
                    const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;
                    let metricsHtml = '';
                    if (sortedFindings.length === 1) {
                        metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">Primary Finding</div><div class="single-finding-metric">Supported by ${supportCount} Posts</div><div class="prevalence-subtitle">This was the only significant problem theme identified.</div></div>`;
                    } else {
                        let barColor = prevalence >= 30 ? "#296fd3" : (prevalence >= 15 ? "#8ab4f3" : "#b5cef3");
                        let prevalenceLabel = prevalence >= 30 ? "High Prevalence" : (prevalence >= 15 ? "Medium Prevalence" : "Low Prevalence");
                        metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">${prevalenceLabel}</div><div class="prevalence-bar-background"><div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${barColor};">${prevalence}%</div></div><div class="prevalence-subtitle">Represents ${prevalence}% of all identified problems.</div></div>`;
                    }
                    content.innerHTML = `<div class="section-title">${summary.title}</div><div class="summary-expand-container"><span class="summary-teaser">${summaryShort}</span>${summary.body.length > 95 ? `<button class="see-more-btn">See more</button>` : ""}</div>${metricsHtml}`;
                }

                if (quoteContainer) {
                    quoteContainer.innerHTML = summary.quotes.length > 0 ? summary.quotes.map(quote => `<div class="quote-bubble">“${quote}”</div>`).join('') : `<div class="quote-bubble-empty">No specific quotes found.</div>`;
                }
            });

            const MAX_POSTS_FOR_ASSIGNMENT = 75;
            window._postsForAssignment = filteredPosts.map(post => {
                let bestScore = 0;
                window._summaries.forEach(finding => { bestScore = Math.max(bestScore, calculateRelevanceScore(post, finding)); });
                return { post, score: bestScore };
            }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, MAX_POSTS_FOR_ASSIGNMENT).map(item => item.post);
            
            window._assignments = await assignPostsToFindings(window._summaries, window._postsForAssignment);
            window._usedPostIds = new Set();

            for (let index = 0; index < window._summaries.length; index++) {
                showSamplePosts(index, window._assignments, filteredPosts, window._usedPostIds);
            }

        } catch (err) {
            if(resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error'>❌ ${err.message}</p>`;
            findingElements.forEach(el => { if(el) el.innerHTML = ""; });
        } finally {
            if (loadingBlock) loadingBlock.style.display = "none";
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
