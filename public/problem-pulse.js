// =============================================================================
// problem-pulse-v2.js — clean rebuild, piece by piece.
//
// PART 1 — Entry / search flow (runs end-to-end on its own):
//   callOpenAI / callReddit      — two small, reliable proxy helpers
//   getRelatedSearchTermsAI       — brainstorm related search terms
//   findSubredditsForGroup        — turn terms into candidate subreddit names
//   fetchSubredditDetails         — look up one subreddit's stats
//   fetchAndRankSubreddits        — validate + rank the candidates (gentle, 4 at a time)
//   renderSubredditChoices        — show selectable communities
//   initEntryFlow                 — wire the buttons (#find-communities-btn / #inspire-me-button)
//
// Design rules:
//   - Keep it simple. Throttle ONLY where a real burst exists (the subreddit lookups).
//   - Timeouts are cleared in `finally` (after JSON parse) so a stall can't hang silently.
//   - Async functions fail soft (return [] / null), never throw into the UI.
// =============================================================================

const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy';
const EMBEDDINGS_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/embeddings-proxy';

console.log('%c[problem-pulse-v2] BUILD 125 — reverted demographics to the compact bar + age tiles (the donut broke the one-screen height and unbalanced the row)', 'color:#00a5ce;font-weight:bold');

// Hide the results panel on page load so the page never flashes an empty results section before a
// search. You can keep #results-wrapper-b set to `display:flex` in Webflow (easier to design) — this
// rule hides it on the live site, and revealResults() sets an inline `display:flex !important` to
// show it (inline !important overrides this stylesheet rule). transitionToStep1 hides it again.
(function () {
    try {
        var s = document.createElement('style');
        s.id = 'pp-initial-hide';
        s.textContent = '#results-wrapper-b{display:none !important;}';
        (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* non-fatal */ }
})();

const suggestions = ['Dog Owners', 'New Parents', 'Home Bakers', 'Freelance Designers', 'Runners', 'Houseplant Lovers'];

// --- proxy helpers ----------------------------------------------------------
// ONE place to choose the model. To try the faster/cheaper reasoning model, set this to
// 'gpt-5.4-mini' (recommended) or 'gpt-5.4-nano'. The request params are auto-adjusted below for
// reasoning models (minimal reasoning so they stay fast, and temperature dropped since they reject
// a custom one), so flipping this constant is all you need. Revert to 'gpt-4o-mini' anytime.
const AI_MODEL = 'gpt-4o-mini';

// Normalise a payload for whichever model is selected. Reasoning models (gpt-5.x / o-series) must
// not "think" for our extraction tasks (that's slow and burns the token budget), and they reject a
// custom temperature — so we strip it and force minimal reasoning.
function _normalizeAIPayload(payload) {
    const model = payload.model || AI_MODEL;
    const p = { ...payload, model };
    if (/^(gpt-5|o\d)/.test(model)) {
        delete p.temperature;
        if (p.reasoning_effort == null) p.reasoning_effort = 'minimal';
    }
    return p;
}
// Shared OpenAI concurrency gate. We fire a LOT of AI calls (findings + 5 talk panels + sub-problems
// + polarity), and bursting them all at once overloads the single Netlify function — the slow ones
// then time out and come back WITHOUT the CORS header, which the browser reports as a CORS error.
// Capping concurrency + retrying transient failures makes that self-heal.
// Serial (1 at a time). The proxy logs proved that two heavy calls running concurrently starve each
// other — one finishes in ~11s while the other runs to the 24s abort and 504s. Run alone, every call
// completes in 7–12s, well inside the window. Slightly slower wall-clock, but reliable.
const OPENAI_MAX_CONCURRENT = 1;
let _openaiInFlight = 0;
const _openaiQueue = [];
function _acquireOpenAISlot() {
    if (_openaiInFlight < OPENAI_MAX_CONCURRENT) { _openaiInFlight++; return Promise.resolve(); }
    return new Promise(resolve => _openaiQueue.push(resolve));
}
function _releaseOpenAISlot() {
    if (_openaiQueue.length) _openaiQueue.shift()();
    else _openaiInFlight = Math.max(0, _openaiInFlight - 1);
}

async function _callOpenAIOnce(payload, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: payload }),
            signal: ctrl.signal
        });
        if (!res.ok) throw new Error('OpenAI proxy status ' + res.status); // 5xx/timeout → retry
        const data = await res.json();
        if (!data || data.error) throw new Error((data && data.message) || 'OpenAI proxy error');
        return JSON.parse(data.openaiResponse);
    } finally {
        clearTimeout(timer);
    }
}

async function callOpenAI(payload, { timeoutMs = 45000, retries = 2, cache = true } = {}) {
    const normalized = _normalizeAIPayload(payload);
    // RESULTS CACHE (Part A): once an audience is keyed, serve any previously-computed AI result from
    // Firestore instead of calling OpenAI. find-communities runs BEFORE _audienceKey is set, so those
    // calls skip the cache naturally. Pass {cache:false} to force a live call (e.g. on-demand briefs).
    const cacheRef = (cache && typeof window !== 'undefined' && window._audienceKey)
        ? _aiCacheRef(window._audienceKey, normalized) : null;
    if (cacheRef) {
        const hit = await _readAICache(cacheRef);
        if (hit !== undefined) { console.log('[AICache] HIT', cacheRef.id); return hit; }
    }
    await _acquireOpenAISlot();
    try {
        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await _callOpenAIOnce(normalized, timeoutMs);
                if (cacheRef) _writeAICache(cacheRef, result); // fire-and-forget save for the next viewer
                return result;
            } catch (e) {
                lastErr = e;
                if (attempt < retries) {
                    // exponential backoff with jitter (≈0.8s, 1.6s) — lets a transient 504/429 clear
                    // and lands the retry AFTER the initial burst has drained, instead of piling on.
                    await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt) + Math.random() * 400));
                }
            }
        }
        throw lastErr;
    } finally {
        _releaseOpenAISlot();
    }
}

// Shared Reddit concurrency gate. EVERY Reddit call (subreddit lookups, the corpus search, and
// later comment fetches) passes through here, so no feature can ever burst the proxy — the exact
// failure that killed the old app, prevented at the source.
const REDDIT_MAX_CONCURRENT = 3; // browsers allow ~6 connections/origin; leave room for other scripts
let _redditInFlight = 0;
const _redditQueue = [];
function _acquireRedditSlot() {
    if (_redditInFlight < REDDIT_MAX_CONCURRENT) { _redditInFlight++; return Promise.resolve(); }
    return new Promise(resolve => _redditQueue.push(resolve));
}
function _releaseRedditSlot() {
    if (_redditQueue.length) _redditQueue.shift()();
    else _redditInFlight = Math.max(0, _redditInFlight - 1);
}

async function callReddit(payload, { timeoutMs = 12000, retries = 2 } = {}) {
    await _acquireRedditSlot();
    try {
        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const res = await fetch(REDDIT_PROXY_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: ctrl.signal
                });
                // 429 (Reddit rate limit) and 5xx (proxy timeout/error) are transient — back off and
                // retry so a short burst self-heals instead of surfacing as a hard failure. The backoff
                // (held inside the concurrency slot) also naturally throttles us back under the limit.
                if (res.status === 429 || res.status >= 500) throw new Error('Reddit proxy status ' + res.status);
                if (!res.ok) throw new Error('Reddit proxy status ' + res.status);
                return await res.json();
            } catch (e) {
                lastErr = e;
                if (attempt < retries) {
                    await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt) + Math.random() * 500));
                }
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastErr;
    } finally {
        _releaseRedditSlot();
    }
}

// --- find communities -------------------------------------------------------
async function getRelatedSearchTermsAI(audience) {
    const payload = {
        model: AI_MODEL,
        messages: [
            { role: 'system', content: 'You are a creative brainstorming assistant that outputs only JSON.' },
            { role: 'user', content: `Given the target audience "${audience}", generate up to 5 related but distinct search terms or concepts that would help find communities for them. Think about activities, problems, life stages, and related interests. Respond ONLY with a valid JSON object with a single key "terms", which is an array of strings.` }
        ],
        temperature: 0.4,
        max_completion_tokens: 150,
        response_format: { type: 'json_object' }
    };
    try {
        const parsed = await callOpenAI(payload);
        return Array.isArray(parsed.terms) ? parsed.terms : [];
    } catch (error) {
        console.warn('[Search Terms] failed:', error && error.message);
        return [];
    }
}

async function findSubredditsForGroup(groupName) {
    const relatedTerms = await getRelatedSearchTermsAI(groupName);
    window._audienceTopics = relatedTerms;
    const allTerms = [groupName, ...relatedTerms];
    const payload = {
        model: AI_MODEL,
        messages: [
            { role: 'system', content: 'You are an expert Reddit community finder providing answers in strict JSON format.' },
            { role: 'user', content: `Based on the following audience and related keywords: [${allTerms.join(', ')}], do two things:
1. Suggest up to 20 relevant and active Reddit subreddits. Prioritize a variety of communities, including both large general ones and smaller niche ones (names without "r/").
2. Provide a "canonical_audience": ONE clean, standardized Title Case name used to group equivalent searches. Rules:
   - Fix spelling and casing (e.g. "dog onwers" → "Dog Owners", "ai entusiasts" → "AI Enthusiasts").
   - Treat interchangeable enthusiast/affinity phrasings as the SAME audience and map them to one standard label: "dog lovers" / "dog owners" / "dog people" / "dog fans" → "Dog Owners"; "SEO people" / "SEO professionals" / "SEO experts" → "SEO Professionals".
   - But KEEP genuinely different roles, professions, segments or species SEPARATE — do NOT collapse these: "Dog Owners" ≠ "Dog Breeders" ≠ "Dog Trainers" ≠ "Dog Groomers"; "Dog Owners" ≠ "Cat Owners".
Respond ONLY as a JSON object: {"subreddits": ["name", ...], "canonical_audience": "..."}.` }
        ],
        temperature: 0.2,
        max_completion_tokens: 300,
        response_format: { type: 'json_object' }
    };
    try {
        const parsed = await callOpenAI(payload);
        const names = Array.isArray(parsed.subreddits) ? parsed.subreddits : [];
        const canonical = (typeof parsed.canonical_audience === 'string' && parsed.canonical_audience.trim())
            ? parsed.canonical_audience.trim() : groupName;
        return { names, canonical };
    } catch (error) {
        console.error('[Find Subreddits] failed:', error && error.message);
        return { names: [], canonical: groupName };
    }
}

// --- validate + rank candidates --------------------------------------------
async function fetchSubredditDetails(name) {
    try {
        const result = await callReddit({ type: 'about', subreddit: name });
        return result && result.data ? result.data : null; // {display_name, subscribers, active_user_count, public_description}
    } catch (error) {
        console.warn(`[Subreddit] r/${name} lookup failed:`, error && error.message);
        return null;
    }
}

function formatMemberCount(num) {
    if (num == null) return 'N/A';
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(num);
}

function getActivityLabel(active, members) {
    members = members || 0; active = active || 0;
    const ratio = members > 0 ? active / members : 0;
    if (members >= 1000000 || active >= 2000 || ratio >= 0.004) return 'High Activity';
    if (members >= 200000 || active >= 300 || ratio >= 0.0015) return 'Highly Engaged';
    return 'Insight Rich';
}

// Look up each candidate, drop the ones that don't resolve, rank by size. We fire them all at
// once and let the shared Reddit gate throttle to 4 concurrent — no manual batching needed.
async function fetchAndRankSubreddits(names) {
    const list = (names || []).filter(Boolean);
    const details = await Promise.all(list.map(n => fetchSubredditDetails(n)));
    return details
        .filter(d => d && d.display_name) // require a real name — drops the "undefined" entries
        .map(d => ({
            name: d.display_name,
            members: d.subscribers || 0,
            description: d.public_description || '',
            activityLabel: getActivityLabel(d.active_user_count, d.subscribers)
        }))
        .filter(s => s.members >= 100) // drop dead/private/tiny communities — never show <100 members
        .sort((a, b) => b.members - a.members);
}

// --- render -----------------------------------------------------------------
function renderSubredditChoices(subs) {
    const container = document.getElementById('subreddit-choices');
    if (!container) return;
    if (!subs.length) {
        container.innerHTML = '<p class="placeholder-text">No communities found. Try another audience.</p>';
        return;
    }
    // Dedupe by name (case-insensitive) so the same community can't appear twice — duplicates were
    // causing colliding checkbox ids (clicking one toggled the one beside it). Also hide any
    // community under 100 members (covers older cached lists built before that filter existed).
    const seen = new Set();
    subs = subs.filter(s => {
        const k = (s.name || '').toLowerCase();
        if (!k || seen.has(k)) return false;
        if ((s.members || 0) < 100) return false;
        seen.add(k); return true;
    });
    if (!subs.length) { container.innerHTML = '<p class="placeholder-text">No communities found. Try another audience.</p>'; return; }

    // Index-based ids guarantee each checkbox/label pair is unique regardless of the name.
    container.innerHTML = subs.map((sub, i) => `
        <div class="subreddit-choice">
            <input type="checkbox" id="sub-choice-${i}" value="${sub.name}" checked>
            <label for="sub-choice-${i}">
                <span class="sub-checkbox"></span>
                <span class="sub-info">
                    <span class="sub-name">r/${sub.name}</span>
                    <span class="sub-members">${formatMemberCount(sub.members)} members</span>
                </span>
                <span class="pill activity-pill" data-activity="${sub.activityLabel}">${sub.activityLabel}</span>
            </label>
        </div>`).join('');
    // Remember the FULL set (names for the customise check, objects for member counts / warnings).
    window._allRankedSubredditNames = subs.map(s => s.name);
    window._allRankedSubreddits = subs;
}

// =============================================================================
// PART 2 — Run analysis: build the corpus (the single source of truth)
//
// On #search-selected-btn click we fetch ONE post corpus from the chosen subreddits, dedupe and
// store it on window._corpus. Every later analysis reads from that — nothing re-fetches Reddit.
// =============================================================================

// Problem-signal terms. Single words get OR-combined into a couple of queries; multi-word phrases
// are quoted for exact match. ~6 queries total, each one page — enough signal, minimal requests.
const PROBLEM_TERMS_SINGLE = ['problem', 'struggle', 'frustrating', 'annoying', 'hate', 'advice', 'help'];
const PROBLEM_TERMS_PHRASE = ['how do i', 'wish i could', 'any tips', 'looking for'];

// Corpus sizing — deliberately modest. AI analyses sample ~40 posts, so a few hundred is plenty.
const CORPUS_PER_QUERY = 100;     // posts requested per query (Reddit max page) — more raw signal,
                                  // same number of queries, so it's a near-free corpus bump
const CORPUS_TIME_FILTER = 'year'; // recent + enough volume; 'all' would be broader but staler
const CORPUS_MIN_SCORE = 1;        // drop 0-score noise

function buildSubredditQuery(subreddits) {
    return subreddits.map(s => `subreddit:${s}`).join(' OR ');
}

// Read the Webflow search-depth toggle (.pf-radio-group, quick/deep) inside #subreddit-selection-container.
// Deep = bigger corpus (2 pages/query) + more comments. Defaults to quick if nothing is selected.
function _isDeepMode() {
    const scope = document.getElementById('subreddit-selection-container') || document;
    const checked = scope.querySelector('.pf-search-depth-options input[type="radio"]:checked, .pf-radio-group input[type="radio"]:checked');
    if (checked) return /deep/i.test(`${checked.value || ''} ${(checked.closest('label') || {}).textContent || ''}`);
    // Webflow custom radios: the selected one carries .w--redirected-checked.
    const sel = scope.querySelector('.pf-search-depth-options .w--redirected-checked, .pf-radio-group .w--redirected-checked');
    if (sel) { const label = sel.closest('label') || sel.parentElement; return /deep/i.test((label && label.textContent) || ''); }
    return false;
}

// Consolidate the given terms into as few Reddit queries as possible (caps keep the request count
// low): single words in OR groups of 4 (max 8 words → 2 queries), plus up to 4 quoted phrases.
// One extra "resource discovery" lane pulls the casual recommend/tool/podcast threads that the
// problem-signal lanes filter out — this is what feeds real (not AI-guessed) data into Tabs 4 & 5.
const DISCOVERY_TERMS = ['recommend', 'tool', 'app', 'podcast', 'website', 'book', 'favorite', 'best'];
// Purchase-intent phrases — these pull the actual "I bought / don't buy / switched from" threads
// straight into the corpus, which is the gold for the How-They-Shop tab (demand signals + brands).
const DEMAND_PHRASES = ['"i bought"', '"just bought"', '"would recommend"', '"worth the money"', '"switched from"', '"stopped buying"', '"regret buying"', '"highly recommend"'];
// Demographic / platform discovery — pulls threads where people declare where they live, where they
// meet up, and which channels they follow. This is what feeds the thin Where-tab charts with REAL data.
const WHERE_PHRASES = ['"based in"', '"living in"', '"anyone from"', '"discord"', '"facebook group"', '"youtube"', '"podcast"', '"instagram"'];

function buildProblemQueries(terms) {
    const single = (terms || []).filter(t => t && !/\s/.test(t)).slice(0, 8);
    const phrases = (terms || []).filter(t => t && /\s/.test(t)).slice(0, 4);
    const queries = [];
    for (let i = 0; i < single.length; i += 4) {
        const group = single.slice(i, i + 4);
        queries.push(group.length > 1 ? '(' + group.join(' OR ') + ')' : group[0]);
    }
    phrases.forEach(p => queries.push(`"${p}"`));
    queries.push(`(${DISCOVERY_TERMS.join(' OR ')})`); // resource-sharing lane
    queries.push(`(${DEMAND_PHRASES.join(' OR ')})`);  // purchase-intent lane (feeds How They Shop)
    queries.push(`(${WHERE_PHRASES.join(' OR ')})`);   // demographic/platform lane (feeds Where They Are)
    return queries.length ? queries : ['(problem OR struggle OR advice)'];
}

// Ask the model for the audience's OWN complaint vocabulary so the corpus search surfaces real
// problem posts (not generic noise). Fails soft to the static terms.
async function getDomainFrustrationTerms(audience) {
    const fallback = PROBLEM_TERMS_SINGLE.concat(PROBLEM_TERMS_PHRASE);
    if (!audience) return fallback;
    try {
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You output only JSON.' },
                { role: 'user', content: `For the audience "${audience}", list 8-10 words or short phrases this group actually uses when describing PROBLEMS, frustrations or struggles — the specific vocabulary of their complaints. Examples — Home Bakers: ["dense","gummy","didn't rise","flat","overproofed"]; Runners: ["shin splints","hit the wall","DNF","IT band"]. Mix single words and short phrases. Respond ONLY with JSON: {"terms":["...","..."]}.` }
            ],
            temperature: 0.4, max_completion_tokens: 200, response_format: { type: 'json_object' }
        });
        const terms = Array.isArray(parsed.terms) ? parsed.terms.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [];
        const blended = Array.from(new Set(terms.concat(['problem', 'struggle', 'advice']))); // always keep a few generic anchors
        return blended.length >= 4 ? blended : fallback;
    } catch (e) {
        console.warn('[Corpus] frustration terms failed, using static terms:', e && e.message);
        return fallback;
    }
}

// One Reddit search → array of post children. Fails soft to []. `pages` follows Reddit's `after`
// cursor to pull additional pages (Deep mode uses 2 → ~2× the corpus). Search calls are heavier than
// about-lookups, so they get extra timeout headroom.
async function fetchPostsForQuery(subredditQuery, searchTerm, pages = 1) {
    let after = null; const all = [];
    for (let i = 0; i < pages; i++) {
        try {
            const data = await callReddit({
                searchTerm, niche: subredditQuery, limit: CORPUS_PER_QUERY, timeFilter: CORPUS_TIME_FILTER, after
            }, { timeoutMs: 20000 });
            const children = (data && data.data && Array.isArray(data.data.children)) ? data.data.children : [];
            all.push(...children);
            after = data && data.data && data.data.after;
            if (!after || !children.length) break;
        } catch (error) {
            console.warn(`[Corpus] query failed (${searchTerm} p${i + 1}):`, error && error.message);
            break;
        }
    }
    return all;
}

function dedupePosts(children) {
    const seen = new Set();
    return children.filter(c => {
        const id = c && c.data && c.data.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

// Strip Reddit boilerplate (URLs, markdown, "Edit: thanks for the gold") so the text we store and
// send to the model is lean and clean — fewer tokens, faster inference, better signal.
function pruneText(text) {
    if (!text) return '';
    let t = String(text);
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');                 // [text](url) -> text (before URL strip)
    t = t.replace(/https?:\/\/\S+/gi, ' ');                       // bare URLs
    t = t.replace(/[*_`#>]+/g, ' ');                              // markdown emphasis / headings / quotes
    t = t.replace(/\b(edit|update)\s*\d*\s*:\s*(thank|thanks|thx|wow|rip|holy)[^\n]*/gi, ''); // "Edit: thanks…" boilerplate
    t = t.replace(/thank[s]?\s+(you\s+)?(so much\s+|all\s+)?for\s+the\s+(gold|award|awards|upvotes|silver)[^\n]*/gi, '');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
}

// Keep posts with a real title and at least a little traction; flatten to a lean shape (clean body)
// so the rest of the app never touches Reddit's raw envelope.
function normalizeCorpus(children) {
    return children
        .map(c => c.data)
        .filter(d => d && d.title && (d.ups || 0) >= CORPUS_MIN_SCORE)
        .map(d => ({
            id: d.id,
            subreddit: d.subreddit,
            title: d.title,
            body: pruneText(d.selftext || ''),
            score: d.ups || 0,
            comments: d.num_comments || 0,
            created: d.created_utc || 0,
            permalink: d.permalink ? `https://reddit.com${d.permalink}` : '',
            // Real signals we used to discard: the link's domain (a youtube.com/instagram.com link is
            // hard evidence of platform use) and user/post flair (often encodes location). Free — both
            // already arrive in the search response. Feed the social-split + location charts.
            domain: (d.domain || '').toLowerCase(),
            flair: `${d.author_flair_text || ''} ${d.link_flair_text || ''}`.trim().toLowerCase()
        }));
}

// Context density: long, problem-word-rich self-text means a genuine problem write-up; short link/
// image/meme posts score low. We rank by this instead of raw upvotes (which favour viral rescue/meme
// posts), so every downstream analysis sees the real problem discussions first.
const PROBLEM_SIGNAL_WORDS = ['problem', 'struggl', 'frustrat', 'annoy', 'hate', 'wish', 'cant', "can't", 'cannot', 'help', 'advice', 'issue', 'difficult', 'stuck', 'fail', 'worry', 'worried', 'scared', 'confus', 'overwhelm', 'tired', 'exhaust', 'pain', 'worse', 'wont', "won't", 'tried', 'desperate', 'how do i', 'anyone else', 'nightmare', 'driving me'];
function densityScore(post) {
    const text = `${post.title} ${post.body}`.toLowerCase();
    const lenFactor = Math.min((post.body || '').length / 100, 6); // up to 6 for ~600+ chars of body
    let pw = 0; PROBLEM_SIGNAL_WORDS.forEach(w => { if (text.includes(w)) pw++; });
    return lenFactor + Math.min(pw, 6);
}
function rankByDensity(corpus) {
    corpus.forEach(p => { p._density = densityScore(p); });
    corpus.sort((a, b) => (b._density - a._density) || (b.score - a.score));
}

// Build the corpus: audience-specific terms → consolidated queries (gate-throttled) → dedupe →
// normalize (clean text) → rank by density (problem discussions first). One fetch, reused.
async function buildCorpus(subreddits, audience, deep) {
    // Cap the subreddit OR-query: Reddit search silently returns NOTHING when there are too many
    // "subreddit:" filters (this is why 19-subreddit audiences came back with 0 posts). The top ~12
    // by membership cover the bulk of the discussion.
    const searchSubs = subreddits.slice(0, 12);
    const subredditQuery = buildSubredditQuery(searchSubs);
    const terms = await getDomainFrustrationTerms(audience);
    const pages = deep ? 2 : 1; // Deep mode pulls a second page per query → ~2× the corpus
    console.log('[Corpus] frustration terms:', terms, `| searching ${searchSubs.length}/${subreddits.length} subreddits | pages/query: ${pages}`);

    const queries = buildProblemQueries(terms);
    let batches = await Promise.all(queries.map(q => fetchPostsForQuery(subredditQuery, q, pages)));
    let corpus = normalizeCorpus(dedupePosts(batches.flat()));

    // Safety net: if the query came back empty (over-narrow phrases, or still-too-long), retry
    // broad with fewer subreddits so we never strand the user at "0 posts".
    if (!corpus.length) {
        console.warn('[Corpus] 0 posts — retrying broad with fewer subreddits');
        const broadQuery = buildSubredditQuery(subreddits.slice(0, 8));
        const broadBatches = await Promise.all(
            ['(problem OR struggle OR advice OR help)', '(how OR why OR recommend OR best)']
                .map(q => fetchPostsForQuery(broadQuery, q))
        );
        corpus = normalizeCorpus(dedupePosts(broadBatches.flat()));
        console.log(`[Corpus] broad retry returned ${corpus.length} posts`);
    }

    rankByDensity(corpus);
    return corpus;
}

// =============================================================================
// FIREBASE CORPUS CACHE — repeat searches for the same audience skip Reddit entirely.
// All fail-soft: if Firebase isn't on the page or errors, we just fetch live as before.
// =============================================================================
const CORPUS_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;   // posts: re-fetch if >14 days old (content goes stale)
// Bump this whenever the corpus pipeline changes (discovery lane, deeper comments, etc.) so every
// older cached corpus is treated as stale and rebuilt automatically — no manual Firestore deletes.
const CORPUS_SCHEMA_VERSION = 4;
const SUBREDDIT_CACHE_TTL_MS = Infinity;                // communities: never expire — the mapping is stable,
                                                        // and this lets pre-launch seeding persist. Delete a
                                                        // doc in Firebase to force a refresh for one audience.

function _firestore() {
    try { return (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore() : null; }
    catch (e) { return null; }
}
function _audienceSlug(audience) {
    return String(audience || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}
// Deterministic identity for KEYING the community list: strips case, spaces, hyphens and punctuation
// so "Sales People", "sales-people" and "salespeople" all collapse to one key ("salespeople"). The
// AI canonical label (typos + synonyms) layers on top of this for the find-communities lookup.
function _canonKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown';
}

// --- CANONICAL AUDIENCE KEY (Part B) -----------------------------------------
// The audience's identity = the COMMUNITY SET it's analysed on, not the phrase typed. So we key the
// corpus AND the analysis-results cache off a stable signature of the SELECTED subreddits (+ depth).
// Two phrasings ("ai fans" / "ai users") that resolve to the same communities therefore share one
// dataset; a customised subset gets its own correct key. Order-independent (sorted) so the same set
// always hashes the same. The readable prefix aids debugging; the hash guarantees uniqueness.
function _stableHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
function _sigKey(subNames, deep) {
    const names = (subNames || []).map(s => String(s).toLowerCase().trim()).filter(Boolean).sort();
    if (!names.length) return null;
    const prefix = names.slice(0, 4).join('-').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return `${prefix || 'sig'}-${_stableHash(names.join('+'))}${deep ? '-deep' : ''}`;
}

// --- ANALYSIS-RESULTS CACHE (Part A) -----------------------------------------
// Memoises every audience-phase OpenAI call in Firestore under analyses/{audienceKey}/calls/{hash}.
// A warmed/seeded audience then makes ZERO OpenAI calls — instant load, no 504s, near-zero spend.
// Keyed by a hash of (model + messages), so identical inputs reuse one result and any prompt change
// auto-misses (acts like a built-in schema bump). ANALYSIS_SCHEMA_VERSION force-invalidates all.
const ANALYSIS_SCHEMA_VERSION = 1;
const ANALYSIS_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — discussions go stale

function _aiCacheId(payload) {
    try {
        const msgs = (payload.messages || []).map(m => `${m.role}:${m.content}`).join('\n');
        return 'c' + _stableHash((payload.model || '') + '|' + msgs);
    } catch (e) { return null; }
}
function _aiCacheRef(key, payload) {
    const db = _firestore();
    if (!db || !key) return null;
    const id = _aiCacheId(payload);
    if (!id) return null;
    try { return db.collection('analyses').doc(key).collection('calls').doc(id); }
    catch (e) { return null; }
}
async function _readAICache(ref) {
    try {
        const doc = await ref.get();
        if (!doc.exists) return undefined;
        const d = doc.data() || {};
        if (d.schema !== ANALYSIS_SCHEMA_VERSION) return undefined;
        if (d.ttl !== 'inf' && Date.now() - (d.updatedAt || 0) > ANALYSIS_CACHE_TTL_MS) return undefined;
        return JSON.parse(d.responseJson); // stored as a string → bypasses Firestore type limits
    } catch (e) { return undefined; }
}
function _writeAICache(ref, response) {
    try { ref.set({ responseJson: JSON.stringify(response), schema: ANALYSIS_SCHEMA_VERSION, updatedAt: Date.now() }); }
    catch (e) { /* fire-and-forget */ }
}

async function getCachedCorpus(audience, deep) {
    const db = _firestore();
    if (!db) return null; // Firebase not configured — behave exactly as before
    try {
        const doc = await db.collection('corpora').doc(window._audienceKey || (_audienceSlug(audience) + (deep ? '-deep' : ''))).get();
        if (!doc.exists) return null;
        const data = doc.data() || {};
        if (!Array.isArray(data.posts) || !data.posts.length) return null;
        if (data.schema !== CORPUS_SCHEMA_VERSION) { console.log(`[Cache] corpus for "${audience}" is an old schema (v${data.schema || 1}) — rebuilding with the current pipeline`); return null; }
        const ageMs = Date.now() - (data.updatedAt || 0);
        if (ageMs > CORPUS_CACHE_TTL_MS) { console.log(`[Cache] corpus for "${audience}" is stale (${Math.round(ageMs / 3600000)}h) — refetching`); return null; }
        return data.posts;
    } catch (e) { console.warn('[Cache] read failed (continuing live):', e && e.message); return null; }
}

async function setCachedCorpus(audience, posts, deep, deepened, keyOverride) {
    const db = _firestore();
    if (!db || !posts || !posts.length) return;
    try {
        // Trim bodies so the document stays well under Firestore's 1MB limit. Deep keeps more posts
        // (500 still fits ~1MB with trimmed bodies + the ~60 comment threads).
        const lean = posts.slice(0, deep ? 500 : 300).map(p => ({
            id: p.id, subreddit: p.subreddit, title: p.title,
            body: (p.body || '').slice(0, 600),
            commentsText: (p.commentsText || '').slice(0, 4000), // deep comment text (Where/Shop signal)
            score: p.score, comments: p.comments, created: p.created, permalink: p.permalink,
            domain: p.domain || '', flair: (p.flair || '').slice(0, 80) // platform/location signal
        }));
        // `deepened`: this quick corpus has had a background deepening pass — flag it so the deepener
        // never runs again on it (keeps the dataset, and therefore the AI-results cache, stable).
        await db.collection('corpora').doc(keyOverride || window._audienceKey || (_audienceSlug(audience) + (deep ? '-deep' : ''))).set({ audience, posts: lean, updatedAt: Date.now(), schema: CORPUS_SCHEMA_VERSION, deepened: !!deepened });
        console.log(`[Cache] corpus SAVED for "${audience}"${deep ? ' (DEEP)' : ''}${deepened ? ' [deepened]' : ''} (${lean.length} posts)`);
    } catch (e) { console.warn('[Cache] write failed (ignored):', e && e.message); }
}

// --- BACKGROUND PROGRESSIVE DEEPENING (Part C) -------------------------------
// After the tabs are on screen, a quiet background pass deepens a QUICK corpus toward deep level —
// more posts (2-page rebuild, merged + deduped) and more enriched comment threads — then re-caches it
// flagged `deepened`. The NEXT viewer of this audience gets the richer dataset instantly; the live
// experience is never slowed. Runs ONCE per audience (the flag stops re-runs, which keeps both the
// corpus and the AI-results cache stable). Fully fail-soft: any error just leaves the thin corpus.
async function deepenCorpusInBackground(audienceKey, subreddits, audience, opts) {
    opts = opts || {};
    if (opts.deep || opts.isCustomised) return;          // deep already pulls 2 pages; custom subsets aren't the canonical dataset
    const db = _firestore();
    if (!db || !audienceKey || !subreddits || !subreddits.length) return;
    // Skip if this corpus has already been deepened (don't churn the dataset / AI cache).
    try {
        const doc = await db.collection('corpora').doc(audienceKey).get();
        if (doc.exists && doc.data() && doc.data().deepened) { console.log('[Deepen] corpus already deepened — skip'); return; }
    } catch (e) { /* best-effort; continue */ }

    console.log('[Deepen] background pass starting (this is invisible to the user)…');
    // Snapshot THIS run's corpus now — if the user starts another search mid-pass, we still merge and
    // cache against the right audience (and we write to the captured key, never the live one).
    const baseCorpus = (window._corpus || []).slice();
    try {
        // 1) MORE POSTS — rebuild pulling 2 pages/query, then merge + dedupe into the snapshot.
        //    (getDomainFrustrationTerms inside is already AI-cached for this audience → no extra spend.)
        const richer = await buildCorpus(subreddits, audience, true);
        const byId = new Map();
        baseCorpus.concat(richer || []).forEach(p => { if (p && p.id && !byId.has(p.id)) byId.set(p.id, p); });
        const merged = Array.from(byId.values());
        if (merged.length <= baseCorpus.length) { console.log('[Deepen] no new posts found — leaving corpus as-is'); return; }
        rankByDensity(merged);
        // 2) MORE COMMENTS — enrich a deeper slice of threads (skips ones already enriched).
        try { await enrichCorpusWithComments(merged, 70); } catch (e) { console.warn('[Deepen] comment enrich failed (non-fatal)', e); }
        // 3) RE-CACHE the deepened corpus under the CAPTURED key, flagged so it's never re-deepened.
        await setCachedCorpus(audience, merged, true, true, audienceKey);
        console.log(`[Deepen] done — next viewer of "${audience}" gets ${merged.length} posts (was ${baseCorpus.length}).`);
    } catch (e) { console.warn('[Deepen] background pass failed (non-fatal):', e && e.message); }
}

// Cache the ranked communities per audience, so a repeat audience skips the ~20 Reddit subreddit
// lookups AND the 2 OpenAI calls the find-communities step makes. Same fail-soft pattern.
async function getCachedSubreddits(audience) {
    const db = _firestore();
    if (!db) return null;
    try {
        const doc = await db.collection('subreddits').doc(_audienceSlug(audience)).get();
        if (!doc.exists) return null;
        const data = doc.data() || {};
        if (!Array.isArray(data.ranked) || !data.ranked.length) return null;
        if (Date.now() - (data.updatedAt || 0) > SUBREDDIT_CACHE_TTL_MS) return null; // indefinite by default
        // Side-effect: surface the cached canonical label (clean, AI-normalized audience name) so a
        // cache hit still gets a tidy display/history name without re-running find-communities.
        if (data.canonical) window._canonicalAudience = data.canonical;
        return data.ranked;
    } catch (e) { console.warn('[Cache] subreddits read failed (continuing live):', e && e.message); return null; }
}
async function setCachedSubreddits(audience, ranked, canonical) {
    const db = _firestore();
    if (!db || !ranked || !ranked.length) return;
    try {
        await db.collection('subreddits').doc(_audienceSlug(audience)).set({ audience, canonical: canonical || audience, ranked: ranked.slice(0, 40), updatedAt: Date.now() });
        console.log(`[Cache] communities SAVED for "${audience}"${canonical && canonical !== audience ? ` (canonical: "${canonical}")` : ''} (${ranked.length})`);
    } catch (e) { console.warn('[Cache] subreddits write failed (ignored):', e && e.message); }
}

// On-brand message modal driven by Webflow elements (#pp-modal + .pp-modal-message / .pp-modal-ok /
// .pp-modal-cancel). Returns a promise: true = OK/confirm, false = cancel. If the modal isn't on the
// page yet, it falls back to the native alert/confirm so nothing breaks.
function showMessage(message, opts) {
    opts = opts || {};
    const modal = document.getElementById('pp-modal');
    const okBtn = modal && modal.querySelector('.pp-modal-ok');
    if (!modal || !okBtn) { // fail-soft: native dialog
        if (opts.confirm) return Promise.resolve(window.confirm(message));
        window.alert(message); return Promise.resolve(true);
    }
    const msgEl = modal.querySelector('.pp-modal-message');
    const cancelBtn = modal.querySelector('.pp-modal-cancel');
    if (msgEl) msgEl.textContent = message;
    if (cancelBtn) cancelBtn.style.display = opts.confirm ? '' : 'none'; // Cancel only for confirms
    modal.style.setProperty('display', 'flex', 'important');
    return new Promise(resolve => {
        const done = (result) => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            resolve(result);
        };
        const onOk = () => done(true);
        const onCancel = () => done(false);
        const onBackdrop = (e) => { if (e.target === modal) done(false); }; // click outside = cancel
        okBtn.addEventListener('click', onOk);
        if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
}

// --- selection + loader -----------------------------------------------------
function getSelectedSubreddits() {
    const boxes = document.querySelectorAll('#subreddit-choices input[type="checkbox"]:checked');
    return Array.from(boxes).map(b => b.value).filter(v => v && v !== 'undefined');
}

// DIAGNOSTIC: is #id actually on screen? If not, which ancestor is hiding it? This pinpoints the
// "rendered but invisible" case — an element whose own styles are fine but whose parent is hidden.
function _debugVisibility(id) {
    const el = document.getElementById(id);
    if (!el) { console.warn(`[Debug] #${id} NOT FOUND in DOM`); return; }
    let node = el;
    while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
            const who = node.id ? '#' + node.id : (node.className ? '.' + String(node.className).split(' ').join('.') : node.tagName);
            console.warn(`[Debug] #${id} is HIDDEN by ancestor ${who} (display:${cs.display}, visibility:${cs.visibility}, opacity:${cs.opacity})`);
            return;
        }
        node = node.parentElement;
    }
    console.log(`[Debug] #${id} is visible ✓`);
}

// The loader is display:none in Webflow, so we set an explicit visible value to override that
// (setting '' would just fall back to none). We look for #loading-code-1 first, then #full-loader-msg.
const LOADER_IDS = ['loading-code-1', 'full-loader-msg'];
function showLoader(message) {
    const el = LOADER_IDS.map(id => document.getElementById(id)).find(Boolean);
    if (!el) { console.warn('[Loader] no loader found (#loading-code-1 / #full-loader-msg)'); return; }
    el.style.display = 'flex';
    if (message) el.setAttribute('data-status', message);
    _debugVisibility(el.id);
}
function hideLoader() {
    LOADER_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
}

// Re-entrancy guard. Another script on the page (audience-chat.js) also hooks the search and
// triggers the analysis, and the button can be double-clicked — so without this, several corpus
// fetches fire at once, saturate the browser→Netlify connection pool, and everything times out.
// Only ONE analysis runs at a time; duplicate triggers are ignored until it finishes.
let _analysisRunning = false;

// #search-selected-btn handler. Builds the corpus, stores it, then hands off to analysis (Part 3).
// Fills the always-visible snapshot chip (#audience-snapshot) so the user can see which audience
// they're looking at. Populated the instant a search starts — independent of any AI/tab loading.
function populateAudienceSnapshot(audience) {
    const nameEl = document.getElementById('audience-name');
    const dateEl = document.getElementById('search-date');
    const timeEl = document.getElementById('search-time');
    if (nameEl) nameEl.textContent = audience || '—';
    const now = new Date();
    if (dateEl) {
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        dateEl.textContent = `${dd}/${mm}/${now.getFullYear()}`;
    }
    if (timeEl) {
        let h = now.getHours();
        const m = String(now.getMinutes()).padStart(2, '0');
        const ampm = h >= 12 ? 'pm' : 'am';
        h = h % 12; if (h === 0) h = 12;
        timeEl.textContent = `${h}:${m}${ampm}`;
    }
}

async function runProblemFinder(preset) {
    if (_analysisRunning) {
        console.warn('[Analysis] already running — ignoring duplicate trigger.');
        return;
    }
    // REOPEN (Saved Searches): a preset re-runs a past audience straight from its saved community set,
    // skipping the type→find→select steps. Everything's keyed by audienceKey, so it lands on cache.
    if (preset && preset.subreddits && preset.subreddits.length) {
        window.originalGroupName = preset.term || preset.canonical || window.originalGroupName;
        window._canonicalAudience = preset.canonical || preset.term || window._canonicalAudience;
        window._allRankedSubredditNames = preset.subreddits.slice(); // mark this as the full set (not customised)
    }
    const subreddits = (preset && preset.subreddits && preset.subreddits.length) ? preset.subreddits.slice() : getSelectedSubreddits();
    if (!subreddits.length) { showMessage('Select at least one community to analyse.'); return; }

    // Thin-data warning: a single small community rarely has enough discussion for rich insights.
    // (Skipped on reopen — the user already ran this audience once.)
    if (!preset && subreddits.length === 1) {
        const one = (window._allRankedSubreddits || []).find(r => r.name === subreddits[0]);
        if (one && (one.members || 0) < 100000) {
            const ok = await showMessage(`Heads up: you've selected just one small community (r/${one.name}, ${formatMemberCount(one.members)} members). The results may be thin — selecting a few more communities gives much richer insights. Continue anyway?`, { confirm: true });
            if (!ok) return; // let them go back and add more (guard not yet set, so safe to bail)
        }
    }

    _analysisRunning = true; // set synchronously, before any await, so concurrent calls bail here
    populateAudienceSnapshot(window.originalGroupName || ''); // show the audience chip immediately
    console.log('[Analysis] selected subreddits:', subreddits);
    auditTab1Elements(); // logs which Webflow elements actually exist, so we can fix any selector

    showLoader('Gathering discussions…');
    try {
        const audience = window.originalGroupName || '';
        const deep = preset ? !!preset.deep : _isDeepMode(); // .pf-radio-group quick/deep toggle (forced on reopen)
        console.log(`[Analysis] ${deep ? 'DEEP' : 'quick'} mode`);
        // Canonical key: signature of the SELECTED communities (+ depth). Everything for this run —
        // corpus cache AND the per-call analysis-results cache — keys off this, so synonymous phrasings
        // that pick the same communities share one cached dataset and zero AI re-runs.
        window._audienceKey = _sigKey(subreddits, deep);
        console.log('[Analysis] audienceKey =', window._audienceKey);
        // Did the user customise the selection (uncheck some communities)? If so, the corpus is a
        // bespoke subset — DON'T serve the cached full-audience corpus, and DON'T save this one
        // (it isn't the canonical mapping). Only the default full selection uses/writes the cache.
        const fullSet = window._allRankedSubredditNames || [];
        const isCustomised = fullSet.length > 0 && subreddits.length < fullSet.length;

        // Quick and Deep are cached under separate docs (deep is a bigger corpus), so switching depth
        // rebuilds rather than serving the thinner one.
        let corpus = isCustomised ? null : await getCachedCorpus(audience, deep);
        const servedFromCache = !!(corpus && corpus.length);
        if (servedFromCache) {
            console.log(`[Analysis] cache HIT — using ${corpus.length} cached posts, skipped Reddit`);
        } else {
            corpus = await buildCorpus(subreddits, audience, deep);
            if (isCustomised) console.log('[Analysis] customised selection — corpus NOT cached');
        }
        window._corpus = corpus;
        // BACKGROUND comment enrichment for the Where tab (doesn't block Tab 1). Only on a FRESH build —
        // a cached corpus is already enriched (schema v4 guarantees it), so re-enriching would waste
        // Reddit calls AND a re-save would clobber a background-deepened doc (truncating it back down).
        const _needsComments = !servedFromCache && corpus.some(p => !p.commentsText);
        window._corpusEnrichedPromise = (async () => {
            if (!_needsComments) return;
            try { await enrichCorpusWithComments(corpus, deep ? 60 : 35); } catch (e) { console.warn('[Comments] enrichment failed', e); }
            if (!isCustomised) setCachedCorpus(audience, corpus, deep); // fire-and-forget save for the next searcher
        })();
        window._analysisSubreddits = subreddits;
        // New search → clear everything tab-related so it regenerates for this audience.
        window._tabLoaded = {};
        window._findings = null; window._findingsPromise = null; window._assignmentPromise = null;
        window._findingPosts = null; window._findingPostsFull = null; window._polarityPromise = null; window._polarityPoints = null;
        window._talkPromise = null; // Tab 3 regenerates for the new audience
        window._wherePromise = null; window._platformPanelsRendered = false; // Tab 4 regenerates too
        window._shopPromise = null; window._entityData = null; // Tab 5 regenerates too
        window._wideScan = null; // wide-scan recomputes for the new audience (no stale leak into export)
        window._demographics = null; window._archetype = null; window._profile = null; // who-data per audience
        window._whereData = null; window._demandSignals = null; // where/shop export data per audience
        try { briefCache.clear(); } catch (e) { } // drop cached brand/product briefs for the new audience
        window._corpusEnrichedPromise = null; // re-enrich comments for the new audience
        if (window._polarityChart && window._polarityChart.destroy) { window._polarityChart.destroy(); window._polarityChart = null; }
        console.log(`[Analysis] corpus ready: ${corpus.length} posts`);
        if (!corpus.length) {
            showMessage('No discussions found for those communities. Try different ones.');
            return;
        }
        // Part 3 — Tab 1 ("Who they are"). All read from the corpus; nothing refetched.
        showLoader('Analysing audience…');
        // Headline volume = posts + the comments of real discussion they sit on. This is the honest
        // "real conversation mined" figure (large, and defensible as the discussion pool the analysis
        // draws on). NOTE: relabel the Webflow element from "insights found" to "posts & comments
        // analysed" (or "data points") so the claim matches the number. A rigorously-true "analysed"
        // count of this size comes later from the embeddings wide-scan (see embeddings-wide-scan-plan.md).
        const commentPool = corpus.reduce((sum, p) => sum + (p.comments || 0), 0);
        const dataPoints = corpus.length + commentPool; // posts + comments mined
        renderTab1Counts(audience, corpus.length, dataPoints); // instant, from data we already have
        // The two AI panels run in parallel (2 OpenAI calls) so the tab fills as fast as possible.
        await Promise.all([
            generateAndRenderWho(corpus, audience),
            generateAndRenderArchetype(corpus, audience),
            generateAndRenderProfile(corpus, audience)
        ]);
        revealResults();
        // SAVED SEARCHES — record this analysis in the user's history (Memberstack, fire-and-forget).
        try {
            saveSearchToHistory({
                term: window.originalGroupName || audience,
                canonical: window._canonicalAudience || window.originalGroupName || audience,
                audienceKey: window._audienceKey,
                subreddits: subreddits.slice(0, 40),
                deep: deep
            });
        } catch (e) { console.warn('[SavedSearch] save failed (non-fatal)', e); }
        // Pre-warm Tab 2 (findings + post assignment) and the polarity map in the background while
        // the user reads Tab 1, so switching to those tabs is near-instant. No Reddit here, so it's
        // safe to run quietly. A small delay lets Tab 1's render settle first.
        // STAGGERED pre-fetch: firing all four tabs at once bursts ~12 OpenAI calls at the proxy and
        // the slow ones 504. We spread them out — findings + polarity first (the primary insights),
        // then talk, then where — so the proxy/OpenAI never sees the whole herd at once.
        setTimeout(() => { try { loadTabHurts(); loadPolarityMap(); } catch (e) { /* non-fatal */ } }, 400);
        setTimeout(() => { try { loadTabTalk(); } catch (e) { /* non-fatal */ } }, 2500);
        setTimeout(() => { try { loadTabWhere(); } catch (e) { /* non-fatal */ } }, 5000);
        setTimeout(() => { try { loadTabShop(); } catch (e) { /* non-fatal */ } }, 7500);
        // PART C — once everything's pre-warmed, quietly deepen this audience's corpus for the NEXT
        // viewer (more posts + comments, re-cached). Captures the key so a later search can't misroute
        // the write. Skipped automatically for deep/customised/already-deepened. Pure background.
        const _deepenKey = window._audienceKey, _deepenSubs = subreddits.slice();
        setTimeout(() => { try { deepenCorpusInBackground(_deepenKey, _deepenSubs, audience, { deep, isCustomised }); } catch (e) { /* non-fatal */ } }, 14000);
    } catch (error) {
        console.error('[Analysis] failed to build corpus:', error);
        showMessage('Something went wrong gathering discussions. Please try again.');
    } finally {
        hideLoader();
        _analysisRunning = false;
    }
}

// =============================================================================
// PART 3 — "Who they are": audience demographics, read straight from the corpus
// =============================================================================

// MEASURE demographics from real self-reports in the corpus (age-gender tags like "34F"/"29M",
// "I'm 34", "as a mom/dad", explicit ages). Returns counts; the caller uses these when there's
// enough signal and falls back to the AI estimate otherwise. This is a biased subsample (only people
// who self-identify), which is why the UI shows the sample size and labels estimates honestly.
function measureDemographics(corpus) {
    let male = 0, female = 0, a1 = 0, a2 = 0, a3 = 0; // a1:18-24  a2:25-45  a3:45+
    const bucket = (age) => { if (age >= 18 && age <= 24) a1++; else if (age >= 25 && age <= 45) a2++; else if (age > 45 && age <= 85) a3++; };
    const reTag1 = /\b(\d{2})\s*\/?\s*([mf])\b/gi;   // 34F, 29 m, 31/F
    const reTag2 = /\b([mf])\s*\/?\s*(\d{2})\b/gi;   // F34, M/29
    const reAge1 = /\bi(?:'?m| am)\s+(\d{1,2})\b/gi;  // I'm 34 / I am 34
    const reAge2 = /\b(\d{1,2})\s*(?:years old|yrs old|yo|y\/o)\b/gi;
    const reAge3 = /\b(?:age|aged|turning|i'?m turning)\s*:?\s*(\d{1,2})\b/gi; // age 34 / turning 30
    const reFemale = /\bas a (?:mom|mum|mother|woman|girl|wife|lady|gal)\b|\bi'?m (?:a )?(?:woman|female|girl|mom|mum|mother)\b|\bmy husband\b/gi;
    const reMale = /\bas a (?:dad|father|man|guy|husband|bloke|boy|fella)\b|\bi'?m (?:a )?(?:man|male|guy|dad|father)\b|\bmy wife\b/gi;
    (corpus || []).forEach(p => {
        const text = `${p.title || ''} ${p.body || ''} ${p.commentsText || ''} ${p.flair || ''}`.toLowerCase();
        let m;
        reTag1.lastIndex = 0; while ((m = reTag1.exec(text))) { const age = +m[1]; if (age >= 16 && age <= 85) { (m[2] === 'f' ? female++ : male++); bucket(age); } }
        reTag2.lastIndex = 0; while ((m = reTag2.exec(text))) { const age = +m[2]; if (age >= 16 && age <= 85) { (m[1] === 'f' ? female++ : male++); bucket(age); } }
        reAge1.lastIndex = 0; while ((m = reAge1.exec(text))) { const age = +m[1]; if (age >= 16 && age <= 85) bucket(age); }
        reAge2.lastIndex = 0; while ((m = reAge2.exec(text))) { const age = +m[1]; if (age >= 16 && age <= 85) bucket(age); }
        reAge3.lastIndex = 0; while ((m = reAge3.exec(text))) { const age = +m[1]; if (age >= 16 && age <= 85) bucket(age); }
        female += (text.match(reFemale) || []).length;
        male += (text.match(reMale) || []).length;
    });
    return { male, female, genderN: male + female, a1, a2, a3, ageN: a1 + a2 + a3 };
}

// Self-contained, inline-styled block (matches the original dashboard look so it renders the same
// regardless of Webflow CSS). All values are guarded so a missing field can't break the layout.
function renderDemographicsHTML(d) {
    const n = (v) => (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.round(v)) : 0;
    const male = n(d.male_pct), female = n(d.female_pct);
    const a1 = n(d.age_18_24), a2 = n(d.age_25_45), a3 = n(d.age_45_plus);
    const note = (src, count, kind) => src === 'measured'
        ? `Measured from ${count} self-identified ${kind}`
        : `Estimated from discussion language & audience name`;
    const genderNote = note(d.gender_source, d.gender_n, 'users');
    const ageNote = note(d.age_source, d.age_n, 'ages');
    const BLUE = '#686ee2', PINK = '#d6539d', DARK = '#201e57';
    const ageCard = (label, val, primary) => `
        <div style="padding:11px 8px; border-radius:12px; background:${primary ? 'rgba(104,110,226,0.075)' : '#f6f7f9'}; ${primary ? 'box-shadow:inset 0 0 0 1px rgba(104,110,226,0.40);' : ''}">
            <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.04em; color:${primary ? BLUE : '#9ca3af'}; text-transform:uppercase;">${label}</div>
            <div style="font-size:16px; font-weight:800; color:${DARK}; margin-top:2px;">${val}%</div>
        </div>`;
    const dot = (c) => `<span style="width:11px; height:11px; border-radius:50%; background:${c}; flex:0 0 auto; box-shadow:0 1px 3px rgba(0,0,0,0.15);"></span>`;
    return `
        <div style="font-family:'Plus Jakarta Sans', system-ui, sans-serif; color:${DARK};">
            <div style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:9px; font-size:0.95rem; font-weight:600;">
                    <span style="display:flex; align-items:center; gap:8px;">${dot(BLUE)} Male <b style="color:${DARK};">${male}%</b></span>
                    <span style="display:flex; align-items:center; gap:8px;">Female <b style="color:${DARK};">${female}%</b> ${dot(PINK)}</span>
                </div>
                <div style="width:100%; height:10px; background:#eef0f4; border-radius:999px; display:flex; overflow:hidden;">
                    <div style="width:${male}%; background:${BLUE};"></div>
                    <div style="width:${female}%; background:${PINK};"></div>
                </div>
                <div style="font-size:0.72rem; color:#9ca3af; margin-top:7px;">${genderNote}</div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; text-align:center;">
                ${ageCard('18-24', a1, false)}${ageCard('25-45', a2, true)}${ageCard('45+', a3, false)}
            </div>
            <div style="font-size:0.72rem; color:#9ca3af; margin-top:7px;">${ageNote}</div>
        </div>`;
}

async function generateAndRenderWho(corpus, audience) {
    const container = document.getElementById('overview-div');
    if (!container) { console.warn('[Who] #overview-div not found — cannot render.'); return; }
    container.innerHTML = '<p class="loading-text">Calculating demographic proportions…</p>';

    // Top ~50 posts, capped at 600 chars each — enough signal, small upload.
    const sample = corpus.slice(0, 50)
        .map(p => `Title: ${p.title}\nContent: ${p.body}`.substring(0, 600))
        .join('\n---\n');

    const payload = {
        model: AI_MODEL,
        messages: [
            { role: 'system', content: 'You are a precise demographic estimator.' },
            { role: 'user', content: `Estimate the demographics of the audience "${audience}" using BOTH the audience name and the language/slang/life-experiences in these Reddit posts. CRITICAL: if the audience name itself explicitly implies a gender, age, or life stage, let that strongly anchor the estimate — e.g. "Women in Business" or "New Moms" → ~90-100% female; "New Dads" → ~90-100% male; "Retirees" → mostly 45+; "Teen ..." → mostly 18-24. Only deviate from an explicit cue if the posts clearly contradict it. You MUST provide numerical percentages. Respond ONLY with a valid JSON object: "male_pct" (integer), "female_pct" (integer), "age_18_24" (integer), "age_25_45" (integer), "age_45_plus" (integer), "top_life_stage" (a 3-4 word string, e.g. "Young Professionals"). Text: ${sample}` }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
    };

    try {
        const parsed = await callOpenAI(payload);                 // AI estimate (anchored on the audience name = industry baseline)
        const measured = measureDemographics(corpus);             // real self-reports from the corpus
        // Need a STATISTICALLY MEANINGFUL self-report sample before we show "measured" — a handful of
        // bios (9, 12, 13…) is misleading on the first tab a user sees. Below this, fall back to the
        // audience-baseline estimate (clearly labelled), per the accuracy review.
        const GENDER_MIN = 30, AGE_MIN = 30;
        const d = { top_life_stage: parsed.top_life_stage };
        // Gender: use measured split when we have enough self-identifications, else fall back to estimate.
        if (measured.genderN >= GENDER_MIN) {
            d.female_pct = Math.round((measured.female / measured.genderN) * 100);
            d.male_pct = 100 - d.female_pct;
            d.gender_source = 'measured'; d.gender_n = measured.genderN;
        } else {
            d.male_pct = parsed.male_pct; d.female_pct = parsed.female_pct; d.gender_source = 'estimated';
        }
        // Age: same logic.
        if (measured.ageN >= AGE_MIN) {
            d.age_18_24 = Math.round((measured.a1 / measured.ageN) * 100);
            d.age_25_45 = Math.round((measured.a2 / measured.ageN) * 100);
            d.age_45_plus = Math.max(0, 100 - d.age_18_24 - d.age_25_45);
            d.age_source = 'measured'; d.age_n = measured.ageN;
        } else {
            d.age_18_24 = parsed.age_18_24; d.age_25_45 = parsed.age_25_45; d.age_45_plus = parsed.age_45_plus; d.age_source = 'estimated';
        }
        window._demographics = d; // stash for the CSV export
        container.innerHTML = renderDemographicsHTML(d);
        console.log(`[Who] demographics — gender:${d.gender_source}(${measured.genderN}) age:${d.age_source}(${measured.ageN})`, d);
    } catch (error) {
        console.error('[Who] demographics failed:', error);
        container.innerHTML = '<p class="error-message">Could not analyse demographics. Please try again.</p>';
    }
}

// BLUEPRINT METHOD: these elements are designed in Webflow, so we fill the existing element's text
// and never touch its parent's HTML — the design stays intact, only the value changes.
function setDesignedText(selector, value) {
    document.querySelectorAll(selector).forEach(el => { el.innerText = value; });
}

// One-time audit so we can SEE exactly which Webflow elements exist (and under what selector).
function auditTab1Elements() {
    const idCheck = (id) => document.getElementById(id) ? 'FOUND' : 'missing';
    const clsCheck = (sel) => document.querySelectorAll(sel).length;
    console.log('[Audit] tab-1 elements:', {
        'id#loading-code-1': idCheck('loading-code-1'),
        'id#full-loader-msg': idCheck('full-loader-msg'),
        'id#results-wrapper-b': idCheck('results-wrapper-b'),
        'id#overview-div': idCheck('overview-div'),
        'id#architype-heading': idCheck('architype-heading'),
        'id#archetype-heading': idCheck('archetype-heading'),
        'id#archetype-d': idCheck('archetype-d'),
        '.count-audience': clsCheck('.count-audience'),
        '.count-insights': clsCheck('.count-insights'),
        '.count-insight': clsCheck('.count-insight'),
        '.count-posts': clsCheck('.count-posts'),
        'id#goals-pillar': idCheck('goals-pillar'),
        'id#fears-pillar': idCheck('fears-pillar'),
        'goals .pillar-item-template': clsCheck('#goals-pillar .pillar-item-template'),
        'fears .pillar-item-template': clsCheck('#fears-pillar .pillar-item-template'),
        'id#characteristics-d': idCheck('characteristics-d'),
        'id#reject-d': idCheck('reject-d'),
        'chars .mindset-item-template': clsCheck('#characteristics-d .mindset-item-template'),
        'reject .mindset-item-template': clsCheck('#reject-d .mindset-item-template')
    });
}

// Tab-1 count line. .count-posts = curated posts analysed; .count-insights = posts + comments mined
// (the "real conversation" volume — relabel the Webflow copy to "posts & comments analysed"). Logs
// how many elements each selector matched so a zero-match (wrong class) is obvious.
function renderTab1Counts(audience, postsCount, dataPoints) {
    const set = (sel, val) => {
        const els = document.querySelectorAll(sel);
        console.log(`[Counts] "${sel}" matched ${els.length} element(s)`);
        els.forEach(el => { el.innerText = val; });
    };
    set('.count-audience', audience || '');
    set('.count-posts', Number(postsCount).toLocaleString());
    set('.count-insights, .count-insight', Number(dataPoints).toLocaleString());
}

// Set the archetype summary text WITHOUT destroying a .tag-wrap the user nested inside #archetype-d
// (setting .textContent would wipe it). Removes only the previous text nodes, keeps the tag-wrap.
function _setArchetypeSummary(descEl, text) {
    if (!descEl) return;
    const tagWrap = descEl.querySelector('.tag-wrap');
    if (!tagWrap) { descEl.textContent = text || ''; return; }
    [...descEl.childNodes].forEach(node => { if (node !== tagWrap) descEl.removeChild(node); });
    if (text) descEl.insertBefore(document.createTextNode(text + ' '), tagWrap);
}
// Fill .tag-wrap with one-word .who-tag snapshot tags, cloning the user's existing .who-tag as a
// styled blueprint so the Webflow styling is preserved.
function renderWhoTags(tags) {
    const wrap = document.querySelector('#archetype-d .tag-wrap, #architype-d .tag-wrap, .archetype-d .tag-wrap, .architype-d .tag-wrap, .tag-wrap');
    if (!wrap) return;
    if (!window._whoTagBlueprint) { const bp = wrap.querySelector('.who-tag'); if (bp) window._whoTagBlueprint = bp.cloneNode(true); }
    const bp = window._whoTagBlueprint;
    wrap.querySelectorAll('.who-tag').forEach(el => el.remove());
    const seen = new Set();
    const words = (tags || [])
        .map(t => String(t || '').trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9'\-]/g, ''))
        .filter(w => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase())) // one word, de-duped (case-insensitive)
        .slice(0, 6);
    words.forEach(w => {
        let node;
        if (bp) { node = bp.cloneNode(true); node.textContent = w; }
        else { node = document.createElement('div'); node.className = 'who-tag'; node.textContent = w; }
        wrap.appendChild(node);
    });
    console.log('[Archetype] tags:', words);
}

// Audience archetype — a 2-3 word name + a 2-sentence character study. Fills the designed
// #archetype-heading (/.archetype-heading/.architype-heading) and #archetype-d in place.
async function generateAndRenderArchetype(corpus, audience) {
    // Cover every spelling/form: ID or class, "archetype" or "architype".
    const headingEl = document.querySelector('#architype-heading, #archetype-heading, .architype-heading, .archetype-heading');
    const descEl = document.querySelector('#archetype-d, #architype-d, .archetype-d, .architype-d');
    console.log('[Archetype] heading el:', headingEl ? (headingEl.id || headingEl.className) : 'NONE', '| desc el:', descEl ? (descEl.id || descEl.className) : 'NONE');
    if (!headingEl && !descEl) { console.warn('[Archetype] no archetype elements found.'); return; }
    if (headingEl) headingEl.textContent = 'Analysing…';
    _setArchetypeSummary(descEl, ''); // clear text but keep the nested .tag-wrap

    const sample = corpus.slice(0, 20)
        .map(p => `Title: ${p.title}\nContent: ${p.body}`.substring(0, 450))
        .join('\n---\n');

    const payload = {
        model: AI_MODEL,
        messages: [
            { role: 'system', content: 'You are a sharp cultural observer who writes psychologically specific field notes about online communities. You output only valid JSON and never sound like a marketing deck.' },
            { role: 'user', content: `You have spent months lurking inside the "${audience}" community on Reddit. Below are real discussions. Respond ONLY with a valid JSON object with these keys: "archetype" (a short, 2-3 word evocative name for this audience, e.g. "The Practical Innovators"), "summary" (EXACTLY 2 short sentences, 40 words maximum — a sharp character study built around one instinct or contradiction, landing one memorable phrase; do NOT use "this audience is driven by", "they value", or "they appreciate"), and "tags" (an array of 5 SINGLE-WORD snapshot descriptors of this audience — exactly one word each, evocative and specific, e.g. ["Overwhelmed","Devoted","Resourceful","Time-poor","Anxious"]). Posts:\n${sample}` }
        ],
        temperature: 0.6,
        max_completion_tokens: 300,
        response_format: { type: 'json_object' }
    };

    try {
        const parsed = await callOpenAI(payload);
        if (headingEl) headingEl.textContent = parsed.archetype || '';
        _setArchetypeSummary(descEl, parsed.summary || ''); // preserves the nested .tag-wrap
        renderWhoTags(parsed.tags);                         // one-word snapshot tags
        window._archetype = { name: parsed.archetype || '', summary: parsed.summary || '', tags: parsed.tags || [] }; // for export
        console.log('[Archetype] rendered:', parsed.archetype);
    } catch (error) {
        console.error('[Archetype] failed:', error);
        if (headingEl) headingEl.textContent = 'Analysis Failed';
        _setArchetypeSummary(descEl, 'Could not generate the audience summary. Please try again.');
    }
}

// --- audience profile: goals / fears / characteristics / rejects -----------
// All four are designed in Webflow as repeating templates, so we use the blueprint method:
// capture the template ONCE (before clearing), then clone it per item and fill the text node.
function capturePillarBlueprint(container) {
    const tpl = container.querySelector('.pillar-item-template');
    return tpl ? tpl.cloneNode(true) : null;
}
function captureMindsetBlueprints(container) {
    const tpls = container.querySelectorAll('.mindset-item-template');
    return tpls.length ? Array.from(tpls).map(t => t.cloneNode(true)) : null; // keep all 3 to preserve their static numbers
}
// opts.textSelector picks the styled text element; opts.addClass guarantees the styling class is
// present even when the template is a bare div (fears: the text node may have no .pillar-item-fear,
// so we ADD it, which is what makes the Webflow fear style apply).
function populatePillars(container, blueprint, items, opts) {
    opts = opts || {};
    container.innerHTML = '';
    (items || []).slice(0, 3).forEach(text => {
        const clone = blueprint.cloneNode(true);
        clone.style.removeProperty('display');
        const textNode = (opts.textSelector && clone.querySelector(opts.textSelector))
            || clone.querySelector('.pillar-item-text')
            || clone.querySelector('.pillar-item-fear')
            || clone;
        textNode.innerText = text;
        if (opts.addClass) textNode.classList.add(opts.addClass);
        container.appendChild(clone);
    });
}
function populateMindset(container, blueprints, items) {
    container.innerHTML = '';
    (items || []).slice(0, 3).forEach((text, i) => {
        const bp = blueprints[i] || blueprints[blueprints.length - 1]; // matching template keeps its number (1/2/3)
        const clone = bp.cloneNode(true);
        clone.style.removeProperty('display');
        const descEl = clone.querySelector('.mindset-item-desc') || clone;
        descEl.innerText = text;
        container.appendChild(clone);
    });
}

async function generateAndRenderProfile(corpus, audience) {
    const goalsC = document.getElementById('goals-pillar');
    const fearsC = document.getElementById('fears-pillar');
    const charsC = document.getElementById('characteristics-d');
    const rejectC = document.getElementById('reject-d');
    if (!goalsC && !fearsC && !charsC && !rejectC) { console.warn('[Profile] no profile containers found.'); return; }

    // Capture blueprints ONCE, before any clear, so the Webflow design is never lost.
    window._bp = window._bp || {};
    if (goalsC && !window._bp.goals) window._bp.goals = capturePillarBlueprint(goalsC);
    if (fearsC && !window._bp.fears) window._bp.fears = capturePillarBlueprint(fearsC);
    if (charsC && !window._bp.chars) window._bp.chars = captureMindsetBlueprints(charsC);
    if (rejectC && !window._bp.reject) window._bp.reject = captureMindsetBlueprints(rejectC);

    const sample = corpus.slice(0, 20)
        .map(p => `Title: ${p.title}\nContent: ${p.body}`.substring(0, 450))
        .join('\n---\n');

    const payload = {
        model: AI_MODEL,
        messages: [
            { role: 'system', content: 'You are a perceptive observer of human motivation who writes honest, specific, non-corporate insight about online communities. Output only valid JSON.' },
            { role: 'user', content: `You have spent months inside the "${audience}" community reading how they really talk. Below are real discussions. Respond ONLY with a valid JSON object with these four keys, each an array of EXACTLY 3 short strings in a plain human voice — easy to grasp instantly, no waffle, ~12 words or fewer, never corporate or strategy-deck language:
"goals": 3 things they quietly hope for, in emotional human terms.
"fears": 3 things that genuinely worry or keep them up at night.
"characteristics": 3 defining traits or instincts of this audience.
"rejects": 3 things this audience dislikes, distrusts, or pushes back against.
Ground every line in the posts. Posts:\n${sample}` }
        ],
        temperature: 0.6,
        max_completion_tokens: 500,
        response_format: { type: 'json_object' }
    };

    try {
        const parsed = await callOpenAI(payload);
        window._profile = { goals: parsed.goals || [], fears: parsed.fears || [], characteristics: parsed.characteristics || [], rejects: parsed.rejects || [] }; // for export
        if (goalsC && window._bp.goals) populatePillars(goalsC, window._bp.goals, parsed.goals, { textSelector: '.pillar-item-text' });
        if (fearsC && window._bp.fears) populatePillars(fearsC, window._bp.fears, parsed.fears, { textSelector: '.pillar-item-fear', addClass: 'pillar-item-fear' });
        if (charsC && window._bp.chars) populateMindset(charsC, window._bp.chars, parsed.characteristics);
        if (rejectC && window._bp.reject) populateMindset(rejectC, window._bp.reject, parsed.rejects);
        console.log('[Profile] rendered:', {
            goals: (parsed.goals || []).length, fears: (parsed.fears || []).length,
            characteristics: (parsed.characteristics || []).length, rejects: (parsed.rejects || []).length
        });
    } catch (error) {
        console.error('[Profile] failed:', error);
    }
}

// =============================================================================
// PART 4 — Tab 2 "What hurts them" (#tab-hurts): the problem/findings cards.
//
// LAZY: generated the first time the tab is opened, then cached. ONE AI call over the existing
// corpus — no new Reddit fetch. Sample posts + subproblems come in Stage 2 (on .see-more).
// =============================================================================

// Quick visibility audit for the tab-2 card elements (parallels auditTab1Elements).
function auditTab2Elements() {
    const b1 = document.getElementById('findings-block1');
    console.log('[Audit tab2]', {
        'findings-block1': b1 ? 'FOUND' : 'missing',
        '.section-title': b1 ? !!b1.querySelector('.section-title') : '-',
        '.summary-full': b1 ? !!b1.querySelector('.summary-full') : '-',
        '.quote count': b1 ? b1.querySelectorAll('.quote').length : '-',
        '.prevalence-container-wrapper': b1 ? !!b1.querySelector('.prevalence-container-wrapper') : '-',
        'blocks 1-5 present': [1, 2, 3, 4, 5].map(i => document.getElementById('findings-block' + i) ? 1 : 0).join('')
    });
}

// Fast, instant estimate of how many corpus posts back a finding (word-boundary keyword match).
// Used for the immediate card render before the slower semantic assignment refines it.
function keywordSupport(finding, corpus) {
    let n = 0;
    for (const p of corpus) { if (scorePostForFinding(p, finding) >= RELEVANCE_MIN_SCORE) n++; }
    return n;
}

// Local prevalence: how many corpus posts relate to each finding (keyword match). No fetch.
function computeFindingPrevalence(findings, corpus) {
    const texts = corpus.map(p => `${p.title} ${p.body}`.toLowerCase());
    const withSupport = findings.map(f => {
        const kws = ((f.keywords && f.keywords.length) ? f.keywords : (f.title || '').split(/\s+/))
            .map(k => String(k).toLowerCase()).filter(k => k.length > 2);
        let support = 0;
        texts.forEach(t => { if (kws.some(k => t.includes(k))) support++; });
        return Object.assign({}, f, { support });
    });
    const total = withSupport.reduce((s, f) => s + f.support, 0) || 1;
    return withSupport
        .map(f => Object.assign({}, f, { prevalence: Math.round((f.support / total) * 100) }))
        .sort((a, b) => b.prevalence - a.prevalence);
}

// Prevalence. PREFERRED path: you build the bar in Webflow and we just fill values into your
// elements (.prevalence-bar-foreground width, .prevalence-percent, .prevalence-label,
// .prevalence-subtitle) — your styling, untouched. FALLBACK: if you haven't built those elements
// yet, we inject a simple default bar so the card isn't blank.
function populatePrevalence(block, prevalence) {
    const wrap = block.querySelector('.prevalence-container-wrapper');
    if (!wrap) return;
    const lvl = prevalence >= 30 ? 'high' : prevalence >= 15 ? 'medium' : 'low';

    const fill = wrap.querySelector('.prevalence-bar-foreground');
    const pct = wrap.querySelector('.prevalence-percent');
    const label = wrap.querySelector('.prevalence-label, .prevalence-header');
    const subtitle = wrap.querySelector('.prevalence-subtitle');

    if (fill || pct || label || subtitle) {
        // Your own Webflow structure — fill values only, never touch your styling/classes.
        wrap.setAttribute('data-level', lvl); // lets you colour high/medium/low in Webflow via CSS
        if (fill) fill.style.width = prevalence + '%';
        if (pct) pct.textContent = prevalence + '%';
        if (label) label.textContent = lvl.charAt(0).toUpperCase() + lvl.slice(1) + ' Prevalence';
        if (subtitle) subtitle.textContent = prevalence + '% of problems';
    } else {
        wrap.innerHTML = renderPrevalenceBar(prevalence); // fallback until you build your own
    }
}

function renderPrevalenceBar(prevalence) {
    const level = prevalence >= 30 ? 'High' : prevalence >= 15 ? 'Medium' : 'Low';
    const color = prevalence >= 30 ? '#296fd3' : prevalence >= 15 ? '#5b98eb' : '#aecbfa';
    return `<div class="prevalence-container">
        <div class="prevalence-header" style="font-size:12px;color:#888;margin-bottom:6px;">${level} Prevalence</div>
        <div class="prevalence-bar-background" style="background:#1e2a38;border-radius:4px;overflow:hidden;height:18px;">
            <div class="prevalence-bar-foreground" style="width:${prevalence}%;background:${color};height:100%;color:#fff;font-size:11px;text-align:right;padding-right:6px;line-height:18px;box-sizing:border-box;">${prevalence}%</div>
        </div>
        <div class="prevalence-subtitle" style="font-size:11px;color:#888;margin-top:6px;">${prevalence}% of problems</div>
    </div>`;
}

// Fill one card. Only sets text on leaf elements + the prevalence wrapper — never touches the
// block's combo classes, so card colours are preserved.
function renderFindingCard(i, finding) {
    const block = document.getElementById('findings-block' + i);
    if (!block) return false;
    block.style.removeProperty('display'); // show (respect the Webflow default display)

    const title = block.querySelector('.section-title');
    if (title) title.textContent = finding.title || '';

    const full = block.querySelector('.summary-full');
    if (full) full.textContent = finding.summary || '';
    const teaser = block.querySelector('.summary-teaser');
    if (teaser) teaser.style.display = 'none'; // dropped: summary-full is now short + punchy

    const quotesC = block.querySelector('.quotes-container');
    if (quotesC) {
        quotesC.querySelectorAll('.quote').forEach((el, idx) => {
            const text = (finding.quotes || [])[idx];
            if (text) { el.textContent = `“${text}”`; el.style.removeProperty('display'); }
            else { el.style.display = 'none'; }
        });
    }

    populatePrevalence(block, finding.prevalence);
    return true;
}

async function generateAndRenderFindings(corpus, audience) {
    auditTab2Elements();
    // Show every block in its loading state (shimmer + dimmed + floating section-title) right away;
    // each block clears to its normal styling as soon as its card is filled below.
    for (let i = 1; i <= 5; i++) {
        const b = document.getElementById('findings-block' + i);
        if (b) b.style.removeProperty('display');
        setItemLoading('findings-block' + i, true);
    }

    // NOTE: no global loader here — findings are pre-fetched in the background after Tab 1 reveals.
    // The #tab-hurts click handler shows a loader only if you open the tab before it's ready.
    // Sample widely (60 posts) so the model sees the full RANGE of problems, not just the few densest
    // themes — this is what lets it name 4-6 genuinely distinct problems.
    const sample = corpus.slice(0, 60)
        .map(p => `Title: ${p.title}\nContent: ${p.body}`.substring(0, 400))
        .join('\n---\n');

    const payload = {
        model: AI_MODEL,
        messages: [
            { role: 'system', content: 'You distil community discussions into a few core problems with authentic quotes. Output only valid JSON.' },
            { role: 'user', content: `Analyse these discussions about "${audience}" and identify 4 to 6 of the most common, clearly recurring, DISTINCT PROBLEMS — genuine pain points, frustrations, struggles, worries, or unmet needs. Make them genuinely different from each other (no near-duplicate or overlapping problems). IMPORTANT: include ONLY real problems/difficulties. Do NOT include positive or heart-warming themes, things they love or enjoy, or ways their dog helps them — e.g. "emotional support from dogs" is NOT a problem and must be excluded. Respond ONLY with a JSON object: {"findings":[{"title","summary","quotes","keywords","intensity"}]}. Rules — "title": 3-6 words naming a problem, plain and specific. "summary": ONE short, punchy, human-sounding sentence (about 18 words, 25 max), intriguing, NO waffle. Describe the problem directly — do NOT name the audience ("${audience}") in the summary. "quotes": exactly 3 short authentic-sounding strings that express the PROBLEM (a complaint or struggle, not praise), each ≤ 80 characters. "keywords": 3-6 lowercase words for matching related posts. "intensity": an integer 0-100 rating how emotionally severe/painful this problem is for ${audience}, judged INDEPENDENTLY of how often it comes up. Prioritise the most common recurring problems; avoid one-off complaints. Posts:\n${sample}` }
        ],
        temperature: 0.2,
        max_completion_tokens: 1000, // fits 6 findings; trimmed to beat the 26s proxy timeout
        seed: 11,
        response_format: { type: 'json_object' }
    };

    try {
        const parsed = await callOpenAI(payload);
        let findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        if (!findings.length) {
            console.warn('[Findings] none generated');
            for (let i = 1; i <= 5; i++) { const b = document.getElementById('findings-block' + i); if (b) b.style.display = 'none'; }
            return;
        }

        // FAST PASS (instant, no AI): keyword support to order/filter/prevalence so cards appear in
        // ~the findings-call time (~8s) instead of waiting on the slow post-assignment.
        findings.forEach(f => { f.support = keywordSupport(f, corpus); });
        let ranked = findings.filter(f => f.support >= 3).sort((a, b) => b.support - a.support);
        if (ranked.length < 2) ranked = findings.filter(f => f.support >= 1).sort((a, b) => b.support - a.support);
        if (!ranked.length) ranked = findings.slice().sort((a, b) => b.support - a.support);
        ranked = ranked.slice(0, 5);
        const totalKw = ranked.reduce((s, f) => s + f.support, 0) || 1;
        ranked.forEach(f => { f.prevalence = Math.round((f.support / totalKw) * 100); });

        window._findings = ranked;
        window._subProblemCache = {};       // new findings → drop cached subproblems
        window._findingPosts = null;        // not assigned yet — modal waits on _assignmentPromise
        window._findingPostsFull = null;
        ranked.forEach((f, idx) => renderFindingCard(idx + 1, f));
        // Hide any slots with no finding (the shimmer itself is cleared in the finally below).
        for (let i = ranked.length + 1; i <= 5; i++) { const b = document.getElementById('findings-block' + i); if (b) b.style.display = 'none'; }
        console.log('[Findings] cards rendered (fast):', ranked.length, '| keyword support:', ranked.map(f => f.support));

        // BACKGROUND: the accurate semantic assignment. When it lands we store the posts AND refine
        // each card's prevalence bar so it matches the real supporting-post counts. .see-more awaits this.
        // Filter educational/promo (tutorials, books, ads) out of EVERY assignment path — the AI path,
        // the keyword fallback, AND the top-up — so they can't leak into finding posts on any route.
        const cleanCorpus = corpus.filter(p => !_isEducationalOrPromo(p));
        window._assignmentPromise = assignPostsToFindings(ranked, cleanCorpus)
            .then(buckets => {
                ranked.forEach((f, i) => { f._posts = buckets[i] || []; f.support = (buckets[i] || []).length; });
                // Re-sort by REAL support so cards display highest → lowest prevalence, then re-render
                // every card in the new order (the per-block colours stay; only the content moves).
                ranked.sort((a, b) => b.support - a.support);
                const totalShown = ranked.reduce((s, f) => s + f.support, 0) || 1;
                ranked.forEach((f, idx) => {
                    f.prevalence = Math.round((f.support / totalShown) * 100); // prevalence = TRUE AI support
                    renderFindingCard(idx + 1, f);
                });
                // Top up thin findings' display posts (prevalence above is left untouched).
                topUpFindingPosts(ranked, cleanCorpus, 6, 8);
                window._findings = ranked;
                window._findingPosts = ranked.map(f => (f._posts || []).slice(0, 8));
                window._findingPostsFull = ranked.map(f => f._posts || []);
                renderBubbleGuide(ranked); // keep the polarity legend in sync if already shown
                console.log('[Findings] background done | order:', ranked.map(f => `${f.title} ${f.prevalence}%`));
            })
            .catch(e => {
                console.warn('[Findings] assignment failed — keyword posts:', e && e.message);
                const kw = assignPostsByKeyword(ranked, cleanCorpus);
                window._findingPosts = kw.map(arr => arr.slice(0, 8));
                window._findingPostsFull = kw;
            });
    } catch (error) {
        console.error('[Findings] failed:', error);
    } finally {
        // Clear the shimmer on every block (also covers the early-return / error cases above).
        for (let i = 1; i <= 5; i++) setItemLoading('findings-block' + i, false);
    }
}

// Non-blocking "preparing" cue: toggles .pp-tab-loading on the tab's TEXT (.main-tab-text) while its
// content generates, so you can shimmer the label in Webflow. The tab stays clickable throughout.
function setTabLoading(tabId, loading) {
    const el = document.getElementById(tabId);
    if (!el) return;
    // Tab labels use different classes (#tab-hurts → .main-tab-text, #polarity-tab → .tab-text-2),
    // so match either; fall back to the tab link itself if neither is found.
    const textEl = el.querySelector('.main-tab-text, .tab-text-2') || el;
    textEl.classList.toggle('pp-tab-loading', !!loading); // shimmer only; tabs stay clickable
    // Dim the label while it shimmers so the already-loaded tabs stand out as "ready".
    textEl.style.opacity = loading ? '0.5' : '';
}

// Per-ITEM loading shimmer (separate from the tab-label shimmer). Toggles the Webflow `.is-loading`
// class on a content wrapper while its data generates, then removes it so the "normal" styling is
// restored. Ref-counted so a wrapper shared by two panels (e.g. #insider-language = tone map +
// language-to-avoid) only clears once BOTH have finished. A minimum on-screen time keeps the shimmer
// from flashing-and-vanishing when a panel resolves almost instantly (e.g. a cached corpus).
const _itemLoadCounts = {};
const _itemLoadStart = {};
const MIN_SHIMMER_MS = 650;
function setItemLoading(id, loading) {
    const el = document.getElementById(id);
    if (!el) return;
    if (loading) {
        _itemLoadCounts[id] = (_itemLoadCounts[id] || 0) + 1;
        if (_itemLoadCounts[id] === 1) { _itemLoadStart[id] = Date.now(); el.classList.add('is-loading'); }
    } else {
        _itemLoadCounts[id] = Math.max(0, (_itemLoadCounts[id] || 0) - 1);
        if (_itemLoadCounts[id] === 0) {
            const wait = Math.max(0, MIN_SHIMMER_MS - (Date.now() - (_itemLoadStart[id] || 0)));
            setTimeout(() => { if ((_itemLoadCounts[id] || 0) === 0) el.classList.remove('is-loading'); }, wait);
        }
    }
}
function setItemsLoading(ids, loading) { ids.forEach(id => setItemLoading(id, loading)); }

// Shared findings loader — used by both the pre-fetch and the tab click. The shared promise means
// findings generate exactly ONCE even if polarity + tab-hurts + pre-fetch all ask at the same time.
function ensureFindings() {
    if (window._findings && window._findings.length) return Promise.resolve(window._findings);
    if (window._findingsPromise) return window._findingsPromise; // generation already in flight
    if (!window._corpus || !window._corpus.length) return Promise.resolve([]);
    setTabLoading('tab-hurts', true);
    window._findingsPromise = generateAndRenderFindings(window._corpus, window.originalGroupName || '')
        .then(() => window._findings || [])
        .finally(() => setTabLoading('tab-hurts', false));
    return window._findingsPromise;
}

// Pre-fetch (background, no loader). Called after Tab 1 reveals so Tab 2 is ready before it's clicked.
function loadTabHurts() { ensureFindings(); }

// Tab click: instant if already pre-fetched; otherwise show the loader until findings are ready.
function openTabHurts() {
    if (window._findings && window._findings.length) return; // already there
    if (!window._corpus || !window._corpus.length) return;
    showLoader('Finding the core problems…');
    ensureFindings().finally(() => hideLoader());
}

// =============================================================================
// PART 4b — Finding detail modal (.see-more → #findings-N-modal): sample posts.
// Posts come straight from the corpus (matched by the finding's keywords) — no fetch.
// (Subproblems chart renders into the modal in the next stage.)
// =============================================================================

function getFindingModal(i) {
    return document.getElementById(`findings-${i}-modal`) || document.getElementById(`Findings-${i}-modal`);
}

function formatPostDate(utc) {
    if (!utc) return '';
    try { return new Date(utc * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return ''; }
}

// Relevance-scored, deduped posts for a finding; falls back to top corpus posts only if nothing
// clears a positive score.
function matchPostsForFinding(finding, corpus, limit) {
    const scored = dedupeByTitle(corpus)
        .map(p => ({ p, s: scorePostForFinding(p, finding) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s || (b.p.score - a.p.score));
    const list = scored.length ? scored.map(x => x.p) : corpus;
    return list.slice(0, limit);
}

// Capture each modal's own .sample-insight template once (per modal — preserves its card colour).
function getSampleTemplate(modalIndex, container) {
    window._sampleTpl = window._sampleTpl || {};
    if (!window._sampleTpl[modalIndex]) {
        const t = container.querySelector('.sample-insight');
        if (t) window._sampleTpl[modalIndex] = t.cloneNode(true);
    }
    return window._sampleTpl[modalIndex];
}

function renderFindingPosts(modal, modalIndex, finding) {
    const container = modal.querySelector('.reddit-samples-posts');
    if (!container) { console.warn('[Modal] .reddit-samples-posts not found'); return; }
    const tpl = getSampleTemplate(modalIndex, container);
    if (!tpl) { console.warn('[Modal] .sample-insight template not found'); return; }

    // Prefer the de-duplicated, relevance-ranked posts assigned to this finding; fall back to a
    // loose keyword match only if assignment produced nothing.
    const assigned = window._findingPosts && window._findingPosts[modalIndex - 1];
    const posts = (assigned && assigned.length) ? assigned : matchPostsForFinding(finding, window._corpus || [], 8);
    container.innerHTML = '';
    posts.forEach(p => {
        const card = tpl.cloneNode(true);
        card.style.removeProperty('display');
        const set = (sel, val) => { const e = card.querySelector(sel); if (e) e.textContent = val; };
        set('.sample-insight-title', p.title || '');
        const body = (p.body || '').trim();
        set('.sample-insight-content', body ? body.slice(0, 180) + (body.length > 180 ? '…' : '') : '');
        set('.subreddit', 'r/' + p.subreddit);
        set('.likes', formatMemberCount(p.score));
        set('.comments', String(p.comments || 0));
        set('.date', formatPostDate(p.created));
        if (p.permalink) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => window.open(p.permalink, '_blank', 'noopener'));
        }
        container.appendChild(card);
    });
    console.log(`[Modal] finding ${modalIndex}: rendered ${posts.length} sample posts`);
}

async function openFindingModal(blockIndex) {
    const modal = getFindingModal(blockIndex);
    if (!modal) { console.warn(`[Modal] #findings-${blockIndex}-modal not found`); return; }
    modal.style.display = 'flex'; // open first so the chart has a measurable width

    // CRITICAL: capture the .sample-insight template BEFORE anything can overwrite the container —
    // otherwise the "Matching…" loading message wipes the template and posts never render (the
    // first-card stuck bug).
    const postsContainer = modal.querySelector('.reddit-samples-posts');
    if (postsContainer) getSampleTemplate(blockIndex, postsContainer);

    // Hide the subproblem placeholders immediately so nothing messy shows while we wait.
    const chartEl = modal.querySelector('.subproblem-chart');
    if (chartEl) {
        const hub = chartEl.querySelector('.subproblem-hub'); if (hub) hub.style.display = 'none';
        chartEl.querySelectorAll('.subproblem-node-template').forEach(t => { t.style.display = 'none'; });
        const ldr = chartEl.querySelector('.subproblem-loader'); if (ldr) ldr.style.display = 'block';
    }

    // If posts aren't ready, show the loader and wait for the background assignment (which also
    // reorders the cards). We render everything AFTER, so header/posts/subproblems all match.
    if (!window._findingPosts && window._assignmentPromise) {
        if (postsContainer) postsContainer.innerHTML = '<p class="loading-text">Matching the most relevant discussions…</p>';
        try { await window._assignmentPromise; } catch (e) { /* fallback already set in the catch */ }
    }

    const finding = (window._findings || [])[blockIndex - 1]; // read AFTER the wait (post-reorder)
    const header = modal.querySelector('.reddit-samples-header');
    if (header) {
        const block = document.getElementById('findings-block' + blockIndex);
        const fallback = block && block.querySelector('.section-title') ? block.querySelector('.section-title').textContent : '';
        header.textContent = (finding && finding.title) || fallback;
    }
    renderFindingPosts(modal, blockIndex, finding);
    if (chartEl && finding) renderSubproblemsInto(chartEl, finding, blockIndex);
}

function closeFindingModal(modal) {
    if (modal) modal.style.display = 'none';
}

// --- relevance-scored post assignment (fixes repeats + weak matches) --------
const RELEVANCE_STOPWORDS = ['the', 'and', 'for', 'with', 'that', 'this', 'your', 'you', 'are', 'was', 'their', 'they', 'from', 'have', 'has', 'about', 'what', 'when', 'which', 'will', 'would', 'could', 'should', 'just', 'really', 'some', 'very', 'being', 'into', 'more', 'most', 'than', 'then', 'them', 'those', 'these', 'issues', 'issue', 'problem', 'problems'];
const RELEVANCE_MIN_SCORE = 5; // a post must at least share a title word with the finding to qualify

// Niche words (e.g. "dog", "owners") are treated as stopwords — otherwise everything looks relevant.
function _nicheStopSet() {
    const s = new Set(RELEVANCE_STOPWORDS);
    (window.originalGroupName || '').toLowerCase().split(/\s+/).forEach(w => {
        if (w.length > 2) { s.add(w); s.add(w.replace(/s$/, '')); s.add(w + 's'); }
    });
    return s;
}
function _wordRegex(w) { return new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'); }

// Word-boundary relevance (original algorithm): finding title words + keywords, title hits weighted
// higher, with a bonus when BOTH a title word and a keyword match. Far stricter than substring.
function scorePostForFinding(post, finding) {
    const stop = _nicheStopSet();
    const titleWords = (finding.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
    const keywords = (finding.keywords || []).map(k => String(k).toLowerCase()).filter(k => k && k.length > 2 && !stop.has(k));
    const postTitle = (post.title || '').toLowerCase();
    const postBody = (post.body || '').toLowerCase();
    let score = 0, titleMatched = false, keywordMatched = false;
    titleWords.forEach(w => { const r = _wordRegex(w); if (r.test(postTitle)) { score += 5; titleMatched = true; } if (r.test(postBody)) { score += 2; titleMatched = true; } });
    keywords.forEach(k => { const r = _wordRegex(k); if (r.test(postTitle)) { score += 3; keywordMatched = true; } if (r.test(postBody)) { score += 1; keywordMatched = true; } });
    if (titleMatched && keywordMatched) score += 10;
    return score;
}

// Drop cross-post duplicates (identical titles) — keeps the first, which is highest-scored since the
// corpus is sorted by upvotes.
function dedupeByTitle(posts) {
    const seen = new Set();
    return posts.filter(p => {
        const k = (p.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
    });
}

// Fill thin findings' DISPLAY posts with keyword-relevant matches (word-boundary scored, no
// cross-finding repeats) so a modal never looks sparse. Does NOT change support/prevalence — those
// stay based on the strict AI assignment, so the % bar remains honest.
function topUpFindingPosts(findings, corpus, minPosts, maxPosts) {
    const used = new Set();
    findings.forEach(f => (f._posts || []).forEach(p => used.add(p.id)));
    const pool = dedupeByTitle(corpus);
    findings.forEach(f => {
        if (!f._posts) f._posts = [];
        if (f._posts.length >= minPosts) return;
        const extra = pool
            .filter(p => !used.has(p.id))
            .map(p => ({ p, s: scorePostForFinding(p, f) }))
            .filter(x => x.s >= RELEVANCE_MIN_SCORE)
            .sort((a, b) => b.s - a.s || (b.p.score - a.p.score));
        for (const x of extra) {
            if (f._posts.length >= maxPosts) break;
            f._posts.push(x.p); used.add(x.p.id);
        }
    });
}

// Keyword fallback (used only if the AI assignment call fails). Returns uncapped buckets.
function assignPostsByKeyword(findings, corpus) {
    const posts = dedupeByTitle(corpus);
    const buckets = findings.map(() => []);
    posts.forEach(post => {
        let bestIdx = -1, bestScore = 0;
        findings.forEach((f, i) => { const s = scorePostForFinding(post, f); if (s > bestScore) { bestScore = s; bestIdx = i; } });
        if (bestIdx >= 0 && bestScore >= RELEVANCE_MIN_SCORE) buckets[bestIdx].push({ post, score: bestScore });
    });
    return buckets.map(arr => arr.sort((a, b) => b.score - a.score || (b.post.score - a.post.score)).map(x => x.post));
}

// Deterministic backstop for the educational/promo posts the LLM keeps letting through: clear
// tutorials, "explained visually", success write-ups ("how I built/grew/scraped…"), courses,
// webinars, recruiting ads, etc. These are teaching/selling, not someone venting a struggle, so they
// must never be assigned to a pain finding regardless of keyword overlap.
const _EDU_PROMO_RE = /\b(explained visually|visual (explanation|guide)|tutorial|step[- ]by[- ]step|(ultimate|complete|practical|beginner'?s?|field) guide|hands[- ]on|how i (built|made|grew|got|created|scraped|landed|earned|launched)|free (course|book)|master ?class|webinar|cheat ?sheet|e-?book|we'?re hiring|now hiring|jobs and career|promo code|discount code|giveaway)\b/i;
function _isEducationalOrPromo(p) {
    return _EDU_PROMO_RE.test(`${p.title || ''} ${(p.body || '').slice(0, 200)}`);
}

// PRIMARY: let the model decide which problem each post genuinely belongs to (or NONE). This is
// semantic, so it catches things keywords can't — a heart-warming post won't land under "Health",
// and off-topic/positive/rescue posts get dropped. Falls back to keyword matching on failure.
async function assignPostsToFindings(findings, corpus) {
    // Drop near-empty / photo posts AND clear tutorials/promos, then take a density-ranked candidate
    // set so every real problem can gather lots of posts (this pool drives the modal posts AND prevalence).
    const candidates = dedupeByTitle(corpus)
        .filter(p => ((p.title || '').length + (p.body || '').length) >= 80 && !_isEducationalOrPromo(p))
        .slice(0, 45); // smaller batch so the assignment JSON fits the output cap + 26s window
    const buckets = findings.map(() => []);
    try {
        const audience = window._canonicalAudience || window.originalGroupName || 'this audience';
        const problemList = findings.map((f, i) => `${i + 1}: ${f.title} — ${f.summary || ''}`).join('\n');
        const postList = candidates.map((p, i) => `${i + 1}: (r/${p.subreddit || '?'}) "${(p.title || '').slice(0, 120)}" — ${(p.body || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
        const prompt = `You are matching Reddit posts to the problem each one is genuinely about, for a "${audience}" audience.\n\nProblems:\n${problemList}\n\nPosts (each prefixed with its subreddit):\n${postList}\n\nFor each post return the number of the SINGLE problem the AUTHOR is personally experiencing, venting about, or asking for help with. Use 0 (none) GENEROUSLY. Apply ALL of these rules — when in doubt, use 0:\n- A SHARED WORD IS NOT A MATCH. The post's MAIN SUBJECT must BE the problem, in the "${audience}" domain. Reject a post that merely contains a word from the problem (e.g. a human-mortality chart saying risk "declines" must NOT map to "Ad Performance Decline"; a global-economics article saying "progress" "slowed" must NOT map to an SEO finding).\n- REJECT posts that are guides, tutorials, "explained" write-ups, "how I did X" success stories, results/case-studies, book or tool recommendations, self-promotion, recruiting/job ads, or news/data articles — even if they contain matching keywords. We only want genuine struggles, questions and venting, not wins, teaching or selling.\n- REJECT posts whose author is NOT a "${audience}" member hitting the problem first-hand — e.g. a hiring manager rather than a job-seeker, a professional groomer/trainer rather than a pet owner, a parent of a teenager rather than a new parent, an outside observer, or someone in a different field who merely shares a word.\nMatch a post ONLY when its subreddit + content clearly fit the "${audience}" domain AND the author is describing that specific problem as their own unresolved struggle. Respond ONLY with JSON: {"assignments":[{"post":1,"problem":2}]}.`;
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You are a precise categorisation engine that outputs only JSON. You err on the side of 0 (none) rather than forcing a weak match.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0, max_completion_tokens: 800, response_format: { type: 'json_object' }
        });
        const assignments = Array.isArray(parsed.assignments) ? parsed.assignments : [];
        assignments.forEach(a => {
            const pIdx = (parseInt(a.post, 10) || 0) - 1;
            const fIdx = (parseInt(a.problem, 10) || 0) - 1;
            if (pIdx >= 0 && pIdx < candidates.length && fIdx >= 0 && fIdx < findings.length) buckets[fIdx].push(candidates[pIdx]);
        });
        if (buckets.reduce((s, b) => s + b.length, 0) === 0) throw new Error('empty AI assignment');
    } catch (e) {
        console.warn('[Assign] AI assignment failed — keyword fallback:', e && e.message);
        return assignPostsByKeyword(findings, corpus);
    }
    return buckets.map(arr => arr.sort((a, b) => (b.score || 0) - (a.score || 0))); // uncapped — caller caps for display
}

// =============================================================================
// PART 4c — Subproblems ring chart (.subproblem-chart inside each modal).
// Restored from the original: AI finds 6-8 sub-problems from corpus text (no comments), then we
// position them as a ring of .subproblem-node-template nodes with SVG spokes + lucide icons.
// =============================================================================

const SUBPROBLEM_ICONS = ['alert-triangle', 'heart', 'clock', 'shield', 'home', 'car', 'moon', 'sun', 'bone', 'dog', 'cat', 'dollar-sign', 'shopping-cart', 'trending-down', 'frown', 'zap', 'flame', 'droplet', 'scissors', 'wrench', 'lock', 'users', 'message-circle', 'help-circle', 'search', 'book-open', 'calendar', 'map-pin', 'phone', 'briefcase', 'target', 'lightbulb', 'bed', 'utensils', 'dumbbell', 'baby', 'package', 'truck', 'star', 'eye', 'brain', 'activity', 'thermometer', 'pill', 'leaf', 'circle-dot'];
let _subProblemNodeBlueprint = null;

// AI → [{label, icon, pct}], cached per finding title. Counts keyword mentions over the finding's
// matched posts for the pct (corpus text only — no comment fetching).
async function generateSubProblems(finding, posts, audience) {
    window._subProblemCache = window._subProblemCache || {};
    const key = finding.title;
    if (window._subProblemCache[key]) return window._subProblemCache[key];

    // The AI identifies the sub-problems from this finding's posts (topped up if few)…
    let analysisPosts = (posts || []).slice();
    if (analysisPosts.length < 25) {
        const seen = new Set(analysisPosts.map(p => p && p.id).filter(Boolean));
        matchPostsForFinding(finding, window._corpus || [], 40).forEach(p => {
            if (p && p.id && !seen.has(p.id)) { analysisPosts.push(p); seen.add(p.id); }
        });
    }
    const corpusText = analysisPosts.slice(0, 40).map(p => `${p.title} ${(p.body || '').substring(0, 300)}`.trim()).join('\n---\n');

    // …but prevalence is MEASURED across the WHOLE corpus. On a small/topically-homogeneous finding
    // subset, every facet keyword matches every post → all 100%. Over the full corpus each facet gets
    // its true, discriminating share and can never be all-100%.
    const measureTexts = (window._corpus && window._corpus.length ? window._corpus : analysisPosts)
        .map(p => `${p.title || ''} ${p.body || ''} ${p.commentsText || ''}`.toLowerCase());

    const payload = {
        model: AI_MODEL,
        messages: [
            { role: 'system', content: 'You break a problem category into concrete recurring sub-problems and output only valid JSON.' },
            { role: 'user', content: `You are analysing the "${audience}" audience. The broad problem is "${finding.title}": ${finding.summary || ''}. From the real discussions below, identify 6 to 8 specific recurring sub-problems WITHIN this category. Each must be a concrete issue people actually raise, not a restatement. For each return a short 2-4 word "label", 2-4 "keywords" (single words/short phrases in the audience's own language to detect mentions), and an "icon" chosen VERBATIM from this list: [${SUBPROBLEM_ICONS.join(', ')}] (use "circle-dot" if none fit). Respond ONLY with JSON: {"sub_problems":[{"label","keywords","icon"}]}. Discussions:\n${corpusText}` }
        ],
        temperature: 0.2, seed: 11, max_completion_tokens: 1000,
        response_format: { type: 'json_object' }
    };

    let raw = [];
    try { const parsed = await callOpenAI(payload); raw = Array.isArray(parsed.sub_problems) ? parsed.sub_problems : []; }
    catch (e) { console.error('[Subproblems] failed:', e); return []; }

    const size = measureTexts.length || 1;
    const countMentions = (keywords) => {
        let n = 0;
        for (const t of measureTexts) {
            const hit = (keywords || []).some(kw => {
                const words = String(kw).toLowerCase().split(/\s+/).filter(w => w.length > 2);
                if (!words.length) return false;
                let m = 0; for (const w of words) if (t.includes(w)) m++;
                return m / words.length >= 0.5;
            });
            if (hit) n++;
        }
        return n;
    };

    const subs = raw
        .map(sp => {
            const icon = SUBPROBLEM_ICONS.includes((sp.icon || '').toLowerCase().trim()) ? sp.icon.toLowerCase().trim() : 'circle-dot';
            return { label: sp.label, icon, pct: Math.round((countMentions(sp.keywords) / size) * 100) };
        })
        .filter(sp => sp.label)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 8);

    window._subProblemCache[key] = subs;
    return subs;
}

// Position the nodes in a ring around the hub, with SVG spokes behind them (original algorithm).
function renderSubProblemChart(chartEl, finding, subProblems) {
    if (!chartEl) return;
    const tpls = chartEl.querySelectorAll('.subproblem-node-template');
    if (tpls.length && !_subProblemNodeBlueprint) {
        const clean = Array.from(tpls).find(t => !t.classList.contains('node-green') && !t.classList.contains('node-orange')) || tpls[0];
        _subProblemNodeBlueprint = clean.cloneNode(true);
        _subProblemNodeBlueprint.classList.remove('node-green', 'node-orange');
    }
    tpls.forEach(t => { t.style.display = 'none'; });
    if (!_subProblemNodeBlueprint) { console.error('[Subproblems] .subproblem-node-template not found'); return; }

    const hub = chartEl.querySelector('.subproblem-hub');
    if (hub) { hub.style.zIndex = '3'; const t = hub.querySelector('.subproblem-hub-title'); if (t) t.innerText = finding.title || ''; }

    chartEl.querySelectorAll('.sp-generated').forEach(el => el.remove());
    if (!subProblems || !subProblems.length) { if (hub) hub.style.display = 'none'; return; }
    if (hub) hub.style.display = '';

    const size = chartEl.clientWidth || chartEl.offsetWidth || 560;
    const center = size / 2, radius = size * 0.36, N = subProblems.length;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.classList.add('sp-generated');
    svg.setAttribute('width', size); svg.setAttribute('height', size);
    svg.style.position = 'absolute'; svg.style.left = '0'; svg.style.top = '0'; svg.style.pointerEvents = 'none'; svg.style.zIndex = '0';

    const placed = [];
    subProblems.forEach((sp, i) => {
        const angle = (-90 + i * (360 / N)) * Math.PI / 180;
        const x = center + radius * Math.cos(angle), y = center + radius * Math.sin(angle);
        placed.push({ x, y });
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', center); line.setAttribute('y1', center);
        line.setAttribute('x2', x); line.setAttribute('y2', y);
        line.setAttribute('stroke', '#ffffff'); line.setAttribute('stroke-width', '1.5');
        svg.appendChild(line);
    });
    chartEl.insertBefore(svg, chartEl.firstChild);

    subProblems.forEach((sp, i) => {
        const { x, y } = placed[i];
        const node = _subProblemNodeBlueprint.cloneNode(true);
        node.classList.add('sp-generated');
        node.classList.add(i % 2 === 0 ? 'node-green' : 'node-orange');
        node.style.display = '';
        node.style.position = 'absolute';
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.style.transform = 'translate(-50%, -50%)';
        node.style.zIndex = '2';
        const labelEl = node.querySelector('.subproblem-node-label');
        const pctEl = node.querySelector('.subproblem-node-pct');
        const iconEl = node.querySelector('.subproblem-node-icon');
        if (labelEl) labelEl.innerText = sp.label;
        if (pctEl) pctEl.innerText = `${sp.pct}%`;
        if (iconEl) iconEl.innerHTML = `<i data-lucide="${sp.icon}"></i>`;
        chartEl.appendChild(node);
    });

    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

// Fire-and-forget: show the chart's loader, generate (cached) subproblems, then render the ring.
async function renderSubproblemsInto(chartEl, finding, blockIndex) {
    const loader = chartEl.querySelector('.subproblem-loader');
    // Hide the Webflow placeholders (hub + node templates + any old generated nodes) so ONLY the
    // loader shows while we generate — otherwise the empty hub/templates look messy.
    const hub = chartEl.querySelector('.subproblem-hub');
    if (hub) hub.style.display = 'none';
    chartEl.querySelectorAll('.subproblem-node-template').forEach(t => { t.style.display = 'none'; });
    chartEl.querySelectorAll('.sp-generated').forEach(el => el.remove());
    if (loader) loader.style.display = 'block';
    try {
        // Prefer this finding's full set of AI-assigned posts; fall back to a relevance match if few.
        const assigned = window._findingPostsFull && window._findingPostsFull[blockIndex - 1];
        const analysisPosts = (assigned && assigned.length >= 5) ? assigned : matchPostsForFinding(finding, window._corpus || [], 40);
        const subs = await generateSubProblems(finding, analysisPosts, window.originalGroupName || '');
        renderSubProblemChart(chartEl, finding, subs);
    } catch (e) {
        console.warn('[Subproblems] render failed', e);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

// =============================================================================
// PART 4d — Polarity Map (#polarity-tab → #emotion-map-container), Highcharts.
// Plots the SAME findings (frequency × intensity) so it can't contradict the cards. Teal bubbles
// matching the old emotion map; responsive.
// =============================================================================

// (ensureFindings is defined once, earlier, with a shared promise so findings generate only once.)

// Shared palette: bubble colour for parent problem i == legend swatch for finding i.
const PARENT_PALETTE = ['#6C5CE7', '#00A5CE', '#E84393', '#0984E3', '#00B894', '#FDCB6E'];

function _escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Subtle legend in #bubble-guide: a coloured dot per finding so users know which card each bubble
// colour ties to. Dots carry the palette colour; the label text inherits #bubble-guide's own colour
// (style it in Webflow).
function renderBubbleGuide(findings) {
    const el = document.getElementById('bubble-guide');
    if (!el) return;
    // Layout stays inline (so it lays out fine unstyled), but the TEXT carries .pp-guide-label with NO
    // inline text styles — so you fully control its font/size/colour/weight from Webflow.
    el.innerHTML = (findings || []).map((f, i) => `
        <span class="pp-guide-item" style="display:inline-flex;align-items:center;gap:6px;margin:0 14px 6px 0;">
            <span class="pp-guide-dot" style="width:11px;height:11px;border-radius:50%;flex:0 0 auto;background:${PARENT_PALETTE[i % PARENT_PALETTE.length]};border:1px solid rgba(255,255,255,0.6);"></span>
            <span class="pp-guide-label">${_escapeHtml(f.title || '')}</span>
        </span>`).join('');
}

// Richer map WITHOUT contradicting the cards: one call breaks the SAME findings into their concrete
// sub-problems (frequency × intensity, both 1-100), so every point is a facet of a card's problem —
// honest and consistent, just finer-grained. Falls back to the findings themselves if it fails.
// Emotional-intensity lexicon — used to MEASURE the polarity Y-axis from real text (no AI guessing).
const _INTENSITY_WORDS = ['desperate', 'exhaust', 'overwhelm', 'hate', 'terrible', 'awful', 'nightmare', 'crying', 'cried', 'scared', 'afraid', 'anxious', 'anxiety', 'panic', 'worst', 'horrible', 'miserable', 'depress', 'furious', 'frustrat', 'angry', 'rage', 'breakdown', 'hopeless', 'struggl', 'painful', 'unbearable', 'give up', 'wit\'s end', 'end of my rope', 'losing my mind', "can't take", 'cant take', 'so hard', 'breaking point', 'burnt out', 'burned out'];
function _intensityScore(text) { const t = (text || '').toLowerCase(); let n = 0; for (const w of _INTENSITY_WORDS) if (t.includes(w)) n++; return n; }
function _matchesKeywords(text, kws) {
    return (kws || []).some(k => {
        const words = String(k).toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (!words.length) return false;
        let m = 0; for (const w of words) if (text.includes(w)) m++;
        return m / words.length >= 0.5;
    });
}
// The AI only IDENTIFIES the problems (label + keywords + parent). Frequency and intensity are then
// MEASURED from the corpus — frequency = how many posts mention it, intensity = density of
// emotional language in those posts — so the map reflects real signal, not invented numbers.
async function generatePolarityData(findings, corpus, audience) {
    const main = (findings || []).map((f, i) => `${i + 1}: ${f.title}`).join('\n');
    const sample = (corpus || []).slice(0, 30).map(p => `${p.title} ${p.body}`.substring(0, 220)).join('\n---\n');
    try {
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You output only valid JSON.' },
                { role: 'user', content: `For "${audience}", the main problems are:\n${main}\n\nUsing these and the discussions below, produce 12-16 specific problems this audience faces. They MUST be facets/sub-problems OF the main problems above — do not invent unrelated ones. For each: "label" (2-5 words), "parent" (the number of the main problem it belongs to), and "keywords" (2-4 words/short phrases in the audience's own language used to detect this problem in text). Respond ONLY with JSON: {"points":[{"label","parent","keywords"}]}. Discussions:\n${sample}` }
            ],
            temperature: 0.3, max_completion_tokens: 900, response_format: { type: 'json_object' }
        });
        const pts = Array.isArray(parsed.points) ? parsed.points : [];
        // Build a lowercased text index of the corpus (title + body + comments) once.
        const texts = (corpus || []).map(p => `${p.title || ''} ${p.body || ''} ${p.commentsText || ''}`.toLowerCase());
        const measured = pts.map(p => {
            const kws = Array.isArray(p.keywords) ? p.keywords : [];
            let freq = 0, intenSum = 0;
            for (const t of texts) { if (_matchesKeywords(t, kws)) { freq++; intenSum += _intensityScore(t); } }
            return { label: String(p.label || '').trim(), parent: parseInt(p.parent, 10) || 1, freqRaw: freq, intenRaw: freq ? intenSum / freq : 0 };
        }).filter(p => p.label && p.freqRaw > 0);
        if (measured.length < 3) return null;
        // Normalise to 0-100 RELATIVE to the set so the bubbles spread across the quadrant chart.
        const maxFreq = Math.max(1, ...measured.map(m => m.freqRaw));
        const maxInten = Math.max(1, ...measured.map(m => m.intenRaw));
        return measured.map(m => ({
            label: m.label, parent: m.parent,
            x: Math.max(5, Math.round((m.freqRaw / maxFreq) * 100)),   // frequency — measured
            y: Math.max(5, Math.round((m.intenRaw / maxInten) * 100))  // intensity — measured
        }));
    } catch (e) {
        console.warn('[Polarity] data gen failed, using findings only:', e && e.message);
        return null;
    }
}

function renderPolarityMap(points) {
    const container = document.getElementById('emotion-map-container');
    if (!container) { console.warn('[Polarity] #emotion-map-container not found'); return; }
    if (typeof Highcharts === 'undefined') {
        console.error('[Polarity] Highcharts not loaded');
        container.innerHTML = '<p class="chart-placeholder-text">Chart library not found.</p>';
        return;
    }
    if (!points || !points.length) { container.innerHTML = '<p class="chart-placeholder-text">Not enough problems to map yet.</p>'; return; }

    // Colour each bubble by its parent problem (so the map visually groups by card), thin white border.
    const data = points.map(p => ({
        x: p.x, y: p.y, z: Math.max(1, p.x), label: p.label,
        color: PARENT_PALETTE[((p.parent || 1) - 1) % PARENT_PALETTE.length]
    }));

    if (window._polarityChart && window._polarityChart.destroy) window._polarityChart.destroy();
    window._polarityChart = Highcharts.chart(container, {
        chart: { type: 'bubble', backgroundColor: 'transparent', spacing: [12, 12, 12, 12], reflow: true },
        title: { text: '' }, credits: { enabled: false }, legend: { enabled: false },
        exporting: { enabled: false }, // removes the hamburger/context menu icon (top right)
        // Axis titles removed — built in Webflow. Numbers/grid stay white-70%.
        xAxis: { title: { text: null }, min: 0, max: 100, tickInterval: 25, gridLineColor: 'rgba(255,255,255,0.15)', lineColor: 'rgba(255,255,255,0.3)', tickColor: 'rgba(255,255,255,0.3)', labels: { style: { color: 'rgba(255,255,255,0.7)' } } },
        yAxis: { title: { text: null }, min: 0, max: 100, tickInterval: 25, gridLineColor: 'rgba(255,255,255,0.15)', lineColor: 'rgba(255,255,255,0.3)', tickColor: 'rgba(255,255,255,0.3)', labels: { style: { color: 'rgba(255,255,255,0.7)' } } },
        tooltip: { useHTML: true, headerFormat: '', pointFormat: '<b>{point.label}</b><br>Frequency: {point.x}/100<br>Intensity: {point.y}/100' },
        plotOptions: {
            bubble: { minSize: 12, maxSize: 46, marker: { fillOpacity: 1, lineColor: 'rgba(255,255,255,0.85)', lineWidth: 1 } }, // per-point colour set in data; thin white border
            series: { dataLabels: { enabled: false } } // labels show on hover (tooltip) only
        },
        series: [{ data }]
    });

    // True responsiveness: Highcharts pins an inline pixel width/height at render. A ResizeObserver
    // reflows it whenever #emotion-map-container changes size (not just on window resize).
    if (window._polarityResizeObserver) window._polarityResizeObserver.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
        window._polarityResizeObserver = new ResizeObserver(() => {
            if (window._polarityChart && window._polarityChart.reflow) window._polarityChart.reflow();
        });
        window._polarityResizeObserver.observe(container);
    }
    setTimeout(() => { if (window._polarityChart && window._polarityChart.reflow) window._polarityChart.reflow(); }, 60);
    console.log('[Polarity] map rendered with', data.length, 'problems');
}

// Pre-fetch / load the polarity map. Self-guarding + returns a shared promise so it runs once and
// the tab click can await it. Reuses findings via ensureFindings (no double generation).
function loadPolarityMap() {
    if (window._polarityChart) return Promise.resolve();          // already rendered
    if (window._polarityPromise) return window._polarityPromise;  // already in flight
    if (!window._corpus || !window._corpus.length) return Promise.resolve();
    setTabLoading('polarity-tab', true);
    setItemLoading('polarity-map-wrap', true); // shimmer the map panel while it builds
    window._polarityPromise = (async () => {
        const findings = await ensureFindings();
        let points = await generatePolarityData(findings, window._corpus || [], window.originalGroupName || '');
        if (!points) { // fallback to the findings themselves — but MEASURE intensity (no AI round numbers)
            const raw = (findings || []).map((f, i) => {
                const fposts = (window._findingPostsFull && window._findingPostsFull[i]) || matchPostsForFinding(f, window._corpus || [], 40);
                const intens = fposts.length ? fposts.reduce((s, p) => s + _intensityScore(`${p.title || ''} ${p.body || ''} ${p.commentsText || ''}`), 0) / fposts.length : 0;
                return { label: f.title, parent: i + 1, x: Math.round(f.prevalence || 0), intensRaw: intens };
            });
            const maxI = Math.max(1, ...raw.map(r => r.intensRaw));
            points = raw.map(r => ({ label: r.label, parent: r.parent, x: Math.max(5, r.x), y: Math.max(5, Math.round((r.intensRaw / maxI) * 100)) }));
        }
        window._polarityPoints = points; // stash for the CSV export
        renderPolarityMap(points);
        renderBubbleGuide(findings); // legend below the map
    })()
        .catch(e => { console.warn('[Polarity] failed', e); window._polarityPromise = null; })
        .finally(() => { setTabLoading('polarity-tab', false); setItemLoading('polarity-map-wrap', false); });
    return window._polarityPromise;
}

// Tab click: instant if already pre-fetched; otherwise show the loader until the map is ready.
function openPolarityMap() {
    if (window._polarityChart) return; // already rendered
    if (!window._corpus || !window._corpus.length) return;
    showLoader('Building the polarity map…');
    Promise.resolve(loadPolarityMap()).finally(() => hideLoader());
}

// =============================================================================
// PART 5 — Tab 3 "How they talk" (#tab-talk). Lazy on click, cached, corpus-only.
// Stage 1: Voice Profile + Tone Map + Language-to-Avoid (3 parallel calls).
// =============================================================================

// Voice profile: 5 tone sentences (.voice-p-context) + 6 adjective pills (.voice-adjective-tags).
async function generateAndRenderVoiceProfile(corpus, audience) {
    setItemLoading('voice-p-wrap', true);
    const container = document.getElementById('voice-profile-container');
    if (!container) { console.warn('[Talk] #voice-profile-container not found'); setItemLoading('voice-p-wrap', false); return; }
    const tagsContainer = container.querySelector('.voice-adjective-tags');
    if (tagsContainer && !window._voicePillBlueprint) {
        const pill = tagsContainer.firstElementChild; // capture the designed pill once
        if (pill) window._voicePillBlueprint = pill.cloneNode(true);
    }
    const sample = corpus.slice(0, 40).map(p => `Title: ${p.title}\nBody: ${(p.body || '').substring(0, 400)}`).join('\n---\n');
    try {
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You are a brand strategist who outputs only valid JSON.' },
                { role: 'user', content: `You are a sharp cultural observer studying how the "${audience}" community actually talks. Write an observational, psychologically sharp, slightly editorial tone-of-voice read (avoid marketing cliches). Respond ONLY as valid JSON with two keys: "tone_description" — an array of EXACTLY 5 one-sentence strings in this order: (1) their emotional state, (2) how they communicate, (3) how they relate to each other, (4) what they're really seeking, (5) what messaging lands with them; and "voice_adjectives" — an array of exactly 6 evocative adjectives. Posts: ${sample}` }
            ],
            temperature: 0.3, max_completion_tokens: 500, response_format: { type: 'json_object' }
        });
        const wrap = container.querySelector('.voice-p-wrap');
        if (wrap && Array.isArray(parsed.tone_description)) {
            const ctx = wrap.querySelectorAll('.voice-p-context');
            parsed.tone_description.forEach((t, i) => { if (ctx[i]) ctx[i].textContent = t; });
        }
        if (tagsContainer) {
            tagsContainer.innerHTML = '';
            (parsed.voice_adjectives || []).forEach(adj => {
                if (window._voicePillBlueprint) {
                    const pill = window._voicePillBlueprint.cloneNode(true);
                    pill.style.removeProperty('display'); pill.innerText = adj;
                    tagsContainer.appendChild(pill);
                }
            });
        }
        console.log('[Talk] voice profile rendered');
    } catch (e) { console.error('[Talk] voice profile failed:', e); }
    finally { setItemLoading('voice-p-wrap', false); }
}

// Tone map: 4 topic cards (.tone-card-blueprint) — title, 3 insights (.tone-what-means), intensity
// label, and trait bars (.tone-trait-row → .tone-trait-name + .tone-bar-fill width).
async function generateAndRenderToneMap(corpus, audience) {
    setItemLoading('insider-language', true);
    const container = document.getElementById('tone-map-container');
    if (!container) { console.warn('[Talk] #tone-map-container not found'); setItemLoading('insider-language', false); return; }
    if (!window._toneCardBlueprint) {
        const card = container.querySelector('.tone-card-blueprint') || container.querySelector('.tone-card');
        if (card) {
            window._toneCardBlueprint = card.cloneNode(true);
            const row = window._toneCardBlueprint.querySelector('.tone-trait-row');
            if (row) window._toneTraitBlueprint = row.cloneNode(true);
        }
    }
    if (!window._toneCardBlueprint) { console.warn('[Talk] .tone-card-blueprint not found'); setItemLoading('insider-language', false); return; }
    container.innerHTML = '<p class="loading-text">Performing deep tonal analysis…</p>';
    const sample = corpus.slice(0, 40).map(p => `Topic: ${p.title} - ${(p.body || '').substring(0, 200)}`).join('\n---\n');
    try {
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You are a brand psychologist who outputs only valid JSON.' },
                { role: 'user', content: `Analyse the "${audience}" community. Identify 4 distinct conversation topics. For each: "topic" (short title), "traits" (array of 4 objects, each {"name": adjective, "score": integer 10-100 intensity}), "insights" (array of EXACTLY 3 standalone sentences, each under 15 words, one observation each), "level" (LOW, MEDIUM, or HIGH). Respond ONLY as valid JSON where the value of key "tone_analysis" is a JSON ARRAY of exactly 4 such objects (not an object). Posts: ${sample}` }
            ],
            temperature: 0.2, max_completion_tokens: 900, response_format: { type: 'json_object' }
        });
        container.innerHTML = '';
        // The model sometimes returns tone_analysis as an object (keyed by topic) instead of an array,
        // or nests the array under a different key — coerce to an array either way so we never crash.
        let toneList = parsed.tone_analysis;
        if (!Array.isArray(toneList)) {
            if (toneList && typeof toneList === 'object') toneList = Object.values(toneList);
            else toneList = [];
        }
        if (!toneList.length) {
            const firstArray = Object.values(parsed).find(v => Array.isArray(v));
            if (firstArray) toneList = firstArray;
        }
        toneList.forEach(item => {
            const card = window._toneCardBlueprint.cloneNode(true);
            card.style.removeProperty('display');
            const titleEl = card.querySelector('.tone-topic-title'); if (titleEl) titleEl.innerText = item.topic || '';
            const meaning = card.querySelectorAll('.tone-what-means');
            const insights = Array.isArray(item.insights) ? item.insights : [];
            meaning.forEach((el, i) => { el.innerText = insights[i] || ''; });
            const lvl = card.querySelector('.tone-intensity-label'); if (lvl) lvl.innerText = `INTENSITY: ${item.level || ''}`;
            const traitsC = card.querySelector('.tone-traits-container');
            if (traitsC) {
                traitsC.innerHTML = '';
                (item.traits || []).forEach(tr => {
                    const base = window._toneTraitBlueprint;
                    if (!base) return;
                    const row = base.cloneNode(true);
                    const nameEl = row.querySelector('.tone-trait-name'); if (nameEl) nameEl.innerText = tr.name || tr.adjective || tr.word || '';
                    const fill = row.querySelector('.tone-bar-fill'); if (fill) fill.style.width = `${Math.max(0, Math.min(100, tr.score || 0))}%`;
                    traitsC.appendChild(row);
                });
            }
            container.appendChild(card);
        });
        console.log('[Talk] tone map rendered');
    } catch (e) { console.error('[Talk] tone map failed:', e); container.innerHTML = '<p class="error-message">Tonal analysis unavailable.</p>'; }
    finally { setItemLoading('insider-language', false); }
}

// Language to avoid: pairs of insider/outsider terms → .avoid-items-wrap (.avoid-term-template:
// .term-avoid + .term-avoid-reason) and .use-items-wrap (.use-term-template: .term-use + .term-use-reason).
async function generateAndRenderLanguageToAvoid(corpus, audience) {
    setItemLoading('insider-language', true);
    const wrapper = document.getElementById('language-to-avoid-container');
    if (!wrapper) { console.warn('[Talk] #language-to-avoid-container not found'); setItemLoading('insider-language', false); return; }
    const avoidC = wrapper.querySelector('.avoid-items-wrap');
    const useC = wrapper.querySelector('.use-items-wrap');
    if (!avoidC || !useC) { console.warn('[Talk] language wraps not found'); setItemLoading('insider-language', false); return; }
    if (!window._avoidBlueprint) { const t = avoidC.querySelector('.avoid-term-template'); if (t) window._avoidBlueprint = t.cloneNode(true); }
    if (!window._useBlueprint) { const t = useC.querySelector('.use-term-template'); if (t) window._useBlueprint = t.cloneNode(true); }
    if (!window._avoidBlueprint || !window._useBlueprint) { console.warn('[Talk] language templates not found'); setItemLoading('insider-language', false); return; }
    const sample = corpus.slice(0, 40).map(p => `Title: ${p.title}\nBody: ${(p.body || '').substring(0, 400)}`).join('\n---\n');
    try {
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You are a brand linguist who outputs only valid JSON.' },
                { role: 'user', content: `You are a brand linguist analysing the "${audience}" community. Identify 8-10 language pairs: terms outsiders/marketers use that insiders find inauthentic, paired with the authentic alternative insiders actually use. For each: "avoid", "avoid_reason" (max 12 words), "use", "use_reason" (max 12 words). Respond ONLY as valid JSON with key "pairs" (array of objects). Posts: ${sample}` }
            ],
            temperature: 0.3, max_completion_tokens: 900, response_format: { type: 'json_object' }
        });
        avoidC.innerHTML = ''; useC.innerHTML = '';
        (parsed.pairs || []).forEach(pair => {
            const a = window._avoidBlueprint.cloneNode(true); a.style.removeProperty('display');
            const ae = a.querySelector('.term-avoid'); if (ae) ae.innerText = pair.avoid || '';
            const ar = a.querySelector('.term-avoid-reason'); if (ar) ar.innerText = pair.avoid_reason || '';
            avoidC.appendChild(a);
            const u = window._useBlueprint.cloneNode(true); u.style.removeProperty('display');
            const ue = u.querySelector('.term-use'); if (ue) ue.innerText = pair.use || '';
            const ur = u.querySelector('.term-use-reason'); if (ur) ur.innerText = pair.use_reason || '';
            useC.appendChild(u);
        });
        console.log('[Talk] language-to-avoid rendered');
    } catch (e) { console.error('[Talk] language-to-avoid failed:', e); }
    finally { setItemLoading('insider-language', false); }
}

// Hooks: 4-6 engagement patterns into #hook-wrapper (HOOK_CARD_BLUEPRINT), each with example posts
// (HOOK_ITEM_BLUEPRINT). Corpus-only; example posts link to Reddit.
async function generateAndRenderHookPatterns(corpus, audience) {
    setItemLoading('hook-wrap', true);
    const wrapper = document.getElementById('hook-wrapper');
    if (!wrapper) { console.warn('[Talk] #hook-wrapper not found'); setItemLoading('hook-wrap', false); return; }
    if (!window._hookCardBlueprint) {
        const card = wrapper.firstElementChild;
        if (card) {
            window._hookCardBlueprint = card.cloneNode(true);
            const list = window._hookCardBlueprint.querySelector('.hook-examples-list');
            if (list && list.firstElementChild) window._hookItemBlueprint = list.firstElementChild.cloneNode(true);
        }
    }
    if (!window._hookCardBlueprint) { console.warn('[Talk] hook card blueprint not found'); setItemLoading('hook-wrap', false); return; }
    wrapper.innerHTML = '<p class="loading-text">Analysing engagement patterns…</p>';

    // Hooks are meant to be PROVEN by high engagement, so only let genuinely engaging posts be
    // candidates. Rank by a combined metric (upvotes + comments weigh in), then require a real
    // engagement floor — but fall back gracefully for small niches where 50+ upvotes is rare.
    const engagement = p => (p.score || 0) + 2 * (p.comments || 0);
    const ranked = [...corpus].sort((a, b) => engagement(b) - engagement(a));
    const ENGAGEMENT_FLOOR = 50;
    let topPosts = ranked.filter(p => (p.score || 0) >= ENGAGEMENT_FLOOR);
    if (topPosts.length < 15) topPosts = ranked; // small community — keep the best we have
    topPosts = topPosts.slice(0, 40);
    const listForAI = topPosts.map((p, i) => `ID: ${i} | UPS: ${p.score} | COMMENTS: ${p.comments || 0} | TITLE: ${p.title}`).join('\n');
    try {
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You are a content strategist. You are brief and punchy. Output only valid JSON.' },
                { role: 'user', content: `Analyse these top posts for "${audience}". Identify 4-6 modern hook patterns. Respond ONLY as valid JSON with key "patterns", each object: "category" (hook name), "short_summary" (≤10 words), "strategy" (≤20 words on why it works), "example_ids" (array of 3 post IDs from the list), "emotion_type" (a SHORT 2-3 word emotional driver, unique to this pattern; use "&" instead of "and"), "impact_level" (exactly one of "Very High Impact","High Impact","Medium Impact"), "emotional_intensity" (integer 0-100), "viral_potential" (integer 0-100), "community_impact" (one of "Very High","High","Medium","Low"). Posts:\n${listForAI}` }
            ],
            temperature: 0.1, max_completion_tokens: 950, response_format: { type: 'json_object' }
        });
        wrapper.innerHTML = '';
        (parsed.patterns || []).forEach(pattern => {
            const card = window._hookCardBlueprint.cloneNode(true);
            card.style.removeProperty('display');
            const set = (sel, val) => { const e = card.querySelector(sel); if (e) e.innerText = val; };
            set('.hook-category', pattern.category || '');
            set('.hook-why', pattern.short_summary || '');
            set('.why-reason', pattern.strategy || '');
            set('.emotion-hook', _trunc((pattern.emotion_type || '').replace(/\s+and\s+/gi, ' & '), 20)); // "&", ≤20 chars
            set('.impact-label', pattern.impact_level || '');
            set('.emotional-intensity-p', pattern.emotional_intensity != null ? `${pattern.emotional_intensity}%` : '');
            set('.viral-potential-p', pattern.viral_potential != null ? `${pattern.viral_potential}%` : '');
            set('.community-impact', pattern.community_impact || '');
            const list = card.querySelector('.hook-examples-list');
            if (list) {
                list.innerHTML = '';
                (pattern.example_ids || [])
                    .map(id => topPosts[parseInt(id, 10)])
                    .filter(Boolean)
                    .sort((a, b) => (b.score || 0) - (a.score || 0)) // show the strongest proof first
                    .forEach(post => {
                    if (!window._hookItemBlueprint) return;
                    const item = window._hookItemBlueprint.cloneNode(true);
                    item.style.removeProperty('display');
                    const t = item.querySelector('.hook-proof-title'); if (t) { const raw = post.title || ''; t.innerText = raw.length > 130 ? raw.substring(0, 127) + '…' : raw; }
                    const up = item.querySelector('.proof-badge-upvotes'); if (up) up.innerText = `👍 ${(post.score || 0).toLocaleString()}`;
                    const cm = item.querySelector('.proof-badge-comments'); if (cm) cm.innerText = `💬 ${(post.comments || 0).toLocaleString()}`;
                    const link = item.tagName === 'A' ? item : item.querySelector('a');
                    if (link && post.permalink) { link.href = post.permalink; link.target = '_blank'; }
                    list.appendChild(item);
                });
            }
            wrapper.appendChild(card);
        });
        console.log('[Talk] hooks rendered:', (parsed.patterns || []).length);
    } catch (e) { console.error('[Talk] hooks failed:', e); }
    finally { setItemLoading('hook-wrap', false); }
}

// Sentiment (AI-first, corpus-only): one call returns weighted positive/negative terms + the overall
// balance. We render two word clouds (.cloud-word sized by weight) and the score bar — no dictionaries.
// Exact original palettes (teal family = positive, pink family = negative).
// Ordered DARK → LIGHT. Small/low-weight words get the darker, more saturated end so they stay
// readable on the light panel; only the biggest words use the pale tints.
const POSITIVE_CLOUD_COLORS = ['#006d85', '#0090b5', '#00a5ce', '#00c0e6', '#7bd9ec', '#b3e8f3'];
const NEGATIVE_CLOUD_COLORS = ['#d6539d', '#ff4fa3', '#fd80c7', '#f472b6', '#ff99d6', '#fbb6ce'];

function renderSentimentCloud(container, items, colors) {
    // Keep only SHORT terms — a word cloud is for words/phrases, not sentences. Drop anything with
    // more than 3 words, over 24 chars, or that reads like a clause ("i …", contains "but/because…").
    const _badPhrase = /^(i|we|they|he|she|it|you)\b|\b(but|because|so that|ended up|turned out|even though)\b/i;
    const list = (items || []).filter(it => {
        if (!it || !it.term) return false;
        const t = String(it.term).trim();
        const words = t.split(/\s+/).length;
        return words <= 3 && t.length <= 24 && !_badPhrase.test(t);
    });
    if (list.length < 3) { container.innerHTML = '<p class="chart-placeholder-text">Not enough distinct terms found.</p>'; return; }
    const weights = list.map(it => Number(it.weight) || 1);
    const max = Math.max(...weights), min = Math.min(...weights);
    const minF = 11, maxF = 24; // smaller, more compact cloud (was 16-42, far too big)
    const palette = colors || POSITIVE_CLOUD_COLORS;
    // Exactly like the original: font-size scaled by weight, a colour from the palette, a slight
    // rotation. Wrapped in a plain block div so the words FLOW as a cloud (the words were stacking
    // because they were direct children of a flex container).
    const spans = list.map(it => {
        const w = Number(it.weight) || 1;
        const t = (w - min) / ((max - min) || 1); // 0 = smallest word, 1 = biggest word
        const size = (minF + t * (maxF - minF)).toFixed(1);
        // Palette is dark→light: index by weight so small words (t≈0) take the darkest, most legible
        // shades and only the largest words use the pale tints. Cap the two lightest tints to the top
        // ~third of weights so no small word is ever near-invisible.
        let idx = Math.round(t * (palette.length - 1));
        if (t < 0.66) idx = Math.min(idx, palette.length - 3);
        idx = Math.max(0, Math.min(palette.length - 1, idx));
        const color = palette[idx];
        const rot = (Math.random() * 8 - 4).toFixed(1);
        const term = _escapeHtml(it.term);
        return `<span class="cloud-word" data-word="${term}" style="font-size:${size}px; color:${color}; transform:rotate(${rot}deg);">${term}</span>`;
    }).join('');
    container.innerHTML = `<div class="cloud-inner">${spans}</div>`;
}

function renderSentimentScore(positiveCount, negativeCount) {
    const container = document.getElementById('sentiment-score-container');
    if (!container) return;
    const total = positiveCount + negativeCount;
    if (total === 0) { container.style.display = 'none'; return; }
    container.style.display = '';
    const positivePercent = Math.round((positiveCount / total) * 100);
    const negativePercent = 100 - positivePercent;
    const segments = container.querySelectorAll('.score-segment');
    if (segments.length >= 2) {
        segments[0].style.width = `${positivePercent}%`;
        segments[1].style.width = `${negativePercent}%`;
        const pv = segments[0].querySelector('.score-value'); if (pv) pv.textContent = `${positivePercent}% Positive`;
        const nv = segments[1].querySelector('.score-value'); if (nv) nv.textContent = `${negativePercent}% Negative`;
    }
    const vibeLabel = container.querySelector('.sentiment-vibe-label');
    if (vibeLabel) {
        let vibe;
        if (positivePercent >= 70) vibe = 'Enthusiastic and highly engaged';
        else if (positivePercent >= 60) vibe = 'Largely positive with pockets of frustration';
        else if (positivePercent >= 52) vibe = 'Leaning positive, but genuinely mixed';
        else if (positivePercent >= 48) vibe = 'Evenly split, optimism and frustration in tension';
        else if (positivePercent >= 40) vibe = 'Leaning negative, frustration outweighs optimism';
        else if (positivePercent >= 30) vibe = 'Frequently frustrated, actively seeking solutions';
        else vibe = 'High frustration community, pain points dominate';
        vibeLabel.textContent = vibe;
    }

    // Benchmark vs a typical-community baseline (Reddit positive sentiment averages ~58%).
    const benchmarkEl = container.querySelector('.sentiment-benchmark-text');
    if (benchmarkEl) {
        const diff = positivePercent - 58;
        let benchmark;
        if (Math.abs(diff) <= 2) benchmark = 'About as positive as the average audience';
        else if (diff > 0) benchmark = `${diff}% more positive than the average audience`;
        else benchmark = `${Math.abs(diff)}% less positive than the average audience`;
        benchmarkEl.textContent = benchmark;
    }
}

async function generateAndRenderSentiment(corpus, audience) {
    setItemsLoading(['sentiment-wrap', 'positive-wrap', 'nega-wrap'], true);
    const posC = document.getElementById('positive-cloud');
    const negC = document.getElementById('negative-cloud');
    if (!posC || !negC) { console.warn('[Talk] sentiment cloud containers not found'); setItemsLoading(['sentiment-wrap', 'positive-wrap', 'nega-wrap'], false); return; }
    posC.innerHTML = '<p class="loading-text">Analysing sentiment…</p>';
    negC.innerHTML = '<p class="loading-text">Analysing sentiment…</p>';
    const sample = corpus.slice(0, 50).map(p => `${p.title}. ${(p.body || '').substring(0, 300)}`).join('\n---\n');
    try {
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You are a market-research sentiment analyst. Output only valid JSON.' },
                { role: 'user', content: `From these "${audience}" discussions, extract the language that carries clear sentiment. Respond ONLY as valid JSON: {"positive":[{"term":"...","weight":1-10}], "negative":[{"term":"...","weight":1-10}], "positive_pct": <integer 0-100, the overall share of positive vs negative sentiment>}. Give 15-22 items each for positive and negative. Each "term" MUST be a SHORT word or phrase of 1-3 words MAX (e.g. "finally fixed", "so frustrating", "love it") — NEVER a full sentence, clause, or quote. Use the audience's actual words; weight = how common/strong it is. Posts:\n${sample}` }
            ],
            temperature: 0.2, max_completion_tokens: 850, response_format: { type: 'json_object' }
        });
        // Balance the two clouds so neither side dominates: sort each by weight (strongest first) and
        // trim both to the SAME count (the smaller of the two, capped at 16).
        const byWeight = arr => (arr || []).filter(it => it && it.term).sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0));
        let posTerms = byWeight(parsed.positive), negTerms = byWeight(parsed.negative);
        const n = Math.min(posTerms.length, negTerms.length, 16);
        posTerms = posTerms.slice(0, n);
        negTerms = negTerms.slice(0, n);
        renderSentimentCloud(posC, posTerms, POSITIVE_CLOUD_COLORS);
        renderSentimentCloud(negC, negTerms, NEGATIVE_CLOUD_COLORS);
        const posPct = Math.max(0, Math.min(100, Math.round(parsed.positive_pct != null ? parsed.positive_pct : 50)));
        renderSentimentScore(posPct, 100 - posPct);
        console.log(`[Talk] sentiment rendered: ${(parsed.positive || []).length} pos / ${(parsed.negative || []).length} neg, ${posPct}% positive`);
    } catch (e) { console.error('[Talk] sentiment failed:', e); posC.innerHTML = ''; negC.innerHTML = ''; }
    finally { setItemsLoading(['sentiment-wrap', 'positive-wrap', 'nega-wrap'], false); }
}

// Historical sentiment ("sentiment shift") — REBUILT corpus-only: bucket the corpus posts by recency
// window (using their timestamps) and score each with a small inline sentiment word list (no big
// dictionaries, no extra Reddit). Renders a Highcharts areaspline into .history-sentiment.
const HIST_POS_WORDS = ['love', 'great', 'best', 'amazing', 'helpful', 'perfect', 'easy', 'happy', 'thank', 'recommend', 'worth', 'works', 'better', 'good', 'excited', 'glad', 'awesome', 'fantastic', 'grateful', 'relief', 'enjoy', 'solved', 'wonderful', 'win', 'lifesaver'];
const HIST_NEG_WORDS = ['hate', 'worst', 'terrible', 'awful', 'frustrat', 'annoy', 'difficult', 'struggl', 'problem', 'fail', 'pain', 'hard', 'disappoint', 'useless', 'waste', 'broken', 'confus', 'stuck', 'tired', 'exhaust', 'horrible', 'nightmare', 'stress', 'worry', 'angry', 'upset', 'wont', 'cant', 'impossible', 'overwhelm'];

function countSentimentLocal(posts) {
    let positive = 0, negative = 0;
    posts.forEach(p => {
        const text = `${p.title} ${p.body}`.toLowerCase();
        HIST_POS_WORDS.forEach(w => { if (text.includes(w)) positive++; });
        HIST_NEG_WORDS.forEach(w => { if (text.includes(w)) negative++; });
    });
    return { positive, negative };
}

function renderHistoricalSentimentChart(data) {
    const container = document.querySelector('.history-sentiment');
    if (!container) return;
    if (typeof Highcharts === 'undefined' || !data || data.length < 2) {
        container.innerHTML = '<p class="placeholder-text">Not enough historical data to chart sentiment over time.</p>';
        return;
    }
    container.innerHTML = '';
    Highcharts.chart(container, {
        chart: { type: 'areaspline', backgroundColor: 'transparent', height: 280 },
        title: { text: null }, credits: { enabled: false }, legend: { enabled: false }, exporting: { enabled: false },
        xAxis: { categories: data.map(d => d.period), labels: { style: { color: '#475569' } }, lineColor: 'rgba(0,0,0,0.12)', tickColor: 'rgba(0,0,0,0.12)' },
        yAxis: {
            title: { text: '% Positive', style: { color: '#64748b' } }, min: 0, max: 100,
            labels: { format: '{value}%', style: { color: '#475569' } }, gridLineColor: 'rgba(0,0,0,0.06)',
            plotLines: [{ value: 58, color: 'rgba(100,116,139,0.5)', dashStyle: 'Dash', width: 1, label: { text: 'Avg', style: { color: '#94a3b8', fontSize: '11px' }, align: 'left', x: 5, y: -4 } }]
        },
        tooltip: { valueSuffix: '% positive', backgroundColor: '#ffffff' },
        plotOptions: {
            areaspline: {
                color: '#00a5ce', lineWidth: 2, marker: { enabled: true, radius: 4, fillColor: '#00a5ce' },
                fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(0,165,206,0.18)'], [1, 'rgba(0,165,206,0.0)']] }
            }
        },
        series: [{ name: '% Positive', data: data.map(d => d.positive) }]
    });
}

function generateAndRenderHistoricalSentiment(corpus) {
    const container = document.querySelector('.history-sentiment');
    if (!container) { console.warn('[Talk] .history-sentiment not found'); return; }
    const nowSec = Date.now() / 1000, DAY = 86400;
    const periods = [
        { label: 'Past 6 Mo', days: 182 }, { label: 'Past 3 Mo', days: 91 },
        { label: 'Past Month', days: 30 }, { label: 'Past Week', days: 7 }
    ];
    const trend = [];
    periods.forEach(per => {
        const inWindow = corpus.filter(p => (p.created || 0) >= nowSec - per.days * DAY);
        if (!inWindow.length) return;
        const { positive, negative } = countSentimentLocal(inWindow);
        const total = positive + negative;
        if (total === 0) return;
        trend.push({ period: per.label, positive: Math.round((positive / total) * 100) });
    });
    renderHistoricalSentimentChart(trend);
    console.log('[Talk] historical sentiment rendered:', trend.length, 'periods');
}

// Lazy load Tab 3 once, cached. Runs the panels in parallel (corpus-only).
function loadTabTalk() {
    if (!window._tabLoaded) window._tabLoaded = {};
    if (window._tabLoaded.talk) return window._talkPromise || Promise.resolve();
    if (!window._corpus || !window._corpus.length) return Promise.resolve();
    window._tabLoaded.talk = true;
    setTabLoading('tab-talk', true);
    const corpus = window._corpus, audience = window.originalGroupName || '';
    // Each render function now owns its OWN panel shimmer (sets .is-loading on entry, clears it in its
    // finally), so every panel reveals the instant ITS data lands — fully independent of the others.
    // #insider-language is ref-counted across the tone map + language-to-avoid, so it only clears
    // once BOTH have finished.
    window._talkPromise = Promise.all([
        generateAndRenderVoiceProfile(corpus, audience),
        generateAndRenderToneMap(corpus, audience),
        generateAndRenderLanguageToAvoid(corpus, audience),
        generateAndRenderHookPatterns(corpus, audience),
        generateAndRenderSentiment(corpus, audience),
        Promise.resolve(generateAndRenderHistoricalSentiment(corpus)) // synchronous, corpus-only
    ]).catch(e => { console.warn('[Talk] failed', e); window._tabLoaded.talk = false; })
        .finally(() => setTabLoading('tab-talk', false));
    return window._talkPromise;
}

// Tab click: shimmer the label while it loads on first open; instant after that (cached).
function openTabTalk() {
    if (window._tabLoaded && window._tabLoaded.talk) return;
    if (!window._corpus || !window._corpus.length) return;
    loadTabTalk();
}

// =============================================================================
// PART 6 — Tab 4 "Where they are" (#tab-where). Lazy on click + pre-fetched.
// Corpus-only (no extra Reddit): 3 instant charts (social split, location, active
// hours) + 5 AI panels (waterholes, media, experts, tools, events) run in parallel.
// Ported from the original app and optimised: dropped the dedicated media Reddit
// search and the per-podcast iTunes lookups, so the whole tab is corpus-only & fast.
// =============================================================================

const _whereStop = ['the', 'and', 'for', 'with', 'your', 'that', 'this', 'from', 'have', 'about', 'into', 'what', 'when', 'how', 'are', 'you', 'they', 'their'];
const _whereTextOf = p => `${p.title || ''} ${p.body || ''} ${p.commentsText || ''}`;

// Comment enrichment — the Where-tab charts (platforms, locations, tools, podcasts, places) are
// thin on posts alone because the corpus is problem-focused; comments are where this stuff actually
// gets named. We pull comment threads for the top posts ONCE, store them on p.commentsText (fed only
// into _whereTextOf so the other tabs are untouched), and the enriched corpus is cached in Firestore
// so this cost is paid once per audience, not per user.
const _commentCache = new Map();
async function fetchPostComments(postId) {
    if (!postId) return [];
    if (_commentCache.has(postId)) return _commentCache.get(postId);
    let bodies = [];
    try {
        const data = await callReddit({ type: 'comments', postId });
        if (Array.isArray(data) && data[1] && data[1].data && Array.isArray(data[1].data.children)) {
            bodies = data[1].data.children
                .filter(c => c.kind === 't1' && c.data && c.data.body)
                .map(c => c.data.body)
                .filter(b => b && b !== '[deleted]' && b !== '[removed]');
        }
    } catch (e) { /* best-effort: a missing thread shouldn't fail the tab */ }
    _commentCache.set(postId, bodies);
    return bodies;
}

// Comment enrichment — names of creators/podcasts/events live in COMMENTS, not titles, so this is
// what makes the Where panels show real "Mentioned" data instead of AI picks. We fetch the top ~22
// threads (gated + cached, so scale stays fine), PRIORITISING resource/recommendation threads where
// people actually list names, then the most-discussed. Up to 4000 chars of comment text each.
const _RESOURCE_SIGNAL = /\b(recommend|recommendation|favou?rite|best|which|what.*(use|using)|anyone use|app|apps|tool|tools|podcast|channel|youtube|book|website|brand|gear|trainer|expert)\b/i;
async function enrichCorpusWithComments(corpus, topN = 35) {
    if (!corpus || !corpus.length) return corpus;
    const resourceScore = p => (_RESOURCE_SIGNAL.test(`${p.title || ''} ${p.body || ''}`) ? 100000 : 0) + (p.comments || 0);
    const targets = corpus
        .filter(p => p.id && (p.comments || 0) > 0 && !p.commentsText)
        .sort((a, b) => resourceScore(b) - resourceScore(a)) // resource threads first, then density
        .slice(0, topN);
    await Promise.all(targets.map(async p => {
        try {
            const bodies = await fetchPostComments(p.id);
            if (bodies.length) p.commentsText = pruneText(bodies.join(' ')).slice(0, 4000);
        } catch (e) { console.warn(`[Comments] failed for ${p.id}`, e && e.message); }
    }));
    console.log(`[Comments] enriched ${targets.filter(p => p.commentsText).length}/${targets.length} threads (resource-first)`);
    return corpus;
}

// Count real mentions of a name in the joined corpus text; falls back to its most
// distinctive token so "Huberman Lab" still grounds via "huberman".
function groundNameCount(key, allText) {
    if (!key) return 0;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exact = allText.match(new RegExp(`\\b${esc}\\b`, 'gi'));
    if (exact && exact.length) return exact.length;
    const sig = key.split(/\s+/).filter(t => t.length > 3 && !_whereStop.includes(t)).sort((a, b) => b.length - a.length)[0];
    if (!sig) return 0;
    const escSig = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m2 = allText.match(new RegExp(`\\b${escSig}\\b`, 'gi'));
    return m2 ? m2.length : 0;
}

// Count a name's mentions AND how many sit near an "influence/use/visit" signal word.
// Per-segment scan so a window never bleeds across post boundaries.
function countNameInContext(key, segments, signalRe, windowSize) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + esc + '\\b', 'gi');
    const w = windowSize || 70;
    let total = 0, contextHits = 0;
    for (const seg of segments) {
        re.lastIndex = 0; let m;
        while ((m = re.exec(seg)) !== null) {
            total++;
            const s = Math.max(0, m.index - w);
            const e = Math.min(seg.length, m.index + key.length + w);
            if (signalRe.test(seg.slice(s, e))) contextHits++;
            if (total > 800) break;
        }
        if (total > 800) break;
    }
    return { total, contextHits };
}

// Thin-results fallback: clearly-labelled AI suggestions (never counted as real mentions).
async function aiSuggestEntities(audience, spec, avoid, want) {
    if (want <= 0) return [];
    const prompt = `For a "${audience}" audience, name up to ${want} of the most prominent, real, widely-recognised ${spec.what} that this kind of audience typically ${spec.verb}. ${spec.examples || ''}
Return only REAL, well-known names — never invented ones — and avoid generic categories.${avoid && avoid.length ? ` Do NOT repeat any of these: ${avoid.join(', ')}.` : ''}
Respond ONLY with JSON: {"items":[{"name":"...","note":"<= 6 word description, or empty"}]}`;
    try {
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You suggest only real, well-known names relevant to a given audience. You never invent names, and you output only valid JSON.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3, max_completion_tokens: 400, response_format: { type: 'json_object' }
        });
        return parsed.items || [];
    } catch (e) { console.warn('[Where/Suggest] failed:', e && e.message); return []; }
}

function mentionTier(count) {
    if (count >= 20) return 'Huge Mentions';
    if (count >= 6) return 'High Mentions';
    if (count >= 2) return 'Medium Mentions';
    return 'A Few Mentions';
}

// --- 1) SOCIAL SPLIT donut (#social-split-chart) — instant, no AI ------------
function renderSocialSplitChart(posts) {
    const el = document.getElementById('social-split-chart');
    if (!el) return;
    const texts = (posts || []).map(p => _whereTextOf(p).toLowerCase());
    if (!texts.length) return;
    const PLATFORMS = [
        { name: 'Instagram', color: '#FF6FB5', keys: ['instagram', 'insta', 'reels'], domains: ['instagram.com'] },
        { name: 'TikTok', color: '#36E0D0', keys: ['tiktok', 'tik tok'], domains: ['tiktok.com'] },
        { name: 'YouTube', color: '#FF8C66', keys: ['youtube'], domains: ['youtube.com', 'youtu.be'] },
        { name: 'Facebook', color: '#6C8CFF', keys: ['facebook', 'fb group', 'fb groups'], domains: ['facebook.com', 'fb.com', 'fb.watch'] },
        { name: 'X / Twitter', color: '#7CC7FF', keys: ['twitter', 'tweet', 'x.com'], domains: ['twitter.com', 'x.com', 't.co'] },
        { name: 'Discord', color: '#8B7CFF', keys: ['discord'], domains: ['discord.gg', 'discord.com'] },
        { name: 'Telegram', color: '#5ED1D8', keys: ['telegram'], domains: ['t.me', 'telegram.me'] },
        { name: 'WhatsApp', color: '#57D9A3', keys: ['whatsapp', 'whats app'], domains: ['whatsapp.com', 'wa.me', 'chat.whatsapp.com'] },
        { name: 'Snapchat', color: '#FFD56B', keys: ['snapchat'], domains: ['snapchat.com'] },
        { name: 'Pinterest', color: '#FF8FA3', keys: ['pinterest'], domains: ['pinterest.com', 'pin.it'] },
        { name: 'LinkedIn', color: '#5B9BD5', keys: ['linkedin'], domains: ['linkedin.com'] }
    ];
    const fullText = texts.join(' \n ');
    const countKeys = (keys) => {
        const pat = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|');
        const m = fullText.match(new RegExp('\\b(' + pat + ')\\b', 'gi'));
        return m ? m.length : 0;
    };
    // A POSTED link to a platform is hard evidence (stronger than a passing text mention) → weight ×3.
    const postDomains = (posts || []).map(p => (p.domain || '').toLowerCase()).filter(Boolean);
    const countDomains = (doms) => postDomains.filter(d => doms.some(pd => d === pd || d.endsWith('.' + pd))).length * 3;
    let data = PLATFORMS.map(pl => ({ name: pl.name, color: pl.color, count: countKeys(pl.keys) + countDomains(pl.domains) }))
        .filter(d => d.count > 0).sort((a, b) => b.count - a.count);
    const grandTotal = data.reduce((n, d) => n + d.count, 0);
    if (data.length === 0 || grandTotal < 12) {
        el.innerHTML = `<p class="placeholder-text" style="text-align:center; color:#9ca3af; padding:1rem;">This audience rarely names social platforms in their discussions (only ${grandTotal} mention${grandTotal === 1 ? '' : 's'}), so there isn't enough signal to chart a reliable split.</p>`;
        return;
    }
    if (data.length > 8) {
        const otherCount = data.slice(8).reduce((n, d) => n + d.count, 0);
        data = data.slice(0, 8);
        if (otherCount > 0) data.push({ name: 'Other', color: '#C9C9D6', count: otherCount });
    }
    const total = data.reduce((n, d) => n + d.count, 0) || 1;
    data.forEach(d => { d.pct = Math.round((d.count / total) * 100); });
    const GAP = data.length > 1 ? 1.6 : 0;
    let acc = 0; const stops = [];
    data.forEach((d) => {
        const start = acc, end = start + (d.count / total) * 360;
        stops.push(`${d.color} ${start}deg ${Math.max(start, end - GAP)}deg`);
        if (GAP) stops.push(`#ffffff ${Math.max(start, end - GAP)}deg ${end}deg`);
        acc = end;
    });
    const gradient = `conic-gradient(from -90deg, ${stops.join(', ')})`;
    const top = data[0];
    el.innerHTML = `
      <div class="social-split" style="display:flex; gap:28px; align-items:center; flex-wrap:wrap; font-family:'Plus Jakarta Sans', system-ui, sans-serif;">
        <div class="social-split-donut" style="position:relative; width:190px; height:190px; flex:0 0 auto; border-radius:50%; background:${gradient}; box-shadow:0 12px 30px rgba(124,92,255,0.20);">
          <div class="social-split-center" style="position:absolute; inset:27%; border-radius:50%; background:rgba(255,255,255,0.85); backdrop-filter:blur(6px); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; box-shadow:inset 0 1px 5px rgba(0,0,0,0.06);">
            <div style="font-size:1.55rem; font-weight:800; color:#1f2937; line-height:1;">${top.pct}%</div>
            <div style="font-size:0.72rem; font-weight:600; color:#6b7280; margin-top:3px; padding:0 6px;">${top.name}</div>
          </div>
        </div>
        <div class="social-split-legend" style="display:flex; flex-direction:column; gap:9px; min-width:170px;">
          ${data.map(d => `
            <div class="social-split-chip" style="display:flex; align-items:center; gap:10px; font-size:0.95rem; color:#1f2937;">
              <span style="width:12px; height:12px; border-radius:50%; background:${d.color}; flex:0 0 auto; box-shadow:0 1px 3px rgba(0,0,0,0.15);"></span>
              <span style="flex:1;">${d.name}</span>
              <b style="color:#374151;">${d.pct}%</b>
            </div>`).join('')}
        </div>
      </div>`;
}

// --- 2) LOCATION ranked bars (#location) — instant, no AI --------------------
function renderLocationChart(posts) {
    const el = document.getElementById('location');
    if (!el) return;
    const texts = (posts || []).map(p => _whereTextOf(p).toLowerCase());
    if (!texts.length) return;
    const COUNTRIES = [
        { name: 'United States', color: '#7C5CFF', keys: ['united states', 'usa', 'america', 'american', 'americans'] },
        { name: 'United Kingdom', color: '#FF6FB5', keys: ['united kingdom', 'uk', 'britain', 'british', 'england', 'scotland', 'wales'] },
        { name: 'Canada', color: '#36E0D0', keys: ['canada', 'canadian', 'canadians'] },
        { name: 'Australia', color: '#FF8C66', keys: ['australia', 'australian', 'aussie', 'aussies'] },
        { name: 'India', color: '#6C8CFF', keys: ['india', 'indian', 'indians'] },
        { name: 'Germany', color: '#7CC7FF', keys: ['germany', 'german', 'germans'] },
        { name: 'France', color: '#8B7CFF', keys: ['france', 'french'] },
        { name: 'Netherlands', color: '#5ED1D8', keys: ['netherlands', 'dutch', 'holland'] },
        { name: 'Ireland', color: '#57D9A3', keys: ['ireland', 'irish'] },
        { name: 'New Zealand', color: '#FFD56B', keys: ['new zealand', 'kiwi', 'kiwis'] },
        { name: 'Italy', color: '#FF8FA3', keys: ['italy', 'italian', 'italians'] },
        { name: 'Spain', color: '#5B9BD5', keys: ['spain', 'spaniard'] },
        { name: 'Brazil', color: '#9CE37D', keys: ['brazil', 'brasil', 'brazilian', 'brazilians'] },
        { name: 'Mexico', color: '#F78C6B', keys: ['mexico', 'mexican', 'mexicans'] },
        { name: 'Sweden', color: '#8FD3F4', keys: ['sweden', 'swedish', 'swede'] },
        { name: 'Norway', color: '#B388FF', keys: ['norway', 'norwegian', 'norwegians'] },
        { name: 'Denmark', color: '#F48FB1', keys: ['denmark', 'danish'] },
        { name: 'Finland', color: '#80DEEA', keys: ['finland', 'finnish'] },
        { name: 'Poland', color: '#A5D6A7', keys: ['poland'] },
        { name: 'Japan', color: '#FF7597', keys: ['japan', 'japanese'] },
        { name: 'Philippines', color: '#4DD0E1', keys: ['philippines', 'filipino', 'filipina', 'pinoy'] },
        { name: 'Singapore', color: '#CE93D8', keys: ['singapore', 'singaporean'] },
        { name: 'South Africa', color: '#FFB74D', keys: ['south africa', 'south african'] },
        { name: 'UAE / Dubai', color: '#9FA8DA', keys: ['dubai', 'uae', 'emirates'] },
        { name: 'Portugal', color: '#80CBC4', keys: ['portugal', 'portuguese'] },
        { name: 'Switzerland', color: '#EF9A9A', keys: ['switzerland', 'swiss'] }
    ];
    const fullText = texts.join(' \n ');
    const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const countKeys = (keys) => { const pat = keys.map(esc).join('|'); const m = fullText.match(new RegExp('\\b(' + pat + ')\\b', 'gi')); return m ? m.length : 0; };
    // Residency / local-presence phrases. Each only counts when an actual country name follows (the
    // regex anchors on a country), so broad ones like "problem in" can't false-positive.
    const LOC_INTENT = [
        "(?:i'?m|i am|we'?re|we are)\\s+(?:from|in|living\\s+in|based\\s+in|located\\s+in)",
        "live\\s+in", "living\\s+in", "based\\s+in", "located\\s+in", "here\\s+in",
        "moved\\s+to", "moving\\s+to", "relocat(?:ed|ing)\\s+to",
        "grew\\s+up\\s+in", "raised\\s+in", "raising\\s+(?:my\\s+)?\\w+\\s+in",
        "(?:we|i)\\s+have\\s+(?:a\\s+|an\\s+)?(?:problem|issue|situation)\\s+(?:here\\s+)?in",
        "anyone\\s+(?:else\\s+)?(?:from|in)",
        "from"
    ].join('|');
    const countStrong = (keys) => { const pat = keys.map(esc).join('|'); const m = fullText.match(new RegExp('\\b(?:' + LOC_INTENT + ')\\s+(?:the\\s+)?(' + pat + ')\\b', 'gi')); return m ? m.length : 0; };
    // User/post FLAIR ("UK", "Texas", "🇦🇺") is a strong real residency signal the poster set themselves
    // — count it like an explicit "I'm based in…" (weight ×4) and fold it into the totals.
    const flairs = (posts || []).map(p => (p.flair || '').toLowerCase()).filter(Boolean);
    const countFlair = (keys) => flairs.filter(f => keys.some(k => new RegExp('\\b' + esc(k) + '\\b').test(f))).length;
    let data = COUNTRIES.map(c => {
        const flair = countFlair(c.keys);
        const mentions = countKeys(c.keys) + flair, strong = countStrong(c.keys) + flair;
        return { name: c.name, color: c.color, mentions, strong, score: strong * 4 + Math.max(0, mentions - strong) };
    }).filter(d => d.mentions > 0).sort((a, b) => b.score - a.score);
    const grandTotal = data.reduce((n, d) => n + d.mentions, 0);
    const strongTotal = data.reduce((n, d) => n + d.strong, 0);
    if (data.length === 0 || grandTotal < 12) {
        el.innerHTML = `<p class="placeholder-text" style="text-align:center; color:#9ca3af; padding:1rem;">This audience rarely names a country or region in their discussions (only ${grandTotal} mention${grandTotal === 1 ? '' : 's'}), so there isn't enough signal to chart where they're based.</p>`;
        return;
    }
    if (data.length > 8) {
        const otherScore = data.slice(8).reduce((n, d) => n + d.score, 0);
        data = data.slice(0, 8);
        if (otherScore > 0) data.push({ name: 'Other', color: '#C9C9D6', score: otherScore, strong: 0, mentions: 0 });
    }
    const total = data.reduce((n, d) => n + d.score, 0) || 1;
    const max = data[0].score || 1;
    data.forEach(d => { d.pct = Math.round((d.score / total) * 100); });
    const footnote = strongTotal > 0
        ? `Weighted toward stated location — where people explicitly say they're based (an "I'm based in…" phrase or location flair) counts more heavily than a passing country mention.`
        : `Reflects countries discussed rather than confirmed residence — few people stated where they're actually based.`;
    el.innerHTML = `
      <div class="location-chart" style="display:flex; flex-direction:column; gap:11px; font-family:'Plus Jakarta Sans', system-ui, sans-serif;">
        ${data.map(d => `
          <div class="location-row" style="display:flex; align-items:center; gap:12px; font-size:0.95rem; color:#1f2937;">
            <span style="flex:0 0 120px; text-align:right; color:#374151;">${d.name}</span>
            <div style="flex:1; height:14px; background:rgba(124,92,255,0.08); border-radius:7px; overflow:hidden;">
              <div style="width:${Math.max(4, (d.score / max) * 100)}%; height:100%; background:${d.color}; border-radius:7px; box-shadow:0 1px 3px rgba(0,0,0,0.15);"></div>
            </div>
            <b style="flex:0 0 38px; text-align:right; color:#374151;">${d.pct}%</b>
          </div>`).join('')}
        <p style="margin:6px 0 0; font-size:0.72rem; color:#9ca3af;">${footnote}</p>
      </div>`;
}

// --- 3) ACTIVE HOURS histogram (#active-hours) — instant, no AI --------------
function renderActiveHours(posts) {
    const el = document.getElementById('active-hours');
    if (!el) return;
    const corpus = posts || [];
    const bins = new Array(24).fill(0);
    let n = 0;
    corpus.forEach(p => {
        const ts = p && p.created;
        if (!ts) return;
        const h = new Date(ts * 1000).getUTCHours();
        if (h >= 0 && h < 24) { bins[h]++; n++; }
    });
    if (n < 20) {
        el.innerHTML = `<p class="placeholder-text" style="text-align:center; color:#9ca3af; padding:1rem;">Only ${n} post${n === 1 ? '' : 's'} carried a timestamp, so there isn't enough signal to chart a reliable posting rhythm.</p>`;
        return;
    }
    const max = Math.max.apply(null, bins) || 1;
    const winSum = [];
    for (let i = 0; i < 24; i++) { let s = 0; for (let k = 0; k < 4; k++) s += bins[(i + k) % 24]; winSum.push(s); }
    let peakStart = 0;
    for (let i = 1; i < 24; i++) if (winSum[i] > winSum[peakStart]) peakStart = i;
    const apart = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 24 - d) >= 4; };
    let secStart = -1;
    for (let i = 0; i < 24; i++) if (apart(i, peakStart) && (secStart === -1 || winSum[i] > winSum[secStart])) secStart = i;
    const bimodal = secStart !== -1 && winSum[secStart] >= winSum[peakStart] * 0.8;
    const fmt = (h) => String(h).padStart(2, '0') + ':00';
    const win = (s) => `${fmt(s)}–${fmt((s + 4) % 24)}`;
    const peakHours = new Set();
    [peakStart].concat(bimodal ? [secStart] : []).forEach(st => [0, 1, 2, 3].forEach(k => peakHours.add((st + k) % 24)));
    const peakShare = Math.round((winSum[peakStart] / n) * 100);
    let callout;
    if (bimodal) {
        const a = Math.min(peakStart, secStart), b = Math.max(peakStart, secStart);
        const combined = Math.round(((winSum[peakStart] + winSum[secStart]) / n) * 100);
        callout = `Two active windows: <b>${win(a)} and ${win(b)} UTC</b> — together ${combined}% of posts.`;
    } else {
        callout = `Most active around <b>${win(peakStart)} UTC</b> — ${peakShare}% of posts land in that 4-hour window.`;
    }
    el.innerHTML = `
      <div class="active-hours" style="font-family:'Plus Jakarta Sans', system-ui, sans-serif;">
        <div style="display:flex; align-items:flex-end; gap:3px; height:140px;">
          ${bins.map((c, h) => {
              const inPeak = peakHours.has(h);
              const col = inPeak ? '#7C5CFF' : 'rgba(124,92,255,0.22)';
              const ht = Math.max(3, Math.round((c / max) * 132));
              return `<div title="${fmt(h)} — ${c} post${c === 1 ? '' : 's'}" style="flex:1 1 0; height:${ht}px; background:${col}; border-radius:4px 4px 0 0; box-shadow:${inPeak ? '0 1px 4px rgba(124,92,255,0.35)' : 'none'};"></div>`;
          }).join('')}
        </div>
        <div style="display:flex; gap:3px; margin-top:6px;">
          ${bins.map((c, h) => `<div style="flex:1; text-align:center; font-size:0.6rem; color:#9ca3af;">${h % 6 === 0 ? fmt(h) : ''}</div>`).join('')}
        </div>
        <p style="margin:11px 0 0; font-size:0.9rem; color:#1f2937;">${callout}</p>
        <p style="margin:4px 0 0; font-size:0.72rem; color:#9ca3af;">Based on ${n} timestamped posts. Times are UTC — shift to your audience's timezone to plan posting and launches.</p>
      </div>`;
}

// --- UNIFIED "Where they are" system -----------------------------------------
// One OpenAI call extracts all 5 panels (experts/tools/events/waterholes/media) WITH built-in
// "suggested" seeding, instead of 5+5 separate calls. Client-side FUZZY grounding keeps real
// mentions even when the AI's name differs slightly from the corpus wording.

// Strict, high-fidelity grounding. Multi-word names must match as a COHESIVE phrase (or two
// principal tokens in tight proximity) — never by a single generic token. This is what stops a
// category like "Dog Training Apps" grounding off every occurrence of "training" (the 735-count bug).
function fuzzyGroundNameCount(name, allTextLow, isPerson) {
    const key = String(name).trim().toLowerCase();
    if (key.length < 3) return 0;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 1. Single word (e.g. "Chewy") → clean boundary match with light plural tolerance.
    if (!/\s/.test(key)) {
        const m = allTextLow.match(new RegExp(`\\b${esc}(s|es|'s)?\\b`, 'g'));
        return m ? m.length : 0;
    }
    // 2. Multi-word → count the whole phrase.
    const phrase = allTextLow.match(new RegExp(`\\b${esc}(s|es)?\\b`, 'g'));
    const phraseCount = phrase ? phrase.length : 0;
    const tokens = key.split(/\s+/).filter(t => t.length > 3 && !_whereStop.includes(t));
    // 3. PEOPLE are usually referenced by SURNAME alone ("Karpathy", "Pryor") — the LAST token. For the
    // experts panel, also count standalone surname mentions and take the higher of phrase/surname. We
    // DON'T do this for brands/places — matching a single token there caused the "training" over-count.
    if (isPerson) {
        const surname = tokens[tokens.length - 1];
        if (surname && surname.length >= 4) {
            const m = allTextLow.match(new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'));
            return Math.max(phraseCount, m ? m.length : 0);
        }
        return phraseCount;
    }
    if (phraseCount) return phraseCount;
    // 4. Proximity fallback (non-person): the two principal tokens within a 3-word window.
    if (tokens.length >= 2) {
        const t1 = tokens[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const t2 = tokens[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const prox = allTextLow.match(new RegExp(`\\b(${t1}\\s+(?:\\w+\\s+){0,2}${t2}|${t2}\\s+(?:\\w+\\s+){0,2}${t1})\\b`, 'gi'));
        return prox ? prox.length : 0;
    }
    return 0; // unverifiable → falls back to an "Audience Match" badge with count 0
}

// Label for AI-added (non-grounded) entries — frames them as a curated match for the niche rather
// than a "tool failed to find data" disclaimer. The per-panel signal label keeps it honest.
const SUGGESTED_LABEL = 'Audience Match';
// Media-type icons (Webflow-hosted): microphone for podcasts/shows, YouTube glyph for channels.
const MEDIA_ICON_PODCAST = 'https://cdn.prod.website-files.com/685a77786ed6701cb1f51c9f/6a29910c7ee904f1b1846c2a_microphone%20(1).svg';
const MEDIA_ICON_YOUTUBE = 'https://cdn.prod.website-files.com/685a77786ed6701cb1f51c9f/6a29904e3a7a8a6d15eab767_youtube.svg';

// Per-panel signal strength from the real (grounded) mentions, so a thin panel reads as honest
// audience intelligence ("this community rarely names X") rather than a broken/empty panel.
function _whereSignal(items) {
    const real = items.filter(it => !it.suggested);
    const mentions = real.reduce((s, it) => s + (it.count || 0), 0);
    const top = real.reduce((m, it) => Math.max(m, it.count || 0), 0);
    // Strong = genuinely well-evidenced: several grounded names AND real volume (or one heavily-cited
    // name). A handful of 1-2 mention items is Moderate at best.
    if (real.length >= 4 && (mentions >= 15 || top >= 8)) return { t: 'Strong signal', c: '#16a34a', bg: 'rgba(22,163,74,0.12)', strong: true };
    if (real.length >= 2 && mentions >= 5) return { t: 'Moderate signal', c: '#d97706', bg: 'rgba(217,119,6,0.12)', strong: false };
    return { t: 'Low signal', c: '#64748b', bg: 'rgba(100,116,139,0.12)', strong: false };
}

// Trim to a hard cap so titles/descriptions stay compact and never wrap or overflow.
function _trunc(s, n) { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

// Shared self-contained renderer for the experts / tools / events / waterholes panels.
function renderWherePanelUI(elId, items, cfg) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!items || !items.length) {
        el.innerHTML = `<p class="placeholder-text" style="text-align:center; color:#9ca3af; padding:1rem;">${cfg.empty}</p>`;
        return;
    }
    const radius = cfg.round ? '50%' : '8px';
    const sig = _whereSignal(items);
    const sBadge = `<span style="flex:0 0 auto; font-size:0.68rem; font-weight:700; color:#94a3b8; background:rgba(100,116,139,0.12); padding:2px 8px; border-radius:999px;">${SUGGESTED_LABEL}</span>`;
    el.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; font-family:'Plus Jakarta Sans', system-ui, sans-serif;">
        <div style="display:flex; justify-content:flex-end;">
          <span style="font-size:0.6rem; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; color:${sig.c}; background:${sig.bg}; padding:3px 9px; border-radius:999px;">${sig.t}</span>
        </div>
        ${items.map(it => `
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="flex:0 0 34px; height:34px; border-radius:${radius}; background:${cfg.accentBg}; color:${cfg.accent}; font-weight:800; display:flex; align-items:center; justify-content:center; font-size:0.82rem;">${(it.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || '?').toUpperCase()}</span>
            <div style="flex:1; min-width:0;">
              <div style="font-size:0.98rem; font-weight:700; color:#1f2937; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${_escapeHtml(_trunc(it.name, 26))}</div>
              ${it.sub ? `<div style="font-size:0.8rem; color:#6b7280; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${_escapeHtml(_trunc(it.sub, 30))}</div>` : ''}
            </div>
            ${it.suggested ? sBadge : `<span style="flex:0 0 auto; font-size:0.68rem; font-weight:700; color:#6b7280; background:rgba(0,0,0,0.06); padding:2px 8px; border-radius:999px;">Mentioned ${it.count} ${it.count === 1 ? 'time' : 'times'}</span>`}
          </div>`).join('')}
        ${!sig.strong && cfg.context ? `<p style="margin:8px 0 0; font-size:0.72rem; color:#9ca3af; font-style:italic;">${cfg.context}</p>` : ''}
      </div>`;
}

// The corpus is ranked by PROBLEM density (complaints), so the resource/recommendation threads —
// where tools, creators, podcasts and communities actually get named — sink to the bottom and never
// reach the Where extractor. Re-rank by RESOURCE-signal density first, so the AI analyses the posts
// most likely to contain proper nouns. Pure in-memory, works for any audience, zero extra cost.
const _WHERE_RESOURCE_WORDS = ['recommend', 'tool', 'app', 'software', 'podcast', 'youtube', 'channel', 'book', 'website', 'favourite', 'favorite', 'best', 'creator', 'influencer', 'expert', 'follow', 'group', 'discord', 'facebook', 'instagram', 'twitter', 'course', 'newsletter', 'subscribe'];
function getResourceDenseSample(corpus, limit = 18) {
    return (corpus || []).map(p => {
        const text = `${p.title || ''} ${p.body || ''} ${p.commentsText || ''}`.toLowerCase();
        let score = 0;
        _WHERE_RESOURCE_WORDS.forEach(w => { const m = text.match(new RegExp('\\b' + w + '\\b', 'g')); if (m) score += m.length; });
        if (p.commentsText) score += 10; // enriched threads are where resources get named
        return { post: p, score };
    }).sort((a, b) => b.score - a.score).map(x => x.post).slice(0, limit);
}

// Single, high-efficiency call that harvests all 5 entity lists at once (with seeding built in).
async function generateAndRenderAllWherePanels(corpus, audience) {
    const panels = ['thought-leaders', 'tools-apps', 'events-places', 'watering-holes', 'podcasts'];
    panels.forEach(id => setItemLoading(id, true));

    // MULTI-TIER sample (0 extra network cost): a DENSE list of the top 100 post TITLES (people put
    // resource names right in titles — "Has anyone used Rover?") + the top 30 bodies with their deep
    // comments. This gives the model a far wider net to catch organic mentions, so fewer items fall
    // back to "suggested".
    // Kept lean so this single call reliably finishes inside the 26s function window (was timing out
    // at ~17k input tokens). Grounding still runs over the FULL corpus, so accuracy is unaffected —
    // the model just gets a tighter brief, and any name it names is verified against everything.
    const titlesList = corpus.slice(0, 70)
        .map((p, i) => `[Post ${i} Title] ${p.title} (r/${p.subreddit || ''})`)
        .join('\n');
    // Re-rank by RESOURCE-signal density so the 18 bodies we send are the ones most packed with
    // tool/creator/podcast/community mentions (not the loudest complaints).
    const sample = getResourceDenseSample(corpus, 18)
        .map((p, i) => `[Post ${i} Body] ${(p.body || '').slice(0, 350)}\nDiscussions: ${(p.commentsText || '').slice(0, 900)}`)
        .join('\n---\n');

    const prompt = `You are an expert market researcher building a "Where they are" report for a "${audience}" audience.
Analyse the discussions below and extract five distinct lists of resources they discuss, use, or follow.
For each list, retrieve up to 6 of the most prominent, real names. If there are fewer than 6 explicit mentions in the text, you MUST append well-known, highly relevant suggestions that are real and popular for this target audience, setting "suggested": true for those.

CRITICAL EXTRACTION RULES (DO NOT VIOLATE):
- Every entry MUST be a specific, trademarked BRAND, PROPER NOUN, or named entity.
- NEVER extract generic category plural nouns, descriptions, or activities.
  * WRONG (Generic): "design software", "sneaker apps", "parenting groups", "running shoe brands", "dog training apps", "dog parks".
  * RIGHT (Proper Nouns): "Figma", "StockX", "Peanut App", "Nike SNKRS", "Puppr", "Redwood Dog Park".
- Do NOT return the audience's own anonymous Reddit usernames.
- Keep every "role"/"use"/"what"/"focus" description to a MAXIMUM of 4 words — terse, no filler (e.g. "ML library", "Sleep-tracking app", "Annual design conf", "Dog trainer").
- If no specific brand or proper noun is named, return an empty list or use your curated "suggested": true fallback to suggest actual brands.

Extract these five categories:
1. "experts": Real people, creators, YouTubers, authors, or leaders they follow or learn from.
   * Examples: Emily Oster (Parenthood), Jacques Slade (Sneakers), Tobias van Schneider (Design), Karen Pryor (Dogs).
2. "tools": ONLY digital things used online — apps, software, websites, or online platforms. NOT physical retail stores, NOT physical products.
   * WRONG here: "Home Depot", "Lowe's", "IKEA" (those are STORES → put in events); "Citristrip", "Kong toy" (physical products → leave out entirely).
   * RIGHT: Huckleberry (Parenthood), GOAT app (Sneakers), Spline (Design), Rover app (Dogs), Canva, Notion, Pinterest.
3. "events": Physical real-world places they go — retail STORES (e.g. Home Depot, Lowe's, IKEA), expos, meetups, parks, clubs, classes, venues.
   * Examples: Home Depot (DIY), Sneaker Con (Sneakers), Config (Design), Crufts (Dogs), a named local park or store.
4. "waterholes": Non-Reddit communities where they gather (e.g. Slack workspaces, Discord servers, Facebook groups, independent forums).
   * Examples: SoleSavy Discord (Sneakers), Designer Hangout Slack (Design), Peanut App Groups (Parenthood).
5. "media": Podcasts, YouTube channels, newsletters, or video shows they recommend or watch.
   * Examples: Taking Cara Babies YouTube (Parenthood), Full Size Run (Sneakers), The Futur (Design).

Respond ONLY with a valid JSON object matching this schema:
{
  "experts": [{"name": "Specific Person Name", "role": "max 4 words", "suggested": false}],
  "tools": [{"name": "Specific App/Site Brand", "use": "max 4 words", "suggested": false}],
  "events": [{"name": "Specific Venue/Event Name", "what": "max 4 words", "suggested": false}],
  "waterholes": [{"name": "Specific Group Name", "platform": "e.g. Discord/Facebook/Forum", "suggested": false}],
  "media": [{"name": "Specific Show/Channel Name", "type": "podcast/youtube/show", "focus": "max 4 words", "suggested": false}]
}

[READING INSTRUCTIONS]
First, scan the "Dense Post Titles List" to identify specific proper nouns frequently mentioned in thread titles.
Second, cross-reference with the "Full Post Bodies & Discussions" to find deeper context and verify mentions.

Dense Post Titles List:
${titlesList}

Full Post Bodies & Discussions:
${sample}`;

    try {
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You are an advanced entities extraction engine for audience research. You output only valid JSON.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.1, max_completion_tokens: 800, response_format: { type: 'json_object' }
        });

        const allTextLow = corpus.map(_whereTextOf).join(' ').toLowerCase();
        // "Suggested" is defined ONLY by grounding: if the name is actually found in the corpus it's
        // REAL, otherwise it's an AI suggestion (we ignore the model's self-reported flag — the corpus
        // is the source of truth). Real items always show; suggestions only top up a THIN panel and
        // never dominate: if we have ≥3 real, show up to 6 real and NO suggestions; otherwise show the
        // real ones plus a few suggestions, capped at 4 total. Keeps the "data-backed" promise honest.
        const build = (raw, subFn, isPerson) => {
            const mapped = (raw || []).filter(x => x && x.name).map(x => {
                const count = fuzzyGroundNameCount(x.name, allTextLow, isPerson);
                // Grounding is the source of truth: if the name is actually in the corpus it's a REAL
                // mention (even if the AI flagged it suggested), otherwise it's an AI pick. The wider
                // multi-tier sample means far more names now ground → fewer "suggested" badges.
                return { name: x.name, sub: subFn(x), count, suggested: count === 0 };
            });
            const real = mapped.filter(x => !x.suggested).sort((a, b) => b.count - a.count);
            const sugg = mapped.filter(x => x.suggested);
            // Keep the grid FULL (the "shock absorber"): real mentions first, then top up with matches
            // to ~6. Honesty comes from the per-item badge + the panel's signal label/context, not from
            // leaving it sparse.
            const out = real.slice(0, 6);
            if (out.length < 6) out.push(...sugg.slice(0, 6 - out.length));
            return out;
        };

        const experts = build(parsed.experts, x => x.role, true); // person mode → surname grounding
        renderWherePanelUI('thought-leaders', experts, { round: true, accent: '#7C5CFF', accentBg: 'rgba(124,92,255,0.12)', empty: 'No experts or creators were identified.', context: 'This community rarely names specific creators in discussion — these are the most relevant figures for the niche.' });

        const tools = build(parsed.tools, x => x.use);
        renderWherePanelUI('tools-apps', tools, { round: false, accent: '#00a5ce', accentBg: 'rgba(0,165,206,0.14)', empty: 'No tools or apps were identified.', context: 'Physical-first communities discuss software and apps less than digital-first ones — these are their most common digital touchpoints.' });

        const events = build(parsed.events, x => x.what);
        renderWherePanelUI('events-places', events, { round: false, accent: '#00a5ce', accentBg: 'rgba(0,165,206,0.14)', empty: 'No physical events or places were identified.', context: 'Borderless, digital-first communities rarely name physical venues — these are the most relevant real-world events for the niche.' });

        const waterholes = build(parsed.waterholes, x => `Platform: ${x.platform || 'Community'}`);
        renderWherePanelUI('watering-holes', waterholes, { round: false, accent: '#7C5CFF', accentBg: 'rgba(124,92,255,0.12)', empty: 'No off-Reddit community watering holes were identified.', context: 'This audience rarely names off-Reddit communities directly — these are common gathering spots for the niche.' });

        const media = build(parsed.media, x => { const mt = x.type === 'youtube' ? 'YouTube' : (x.type === 'show' ? 'Show' : 'Podcast'); return `${mt}${x.focus ? ' | ' + x.focus : ''}`; });
        renderWherePodcasts(media);

        window._whereData = { experts, tools, events, waterholes, media }; // for CSV export
        console.log(`[Where] unified harvest: experts=${experts.length} tools=${tools.length} events=${events.length} waterholes=${waterholes.length} media=${media.length}`);
    } catch (e) {
        console.error('[Where] unified panel rendering failed:', e);
        // Allow a retry on the next tab open instead of leaving the tab stuck blank, and show a
        // recoverable message in any panel that never rendered.
        if (window._tabLoaded) window._tabLoaded.where = false;
        ['thought-leaders', 'tools-apps', 'events-places', 'watering-holes'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.querySelector('div')) el.innerHTML = '<p class="placeholder-text" style="text-align:center; color:#9ca3af; padding:1rem;">Took too long to load — reopen this tab to try again.</p>';
        });
    } finally {
        panels.forEach(id => setItemLoading(id, false));
    }
}

// Media cards (keeps the Webflow .podcasts-list-item blueprint). Takes the unified data shape.
function renderWherePodcasts(items) {
    const container = document.getElementById('podcasts');
    if (!container) return;
    if (!window._podcastBlueprint) {
        const bp = container.querySelector('.podcasts-list-item');
        if (bp) window._podcastBlueprint = bp.cloneNode(true);
    }
    const blueprint = window._podcastBlueprint;
    if (!blueprint) return;
    container.querySelectorAll('.podcasts-list-item').forEach(el => el.remove());
    if (!items || !items.length) {
        const empty = blueprint.cloneNode(true); empty.style.display = '';
        const n = empty.querySelector('.podcast-name'); if (n) n.innerText = 'No podcasts or channels were named.';
        ['.podcast-focus', '.podcast-meta', '.media-type', '.prevalence-tag', '.prevelance-tag'].forEach(sel => { const e = empty.querySelector(sel); if (e) e.innerText = ''; });
        const img = empty.querySelector('.podcast-image'); if (img) img.style.display = 'none';
        container.appendChild(empty); return;
    }
    items.forEach(it => {
        const node = blueprint.cloneNode(true); node.style.display = '';
        const set = (sel, val) => { const e = node.querySelector(sel); if (e) e.innerText = val; };
        set('.podcast-name', _trunc(it.name, 34));
        set('.podcast-focus', _trunc(it.sub || '', 38));
        set('.media-type', (it.sub || '').split(' | ')[0] || 'Podcast');
        // Swap the media icon: microphone for podcasts/shows, YouTube glyph for channels.
        const isYouTube = /^youtube/i.test(it.sub || '');
        const mi = node.querySelector('.media-icon');
        if (mi) {
            const url = isYouTube ? MEDIA_ICON_YOUTUBE : MEDIA_ICON_PODCAST;
            if (mi.tagName === 'IMG') mi.src = url; else mi.style.backgroundImage = `url("${url}")`;
            mi.style.display = '';
        }
        set('.podcast-meta', '');
        const tier = it.suggested ? SUGGESTED_LABEL : mentionTier(it.count);
        set('.prevalence-tag', tier); set('.prevelance-tag', tier);
        const img = node.querySelector('.podcast-image'); if (img) img.style.display = 'none';
        const link = node.querySelector('.podcast-link');
        if (link) link.setAttribute('target', '_blank');
        if (isYouTube) {
            // YouTube: a results search lands on the channel (no API key needed).
            if (link) link.setAttribute('href', `https://www.youtube.com/results?search_query=${encodeURIComponent(it.name)}`);
        } else if (link) {
            // Podcast/show: start with an Apple Podcasts search, then resolve the REAL show page (+
            // cover art + network/episodes/latest meta) via the JSONP iTunes lookup when it returns.
            link.setAttribute('href', `https://podcasts.apple.com/search?term=${encodeURIComponent(it.name)}`);
            itunesPodcastLookup(it.name).then(r => {
                if (!r) return;
                const a = it.name.toLowerCase(), b = (r.collectionName || '').toLowerCase();
                if (!b || !(b.includes(a) || a.includes(b))) return; // not a confident match — keep the search
                if (r.collectionViewUrl) link.setAttribute('href', r.collectionViewUrl);
                const art = r.artworkUrl600 || r.artworkUrl100;
                if (img && art) { if (img.tagName === 'IMG') img.src = art; else img.style.backgroundImage = `url("${art}")`; img.style.display = ''; }
                const bits = [];
                if (r.artistName) bits.push(r.artistName);
                if (r.trackCount) bits.push(`${r.trackCount} episode${r.trackCount === 1 ? '' : 's'}`);
                if (r.releaseDate) { const d = new Date(r.releaseDate); if (!isNaN(d)) bits.push(`latest ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`); }
                if (bits.length) set('.podcast-meta', bits.join(' · '));
            }).catch(() => { });
        }
        container.appendChild(node);
    });
}

// JSONP lookup against the iTunes Search API (no key, bypasses CORS) → real podcast page + art + meta.
function itunesPodcastLookup(name) {
    return new Promise((resolve) => {
        const cb = '_itunes_cb_' + Math.random().toString(36).slice(2);
        let script;
        const cleanup = () => { try { delete window[cb]; } catch (e) { } if (script && script.parentNode) script.parentNode.removeChild(script); };
        const timer = setTimeout(() => { cleanup(); resolve(null); }, 6000);
        window[cb] = (data) => { clearTimeout(timer); cleanup(); resolve((data && data.results && data.results[0]) || null); };
        script = document.createElement('script');
        script.src = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=podcast&limit=1&callback=${cb}`;
        script.onerror = () => { clearTimeout(timer); cleanup(); resolve(null); };
        document.head.appendChild(script);
    });
}

// Lazy loader: instant charts render immediately; the single unified harvester runs behind them.
function loadTabWhere() {
    if (!window._tabLoaded) window._tabLoaded = {};
    if (window._tabLoaded.where) return window._wherePromise || Promise.resolve();
    if (!window._corpus || !window._corpus.length) return Promise.resolve();
    window._tabLoaded.where = true;
    setTabLoading('tab-where', true);
    const audience = window.originalGroupName || '';
    window._wherePromise = (async () => {
        try { await (window._corpusEnrichedPromise || Promise.resolve()); } catch (e) { /* enrich best-effort */ }
        const corpus = window._corpus;
        try { renderSocialSplitChart(corpus); } catch (e) { console.warn('[Where/Social] failed', e); }
        try { renderLocationChart(corpus); } catch (e) { console.warn('[Where/Location] failed', e); }
        try { renderActiveHours(corpus); } catch (e) { console.warn('[Where/Hours] failed', e); }
        await generateAndRenderAllWherePanels(corpus, audience);
    })().catch(e => { console.warn('[Where] loader failed', e); window._tabLoaded.where = false; })
        .finally(() => setTabLoading('tab-where', false));
    return window._wherePromise;
}

function openTabWhere() {
    if (window._tabLoaded && window._tabLoaded.where) return;
    if (!window._corpus || !window._corpus.length) return;
    loadTabWhere();
}


// =============================================================================
// PART 7 — Tab 5 "How they shop" (#tab-shop). Lazy on click, corpus-only.
//  • Brands & Products → #top-brands-container / #top-products-container (.discovery-list-item)
//  • Demand-signals constellation → #constellation-map-container (+ #bubble-content side panel)
// Ported from the original, optimised: one AI call per panel over the comment-enriched corpus
// (was a separate Reddit shopping search + 4 batched calls).
// =============================================================================

const _shopTextOf = p => `${p.title || ''} ${p.body || ''} ${p.commentsText || ''}`;
const _SHOP_SKIP = new Set(['the', 'this', 'that', 'these', 'those', 'here', 'there', 'what', 'when', 'where', 'why', 'how', 'who', 'and', 'but', 'for', 'nor', 'yet', 'our', 'your', 'his', 'her', 'its', 'their', 'they', 'them', 'you', 'she', 'it', 'we', 'my', 'me', 'just', 'also', 'then', 'than', 'some', 'any', 'all', 'one', 'two', 'reddit', 'edit', 'update', 'tldr', 'imo', 'imho', 'with', 'have', 'from', 'about', 'would', 'could', 'should', 'really', 'been', 'were', 'will', 'dont', 'cant', 'wont']);
const _NON_PRODUCT_TERMS = new Set(['depression', 'anxiety', 'adhd', 'add', 'autism', 'asd', 'ocd', 'ptsd', 'bipolar', 'bpd', 'stress', 'burnout', 'insomnia', 'fatigue', 'brain fog', 'executive dysfunction', 'dopamine', 'serotonin', 'motivation', 'focus', 'productivity', 'procrastination', 'overwhelm', 'guilt', 'shame', 'anger', 'sadness', 'loneliness', 'mood', 'energy', 'health', 'wellness', 'life', 'time', 'money', 'sleep', 'pain', 'weight', 'symptoms', 'symptom', 'diagnosis', 'disorder', 'condition', 'therapy', 'treatment', 'medication', 'meds']);

// Render a ranked discovery list into a Webflow blueprint (.discovery-list-item → .rank/.name/.count).
// Clones the last slot if there are more items than designed slots, so nothing gets capped.
function renderDiscoveryList(containerId, data, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let slots = container.querySelectorAll('.discovery-list-item');
    if (slots.length && data && data.length > slots.length) {
        const template = slots[slots.length - 1];
        for (let k = slots.length; k < data.length; k++) template.parentNode.appendChild(template.cloneNode(true));
        slots = container.querySelectorAll('.discovery-list-item');
    }
    slots.forEach(slot => { slot.style.display = 'none'; slot.style.opacity = '0'; });
    if (!data || !data.length) return;
    data.forEach(([name, details], index) => {
        const slot = slots[index];
        if (!slot) return;
        const display = (details && details.originalName) || name;
        const rankEl = slot.querySelector('.rank'); if (rankEl) rankEl.textContent = `${index + 1}.`;
        const nameEl = slot.querySelector('.name'); if (nameEl) nameEl.textContent = display;
        const countEl = slot.querySelector('.count'); if (countEl) countEl.textContent = `${details.count} mention${details.count === 1 ? '' : 's'}`;
        slot.setAttribute('data-word', display);
        slot.setAttribute('data-type', type);
        slot.style.display = 'flex';
        setTimeout(() => { slot.style.opacity = '1'; }, index * 50);
    });
}

// Brands & Products: surface frequent proper-noun candidates from the corpus, let the model split
// them into real commercial brands vs generic buyable products, then GROUND each by real mention count.
async function generateAndRenderShopEntities(corpus, audience) {
    const brandsC = document.getElementById('top-brands-container');
    const productsC = document.getElementById('top-products-container');
    if (!brandsC && !productsC) { console.warn('[Shop] no brand/product containers'); return; }
    if ((corpus || []).length < 5) return;
    const caseText = corpus.map(_shopTextOf).join(' ');
    const audWords = new Set(String(audience || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean));
    const skip = w => w.length < 3 || _SHOP_SKIP.has(w) || audWords.has(w);
    const capFreq = {};
    (caseText.match(/\b[A-Z][A-Za-z0-9'&-]{2,}\b/g) || []).forEach(tok => { const low = tok.toLowerCase(); if (skip(low)) return; capFreq[low] = (capFreq[low] || 0) + 1; });
    const lowFreq = {};
    (caseText.toLowerCase().match(/\b[a-z][a-z'&-]{2,}\b/g) || []).forEach(w => { if (skip(w)) return; lowFreq[w] = (lowFreq[w] || 0) + 1; });
    const topCap = Object.entries(capFreq).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k);
    const topLow = Object.entries(lowFreq).filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k]) => k);
    const candidateList = [...new Set([...topCap, ...topLow])].slice(0, 75).map(k => `${k} (${lowFreq[k] || capFreq[k] || 0})`).join(', ');
    // Sample by SHOPPING INTENT + comments (where brands actually get named), not density — otherwise a
    // bigger (Deep) corpus just crowds the sample with problem-posts and FEWER brands surface. Scaling
    // with the corpus this way means Deep mode genuinely yields more brands than Quick.
    const _shopW = ['buy', 'bought', 'purchase', 'price', 'cost', 'worth', 'brand', 'recommend', 'favourite', 'favorite', 'best', 'use', 'using', 'tried', 'app', 'product', 'gear', 'switched', 'love'];
    const shopScored = corpus.map(p => {
        const t = `${p.title || ''} ${p.body || ''} ${p.commentsText || ''}`.toLowerCase();
        let s = 0; _shopW.forEach(w => { if (t.includes(w)) s += 2; });
        if (p.commentsText) s += 5;
        return { p, s };
    });
    const brandRich = shopScored.filter(x => x.s > 0).sort((a, b) => b.s - a.s || ((b.p.score || 0) - (a.p.score || 0))).map(x => x.p);
    const sampleText = (brandRich.length ? brandRich : corpus).slice(0, 60)
        .map(p => `Title: ${p.title || ''}\nBody: ${(p.body || '').substring(0, 400)}\nDiscussions: ${(p.commentsText || '').substring(0, 500)}`).join('\n---\n');
    const prompt = `You are a shopping-behaviour analyst studying what the "${audience}" audience BUYS, for a "How They Shop" report. Separate real commercial BRANDS from generic buyable PRODUCT categories.
A BRAND is a specific company, retailer, app, marketplace, medication or trademarked product line (e.g. Nike, Chewy, Kong, Purina, Notion, Amazon). Include niche/unfamiliar brands this audience mentions. A capitalised proper-noun product name is almost always a brand.
A PRODUCT is a generic buyable item or gear category with no specific maker (e.g. dog treats, chew toys, running shoes, weighted blanket, supplements).
STRICT EXCLUSIONS (put in NEITHER list): medical conditions/symptoms (depression, anxiety, ADHD, insomnia, burnout), emotions/abstract states (motivation, focus, productivity), generic life concepts (health, sleep, money), diets/methods (keto, fasting), generic activities (running, walking), personal names. If something cannot be bought, used or shopped for, exclude it.
Extract up to 20 BRANDS and up to 20 PRODUCTS, most relevant first. Return ONLY JSON: {"brands":["..."],"products":["..."]}.
FREQUENT TERMS across the discussions (name (count)) — classify each real brand into "brands" and each generic buyable item into "products"; ignore the rest (e.g. Kong is a dog-toy brand even though it's a common word):
${candidateList || '(none detected)'}
Text to analyse:
${sampleText}`;
    let parsed = { brands: [], products: [] };
    try {
        const data = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: "You are a shopping-data extractor for a 'How They Shop' report. Every brand or product you return must be something the audience can actually buy, use or shop for. You surface every specific named brand present, including niche ones, and NEVER return medical conditions, symptoms, emotions, abstract states, diets, methods, activities or personal names." },
                { role: 'user', content: prompt }
            ],
            temperature: 0, max_completion_tokens: 700, response_format: { type: 'json_object' }
        });
        parsed = { brands: data.brands || [], products: data.products || [] };
    } catch (e) { console.warn('[Shop] entity extraction failed:', e && e.message); }
    const allText = caseText.toLowerCase();
    // Reset + populate the entity store. We also collect the corpus posts that mention each entity
    // (client-side regex over text we already have — zero network) so the brand-brief can analyse them
    // and chart momentum WITHOUT any extra Reddit calls.
    window._entityData = { brands: {}, products: {} };
    const tally = (names, type) => {
        const out = window._entityData[type];
        (names || []).forEach(name => {
            const key = String(name).toLowerCase().trim();
            if (key.length < 3 || _NON_PRODUCT_TERMS.has(key) || out[key]) return;
            const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const count = (allText.match(new RegExp(`\\b${esc}(s|es|'s)?\\b`, 'gi')) || []).length;
            if (count > 0) {
                const testRe = new RegExp(`\\b${esc}(s|es|'s)?\\b`, 'i');
                const posts = corpus.filter(p => testRe.test(`${p.title || ''} ${p.body || ''} ${p.commentsText || ''}`));
                out[key] = { originalName: name, count, posts };
            }
        });
        return Object.entries(out).sort((a, b) => b[1].count - a[1].count).slice(0, 8);
    };
    renderDiscoveryList('top-brands-container', tally(parsed.brands, 'brands'), 'brands');
    renderDiscoveryList('top-products-container', tally(parsed.products, 'products'), 'products');
    console.log(`[Shop] brands/products rendered`);
}

// =============================================================================
// Brand / Product BRIEF — click a discovery row → AI deep-dive in the side panel.
// Lazy (on click), cached, and corpus-only: the analysis reads the entity's own corpus posts, and the
// momentum chart is derived from those posts' timestamps + local sentiment (NO extra Reddit search,
// unlike the original — that's the scale/speed win). Styling/typewriter ported from the original.
// =============================================================================
const briefCache = new Map();
function ensureTypewriterStyle() {
    if (typeof document === 'undefined' || document.getElementById('tw-style')) return;
    const st = document.createElement('style');
    st.id = 'tw-style';
    st.textContent = '.tw-caret{border-right:2px solid currentColor; padding-right:1px; animation:twblink 1s steps(1) infinite;} @keyframes twblink{50%{border-color:transparent;}}';
    document.head.appendChild(st);
}
function typeInto(el, text, speed = 14) {
    return new Promise(resolve => {
        if (!el) { resolve(); return; }
        const full = String(text == null ? '' : text);
        el.textContent = '';
        el.classList.add('tw-caret');
        let i = 0;
        const step = Math.max(1, Math.round(full.length / 90));
        const tick = () => {
            i += step;
            el.textContent = full.slice(0, i);
            if (i < full.length) { setTimeout(tick, speed); }
            else { el.classList.remove('tw-caret'); resolve(); }
        };
        tick();
    });
}
async function typeListItems(ul, items, speed = 14) {
    if (!ul) return;
    ul.innerHTML = '';
    for (const it of (items || [])) { const li = document.createElement('li'); ul.appendChild(li); await typeInto(li, it, speed); }
}
function escBriefText(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function buildBrandBriefHtml(itemName, parsed, trend) {
    const e = escBriefText;
    return `
        <div class="brief-content">
            <h3 class="brief-header">${e(itemName)}</h3>
            <div class="brief-section"><h4 class="brief-section-title">What It Is</h4><p class="brief-text">${e(parsed.what_it_is)}</p></div>
            <div class="brief-section">
                <h4 class="brief-section-title">Momentum Trend</h4>
                <div id="brand-momentum-chart" style="height:200px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.03); border-radius:8px; font-size:12px; color:#888;"><span class="loader-dots">Crunching historical mentions...</span></div>
            </div>
            <div class="brief-section"><h4>Use Case</h4><p class="brief-text">${e(parsed.use_case)}</p></div>
            <div class="brief-section"><h4>Strengths</h4><ul class="brief-list">${(parsed.loves || []).map(i => `<li>${e(i)}</li>`).join('')}</ul></div>
            <div class="brief-section"><h4>Pain Points</h4><ul class="brief-list">${(parsed.hates || []).map(i => `<li>${e(i)}</li>`).join('')}</ul></div>
            <div class="brief-verdict" style="background:rgba(0,165,206,0.1); padding:15px; border-radius:8px;"><p><strong>Verdict:</strong> ${e(parsed.verdict)}</p></div>
            ${trend ? `<script id="brand-momentum-chart-data" type="application/json">${JSON.stringify(trend)}</script>` : ''}
        </div>`;
}

// Momentum from the corpus only: bucket the entity's posts by recency, score each with the local
// sentiment word lists (same as the Talk historical chart). No Reddit calls.
function _entityMomentum(posts) {
    const nowSec = Date.now() / 1000, DAY = 86400;
    const periods = [{ label: 'Past 6 Mo', days: 182 }, { label: 'Past 3 Mo', days: 91 }, { label: 'Past Month', days: 30 }, { label: 'Past Week', days: 7 }];
    const trend = [];
    periods.forEach(per => {
        const inWin = (posts || []).filter(p => (p.created || 0) >= nowSec - per.days * DAY);
        if (!inWin.length) return;
        const { positive, negative } = countSentimentLocal(inWin);
        const total = positive + negative;
        trend.push({ period: per.label, positivePercentage: total ? Math.round((positive / total) * 100) : 50, context: { verdict: `${inWin.length} mention${inWin.length === 1 ? '' : 's'} in this window` } });
    });
    return trend.length >= 2 ? trend : null;
}

function renderBrandMomentumChart(data) {
    if (typeof Highcharts === 'undefined' || !data || !data.length) {
        const c = document.getElementById('brand-momentum-chart');
        if (c) c.innerHTML = '<span>Not enough historical data to chart.</span>';
        return;
    }
    Highcharts.chart('brand-momentum-chart', {
        chart: { type: 'line', backgroundColor: 'transparent' },
        title: { text: null }, credits: { enabled: false },
        xAxis: { categories: data.map(d => d.period), labels: { style: { color: '#888' } } },
        yAxis: { title: { text: null }, min: 0, max: 100, labels: { style: { color: '#888' } } },
        legend: { enabled: false },
        series: [{ name: '% Positive', data: data.map(d => ({ y: d.positivePercentage, context: d.context })), color: '#00a5ce' }],
        tooltip: {
            useHTML: true, outside: true, backgroundColor: '#FFFFFF', borderColor: '#E0E0E0', borderWidth: 1, padding: 16, borderRadius: 10, shadow: true,
            style: { fontSize: '14px', zIndex: 9999 },
            formatter: function () {
                const context = this.point.options.context;
                let html = `<div style="min-width:220px; max-width:280px; white-space:normal; line-height:1.4;"><b>${this.key}</b><br/><span style="color:${this.series.color}">●</span> Positive: <b>${this.y}%</b>`;
                if (context) {
                    html += `<hr style="margin:8px 0; border:0; border-top:1px solid #eee;">`;
                    if (context.positive_theme) html += `<div style="margin-bottom:4px"><span style="color:#28a745">🟢</span> ${context.positive_theme}</div>`;
                    if (context.negative_theme) html += `<div style="margin-bottom:8px"><span style="color:#dc3545">🔴</span> ${context.negative_theme}</div>`;
                    if (context.verdict) html += `<div style="font-size:12px; font-style:italic; color:#666;">${context.verdict}</div>`;
                }
                return html + `</div>`;
            }
        }
    });
}

async function generateAndRenderBrandBrief(itemName, itemType) {
    const isBrand = itemType === 'brands';
    const targetPanel = document.getElementById(isBrand ? 'brand-detail-panel' : 'product-detail-panel');
    if (!targetPanel) return;
    ensureTypewriterStyle();
    targetPanel.innerHTML = '<div class="brief-content"><p class="loading-text">Building brief… <span class="loader-dots"></span></p></div>';

    if (briefCache.has(itemName)) {
        targetPanel.innerHTML = briefCache.get(itemName);
        if (isBrand) {
            const dataEl = targetPanel.querySelector('#brand-momentum-chart-data');
            if (dataEl) { try { const t = JSON.parse(dataEl.textContent); if (t) renderBrandMomentumChart(t); } catch (e) {} }
            else { const c = document.getElementById('brand-momentum-chart'); if (c) c.innerHTML = '<span>Not enough historical data to chart.</span>'; }
        }
        return;
    }

    const entity = window._entityData?.[itemType]?.[String(itemName).toLowerCase()];
    const topPosts = (entity?.posts || []).slice(0, 20);
    const topPostsText = topPosts.map(p => `"${p.title || ''} - ${(p.body || '').substring(0, 300)}"`).join('\n');

    try {
        const prompt = isBrand
            ? `Analyze "${itemName}" based on: ${topPostsText}. Return JSON with: what_it_is, use_case, loves (array), hates (array), verdict.`
            : `Analyze category "${itemName}" based on: ${topPostsText}. Return JSON with: what_it_is, job_to_be_done, table_stakes (array), disruption_opportunities (array).`;
        const parsed = await callOpenAI({
            model: AI_MODEL,
            messages: [{ role: 'system', content: 'You are a fast market analyst. Output JSON.' }, { role: 'user', content: prompt }],
            temperature: 0.1, max_completion_tokens: 800, response_format: { type: 'json_object' }
        });
        const e = escBriefText;

        if (isBrand) {
            targetPanel.innerHTML = `
                <div class="brief-content">
                    <h3 class="brief-header">${e(itemName)}</h3>
                    <div class="brief-section"><h4 class="brief-section-title">What It Is</h4><p class="brief-text" id="tw-what"></p></div>
                    <div class="brief-section">
                        <h4 class="brief-section-title">Momentum Trend</h4>
                        <div id="brand-momentum-chart" style="height:200px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.03); border-radius:8px; font-size:12px; color:#888;"><span class="loader-dots">Crunching historical mentions...</span></div>
                    </div>
                    <div class="brief-section"><h4>Use Case</h4><p class="brief-text" id="tw-use"></p></div>
                    <div class="brief-section"><h4>Strengths</h4><ul class="brief-list" id="tw-loves"></ul></div>
                    <div class="brief-section"><h4>Pain Points</h4><ul class="brief-list" id="tw-hates"></ul></div>
                    <div class="brief-verdict" style="background:rgba(0,165,206,0.1); padding:15px; border-radius:8px;"><p><strong>Verdict:</strong> <span id="tw-verdict"></span></p></div>
                </div>`;
            const trend = _entityMomentum(entity?.posts || []);
            if (trend) renderBrandMomentumChart(trend);
            else { const c = document.getElementById('brand-momentum-chart'); if (c) c.innerHTML = '<span>Not enough historical data to chart.</span>'; }
            await typeInto(document.getElementById('tw-what'), parsed.what_it_is);
            await typeInto(document.getElementById('tw-use'), parsed.use_case);
            await typeListItems(document.getElementById('tw-loves'), parsed.loves);
            await typeListItems(document.getElementById('tw-hates'), parsed.hates);
            await typeInto(document.getElementById('tw-verdict'), parsed.verdict);
            briefCache.set(itemName, buildBrandBriefHtml(itemName, parsed, trend));
        } else {
            targetPanel.innerHTML = `
                <div class="brief-content">
                    <h3 class="brief-header">${e(itemName)}</h3>
                    <div class="brief-section"><h4>Category Info</h4><p class="brief-text" id="tw-what"></p></div>
                    <div class="brief-section"><h4>Job to be Done</h4><p class="brief-text" id="tw-job"></p></div>
                    <div class="brief-section"><h4>Table Stakes</h4><ul id="tw-stakes"></ul></div>
                </div>`;
            await typeInto(document.getElementById('tw-what'), parsed.what_it_is);
            await typeInto(document.getElementById('tw-job'), parsed.job_to_be_done);
            await typeListItems(document.getElementById('tw-stakes'), parsed.table_stakes);
            briefCache.set(itemName, `
                <div class="brief-content">
                    <h3 class="brief-header">${e(itemName)}</h3>
                    <div class="brief-section"><h4>Category Info</h4><p>${e(parsed.what_it_is)}</p></div>
                    <div class="brief-section"><h4>Job to be Done</h4><p>${e(parsed.job_to_be_done)}</p></div>
                    <div class="brief-section"><h4>Table Stakes</h4><ul>${(parsed.table_stakes || []).map(i => `<li>${e(i)}</li>`).join('')}</ul></div>
                </div>`);
        }
    } catch (error) {
        console.warn('[Brief] failed:', error && error.message);
        targetPanel.innerHTML = `<div class="brief-content"><p>Error loading content.</p></div>`;
    }
}

// Click a .brief-button (on a discovery row) → open the detail panel + run the brief; .brief-back-btn closes.
document.addEventListener('click', (e) => {
    const briefBtn = e.target.closest('.brief-button');
    if (briefBtn) {
        const item = briefBtn.closest('.discovery-list-item') || briefBtn;
        const itemName = item.getAttribute('data-word') || briefBtn.getAttribute('data-word');
        const itemType = item.getAttribute('data-type') || briefBtn.getAttribute('data-type');
        if (itemName && itemType) {
            const panel = document.getElementById(itemType === 'brands' ? 'brand-detail-panel' : 'product-detail-panel');
            if (panel) panel.classList.add('visible');
            generateAndRenderBrandBrief(itemName, itemType);
        }
        return;
    }
    const backBtn = e.target.closest('.brief-back-btn');
    if (backBtn) document.querySelectorAll('#brand-detail-panel, #product-detail-panel').forEach(p => p.classList.remove('visible'));
});

// --- Demand-signals constellation ------------------------------------------
const _SHOP_CATEGORIES = ['WillingnessToPay', 'PriceSensitivity', 'BrandLoyalty', 'ResearchHabits', 'Substitutes', 'Dealbreakers'];
const _SHOP_CAT_COLORS = {
    'willingness to pay': '#4FB0F5', 'substitutes': '#2BD4E8', 'price sensitivity': '#FB923C',
    'brand loyalty': '#F15FA6', 'research habits': '#34D17A', 'dealbreakers': '#00a5ce'
};

// Webflow state panel (#bubble-content): .bubble-loader / .bubble-empty / .bubble-prompt / .bubble-detail
// (with .bubble-detail-title/-quote/-meta/-source). Returns false if none exist (caller falls back).
function setConstellationPanelState(state, data) {
    const panel = document.getElementById('bubble-content');
    if (!panel) return false;
    const loader = panel.querySelector('.bubble-loader'), empty = panel.querySelector('.bubble-empty');
    const prompt = panel.querySelector('.bubble-prompt'), detail = panel.querySelector('.bubble-detail');
    if (!loader && !empty && !prompt && !detail) return false;
    const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
    show(loader, state === 'loading'); show(empty, state === 'empty'); show(prompt, state === 'prompt'); show(detail, state === 'detail');
    if (state === 'detail' && detail && data) {
        const set = (sel, val) => { const e = detail.querySelector(sel); if (e) e.innerText = val; };
        set('.bubble-detail-title', data.name || '');
        set('.bubble-detail-quote', `“${data.quote || ''}”`);
        const src = data.source || {};
        set('.bubble-detail-meta', src.subreddit ? `r/${src.subreddit} | 👍 ${(src.ups || 0).toLocaleString()}` : '');
        const link = detail.querySelector('.bubble-detail-source');
        if (link && src.url) link.setAttribute('href', src.url);
    }
    return true;
}

function renderConstellation(signals) {
    const container = document.getElementById('constellation-map-container');
    if (!container || typeof Highcharts === 'undefined') { console.warn('[Shop] constellation container/Highcharts missing'); return; }
    if (!signals || !signals.length) {
        setConstellationPanelState('empty');
        Highcharts.chart(container, { chart: { type: 'packedbubble', backgroundColor: 'transparent' }, title: { text: '' }, credits: { enabled: false }, series: [] });
        return;
    }
    const agg = {};
    signals.forEach(s => {
        if (!s.problem_theme || !s.source || !s.category) return;
        const theme = s.problem_theme.trim();
        if (!agg[theme]) agg[theme] = { ...s, frequency: 0 };
        agg[theme].frequency++;
    });
    const byCat = new Map();
    Object.values(agg).forEach(d => {
        const category = d.category.replace(/([A-Z])/g, ' $1').trim();
        if (!byCat.has(category)) byCat.set(category, []);
        byCat.get(category).push({ name: d.problem_theme, value: d.frequency, quote: d.quote, source: d.source });
    });
    const series = Array.from(byCat, ([name, data]) => {
        const s = { name, data };
        const c = _SHOP_CAT_COLORS[String(name).toLowerCase().trim()];
        if (c) s.color = c;
        return s;
    });
    Highcharts.chart(container, {
        chart: { type: 'packedbubble', backgroundColor: 'transparent' },
        title: { text: null }, credits: { enabled: false },
        tooltip: {
            // The HTML wrapper IS the visible box (fixed width + word-wrap), and Highcharts' own
            // background is turned off — this stops the useHTML text overflowing the drawn box.
            useHTML: true, outside: true, backgroundColor: 'transparent', borderWidth: 0, shadow: false,
            style: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
            formatter: function () {
                const src = this.point.options && this.point.options.source;
                if (this.point.isParentNode || !src) return false;
                return `<div style="width:240px; box-sizing:border-box; background:#FFFFFF; border:1px solid #E0E0E0; border-radius:10px; box-shadow:0 3px 12px rgba(0,0,0,0.15); padding:12px 14px; color:#333333; white-space:normal; overflow-wrap:break-word; word-break:break-word;">
                    <div style="font-weight:bold; font-size:1rem; margin-bottom:8px; border-bottom:1px solid #E0E0E0; padding-bottom:6px;">${this.point.name}</div>
                    <div style="font-size:0.9rem; line-height:1.4; margin-bottom:8px;">“${this.point.options.quote || ''}”</div>
                    <a href="${src.url || '#'}" target="_blank" rel="noopener" style="font-size:0.8rem; color:#555; text-decoration:none;">r/${src.subreddit || ''} | 👍 ${(src.ups || 0).toLocaleString()}</a>
                </div>`;
            }
        },
        plotOptions: {
            packedbubble: {
                minSize: '35%', maxSize: '140%', zMin: 0, zMax: 1000,
                layoutAlgorithm: { splitSeries: true, gravitationalConstant: 0.05, seriesInteraction: false, dragBetweenSeries: true, parentNodeLimit: true, parentNodeOptions: { bubblePadding: 3 } },
                dataLabels: {
                    enabled: true, useHTML: true,
                    style: { color: 'black', textOutline: 'none', fontWeight: 'normal', fontFamily: "'Plus Jakarta Sans', sans-serif", textAlign: 'center' },
                    formatter: function () {
                        const radius = this.point.marker.radius;
                        if (this.point.name.length * 6 > radius * 1.8) return null;
                        return `<div style="font-size:${Math.max(8, radius / 3.5)}px;">${this.point.name}</div>`;
                    }
                },
                point: {
                    events: {
                        click: function () {
                            if (!this.isParentNode) {
                                const { name, quote, source } = this.options;
                                setConstellationPanelState('detail', { name, quote, source });
                            }
                        }
                    }
                }
            }
        },
        series
    });
    setConstellationPanelState('prompt');
}

async function generateAndRenderDemandSignals(corpus, audience) {
    const container = document.getElementById('constellation-map-container');
    if (!container) { console.warn('[Shop] #constellation-map-container not found'); return; }
    if ((corpus || []).length < 5) { renderConstellation([]); return; }
    setConstellationPanelState('loading');
    // Select by SHOPPING INTENT, not upvotes (upvotes favour stories, not purchases). Score each post
    // on commercial keywords + a big bonus for comment-enriched threads (recommendations live in
    // comments), take the top 22, and read DEEPER (the buying talk is rarely in the first 200 chars).
    const shopWords = ['buy', 'bought', 'purchase', 'pay', 'price', 'cost', 'worth', 'brand', 'recommend', 'choose', 'spent', 'subscription', 'upgrade', 'cheap', 'expensive', 'ordered', 'shopping', 'store', 'gear'];
    const scored = corpus.map(p => {
        const text = `${p.title || ''} ${p.body || ''} ${p.commentsText || ''}`.toLowerCase();
        let intentScore = 0;
        shopWords.forEach(w => { if (text.includes(w)) intentScore += 2; });
        if (p.commentsText) intentScore += 5;
        return { post: p, intentScore };
    });
    const targeted = scored.filter(x => x.intentScore > 0)
        .sort((a, b) => b.intentScore - a.intentScore || ((b.post.score || 0) - (a.post.score || 0)))
        .map(x => x.post).slice(0, 22);
    const finalSelection = targeted.length ? targeted : [...corpus].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 22);
    const listForAI = finalSelection.map((p, i) => `[${i}] ${`${p.title || ''}. ${(p.body || '').substring(0, 500)} ${(p.commentsText || '').substring(0, 800)}`.replace(/\s+/g, ' ')}`).join('\n');
    const prompt = `You are a shopper-behaviour analyst studying how the "${audience}" audience spends money.
From the numbered posts, extract concrete SHOPPING / product-decision signals and sort each into ONE of these six categories. COVER AS MANY of the six categories as the discussions support — aim for 2-4 signals per category where the material exists; do NOT pile everything into one or two.
- WillingnessToPay: happy to pay more, premium picks, "worth every penny", splurges.
- PriceSensitivity: budgeting, too expensive, cheaper alternative, deal-hunting, "overpriced".
- BrandLoyalty: always buys X, go-to brand, switched to/from a brand, sticks with one.
- ResearchHabits: how they decide — comparing options, reading reviews, asking for recommendations.
- Substitutes: alternatives, DIY-vs-buy, switching between product types (e.g. cloth vs disposable).
- Dealbreakers: returns, warnings, "never again", a flaw that kills the purchase.
For each signal: "post_index" (the [N]), "category" (EXACTLY one of the six above), "problem_theme" (2-4 words naming the PRODUCT, BRAND or decision — e.g. "Off-White sneakers", "Millie Moon diapers", "premium stroller" — NOT a life event or generic worry), "quote" (a SHORT verbatim snippet, MAX 15 words).
Only real shopping signals — never invent. Reject pure lifestyle/diet/habit talk where nothing is bought.
Return ONLY JSON: {"signals":[{"post_index":0,"category":"PriceSensitivity","problem_theme":"...","quote":"..."}]} — up to 14 signals.
Posts:
${listForAI}`;
    let signals = [];
    try {
        const data = await callOpenAI({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: 'You extract real shopping/purchase-decision signals from discussions and output only valid JSON. You never invent quotes. Keep quotes short so the JSON is always complete.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.1, max_completion_tokens: 850, response_format: { type: 'json_object' }
        });
        const raw = Array.isArray(data.signals) ? data.signals : [];
        const lookup = {}; _SHOP_CATEGORIES.forEach(c => { lookup[c.toLowerCase().replace(/[^a-z]/g, '')] = c; });
        signals = raw.map(s => {
            const post = finalSelection[parseInt(s.post_index, 10)];
            const cat = lookup[String(s.category || '').toLowerCase().replace(/[^a-z]/g, '')];
            if (!post || !cat || !s.problem_theme || !s.quote) return null;
            return { category: cat, problem_theme: String(s.problem_theme).trim(), quote: String(s.quote).trim(), source: { subreddit: post.subreddit || '', ups: post.score || 0, url: post.permalink || '' } };
        }).filter(Boolean);
    } catch (e) { console.warn('[Shop] demand signals failed:', e && e.message); }
    window._demandSignals = signals; // for CSV export
    console.log(`[Shop] ${signals.length} demand signals`);
    renderConstellation(signals);
}

// Lazy-load Tab 5 on first open (not pre-fetched — it's the last tab, keeps background load low).
function loadTabShop() {
    if (!window._tabLoaded) window._tabLoaded = {};
    if (window._tabLoaded.shop) return window._shopPromise || Promise.resolve();
    if (!window._corpus || !window._corpus.length) return Promise.resolve();
    window._tabLoaded.shop = true;
    // Shimmer the shop tab label(s) — #demand-signals-tab is the actual Webflow tab; #tab-shop kept as
    // a fallback. setTabLoading no-ops on whichever isn't present.
    setTabLoading('demand-signals-tab', true);
    setTabLoading('tab-shop', true);
    const audience = window.originalGroupName || '';
    window._shopPromise = (async () => {
        try { await (window._corpusEnrichedPromise || Promise.resolve()); } catch (e) { /* enrich best-effort */ }
        const corpus = window._corpus;
        await Promise.all([
            generateAndRenderShopEntities(corpus, audience),
            generateAndRenderDemandSignals(corpus, audience)
        ]);
    })().catch(e => { console.warn('[Shop] failed', e); window._tabLoaded.shop = false; })
        .finally(() => { setTabLoading('demand-signals-tab', false); setTabLoading('tab-shop', false); });
    return window._shopPromise;
}

function openTabShop() {
    if (window._tabLoaded && window._tabLoaded.shop) return;
    if (!window._corpus || !window._corpus.length) return;
    loadTabShop();
}

// Reveal the main results container (hidden until the first analysis is ready). display:flex is set
// with !important to beat any Webflow inline/none, then we fade in and scroll to it.
function revealResults() {
    const wrapper = document.getElementById('results-wrapper-b');
    if (!wrapper) { console.warn('[Analysis] #results-wrapper-b NOT FOUND — cannot reveal results.'); }
    else {
        wrapper.style.setProperty('display', 'flex', 'important');
        wrapper.style.opacity = '1';
        setTimeout(() => wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
    // Hide the landing header now that results are showing (restored on back-to-step1).
    const fullHeader = document.getElementById('full-header');
    if (fullHeader) fullHeader.style.setProperty('display', 'none', 'important');

    // Always land on Tab 1 (Who). Clicking it makes Webflow set it current and reset the other tabs
    // to their default (non-current) state — so a new search never drops you on a stale/empty tab.
    const whoTab = document.getElementById('tab-who');
    if (whoTab && typeof whoTab.click === 'function') whoTab.click();

    _debugVisibility('overview-div');
}

// Reveal the subreddit-selection step (the original's transitionToStep2). Without this, the
// results render into a container that's still hidden — which is why "nothing happened" even
// though the data loaded fine.
function transitionToStep2(audienceName) {
    const welcome = document.getElementById('welcome-div');
    const step1 = document.getElementById('step-1-container');
    const step2 = document.getElementById('subreddit-selection-container');
    const title = document.getElementById('pf-audience-title');
    if (welcome) welcome.style.display = 'none';
    if (step1) step1.classList.add('hidden');
    if (step2) step2.classList.add('visible');
    if (title) title.innerHTML = `Select Subreddits For: <span class="pf-audience-name">${audienceName}</span>`;
}

// #back-to-step1-btn — full reset to the original load state so the user can start a fresh search.
function transitionToStep1() {
    // Step containers back to the start.
    const welcome = document.getElementById('welcome-div');
    const step1 = document.getElementById('step-1-container');
    const step2 = document.getElementById('subreddit-selection-container');
    if (step2) step2.classList.remove('visible');
    if (step1) step1.classList.remove('hidden');
    if (welcome) welcome.style.display = ''; // restore Webflow's default (visible)
    _showMascot(); // bring the hero mascots back when returning to the start

    // Hide the results, restore the landing header.
    const results = document.getElementById('results-wrapper-b');
    if (results) { results.style.setProperty('display', 'none', 'important'); results.style.opacity = '0'; }
    const fullHeader = document.getElementById('full-header');
    if (fullHeader) fullHeader.style.removeProperty('display'); // back to Webflow default (visible)

    // Clear the previous run's inputs/output so a new search starts clean.
    const choices = document.getElementById('subreddit-choices');
    if (choices) choices.innerHTML = '';
    const groupInput = document.getElementById('group-input');
    if (groupInput) groupInput.value = '';

    // Wipe analysis state (corpus, findings, tabs, polarity) so the next search regenerates fresh.
    window._corpus = null; window._analysisSubreddits = null; window._allRankedSubredditNames = null;
    window._audienceKey = null; window._canonicalAudience = null;
    window._findings = null; window._findingsPromise = null; window._assignmentPromise = null;
    window._findingPosts = null; window._findingPostsFull = null;
    window._polarityPromise = null; window._subProblemCache = {}; window._tabLoaded = {};
    if (window._polarityChart && window._polarityChart.destroy) { window._polarityChart.destroy(); window._polarityChart = null; }
    console.log('[Reset] back to start — ready for a new search');
}

// =============================================================================
// EMBEDDINGS "WIDE SCAN"  (Phase 1 — console-validated engine, NO UI yet)
// Embed every post + comment chunk → cluster by meaning (k-means/cosine) → label clusters with ONE
// GPT call. Gives measured theme prevalence across thousands of units, cheaply. After running an
// analysis, validate from the console:  await runWideScan()  (add {fresh:true} to bypass cache).
// Results cache under analyses/{audienceKey}/tabs/wideScan. Nothing here touches the live UI.
// =============================================================================
const WIDE_SCAN_SCHEMA_VERSION = 2;   // bump → old cached wide-scans (with boilerplate themes) auto-expire & recompute
const WIDE_SCAN_MAX_UNITS = 2800;   // cap for browser memory/compute
const WIDE_SCAN_K = 20;             // target number of themes
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMS = 512;             // shorter vectors → ~3× less memory/compute, still plenty to cluster

// embeddings client — batched, modest concurrency (separate proxy from openai-proxy)
let _embedInFlight = 0; const _embedQueue = [];
function _acquireEmbedSlot() { if (_embedInFlight < 4) { _embedInFlight++; return Promise.resolve(); } return new Promise(r => _embedQueue.push(r)); }
function _releaseEmbedSlot() { if (_embedQueue.length) _embedQueue.shift()(); else _embedInFlight = Math.max(0, _embedInFlight - 1); }
async function _embedBatch(inputs) {
    await _acquireEmbedSlot();
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 28000);
    try {
        const res = await fetch(EMBEDDINGS_PROXY_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeddingPayload: { model: EMBED_MODEL, input: inputs, dimensions: EMBED_DIMS } }),
            signal: ctrl.signal
        });
        if (!res.ok) throw new Error('embeddings proxy ' + res.status);
        const data = await res.json();
        if (!data || data.error || !data.embeddingResponse) throw new Error((data && data.message) || 'embeddings error');
        return data.embeddingResponse.data.map(d => d.embedding);
    } finally { clearTimeout(timer); _releaseEmbedSlot(); }
}
async function embedAll(texts) {
    const B = 150, batches = [];
    for (let i = 0; i < texts.length; i += B) batches.push(texts.slice(i, i + B));
    const out = new Array(batches.length);
    await Promise.all(batches.map(async (b, idx) => { out[idx] = await _embedBatch(b); }));
    return out.flat();
}

// AutoModerator / sticky / rules / welcome boilerplate that pollutes clusters (e.g. "Welcome to
// r/dogs!", "will be removed", "read our rules"). Dropping it removes the junk themes and sharpens
// the real signal — also useful anywhere we feed corpus text to the model.
const _BOILERPLATE_RE = /(welcome to r\/|community (rules|guidelines)|read (our|the) (rules|sidebar|wiki|faq)|\bbe removed\b|please (read|review|make sure you read)|discussion-based subreddit|this (post|comment) (has been|was) removed|\bautomoderator\b|i am a bot|performed automatically|message the mod|contact the mod|\brule \d|mega ?thread|weekly (thread|discussion|question)|your (post|submission) (has|was) removed|posted automatically|^\s*\[?removed\]?\s*$|^\s*\[?deleted\]?\s*$)/i;
function _isBoilerplate(t) { return _BOILERPLATE_RE.test(t || ''); }

// Build embedding units: each post (title+body) + a few comment-text chunks → easily thousands.
// Mod/rules/welcome boilerplate is filtered out so it can't form its own (useless) cluster.
function buildWideScanUnits(corpus) {
    const units = [];
    (corpus || []).forEach(p => {
        const head = `${p.title || ''}. ${(p.body || '').slice(0, 300)}`.replace(/\s+/g, ' ').trim();
        if (head.length > 15 && !_isBoilerplate(head)) units.push({ text: head.slice(0, 500), permalink: p.permalink || '', kind: 'post' });
        const c = (p.commentsText || '').replace(/\s+/g, ' ').trim();
        for (let i = 0, n = 0; i < c.length && n < 4; i += 600, n++) {
            const chunk = c.slice(i, i + 600);
            if (chunk.length > 40 && !_isBoilerplate(chunk)) units.push({ text: chunk, permalink: p.permalink || '', kind: 'comment' });
        }
    });
    return units.length > WIDE_SCAN_MAX_UNITS ? units.slice(0, WIDE_SCAN_MAX_UNITS) : units;
}

// vector math + cosine k-means (vectors are pre-normalised, so cosine == dot product)
function _normVec(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; const o = new Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / s; return o; }
function _dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function kmeansCosine(vectors, k, iters) {
    const n = vectors.length; if (!n) return { assign: [], centroids: [] };
    k = Math.min(k, n);
    // k-means++-lite seeding: each new centroid = the point LEAST similar to all chosen so far (spreads them out)
    const centroids = []; const used = new Set();
    let first = Math.floor(Math.random() * n); centroids.push(vectors[first].slice()); used.add(first);
    while (centroids.length < k) {
        let pick = -1, worst = Infinity;
        for (let i = 0; i < n; i++) {
            if (used.has(i)) continue;
            let maxSim = -Infinity; for (const c of centroids) { const s = _dot(vectors[i], c); if (s > maxSim) maxSim = s; }
            if (maxSim < worst) { worst = maxSim; pick = i; }
        }
        if (pick < 0) break; centroids.push(vectors[pick].slice()); used.add(pick);
    }
    const assign = new Array(n).fill(0); const dim = vectors[0].length;
    for (let it = 0; it < iters; it++) {
        for (let i = 0; i < n; i++) { let best = 0, bs = -Infinity; for (let c = 0; c < centroids.length; c++) { const s = _dot(vectors[i], centroids[c]); if (s > bs) { bs = s; best = c; } } assign[i] = best; }
        const sums = centroids.map(() => new Array(dim).fill(0)); const counts = new Array(centroids.length).fill(0);
        for (let i = 0; i < n; i++) { const a = assign[i]; counts[a]++; const v = vectors[i], su = sums[a]; for (let d = 0; d < dim; d++) su[d] += v[d]; }
        for (let c = 0; c < centroids.length; c++) { if (!counts[c]) continue; const su = sums[c]; for (let d = 0; d < dim; d++) su[d] /= counts[c]; centroids[c] = _normVec(su); }
    }
    return { assign, centroids };
}

// Label all clusters in ONE GPT call (name / category / summary / representative quote).
async function labelWideScanClusters(clusters, audience) {
    const desc = clusters.map((cl, i) => `Cluster ${i} — ${cl.size} items:\n${cl.exemplars.map(e => `• ${e.slice(0, 180)}`).join('\n')}`).join('\n\n');
    const prompt = `You are analysing recurring themes in real discussions from a "${audience}" audience. Each cluster below is a group of semantically similar posts/comments. For EACH cluster return: a short "name" (3-5 words), a "category" (one of: pain, desire, hook, emotion, topic), a one-line "summary", and a verbatim "quote" — pick the item that BEST exemplifies the theme (a genuine user statement; never a moderator notice, rule, or "welcome" message). The quote must clearly match the theme name. Respond ONLY as JSON: {"clusters":[{"index":0,"name":"...","category":"...","summary":"...","quote":"..."}]}\n\n${desc}`;
    const parsed = await callOpenAI({
        model: AI_MODEL,
        messages: [{ role: 'system', content: 'You label thematic clusters for audience research. Output only valid JSON.' }, { role: 'user', content: prompt }],
        temperature: 0.2, max_completion_tokens: 1500, response_format: { type: 'json_object' }
    });
    return Array.isArray(parsed.clusters) ? parsed.clusters : [];
}

// cache (analyses/{key}/tabs/wideScan)
async function getCachedWideScan(key) {
    const db = _firestore(); if (!db || !key) return null;
    try { const doc = await db.collection('analyses').doc(key).collection('tabs').doc('wideScan').get(); if (!doc.exists) return null; const d = doc.data() || {}; return d.schema === WIDE_SCAN_SCHEMA_VERSION ? d : null; }
    catch (e) { return null; }
}
function setCachedWideScan(key, payload) { const db = _firestore(); if (!db || !key) return; try { db.collection('analyses').doc(key).collection('tabs').doc('wideScan').set({ ...payload, schema: WIDE_SCAN_SCHEMA_VERSION, updatedAt: Date.now() }); } catch (e) { } }

// Orchestrator — run from console: await runWideScan()  ·  await runWideScan({fresh:true})
async function runWideScan(opts) {
    opts = opts || {};
    const corpus = window._corpus, key = window._audienceKey, audience = window.originalGroupName || '';
    if (!corpus || !corpus.length) { console.warn('[WideScan] no corpus — run an analysis first'); return null; }
    if (!opts.fresh) { const cached = await getCachedWideScan(key); if (cached) { window._wideScan = cached; console.log('[WideScan] cached result (pass {fresh:true} to recompute):'); console.table((cached.themes || []).map(t => ({ theme: t.name, category: t.category, '%': t.pct, size: t.size }))); return cached; } }

    const units = buildWideScanUnits(corpus);
    if (units.length < 20) { console.warn('[WideScan] too few units to cluster:', units.length); return null; }
    console.log(`[WideScan] ${units.length} units (posts + comments) — embedding…`);
    const t0 = Date.now();
    let vectors;
    try { vectors = (await embedAll(units.map(u => u.text))).map(_normVec); }
    catch (e) { console.error('[WideScan] embedding failed:', e && e.message); return null; }
    console.log(`[WideScan] embedded ${vectors.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s — clustering…`);

    const { assign } = kmeansCosine(vectors, WIDE_SCAN_K, 8);
    const groups = {}; assign.forEach((a, i) => { (groups[a] = groups[a] || []).push(i); });
    const minSize = Math.max(5, Math.round(units.length * 0.01)); // drop noise clusters
    let clusters = Object.values(groups).filter(g => g.length >= minSize).map(idxs => {
        const dim = vectors[0].length, mean = new Array(dim).fill(0);
        idxs.forEach(i => { const v = vectors[i]; for (let d = 0; d < dim; d++) mean[d] += v[d]; });
        for (let d = 0; d < dim; d++) mean[d] /= idxs.length;
        const m = _normVec(mean);
        const ranked = idxs.map(i => ({ i, s: _dot(vectors[i], m) })).sort((a, b) => b.s - a.s);
        return { size: idxs.length, exemplars: ranked.slice(0, 4).map(r => units[r.i].text), permalinks: [...new Set(ranked.slice(0, 6).map(r => units[r.i].permalink).filter(Boolean))] };
    }).sort((a, b) => b.size - a.size);

    console.log(`[WideScan] ${clusters.length} themes — labelling (1 GPT call)…`);
    let labels = []; try { labels = await labelWideScanClusters(clusters, audience); } catch (e) { console.warn('[WideScan] labelling failed (showing raw sizes)', e); }
    const total = units.length;
    const themes = clusters.map((cl, i) => {
        const lb = labels.find(l => l && l.index === i) || labels[i] || {};
        return { name: lb.name || `Theme ${i + 1}`, category: lb.category || 'topic', pct: +((cl.size / total) * 100).toFixed(1), size: cl.size, quote: lb.quote || cl.exemplars[0] || '', permalinks: cl.permalinks };
    });
    console.log(`[WideScan] DONE — ${total} units analysed, ${themes.length} themes:`);
    console.table(themes.map(t => ({ theme: t.name, category: t.category, '%': t.pct, size: t.size })));
    const payload = { audience, units: total, themes };
    window._wideScan = payload;
    setCachedWideScan(key, payload);
    return payload;
}
if (typeof window !== 'undefined') window.runWideScan = runWideScan;

// =============================================================================
// EXPORT — #export-findings-btn dumps the whole analysis (every audience field
// shown to the user) to a CSV so it can be assessed offline. Pulls structured
// data from memory (findings, wide-scan, brands/products) and scrapes the
// rendered text of the other tab panels. If the wide-scan hasn't been run yet,
// it runs it first so the export is complete. Every row carries the search term.
// =============================================================================
function _csvCell(v) { return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`; }
function _pushRow(rows, section, item, field, value) {
    if (value == null || value === '') return;
    rows.push({ section, item, field, value: String(value).replace(/\s*\n\s*/g, ' / ').replace(/\s{2,}/g, ' ').trim() });
}
function collectAnalysisRows() {
    const rows = [];
    const push = (s, i, f, v) => _pushRow(rows, s, i, f, v);
    // meta
    push('meta', '-', 'search_term', window.originalGroupName || '');
    push('meta', '-', 'canonical', window._canonicalAudience || '');
    push('meta', '-', 'audience_key', window._audienceKey || '');
    push('meta', '-', 'posts_in_corpus', (window._corpus || []).length);
    push('meta', '-', 'subreddits', (window._analysisSubreddits || []).join(', '));
    // WHO — demographics (structured, with source + sample size so accuracy is auditable)
    const dem = window._demographics;
    if (dem) {
        push('who_demographics', '-', 'male_pct', dem.male_pct);
        push('who_demographics', '-', 'female_pct', dem.female_pct);
        push('who_demographics', '-', 'gender_source', dem.gender_source);
        push('who_demographics', '-', 'gender_sample_n', dem.gender_n || 0);
        push('who_demographics', '-', 'age_18_24_pct', dem.age_18_24);
        push('who_demographics', '-', 'age_25_45_pct', dem.age_25_45);
        push('who_demographics', '-', 'age_45_plus_pct', dem.age_45_plus);
        push('who_demographics', '-', 'age_source', dem.age_source);
        push('who_demographics', '-', 'age_sample_n', dem.age_n || 0);
        push('who_demographics', '-', 'top_life_stage', dem.top_life_stage);
    }
    // WHO — archetype
    if (window._archetype) {
        push('who_archetype', '-', 'name', window._archetype.name);
        push('who_archetype', '-', 'summary', window._archetype.summary);
        push('who_archetype', '-', 'tags', (window._archetype.tags || []).join(', '));
    }
    // WHO — profile (goals / fears / characteristics / rejects)
    if (window._profile) {
        ['goals', 'fears', 'characteristics', 'rejects'].forEach(k => {
            (window._profile[k] || []).forEach((item, i) => push('who_profile', `${k}.${i + 1}`, k.replace(/s$/, ''), typeof item === 'string' ? item : (item && (item.text || item.label || JSON.stringify(item)))));
        });
    }
    // findings (structured)
    (window._findings || []).forEach((f, i) => {
        push('findings', i + 1, 'title', f.title);
        push('findings', i + 1, 'prevalence_%', f.prevalence);
        push('findings', i + 1, 'summary', f.summary || f.body);
        push('findings', i + 1, 'quotes', (f.quotes || []).join(' | '));
        push('findings', i + 1, 'keywords', (f.keywords || []).join(', '));
    });
    // reddit posts shown to the user per finding (the modal sample posts)
    (window._findingPostsFull || []).forEach((posts, fi) => {
        (posts || []).slice(0, 10).forEach((p, pi) => {
            const it = `F${fi + 1}.P${pi + 1}`;
            push('finding_posts', it, 'parent_finding', (window._findings && window._findings[fi] && window._findings[fi].title) || '');
            push('finding_posts', it, 'subreddit', p.subreddit);
            push('finding_posts', it, 'title', p.title);
            push('finding_posts', it, 'score', p.score);
            push('finding_posts', it, 'comments', p.comments);
            push('finding_posts', it, 'permalink', p.permalink);
            push('finding_posts', it, 'body', (p.body || '').slice(0, 500));
        });
    });
    // polarity map (frequency × intensity per problem)
    (window._polarityPoints || []).forEach((pt, i) => {
        push('polarity', i + 1, 'problem', pt.label);
        push('polarity', i + 1, 'frequency_0_100', pt.x);
        push('polarity', i + 1, 'intensity_0_100', pt.y);
        push('polarity', i + 1, 'parent_finding_index', pt.parent);
    });
    // sub-problems per finding
    (window._findings || []).forEach((f, fi) => {
        const subs = (window._subProblemCache || {})[f.title] || [];
        subs.forEach((sp, si) => {
            push('subproblems', `${fi + 1}.${si + 1}`, 'parent_finding', f.title);
            push('subproblems', `${fi + 1}.${si + 1}`, 'sub_problem', sp.label);
            push('subproblems', `${fi + 1}.${si + 1}`, 'pct', sp.pct);
        });
    });
    // wide scan (structured)
    if (window._wideScan) push('wide_scan', '-', 'units_analysed', window._wideScan.units);
    ((window._wideScan && window._wideScan.themes) || []).forEach((t, i) => {
        push('wide_scan', i + 1, 'theme', t.name);
        push('wide_scan', i + 1, 'category', t.category);
        push('wide_scan', i + 1, 'percent', t.pct);
        push('wide_scan', i + 1, 'size', t.size);
        push('wide_scan', i + 1, 'quote', t.quote);
    });
    // brands / products (structured)
    ['brands', 'products'].forEach(type => {
        const obj = (window._entityData && window._entityData[type]) || {};
        Object.values(obj).forEach((e, i) => { push('shop_' + type, i + 1, 'name', e.originalName || ''); push('shop_' + type, i + 1, 'mentions', e.count); });
    });
    // shop — demand signals (structured)
    (window._demandSignals || []).forEach((s, i) => {
        push('shop_demand', i + 1, 'category', s.category);
        push('shop_demand', i + 1, 'theme', s.problem_theme);
        push('shop_demand', i + 1, 'quote', s.quote);
        push('shop_demand', i + 1, 'subreddit', s.source && s.source.subreddit);
        push('shop_demand', i + 1, 'permalink', s.source && s.source.url);
    });
    // WHERE — the five panels (structured: name, sub-label, mention count, suggested-or-real)
    const wd = window._whereData;
    if (wd) {
        const panelMap = { experts: 'where_experts', tools: 'where_tools', events: 'where_events', waterholes: 'where_waterholes', media: 'where_media' };
        Object.keys(panelMap).forEach(key => {
            (wd[key] || []).forEach((it, i) => {
                push(panelMap[key], i + 1, 'name', it.name);
                push(panelMap[key], i + 1, 'detail', it.sub);
                push(panelMap[key], i + 1, it.suggested ? 'status' : 'mentions', it.suggested ? 'suggested (not found in corpus)' : it.count);
            });
        });
    }
    // displayed text of the rendered panels (faithful "what the user sees")
    const dom = [
        ['talk', 'voice', '#voice-p-wrap'],
        ['talk', 'sentiment', '#sentiment-wrap'],
        ['talk', 'hooks', '#hook-wrap'],
        ['talk', 'insider_language', '#insider-language'],
        ['talk', 'language_avoid', '#nega-wrap'],
        ['talk', 'language_use', '#positive-wrap']
    ];
    dom.forEach(([s, i, sel]) => {
        try { const el = document.querySelector(sel); if (el) { const t = (el.innerText || '').trim(); if (t) push(s, i, 'displayed_text', t.slice(0, 4000)); } } catch (e) { }
    });
    return rows;
}
function rowsToCSV(rows) {
    const term = window.originalGroupName || '', canon = window._canonicalAudience || '';
    const head = ['search_term', 'canonical', 'section', 'item', 'field', 'value'];
    const lines = [head.join(',')];
    rows.forEach(r => lines.push([term, canon, r.section, r.item, r.field, r.value].map(_csvCell).join(',')));
    return lines.join('\r\n');
}
// Make sure findings, polarity map, and sub-problems are generated so the export is complete even
// if the user never opened those tabs / expanded a finding.
async function ensureFullExportData() {
    if (!window._corpus || !window._corpus.length) return;
    try { if (typeof ensureFindings === 'function') await ensureFindings(); } catch (e) { }
    try { await loadPolarityMap(); } catch (e) { }   // computes + stashes window._polarityPoints
    try { if (typeof loadTabWhere === 'function') await loadTabWhere(); } catch (e) { }   // Where panels → window._whereData
    try { if (typeof loadTabShop === 'function') await loadTabShop(); } catch (e) { }     // brands/products + window._demandSignals
    const findings = window._findings || [];
    window._subProblemCache = window._subProblemCache || {};
    for (let i = 0; i < findings.length; i++) {
        const f = findings[i];
        if (window._subProblemCache[f.title]) continue;
        try {
            const assigned = window._findingPostsFull && window._findingPostsFull[i];
            const posts = (assigned && assigned.length >= 5) ? assigned : matchPostsForFinding(f, window._corpus || [], 40);
            await generateSubProblems(f, posts, window.originalGroupName || '');
        } catch (e) { console.warn('[Export] sub-problems failed for', f.title, e && e.message); }
    }
}
// Always-visible toast (the normal loader lives inside #full-header, which is hidden once results
// show — so it can't give feedback here). Pass a falsy msg to remove it.
function _exportToast(msg) {
    let t = document.getElementById('pp-export-toast');
    if (!msg) { if (t) t.remove(); return; }
    if (!t) {
        t = document.createElement('div');
        t.id = 'pp-export-toast';
        t.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0b1437;color:#fff;padding:14px 40px 14px 18px;border-radius:10px;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 8px 28px rgba(0,0,0,0.35);max-width:min(340px, calc(100vw - 32px));box-sizing:border-box;';
        const span = document.createElement('span');
        span.className = 'pp-toast-msg';
        t.appendChild(span);
        // Tiny white close ✕, top-right inside the dark box.
        const close = document.createElement('span');
        close.textContent = '×';
        close.setAttribute('aria-label', 'Close');
        close.style.cssText = 'position:absolute;top:7px;right:11px;cursor:pointer;font-size:17px;line-height:1;color:#fff;opacity:0.65;font-weight:700;';
        close.addEventListener('mouseenter', () => { close.style.opacity = '1'; });
        close.addEventListener('mouseleave', () => { close.style.opacity = '0.65'; });
        close.addEventListener('click', () => { const el = document.getElementById('pp-export-toast'); if (el) el.remove(); });
        t.appendChild(close);
        document.body.appendChild(t);
    }
    const msgEl = t.querySelector('.pp-toast-msg');
    if (msgEl) msgEl.textContent = msg; else t.textContent = msg;
}
async function exportFindings() {
    if (window._exporting) { console.log('[Export] already running — ignoring extra click'); return; }
    window._exporting = true;
    console.log('[Export] clicked — preparing full CSV…');
    _exportToast('Building export… this can take up to a minute.');
    try {
        // Ensure every section exists: findings, posts, polarity, sub-problems, then the wide-scan.
        try { await ensureFullExportData(); } catch (e) { console.warn('[Export] ensure data failed (continuing)', e); }
        if (!window._wideScan && window._corpus && window._corpus.length) {
            console.log('[Export] running wide scan so it is included…');
            _exportToast('Building export… analysing themes (almost there).');
            try { await runWideScan(); } catch (e) { console.warn('[Export] wide scan failed (continuing)', e); }
        }
        const rows = collectAnalysisRows();
        if (!rows.length) { console.warn('[Export] nothing to export — run an analysis first'); showMessage('Run an analysis first, then export.'); return; }
        const csv = rowsToCSV(rows);
        const name = `problempop-${_canonKey(window._canonicalAudience || window.originalGroupName || 'export')}-${new Date().toISOString().slice(0, 10)}.csv`;
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        console.log(`[Export] ${rows.length} rows → ${name}`);
        _exportToast('Export downloaded ✓');
        setTimeout(() => _exportToast(''), 4000);
    } catch (e) {
        console.error('[Export] failed', e);
        _exportToast('Export failed — see console.');
        setTimeout(() => _exportToast(''), 5000);
    } finally {
        window._exporting = false;
    }
}
if (typeof window !== 'undefined') window.exportFindings = exportFindings;

// =============================================================================
// SAVED SEARCHES — per-member history. Stored in the Memberstack member-JSON
// store when a member is logged in (cross-device, per-account), with a browser
// fallback for logged-out visitors. Each completed analysis is recorded; the
// "Saved" tab lists them newest-first and a click RE-RUNS that audience — which
// lands on the corpus + AI-results cache, so it's near-instant and free.
//
// WEBFLOW SETUP (add these once):
//   • A new (last) tab link with id="tab-saved" in the same tab menu as the others.
//   • Inside that tab's pane, an empty container with id="saved-searches-list".
// Nothing else — the list, styling, clicks and reopen are all handled here.
// =============================================================================
const SAVED_SEARCH_LIMIT = 50;

function _memberstack() {
    try { return (typeof window !== 'undefined' && window.$memberstackDom) ? window.$memberstackDom : null; }
    catch (e) { return null; }
}
// getMemberJSON returns { data: <json|null> }; normalise to a plain object either way so we never
// lose a member's other stored JSON when we write savedSearches back (updateMemberJSON REPLACES).
function _extractJSON(res) {
    if (!res || typeof res !== 'object') return {};
    if ('data' in res) return (res.data && typeof res.data === 'object') ? res.data : {};
    return res;
}
async function _loadHistory() {
    const ms = _memberstack();
    if (ms) {
        try {
            const json = _extractJSON(await ms.getMemberJSON());
            return Array.isArray(json.savedSearches) ? json.savedSearches : []; // logged in
        } catch (e) { /* not logged in / unavailable → browser fallback */ }
    }
    try { return JSON.parse(localStorage.getItem('pp_saved_searches') || '[]'); }
    catch (e) { return []; }
}
async function _saveHistory(list) {
    const ms = _memberstack();
    if (ms) {
        try {
            const json = _extractJSON(await ms.getMemberJSON());
            json.savedSearches = list;       // preserve any other member-JSON keys
            await ms.updateMemberJSON({ json });
            return true;
        } catch (e) { /* not logged in → browser fallback */ }
    }
    try { localStorage.setItem('pp_saved_searches', JSON.stringify(list)); } catch (e) { }
    return false;
}

// Record a completed analysis (de-duped by audienceKey, newest first).
async function saveSearchToHistory(entry) {
    if (!entry || !entry.audienceKey) return;
    const list = await _loadHistory();
    const filtered = list.filter(e => e && e.audienceKey !== entry.audienceKey);
    filtered.unshift({
        term: entry.term || '',
        canonical: entry.canonical || entry.term || '',
        audienceKey: entry.audienceKey,
        subreddits: Array.isArray(entry.subreddits) ? entry.subreddits.slice(0, 40) : [],
        deep: !!entry.deep,
        date: Date.now()
    });
    await _saveHistory(filtered.slice(0, SAVED_SEARCH_LIMIT));
    console.log(`[SavedSearch] saved "${entry.canonical || entry.term}" (${entry.audienceKey})`);
}

function _timeAgo(ts) {
    const s = Math.max(0, Math.floor((Date.now() - (ts || 0)) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
    try { return new Date(ts).toLocaleDateString(); } catch (e) { return ''; }
}

async function renderSavedSearches() {
    const el = document.getElementById('saved-searches-list');
    if (!el) { console.warn('[SavedSearch] #saved-searches-list not found — add it in Webflow'); return; }
    el.innerHTML = `<p style="text-align:center; color:#9ca3af; padding:1rem; font-family:'Plus Jakarta Sans',system-ui,sans-serif;">Loading…</p>`;
    const list = await _loadHistory();
    if (!list.length) {
        el.innerHTML = `<p style="text-align:center; color:#9ca3af; padding:1.5rem; font-family:'Plus Jakarta Sans',system-ui,sans-serif;">No saved searches yet. Run an analysis and it'll show up here.</p>`;
        return;
    }
    el.innerHTML = `<div style="display:flex; flex-direction:column; gap:10px; font-family:'Plus Jakarta Sans',system-ui,sans-serif;">
      ${list.map(e => `
        <div class="pp-saved-item" data-key="${_escapeHtml(e.audienceKey)}" role="button" tabindex="0"
             style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border:1px solid #e5e7eb; border-radius:12px; cursor:pointer; background:#fff;">
          <div style="min-width:0;">
            <div style="font-size:1rem; font-weight:700; color:#1f2937; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${_escapeHtml(e.canonical || e.term || 'Untitled')}</div>
            <div style="font-size:0.8rem; color:#6b7280;">${(e.subreddits || []).length} communities${e.deep ? ' · deep' : ''} · ${_timeAgo(e.date)}</div>
          </div>
          <span style="flex:0 0 auto; font-size:0.78rem; font-weight:700; color:#00a5ce; background:rgba(0,165,206,0.12); padding:6px 12px; border-radius:999px;">Reopen →</span>
        </div>`).join('')}
    </div>`;
}

async function reopenSavedSearch(audienceKey) {
    const list = await _loadHistory();
    const entry = list.find(e => e && e.audienceKey === audienceKey);
    if (!entry) { console.warn('[SavedSearch] entry not found', audienceKey); return; }
    console.log(`[SavedSearch] reopening "${entry.canonical || entry.term}"`);
    runProblemFinder({ term: entry.term, canonical: entry.canonical, subreddits: entry.subreddits, deep: entry.deep });
}

function openTabSaved() { renderSavedSearches(); }

// Smoothly fade out the hero mascots (#mascot-wrap) the moment a search starts (suggestion pill or
// Find-communities). Fades opacity + a small lift, then removes from layout so it can't intercept
// clicks. Idempotent. _showMascot restores it when the user goes back to the start.
function _hideMascot() {
    const m = document.getElementById('mascot-wrap');
    if (!m || m.dataset.ppHidden === '1') return;
    m.dataset.ppHidden = '1';
    m.style.transition = 'opacity 0.45s ease, transform 0.45s ease';
    m.style.opacity = '0';
    m.style.transform = 'translateY(-10px)';
    m.style.pointerEvents = 'none';
    setTimeout(() => { if (m.dataset.ppHidden === '1') m.style.display = 'none'; }, 480);
}
function _showMascot() {
    const m = document.getElementById('mascot-wrap');
    if (!m) return;
    m.dataset.ppHidden = '';
    m.style.display = '';
    // next frame so the display change applies before we transition opacity back in
    requestAnimationFrame(() => { m.style.opacity = '1'; m.style.transform = 'translateY(0)'; m.style.pointerEvents = ''; });
}

// --- wire the buttons -------------------------------------------------------
function initEntryFlow() {
    const findBtn = document.getElementById('find-communities-btn');
    if (!findBtn) { console.warn('[Entry] #find-communities-btn not found — cannot wire.'); return; }
    if (findBtn.dataset.ppWired) { return; } // never wire twice
    findBtn.dataset.ppWired = '1';

    // "Inspire me" reveals suggestion pills; clicking a pill fills the input and searches. Best-
    // effort: if these elements don't exist, we just skip them — the main button still works.
    const inspireBtn = document.getElementById('inspire-me-button');
    const pills = document.getElementById('pf-suggestion-pills');
    if (inspireBtn && pills) {
        if (!pills.dataset.populated) {
            pills.innerHTML = suggestions.map(s => `<div class="pf-suggestion-pill" data-value="${s}">${s}</div>`).join('');
            pills.dataset.populated = '1';
        }
        inspireBtn.addEventListener('click', () => pills.classList.toggle('visible'));
        pills.addEventListener('click', (e) => {
            const pill = e.target.closest('.pf-suggestion-pill');
            if (!pill) return;
            _hideMascot();
            const gi = document.getElementById('group-input');
            if (gi) gi.value = pill.getAttribute('data-value');
            findBtn.click();
        });
    }

    // Look up #group-input / #subreddit-choices at CLICK time (not now) so it doesn't matter
    // whether they exist yet when the button is first wired.
    findBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        _hideMascot();
        console.log('[Entry] find-communities-btn clicked');
        const groupInput = document.getElementById('group-input');
        const choices = document.getElementById('subreddit-choices');
        const groupName = (groupInput && groupInput.value.trim()) || '';
        if (!groupName) { showMessage('Please enter a group of people or pick a suggestion.'); return; }
        if (!choices) { console.error('[Entry] #subreddit-choices not found — nowhere to show results.'); return; }

        window.originalGroupName = groupName;
        window._canonicalAudience = groupName; // fallback until the AI (or cache) gives us a clean label
        transitionToStep2(groupName); // reveal the step-2 panel so the results are actually visible
        findBtn.disabled = true;
        choices.innerHTML = '<p class="loading-text">Finding communities…</p>';
        try {
            // CACHE (two-level): the community list is the thing the user sees and selects, so we make
            // it CONSISTENT across phrasings of the same audience. 1) Fast path: exact phrase typed
            // before → instant. 2) Otherwise find communities (which also returns the canonical label),
            // then reuse the CANONICAL audience's list so "SEO people" & "SEO professionals" show the
            // SAME correct subreddits → same selection → same corpus key → real cache sharing downstream.
            // (getCachedSubreddits also restores window._canonicalAudience on a hit.)
            const phraseKey = _canonKey(groupName); // deterministic: merges case/space/hyphen variants
            let hadCandidates = false; // did the AI propose communities? (distinguishes rate-limit from genuinely empty)
            let ranked = await getCachedSubreddits(phraseKey); // 1) fast path (spacing/case-insensitive)
            if (ranked && ranked.length) {
                console.log(`[Cache] communities HIT for "${groupName}" (key:${phraseKey}) — skipped AI + Reddit`);
            } else {
                const { names, canonical } = await findSubredditsForGroup(groupName);
                hadCandidates = names.length > 0;
                window._canonicalAudience = canonical || groupName; // clean, AI-normalized label (typos+synonyms)
                const canonKey = _canonKey(window._canonicalAudience);
                console.log('[Entry] candidate subreddits:', names, '| canonical:', window._canonicalAudience, '| key:', canonKey);
                // 2) Canonical-level sharing: do other phrasings of this audience already have a list?
                let canonRanked = (canonKey !== phraseKey) ? await getCachedSubreddits(canonKey) : null;
                if (canonRanked && canonRanked.length) {
                    ranked = canonRanked;
                    console.log(`[Cache] communities HIT (canonical "${window._canonicalAudience}") — shared across phrasings, skipped Reddit ranking`);
                } else {
                    ranked = await fetchAndRankSubreddits(names);
                    setCachedSubreddits(canonKey, ranked, window._canonicalAudience); // store under canonical identity
                }
                // Also store under the exact phrase key so re-typing this phrasing is instant next time.
                if (canonKey !== phraseKey) setCachedSubreddits(phraseKey, ranked, window._canonicalAudience);
            }
            console.log('[Entry] ranked subreddits:', ranked.length);
            // If the AI proposed communities but NONE could be looked up, that's almost always Reddit
            // rate-limiting (429) the lookups — say so, instead of the misleading "no communities found".
            if (!ranked.length && hadCandidates) {
                choices.innerHTML = '<p class="error-message">Reddit is busy right now (rate limit). Please wait ~30 seconds and try again.</p>';
            } else {
                renderSubredditChoices(ranked);
            }
        } catch (error) {
            console.error('[Entry] find communities failed:', error);
            const rateLimited = /\b(429|5\d\d)\b/.test(String(error && error.message));
            choices.innerHTML = rateLimited
                ? '<p class="error-message">Reddit is busy right now (rate limit). Please wait ~30 seconds and try again.</p>'
                : '<p class="error-message">Could not load communities. Please try again.</p>';
        } finally {
            findBtn.disabled = false;
        }
    });

    // #search-selected-btn → run the analysis on the checked communities. Wired here if present;
    // also covered by the delegated handler below in case it's added to the DOM later.
    const searchBtn = document.getElementById('search-selected-btn');
    if (searchBtn && !searchBtn.dataset.ppWired) {
        searchBtn.dataset.ppWired = '1';
        searchBtn.addEventListener('click', (e) => { e.preventDefault(); runProblemFinder(); });
    }

    // #back-to-step1-btn → return to the search-term entry step.
    const backBtn = document.getElementById('back-to-step1-btn');
    if (backBtn && !backBtn.dataset.ppWired) {
        backBtn.dataset.ppWired = '1';
        backBtn.addEventListener('click', (e) => { e.preventDefault(); transitionToStep1(); });
    }

    // #tab-hurts → usually pre-fetched already (instant); loader only if opened before ready.
    const hurtsTab = document.getElementById('tab-hurts');
    if (hurtsTab && !hurtsTab.dataset.ppWired) {
        hurtsTab.dataset.ppWired = '1';
        hurtsTab.addEventListener('click', openTabHurts);
    }

    // #polarity-tab → usually pre-fetched already (instant); loader only if opened before ready.
    const polarityTab = document.getElementById('polarity-tab');
    if (polarityTab && !polarityTab.dataset.ppWired) {
        polarityTab.dataset.ppWired = '1';
        polarityTab.addEventListener('click', openPolarityMap);
    }

    // #tab-talk → lazy-load Tab 3 (How they talk) on first open.
    const talkTab = document.getElementById('tab-talk');
    if (talkTab && !talkTab.dataset.ppWired) {
        talkTab.dataset.ppWired = '1';
        talkTab.addEventListener('click', openTabTalk);
    }

    // #tab-where → lazy-load Tab 4 (Where they are) on first open.
    const whereTab = document.getElementById('tab-where');
    if (whereTab && !whereTab.dataset.ppWired) {
        whereTab.dataset.ppWired = '1';
        whereTab.addEventListener('click', openTabWhere);
    }

    // #tab-shop → lazy-load Tab 5 (How they shop) on first open.
    const shopTab = document.getElementById('tab-shop');
    if (shopTab && !shopTab.dataset.ppWired) {
        shopTab.dataset.ppWired = '1';
        shopTab.addEventListener('click', openTabShop);
    }

    // #tab-saved → render the user's saved-search history on open.
    const savedTab = document.getElementById('tab-saved');
    if (savedTab && !savedTab.dataset.ppWired) {
        savedTab.dataset.ppWired = '1';
        savedTab.addEventListener('click', openTabSaved);
    }

    // #export-findings-btn → export the whole analysis (incl. wide-scan) to CSV.
    const exportBtn = document.getElementById('export-findings-btn');
    if (exportBtn && !exportBtn.dataset.ppWired) {
        exportBtn.dataset.ppWired = '1';
        exportBtn.addEventListener('click', (e) => { e.preventDefault(); exportFindings(); });
    }

    console.log('[Entry] wired ✓ — #find-communities-btn is live');
}

// Safety net: delegated click handlers so these buttons work even if Webflow renders them after
// init. Each is guarded by dataset.ppWired so it never double-fires with the direct listeners.
document.addEventListener('click', (e) => {
    // Fade the hero mascots out the instant a search starts, however the click was wired.
    if (e.target.closest('#find-communities-btn, .pf-suggestion-pill')) _hideMascot();
    const searchBtn = e.target.closest('#search-selected-btn');
    if (searchBtn && !searchBtn.dataset.ppWired) { e.preventDefault(); runProblemFinder(); return; }
    const backBtn = e.target.closest('#back-to-step1-btn');
    if (backBtn && !backBtn.dataset.ppWired) { e.preventDefault(); transitionToStep1(); return; }
    const hurtsTab = e.target.closest('#tab-hurts');
    if (hurtsTab && !hurtsTab.dataset.ppWired) { openTabHurts(); return; } // don't preventDefault — let Webflow switch the tab
    const polTab = e.target.closest('#polarity-tab');
    if (polTab && !polTab.dataset.ppWired) { openPolarityMap(); return; }
    const talkTab = e.target.closest('#tab-talk');
    if (talkTab && !talkTab.dataset.ppWired) { openTabTalk(); return; }
    const whereTab = e.target.closest('#tab-where');
    if (whereTab && !whereTab.dataset.ppWired) { openTabWhere(); return; }
    const shopTab = e.target.closest('#tab-shop');
    if (shopTab && !shopTab.dataset.ppWired) { openTabShop(); return; }
    const savedTab = e.target.closest('#tab-saved');
    if (savedTab && !savedTab.dataset.ppWired) { openTabSaved(); return; }
    const exportBtn = e.target.closest('#export-findings-btn');
    if (exportBtn && !exportBtn.dataset.ppWired) { e.preventDefault(); exportFindings(); return; }

    // A saved-search row → reopen that audience (re-runs from cache).
    const savedItem = e.target.closest('.pp-saved-item');
    if (savedItem) { e.preventDefault(); reopenSavedSearch(savedItem.getAttribute('data-key')); return; }

    // .see-more on a finding card → open that finding's modal with its sample posts.
    const seeMore = e.target.closest('.see-more, .see-more-btn');
    if (seeMore) {
        const block = seeMore.closest('[id^="findings-block"]');
        if (block) {
            const idx = parseInt(block.id.replace(/\D+/g, ''), 10);
            if (idx) { e.preventDefault(); openFindingModal(idx); }
        }
        return;
    }
    // Modal close: an explicit close control, or clicking the modal backdrop itself.
    const closer = e.target.closest('.modal-close, .close-modal, [data-modal-close]');
    if (closer) { closeFindingModal(closer.closest('[id$="-modal"], [id$="-Modal"]')); return; }
    if (e.target.id && /-modal$/i.test(e.target.id)) { closeFindingModal(e.target); return; }
});

// Esc closes any open finding modal.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (let i = 1; i <= 5; i++) {
        const m = getFindingModal(i);
        if (m && m.style.display !== 'none' && m.style.display !== '') closeFindingModal(m);
    }
});

// --- bootstrap --------------------------------------------------------------
// Webflow renders the DOM asynchronously, so #find-communities-btn often doesn't exist yet at
// DOMContentLoaded — and this script may even load AFTER the page is ready. So we poll for the
// button (up to ~5s) and init the moment it appears. (Same proven pattern as the old file.)
function bootstrapEntryFlow() {
    let retries = 0;
    const intervalId = setInterval(() => {
        if (document.getElementById('find-communities-btn')) {
            clearInterval(intervalId);
            initEntryFlow();
        } else if (++retries > 50) {
            clearInterval(intervalId);
            console.error('[Entry] #find-communities-btn never appeared — init aborted.');
        }
    }, 100);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapEntryFlow);
} else {
    bootstrapEntryFlow(); // DOM already parsed (script loaded late) — start polling now
}
