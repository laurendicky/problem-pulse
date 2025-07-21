// ====================================================================
// SETUP: PROXY URLS & GLOBAL CONSTANTS
// FINAL CORRECTED VERSION - You can use this with confidence.
// ====================================================================
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

const sortFunctions = {
  relevance: (a, b) => 0,
  newest: (a, b) => b.data.created_utc - a.data.created_utc,
  upvotes: (a, b) => b.data.ups - a.data.ups,
  comments: (a, b) => b.data.num_comments - a.data.num_comments,
};

// ====================================================================
// HELPER FUNCTIONS
// ====================================================================

function deduplicatePosts(posts) {
  const seen = new Set();
  return posts.filter(post => {
    if (!post.data?.id) return false;
    if (seen.has(post.data.id)) return false;
    seen.add(post.data.id);
    return true;
  });
}

function formatDate(utcSeconds) {
  const date = new Date(utcSeconds * 1000);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseAISummary(aiResponse) {
  try {
    const jsonString = aiResponse.match(/{[\s\S]*}/)[0];
    const parsed = JSON.parse(jsonString);
    if (!parsed.summaries?.length) throw new Error("AI response missing 'summaries' array.");
    return parsed.summaries;
  } catch (error) {
    console.error("AI Summary Parsing Error:", error, "Raw Response:", aiResponse);
    throw new Error("Failed to parse AI summary.");
  }
}

function parseAIAssignments(aiResponse) {
    try {
      const jsonString = aiResponse.match(/{[\s\S]*}/)[0];
      const parsed = JSON.parse(jsonString);
      if (!parsed.assignments) throw new Error("AI response missing 'assignments' array.");
      return parsed.assignments;
    } catch (error) {
        console.error("AI Assignment Parsing Error:", error, "Raw Response:", aiResponse);
        throw new Error("Failed to parse AI assignments.");
    }
}

function isRamblingOrNoisy(text) {
  if (!text) return false;
  if (/[^a-zA-Z0-9\s]{5,}/g.test(text)) return true;
  if (/(.)\1{6,}/g.test(text)) return true;
  return false;
}

function filterPosts(posts, minUpvotes = 20) {
  return posts.filter(post => {
    const title = post.data.title || "";
    const selftext = post.data.selftext || '';
    if (title.toLowerCase().includes('[ad]') || title.toLowerCase().includes('sponsored')) return false;
    if (post.data.upvote_ratio < 0.2) return false;
    if (post.data.ups < minUpvotes) return false;
    const combinedTextLength = title.length + selftext.length;
    if (combinedTextLength < 80) return false;
    if (isRamblingOrNoisy(title) || isRamblingOrNoisy(selftext)) return false;
    return true;
  });
}

function getTopKeywords(posts, topN = 10) {
    const freqMap = {};
    posts.forEach(post => {
        const combinedText = `${post.data.title} ${post.data.selftext || ''}`.toLowerCase();
        const words = combinedText.replace(/[^a-zA-Z\s]/g, '').split(/\s+/);
        words.forEach(word => {
            if (word.length > 2 && !stopWords.includes(word)) {
                freqMap[word] = (freqMap[word] || 0) + 1;
            }
        });
    });
    return Object.keys(freqMap).sort((a, b) => freqMap[b] - freqMap[a]).slice(0, topN);
}

function getWordMatchRegex(word) {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escapedWord}\\b`, 'i');
}

function calculateRelevanceScore(post, finding) {
  let score = 0;
  const postTitle = post.data.title || "";
  const postBody = post.data.selftext || "";
  const findingTitleWords = finding.title.toLowerCase().split(' ').filter(w => w.length > 3 && !stopWords.includes(w));
  const findingKeywords = (finding.keywords || []).map(k => k.toLowerCase());
  let titleWordMatched = false, keywordMatched = false;
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
  if (titleWordMatched && keywordMatched) score += 10;
  return score;
}

function calculateFindingMetrics(summaries, posts) {
  const metrics = {};
  const allProblemPostIds = new Set();
  summaries.forEach((_, index) => { metrics[index] = { supportCount: 0 }; });
  posts.forEach(post => {
    let bestFindingIndex = -1, maxScore = 0;
    summaries.forEach((finding, index) => {
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

async function assignPostsToFindings(summaries, posts, keywordsString, subredditInput) {
  const prompt = `You are an assistant that categorizes Reddit posts by assigning each to the most relevant finding.
    Here are the findings from [${subredditInput}]:
    ${summaries.map((s, i) => `Finding ${i + 1}: ${s.title}`).join('\n')}
    Here are the Reddit posts:
    ${posts.map((p, i) => `Post ${i + 1}: ${p.data.title}`).join('\n\n')}
    Assign each post to the most relevant finding (e.g., Post 1 -> Finding 2). If a post is not relevant, omit it.
    Provide your response ONLY as a JSON object: {"assignments": [{"postNumber": 1, "finding": 2}]}`;
  const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: prompt }], temperature: 0, max_tokens: 1000 };
  try {
    const response = await fetch(OPENAI_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams }) });
    if (!response.ok) throw new Error(`OpenAI API Error: ${response.statusText}`);
    const data = await response.json();
    return parseAIAssignments(data.openaiResponse);
  } catch (error) {
    console.error("Assignment Error:", error);
    throw error;
  }
}

// --- RENDER FUNCTIONS ---
function renderPosts(posts) {
  const container = document.getElementById("posts-container");
  if (!container) return;
  container.innerHTML = posts.map(post => `
    <div class="insight">
      <a href="https://www.reddit.com${post.data.permalink}" target="_blank">${post.data.title}</a>
      <p>${post.data.selftext ? post.data.selftext.substring(0, 200) + '...' : 'No content.'}</p>
      <small>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 💬 ${post.data.num_comments.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</small>
    </div>`).join('');
}

function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) {
    const finding = window._summaries[summaryIndex];
    if (!finding) return;
    const assignedPostNumbers = assignments.filter(a => a.finding === (summaryIndex + 1)).map(a => a.postNumber);
    const relevantPosts = assignedPostNumbers.map(num => window._postsForAssignment[num - 1]).filter(Boolean);
    const container = document.getElementById(`reddit-div${summaryIndex + 1}`);
    if (container) {
      if (relevantPosts.length === 0) {
        container.innerHTML = `<div class="reddit-samples-header">No specific examples found for this finding.</div>`;
      } else {
        container.innerHTML = `<div class="reddit-samples-header">Real stories for "${finding.title}"</div>` +
        relevantPosts.slice(0, 3).map(post => `
          <div class="insight">
            <a href="https://www.reddit.com${post.data.permalink}" target="_blank">${post.data.title}</a>
            <small>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()}</small>
          </div>
        `).join('');
      }
    }
}


// ====================================================================
// UNIFIED EVENT HANDLING & APP LOGIC
// ====================================================================

// --- Define Element References ---
const searchButton = document.getElementById("pulse-search");
const topicInput = document.getElementById("niche-input");
const audienceContainer = document.getElementById("audience-selection-container");
const audienceChoicesDiv = document.getElementById("audience-choices");
const analyzeButton = document.getElementById("analyze-button");
const resultsWrapper = document.getElementById('results-wrapper');
const resultsMessageDiv = document.getElementById("results-message");
const loadingBlock = document.getElementById("loading-code-1");

// --- HELPER: Main function to run the problem analysis ---
async function runProblemAnalysis(selectedSubreddits) {
  if (resultsWrapper) { resultsWrapper.style.display = 'none'; resultsWrapper.style.opacity = '0'; }
  const toClear = ["count-header", "filter-header", "findings-1", "findings-2", "findings-3", "findings-4", "findings-5", "posts-container"];
  toClear.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
  document.querySelectorAll('.reddit-samples-posts, .reddit-samples-header').forEach(el => el.innerHTML = '');

  const timeRadios = document.getElementsByName("timePosted");
  let selectedTime = "all";
  for (const radio of timeRadios) { if (radio.checked) { selectedTime = radio.value; break; } }

  const minVotesRadios = document.getElementsByName("minVotes");
  let selectedMinUpvotes = 20;
  for (const radio of minVotesRadios) { if (radio.checked) { selectedMinUpvotes = parseInt(radio.value, 10); break; } }

  if (resultsMessageDiv) resultsMessageDiv.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const findingEl = document.getElementById(`findings-${i}`);
    if (findingEl) findingEl.innerHTML = `<p class='loading'>Analyzing problems...</p>`;
  }
  if (loadingBlock) loadingBlock.style.display = "flex";

  try {
    const subredditsForAPI = selectedSubreddits.join('+');
    const problemTerms = ["struggle", "challenge", "problem", "issue", "difficulty", "pain point", "pet peeve", "annoyance", "annoyed", "frustration", "disappointed", "fed up", "drives me mad", "hate when", "help", "advice", "solution to", "workaround", "how do I", "how to fix", "how to stop", "can’t find", "nothing works", "tried everything", "too expensive", "takes too long", "vent", "rant", "so annoying", "makes me want to scream"];
    const combinedSearchTerm = problemTerms.join(' OR ');

    let allPosts = [];
    let after = null;
    while (allPosts.length < 500) {
      const response = await fetch(REDDIT_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'find_problems', subreddits: subredditsForAPI, searchTerm: combinedSearchTerm, limit: 100, timeFilter: selectedTime, after: after })
      });
      if (!response.ok) throw new Error(`Server error (${response.status}). Please check subreddit names.`);
      const data = await response.json();
      if (!data.data?.children?.length) break;
      allPosts.push(...data.data.children);
      after = data.data.after;
      if (!after) break;
    }
    allPosts = deduplicatePosts(allPosts);

    const filteredPosts = filterPosts(allPosts, selectedMinUpvotes);
    if (filteredPosts.length < 10) {
      throw new Error(allPosts.length > 0 ? "Found posts, but not enough high-quality ones to analyze. Try a broader timeframe." : "Couldn't find any relevant posts. Check subreddit spelling.");
    }
    window._filteredPosts = filteredPosts;
    renderPosts(filteredPosts);
    
    const countHeaderDiv = document.getElementById("count-header");
    if (countHeaderDiv) {
        const subCount = selectedSubreddits.length;
        const subText = subCount > 1 ? `${subCount} communities` : `r/${selectedSubreddits[0]}`;
        countHeaderDiv.textContent = `Found over ${Math.round(allPosts.length / 10) * 10} relevant posts in ${subText}.`;
    }
    if (resultsWrapper) {
      resultsWrapper.style.display = 'block';
      setTimeout(() => {
        resultsWrapper.style.opacity = '1';
        window.scrollTo({ top: resultsWrapper.offsetTop - 20, behavior: "smooth" });
      }, 50);
    }
    
    const topKeywords = getTopKeywords(filteredPosts, 10);
    const keywordsString = topKeywords.join(', ');
    const topPosts = filteredPosts.slice(0, 80);
    const combinedTexts = topPosts.map(p => `${p.data.title || ""}. ${p.data.selftext ? p.data.selftext.substring(0, 300) : ""}`).join("\n\n");
    const openAIParams = {
        model: "gpt-4o-mini",
        messages: [{
            role: "system", content: `You are a market research expert, summarizing online discussions into 1-5 core user problems. For each, provide a title, summary, quotes, and keywords in strict JSON format.`
        }, {
            role: "user", content: `From the communities [r/${selectedSubreddits.join(', r/') }], analyze the following content using keywords like [${keywordsString}]. Identify 1-5 core problems. For each problem, provide: 1. "title" 2. "body" 3. "count" 4. "quotes" (3 short quotes) 5. "keywords" (2-3 keywords). Content: \`\`\`${combinedTexts}\`\`\``
        }],
        temperature: 0.0, max_tokens: 1500
    };
    const openAIResponse = await fetch(OPENAI_PROXY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiPayload: openAIParams })
    });
    if (!openAIResponse.ok) throw new Error(`OpenAI API Error: ${openAIResponse.statusText}`);
    const openAIData = await openAIResponse.json();
    let summaries = parseAISummary(openAIData.openaiResponse);

    const validatedSummaries = summaries.filter(finding => {
        return filteredPosts.filter(post => calculateRelevanceScore(post, finding) > 0).length >= 3;
    });
    if (validatedSummaries.length === 0) {
        throw new Error("While posts were found, no clear, common problems emerged. Try different communities.");
    }
    
    const metrics = calculateFindingMetrics(validatedSummaries, filteredPosts);
    const sortedFindings = validatedSummaries.map((summary, index) => {
      const findingMetrics = metrics[index];
      const prevalence = Math.round((findingMetrics.supportCount / (metrics.totalProblemPosts || 1)) * 100);
      return { summary, prevalence, supportCount: findingMetrics.supportCount };
    }).sort((a, b) => b.prevalence - a.prevalence);
    
    window._summaries = sortedFindings.map(item => item.summary);
    for (let i = 1; i <= 5; i++) { document.getElementById(`findings-block${i}`)?.style.display = "none"; }
    
    sortedFindings.forEach((findingData, index) => {
      const displayIndex = index + 1;
      const block = document.getElementById(`findings-block${displayIndex}`);
      const content = document.getElementById(`findings-${displayIndex}`);
      if (block) block.style.display = "flex";
      if (content) {
        const { summary, prevalence, supportCount } = findingData;
        const summaryId = `summary-body-${displayIndex}-${Date.now()}`;
        const summaryShort = summary.body.length > 95 ? summary.body.substring(0, 95) + "…" : summary.body;
        let metricsHtml = '';
        if (sortedFindings.length === 1) {
            metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">Primary Finding</div><div class="single-finding-metric">Supported by ${supportCount} Posts</div><div class="prevalence-subtitle">This was the only significant problem identified.</div></div>`;
        } else {
            let barColor, prevalenceLabel;
            if (prevalence >= 30) { prevalenceLabel = "High Prevalence"; barColor = "#296fd3"; } 
            else if (prevalence >= 15) { prevalenceLabel = "Medium Prevalence"; barColor = "#5b98eb"; } 
            else { prevalenceLabel = "Low Prevalence"; barColor = "#aecbfa"; }
            const prevalenceText = prevalence > 5 ? `${prevalence}%` : '';
            metricsHtml = `<div class="prevalence-container"><div class="prevalence-header">${prevalenceLabel}</div><div class="prevalence-bar-background"><div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${barColor};">${prevalenceText}</div></div><div class="prevalence-subtitle">Represents ${prevalence}% of all identified problems.</div></div>`;
        }
        content.innerHTML = `<div class="section-title">${summary.title}</div><div class="summary-expand-container"><span class="summary-teaser" id="${summaryId}">${summaryShort}</span>${summary.body.length > 95 ? `<button class="see-more-btn" data-summary="${summaryId}">See more</button>` : ""}<span class="summary-full" id="${summaryId}-full" style="display:none">${summary.body}</span></div><div class="quotes-container">${summary.quotes.map(quote => `<div class="quote">"${quote}"</div>`).join('')}</div>${metricsHtml}`;
        if (summary.body.length > 95) {
          setTimeout(() => {
            const seeMoreBtn = content.querySelector(`.see-more-btn[data-summary="${summaryId}"]`);
            if (seeMoreBtn) {
              const teaser = content.querySelector(`#${summaryId}`);
              const full = content.querySelector(`#${summaryId}-full`);
              seeMoreBtn.addEventListener('click', function() { if (teaser.style.display !== 'none') { teaser.style.display = 'none'; full.style.display = ''; seeMoreBtn.textContent = 'See less'; } else { teaser.style.display = ''; full.style.display = 'none'; seeMoreBtn.textContent = 'See more'; } });
            }
          }, 0);
        }
      }
    });
    
    window._postsForAssignment = filteredPosts.map(post => ({ post, score: window._summaries.reduce((max, s) => Math.max(max, calculateRelevanceScore(post, s)), 0) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 75).map(item => item.post);
    const assignments = await assignPostsToFindings(window._summaries, window._postsForAssignment, keywordsString, selectedSubreddits.join(', '));
    window._assignments = assignments;
    window._usedPostIds = new Set();
    for (let index = 0; index < window._summaries.length; index++) {
        showSamplePosts(index, assignments, filteredPosts, window._usedPostIds);
    }

  } catch (err) {
    console.error("Analysis Error:", err);
    if (resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error'>😔 ${err.message}</p>`;
    for (let i = 1; i <= 5; i++) { document.getElementById(`findings-${i}`)?.innerHTML = ""; }
  } finally {
    if (loadingBlock) loadingBlock.style.display = "none";
  }
}

// --- PRIMARY EVENT LISTENERS ---
searchButton.addEventListener("click", async function(event) {
  event.preventDefault();
  const topic = topicInput.value.trim();
  if (!topic) {
    alert("Please enter a topic to discover communities.");
    return;
  }
  
  if (resultsWrapper) resultsWrapper.style.display = 'none';
  audienceChoicesDiv.innerHTML = "<p class='loading'>Discovering communities...</p>";
  audienceContainer.style.display = 'block';

  try {
    const response = await fetch(REDDIT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'find_subreddits', topic: topic })
    });
    if (!response.ok) throw new Error("Could not fetch communities.");
    const data = await response.json();
    
    const subreddits = data.subreddits; 
    
    if (!subreddits || subreddits.length === 0) {
      audienceChoicesDiv.innerHTML = "<p class='error'>😔 No communities found for that topic. Try another keyword.</p>";
      document.getElementById('analyze-button').style.display = 'none';
      return;
    }

    audienceChoicesDiv.innerHTML = subreddits.map((sub, index) => {
      const isChecked = index < 3 ? 'checked' : '';
      return `<div class="checkbox-wrapper"><input type="checkbox" id="sub-${index}" name="subreddit" value="${sub.name}" ${isChecked}><label for="sub-${index}"><strong>r/${sub.name}</strong> (${sub.subscriber_count.toLocaleString()} members)</label></div>`;
    }).join('');
    document.getElementById('analyze-button').style.display = 'block';
  } catch (err) {
    audienceChoicesDiv.innerHTML = `<p class='error'>😔 ${err.message}</p>`;
  }
});

analyzeButton.addEventListener("click", function(event) {
  event.preventDefault();
  const selectedCheckboxes = document.querySelectorAll('#audience-choices input[name="subreddit"]:checked');
  if (selectedCheckboxes.length === 0) {
    alert("Please select at least one community to analyze.");
    return;
  }
  const selectedSubreddits = Array.from(selectedCheckboxes).map(cb => cb.value);
  
  audienceContainer.style.display = 'none';
  runProblemAnalysis(selectedSubreddits);
});

document.getElementById("sort-posts").addEventListener("change", (event) => {
  const sortBy = event.target.value;
  if (sortBy in sortFunctions && window._filteredPosts && window._filteredPosts.length > 0) {
    const sortedPosts = [...window._filteredPosts];
    sortedPosts.sort(sortFunctions[sortBy]);
    renderPosts(sortedPosts);
  }
});
