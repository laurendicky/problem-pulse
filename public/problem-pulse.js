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

console.log('%c[problem-pulse-v2] BUILD 30 — posts cache 14 days, communities cache indefinite (seedable)', 'color:#00a5ce;font-weight:bold');

const suggestions = ['Dog Owners', 'New Parents', 'Home Bakers', 'Freelance Designers', 'Runners', 'Houseplant Lovers'];

// --- proxy helpers ----------------------------------------------------------
async function callOpenAI(payload, { timeoutMs = 45000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(OPENAI_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ openaiPayload: payload }),
            signal: ctrl.signal
        });
        const data = await res.json();
        if (!data || data.error) throw new Error((data && data.message) || 'OpenAI proxy error');
        return JSON.parse(data.openaiResponse);
    } finally {
        clearTimeout(timer);
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

async function callReddit(payload, { timeoutMs = 12000 } = {}) {
    await _acquireRedditSlot();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(REDDIT_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: ctrl.signal
        });
        if (!res.ok) throw new Error('Reddit proxy status ' + res.status);
        return await res.json();
    } finally {
        clearTimeout(timer);
        _releaseRedditSlot();
    }
}

// --- find communities -------------------------------------------------------
async function getRelatedSearchTermsAI(audience) {
    const payload = {
        model: 'gpt-4o-mini',
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
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are an expert Reddit community finder providing answers in strict JSON format.' },
            { role: 'user', content: `Based on the following audience and related keywords: [${allTerms.join(', ')}], suggest up to 20 relevant and active Reddit subreddits. Prioritize a variety of communities, including both large general ones and smaller niche ones. Provide your response ONLY as a JSON object with a single key "subreddits" which contains an array of subreddit names (without "r/").` }
        ],
        temperature: 0.2,
        max_completion_tokens: 300,
        response_format: { type: 'json_object' }
    };
    try {
        const parsed = await callOpenAI(payload);
        return Array.isArray(parsed.subreddits) ? parsed.subreddits : [];
    } catch (error) {
        console.error('[Find Subreddits] failed:', error && error.message);
        return [];
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
    container.innerHTML = subs.map(sub => `
        <div class="subreddit-choice">
            <input type="checkbox" id="sub-${sub.name}" value="${sub.name}" checked>
            <label for="sub-${sub.name}">
                <span class="sub-checkbox"></span>
                <span class="sub-info">
                    <span class="sub-name">r/${sub.name}</span>
                    <span class="sub-members">${formatMemberCount(sub.members)} members</span>
                </span>
                <span class="pill activity-pill" data-activity="${sub.activityLabel}">${sub.activityLabel}</span>
            </label>
        </div>`).join('');
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
const CORPUS_PER_QUERY = 60;      // posts requested per query (Reddit max page is 100)
const CORPUS_TIME_FILTER = 'year'; // recent + enough volume; 'all' would be broader but staler
const CORPUS_MIN_SCORE = 1;        // drop 0-score noise

function buildSubredditQuery(subreddits) {
    return subreddits.map(s => `subreddit:${s}`).join(' OR ');
}

// Consolidate the given terms into as few Reddit queries as possible (caps keep the request count
// low): single words in OR groups of 4 (max 8 words → 2 queries), plus up to 4 quoted phrases.
function buildProblemQueries(terms) {
    const single = (terms || []).filter(t => t && !/\s/.test(t)).slice(0, 8);
    const phrases = (terms || []).filter(t => t && /\s/.test(t)).slice(0, 4);
    const queries = [];
    for (let i = 0; i < single.length; i += 4) {
        const group = single.slice(i, i + 4);
        queries.push(group.length > 1 ? '(' + group.join(' OR ') + ')' : group[0]);
    }
    phrases.forEach(p => queries.push(`"${p}"`));
    return queries.length ? queries : ['(problem OR struggle OR advice)'];
}

// Ask the model for the audience's OWN complaint vocabulary so the corpus search surfaces real
// problem posts (not generic noise). Fails soft to the static terms.
async function getDomainFrustrationTerms(audience) {
    const fallback = PROBLEM_TERMS_SINGLE.concat(PROBLEM_TERMS_PHRASE);
    if (!audience) return fallback;
    try {
        const parsed = await callOpenAI({
            model: 'gpt-4o-mini',
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

// One Reddit search → array of post children. Fails soft to [].
async function fetchPostsForQuery(subredditQuery, searchTerm) {
    try {
        // Search calls are heavier than about-lookups (big OR query across many subreddits), so
        // give them more headroom than callReddit's 12s default — the proxy can take ~8s on Reddit
        // alone, and these were the calls aborting at 12s.
        const data = await callReddit({
            searchTerm,
            niche: subredditQuery,
            limit: CORPUS_PER_QUERY,
            timeFilter: CORPUS_TIME_FILTER,
            after: null
        }, { timeoutMs: 20000 });
        return (data && data.data && Array.isArray(data.data.children)) ? data.data.children : [];
    } catch (error) {
        console.warn(`[Corpus] query failed (${searchTerm}):`, error && error.message);
        return [];
    }
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
            permalink: d.permalink ? `https://reddit.com${d.permalink}` : ''
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
async function buildCorpus(subreddits, audience) {
    const subredditQuery = buildSubredditQuery(subreddits);
    const terms = await getDomainFrustrationTerms(audience);
    console.log('[Corpus] frustration terms:', terms);
    const queries = buildProblemQueries(terms);
    const batches = await Promise.all(queries.map(q => fetchPostsForQuery(subredditQuery, q)));
    const corpus = normalizeCorpus(dedupePosts(batches.flat()));
    rankByDensity(corpus);
    return corpus;
}

// =============================================================================
// FIREBASE CORPUS CACHE — repeat searches for the same audience skip Reddit entirely.
// All fail-soft: if Firebase isn't on the page or errors, we just fetch live as before.
// =============================================================================
const CORPUS_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;   // posts: re-fetch if >14 days old (content goes stale)
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

async function getCachedCorpus(audience) {
    const db = _firestore();
    if (!db) return null; // Firebase not configured — behave exactly as before
    try {
        const doc = await db.collection('corpora').doc(_audienceSlug(audience)).get();
        if (!doc.exists) return null;
        const data = doc.data() || {};
        if (!Array.isArray(data.posts) || !data.posts.length) return null;
        const ageMs = Date.now() - (data.updatedAt || 0);
        if (ageMs > CORPUS_CACHE_TTL_MS) { console.log(`[Cache] corpus for "${audience}" is stale (${Math.round(ageMs / 3600000)}h) — refetching`); return null; }
        return data.posts;
    } catch (e) { console.warn('[Cache] read failed (continuing live):', e && e.message); return null; }
}

async function setCachedCorpus(audience, posts) {
    const db = _firestore();
    if (!db || !posts || !posts.length) return;
    try {
        // Trim bodies so the document stays well under Firestore's 1MB limit.
        const lean = posts.slice(0, 220).map(p => ({
            id: p.id, subreddit: p.subreddit, title: p.title,
            body: (p.body || '').slice(0, 600),
            score: p.score, comments: p.comments, created: p.created, permalink: p.permalink
        }));
        await db.collection('corpora').doc(_audienceSlug(audience)).set({ audience, posts: lean, updatedAt: Date.now() });
        console.log(`[Cache] corpus SAVED for "${audience}" (${lean.length} posts)`);
    } catch (e) { console.warn('[Cache] write failed (ignored):', e && e.message); }
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
        return data.ranked;
    } catch (e) { console.warn('[Cache] subreddits read failed (continuing live):', e && e.message); return null; }
}
async function setCachedSubreddits(audience, ranked) {
    const db = _firestore();
    if (!db || !ranked || !ranked.length) return;
    try {
        await db.collection('subreddits').doc(_audienceSlug(audience)).set({ audience, ranked: ranked.slice(0, 40), updatedAt: Date.now() });
        console.log(`[Cache] communities SAVED for "${audience}" (${ranked.length})`);
    } catch (e) { console.warn('[Cache] subreddits write failed (ignored):', e && e.message); }
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
async function runProblemFinder() {
    if (_analysisRunning) {
        console.warn('[Analysis] already running — ignoring duplicate trigger.');
        return;
    }
    const subreddits = getSelectedSubreddits();
    if (!subreddits.length) { alert('Select at least one community to analyse.'); return; }

    _analysisRunning = true; // set synchronously, before any await, so concurrent calls bail here
    console.log('[Analysis] selected subreddits:', subreddits);
    auditTab1Elements(); // logs which Webflow elements actually exist, so we can fix any selector

    showLoader('Gathering discussions…');
    try {
        const audience = window.originalGroupName || '';
        // CACHE: serve a recent corpus from Firebase if we have one (skips Reddit entirely — the
        // scale/rate-limit risk). Falls through to a live fetch (and saves it) on a miss.
        let corpus = await getCachedCorpus(audience);
        if (corpus && corpus.length) {
            console.log(`[Analysis] cache HIT — using ${corpus.length} cached posts, skipped Reddit`);
        } else {
            corpus = await buildCorpus(subreddits, audience);
            setCachedCorpus(audience, corpus); // fire-and-forget save for the next searcher
        }
        window._corpus = corpus;
        window._analysisSubreddits = subreddits;
        window._tabLoaded = {}; // new search → invalidate cached tabs so they reload for this audience
        console.log(`[Analysis] corpus ready: ${corpus.length} posts`);
        if (!corpus.length) {
            alert('No discussions found for those communities. Try different ones.');
            return;
        }
        // Part 3 — Tab 1 ("Who they are"). All read from the corpus; nothing refetched.
        showLoader('Analysing audience…');
        // "insights" = total discussion signals mined (sum of comment counts). Flagged: tell me the
        // exact definition you want and I'll change this one line.
        const insightsCount = corpus.reduce((sum, p) => sum + (p.comments || 0), 0);
        renderTab1Counts(audience, corpus.length, insightsCount); // instant, from data we already have
        // The two AI panels run in parallel (2 OpenAI calls) so the tab fills as fast as possible.
        await Promise.all([
            generateAndRenderWho(corpus, audience),
            generateAndRenderArchetype(corpus, audience),
            generateAndRenderProfile(corpus, audience)
        ]);
        revealResults();
    } catch (error) {
        console.error('[Analysis] failed to build corpus:', error);
        alert('Something went wrong gathering discussions. Please try again.');
    } finally {
        hideLoader();
        _analysisRunning = false;
    }
}

// =============================================================================
// PART 3 — "Who they are": audience demographics, read straight from the corpus
// =============================================================================

// Self-contained, inline-styled block (matches the original dashboard look so it renders the same
// regardless of Webflow CSS). All values are guarded so a missing field can't break the layout.
function renderDemographicsHTML(d) {
    const n = (v) => (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.round(v)) : 0;
    const male = n(d.male_pct), female = n(d.female_pct);
    const a1 = n(d.age_18_24), a2 = n(d.age_25_45), a3 = n(d.age_45_plus);
    const lifeStage = (d.top_life_stage || '—').toString();
    return `
        <div style="background: transparent; padding: 24px; border-radius: 12px; border: 1px solid #333; color: white; font-family: sans-serif;">
            <h3 style="margin: 0 0 20px 0; font-size: 18px; color: #00a5ce;">Audience Demographics</h3>
            <div style="margin-bottom: 25px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px;">
                    <span>Male: <strong>${male}%</strong></span>
                    <span>Female: <strong>${female}%</strong></span>
                </div>
                <div style="width: 100%; height: 8px; background: #333; border-radius: 4px; display: flex; overflow: hidden;">
                    <div style="width: ${male}%; background: #00a5ce; height: 100%;"></div>
                    <div style="width: ${female}%; background: #fd80c7; height: 100%;"></div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px; text-align: center;">
                <div style="padding: 10px; border-radius: 8px;">
                    <div style="font-size: 11px; color: #888; text-transform: uppercase;">18-24</div>
                    <div style="font-size: 18px; font-weight: bold;">${a1}%</div>
                </div>
                <div style="padding: 10px; border-radius: 8px; border: 1px solid #00a5ce;">
                    <div style="font-size: 11px; color: #888; text-transform: uppercase;">25-45</div>
                    <div style="font-size: 18px; font-weight: bold;">${a2}%</div>
                </div>
                <div style="padding: 10px; border-radius: 8px;">
                    <div style="font-size: 11px; color: #888; text-transform: uppercase;">45+</div>
                    <div style="font-size: 18px; font-weight: bold;">${a3}%</div>
                </div>
            </div>
            <div style="border-top: 1px solid #333; padding-top: 15px; font-size: 14px;">
                <span style="color: #888;">Primary Life Stage:</span>
                <span style="margin-left: 5px; color: #00a5ce; font-weight: 500;">${lifeStage}</span>
            </div>
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
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a precise demographic estimator.' },
            { role: 'user', content: `Based on the language, slang, and life experiences in these Reddit posts for "${audience}", give a specific demographic estimate. You MUST provide numerical percentages — specific, even if estimated. Respond ONLY with a valid JSON object with these keys: "male_pct" (integer), "female_pct" (integer), "age_18_24" (integer), "age_25_45" (integer), "age_45_plus" (integer), "top_life_stage" (a 3-4 word string, e.g. "Young Professionals"). Text: ${sample}` }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
    };

    try {
        const parsed = await callOpenAI(payload);
        container.innerHTML = renderDemographicsHTML(parsed);
        console.log('[Who] demographics rendered:', parsed);
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

// Tab-1 count line — "[insights] insights found in [posts] posts" + the audience name. Logs how many
// elements each selector matched so a zero-match (wrong class) is obvious.
function renderTab1Counts(audience, postsCount, insightCount) {
    const set = (sel, val) => {
        const els = document.querySelectorAll(sel);
        console.log(`[Counts] "${sel}" matched ${els.length} element(s)`);
        els.forEach(el => { el.innerText = val; });
    };
    set('.count-audience', audience || '');
    set('.count-posts', Number(postsCount).toLocaleString());
    set('.count-insights, .count-insight', Number(insightCount).toLocaleString());
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
    if (descEl) descEl.textContent = '';

    const sample = corpus.slice(0, 20)
        .map(p => `Title: ${p.title}\nContent: ${p.body}`.substring(0, 450))
        .join('\n---\n');

    const payload = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a sharp cultural observer who writes psychologically specific field notes about online communities. You output only valid JSON and never sound like a marketing deck.' },
            { role: 'user', content: `You have spent months lurking inside the "${audience}" community on Reddit. Below are real discussions. Respond ONLY with a valid JSON object with these keys: "archetype" (a short, 2-3 word evocative name for this audience, e.g. "The Practical Innovators") and "summary" (EXACTLY 2 short sentences, 40 words maximum — a sharp character study built around one instinct or contradiction, landing one memorable phrase; do NOT use "this audience is driven by", "they value", or "they appreciate"). Posts:\n${sample}` }
        ],
        temperature: 0.6,
        max_completion_tokens: 300,
        response_format: { type: 'json_object' }
    };

    try {
        const parsed = await callOpenAI(payload);
        if (headingEl) headingEl.textContent = parsed.archetype || '';
        if (descEl) descEl.textContent = parsed.summary || '';
        console.log('[Archetype] rendered:', parsed.archetype);
    } catch (error) {
        console.error('[Archetype] failed:', error);
        if (headingEl) headingEl.textContent = 'Analysis Failed';
        if (descEl) descEl.textContent = 'Could not generate the audience summary. Please try again.';
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
        model: 'gpt-4o-mini',
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
    for (let i = 1; i <= 5; i++) { const b = document.getElementById('findings-block' + i); if (b) b.style.display = 'none'; }

    showLoader('Finding the core problems…');
    // Sample widely (60 posts) so the model sees the full RANGE of problems, not just the few densest
    // themes — this is what lets it name 4-6 genuinely distinct problems.
    const sample = corpus.slice(0, 60)
        .map(p => `Title: ${p.title}\nContent: ${p.body}`.substring(0, 400))
        .join('\n---\n');

    const payload = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You distil community discussions into a few core problems with authentic quotes. Output only valid JSON.' },
            { role: 'user', content: `Analyse these discussions about "${audience}" and identify 4 to 6 of the most common, clearly recurring, DISTINCT PROBLEMS — genuine pain points, frustrations, struggles, worries, or unmet needs. Make them genuinely different from each other (no near-duplicate or overlapping problems). IMPORTANT: include ONLY real problems/difficulties. Do NOT include positive or heart-warming themes, things they love or enjoy, or ways their dog helps them — e.g. "emotional support from dogs" is NOT a problem and must be excluded. Respond ONLY with a JSON object: {"findings":[{"title","summary","quotes","keywords","intensity"}]}. Rules — "title": 3-6 words naming a problem, plain and specific. "summary": ONE short, punchy, human-sounding sentence (about 18 words, 25 max), intriguing, NO waffle. Describe the problem directly — do NOT name the audience ("${audience}") in the summary. "quotes": exactly 3 short authentic-sounding strings that express the PROBLEM (a complaint or struggle, not praise), each ≤ 80 characters. "keywords": 3-6 lowercase words for matching related posts. "intensity": an integer 0-100 rating how emotionally severe/painful this problem is for ${audience}, judged INDEPENDENTLY of how often it comes up. Prioritise the most common recurring problems; avoid one-off complaints. Posts:\n${sample}` }
        ],
        temperature: 0.2,
        max_completion_tokens: 1400, // room for up to 6 findings
        seed: 11,
        response_format: { type: 'json_object' }
    };

    try {
        const parsed = await callOpenAI(payload);
        let findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        if (!findings.length) { console.warn('[Findings] none generated'); return; }

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
        console.log('[Findings] cards rendered (fast):', ranked.length, '| keyword support:', ranked.map(f => f.support));
        hideLoader(); // cards are visible now — the rest happens in the background

        // BACKGROUND: the accurate semantic assignment. When it lands we store the posts AND refine
        // each card's prevalence bar so it matches the real supporting-post counts. .see-more awaits this.
        window._assignmentPromise = assignPostsToFindings(ranked, corpus)
            .then(buckets => {
                ranked.forEach((f, i) => { f._posts = buckets[i] || []; f.support = (buckets[i] || []).length; });
                // Re-sort by REAL support so cards display highest → lowest prevalence, then re-render
                // every card in the new order (the per-block colours stay; only the content moves).
                ranked.sort((a, b) => b.support - a.support);
                const totalShown = ranked.reduce((s, f) => s + f.support, 0) || 1;
                ranked.forEach((f, idx) => {
                    f.prevalence = Math.round((f.support / totalShown) * 100);
                    renderFindingCard(idx + 1, f);
                });
                window._findings = ranked;
                window._findingPosts = ranked.map(f => (f._posts || []).slice(0, 8));
                window._findingPostsFull = ranked.map(f => f._posts || []);
                renderBubbleGuide(ranked); // keep the polarity legend in sync if already shown
                console.log('[Findings] background done | order:', ranked.map(f => `${f.title} ${f.prevalence}%`));
            })
            .catch(e => {
                console.warn('[Findings] assignment failed — keyword posts:', e && e.message);
                const kw = assignPostsByKeyword(ranked, corpus);
                window._findingPosts = kw.map(arr => arr.slice(0, 8));
                window._findingPostsFull = kw;
            });
    } catch (error) {
        console.error('[Findings] failed:', error);
    } finally {
        hideLoader();
    }
}

// Run a tab's work once, only after the corpus exists; cache so re-clicks are instant.
function _runTabOnce(key, fn) {
    if (!window._tabLoaded) window._tabLoaded = {};
    if (window._tabLoaded[key]) return;
    if (!window._corpus || !window._corpus.length) {
        console.warn(`[Tab ${key}] corpus not ready — run a search first.`);
        return;
    }
    window._tabLoaded[key] = true;
    Promise.resolve(fn(window._corpus, window.originalGroupName || ''))
        .catch(e => { console.warn(`[Tab ${key}] failed`, e); window._tabLoaded[key] = false; });
}

function loadTabHurts() {
    _runTabOnce('hurts', (corpus, audience) => generateAndRenderFindings(corpus, audience));
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
    const finding = (window._findings || [])[blockIndex - 1];

    const header = modal.querySelector('.reddit-samples-header');
    if (header) {
        const block = document.getElementById('findings-block' + blockIndex);
        const fallback = block && block.querySelector('.section-title') ? block.querySelector('.section-title').textContent : '';
        header.textContent = (finding && finding.title) || fallback;
    }

    modal.style.display = 'flex'; // open first so the chart has a measurable width

    // Subproblems don't need the assignment — they fall back to keyword-matched posts, so fire now.
    const chartEl = modal.querySelector('.subproblem-chart');
    if (chartEl && finding) renderSubproblemsInto(chartEl, finding, blockIndex);

    // Posts come from the background assignment. If it hasn't finished, show an inline loader and wait.
    const postsContainer = modal.querySelector('.reddit-samples-posts');
    if (!window._findingPosts && window._assignmentPromise) {
        if (postsContainer) postsContainer.innerHTML = '<p class="loading-text">Matching the most relevant discussions…</p>';
        try { await window._assignmentPromise; } catch (e) { /* fallback already set in the catch */ }
    }
    renderFindingPosts(modal, blockIndex, finding);
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

// PRIMARY: let the model decide which problem each post genuinely belongs to (or NONE). This is
// semantic, so it catches things keywords can't — a heart-warming post won't land under "Health",
// and off-topic/positive/rescue posts get dropped. Falls back to keyword matching on failure.
async function assignPostsToFindings(findings, corpus) {
    // Drop near-empty / photo posts, then take a LARGE density-ranked candidate set so every real
    // problem can gather lots of posts (this pool drives both the modal posts AND prevalence).
    const candidates = dedupeByTitle(corpus)
        .filter(p => ((p.title || '').length + (p.body || '').length) >= 80)
        .slice(0, 120);
    const buckets = findings.map(() => []);
    try {
        const problemList = findings.map((f, i) => `${i + 1}: ${f.title} — ${f.summary || ''}`).join('\n');
        const postList = candidates.map((p, i) => `${i + 1}: "${(p.title || '').slice(0, 120)}" — ${(p.body || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
        const prompt = `You are matching Reddit posts to the problem each one is genuinely about.\n\nProblems:\n${problemList}\n\nPosts:\n${postList}\n\nFor each post, give the number of the SINGLE problem the AUTHOR is actually describing, experiencing, or asking for help with. Use 0 (none) if it does not clearly belong to any problem — this INCLUDES positive or heart-warming stories, rescue/adoption pleas, "help me name my dog", breed-identification requests, photo/picture posts, and anything off-topic. Be STRICT: when in doubt, use 0. Respond ONLY with JSON: {"assignments":[{"post":1,"problem":2}]}.`;
        const parsed = await callOpenAI({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a precise categorisation engine that outputs only JSON. You err on the side of 0 (none) rather than forcing a weak match.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0, max_completion_tokens: 2500, response_format: { type: 'json_object' }
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

    const texts = (posts || []).map(p => `${p.title} ${p.body}`.toLowerCase());
    const corpusText = (posts || []).slice(0, 40).map(p => `${p.title} ${(p.body || '').substring(0, 300)}`.trim()).join('\n---\n');

    const payload = {
        model: 'gpt-4o-mini',
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

    const size = texts.length || 1;
    const countMentions = (keywords) => {
        let n = 0;
        for (const t of texts) {
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

// Make sure findings exist before the map needs them (in case Polarity is opened first).
function ensureFindings() {
    if (window._findings && window._findings.length) return Promise.resolve(window._findings);
    if (!window._corpus || !window._corpus.length) return Promise.resolve([]);
    return generateAndRenderFindings(window._corpus, window.originalGroupName || '').then(() => window._findings || []);
}

// Shared palette: bubble colour for parent problem i == legend swatch for finding i.
const PARENT_PALETTE = ['#6C5CE7', '#00A5CE', '#E84393', '#0984E3', '#00B894', '#FDCB6E'];

function _escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Subtle legend in #bubble-guide: a coloured dot per finding so users know which card each bubble
// colour ties to. Dots carry the palette colour; the label text inherits #bubble-guide's own colour
// (style it in Webflow).
function renderBubbleGuide(findings) {
    const el = document.getElementById('bubble-guide');
    if (!el) return;
    el.innerHTML = (findings || []).map((f, i) => `
        <span style="display:inline-flex;align-items:center;gap:6px;margin:0 14px 6px 0;font-size:12px;line-height:1.2;color:#ffffff;">
            <span style="width:11px;height:11px;border-radius:50%;flex:0 0 auto;background:${PARENT_PALETTE[i % PARENT_PALETTE.length]};border:1px solid rgba(255,255,255,0.6);"></span>
            ${_escapeHtml(f.title || '')}
        </span>`).join('');
}

// Richer map WITHOUT contradicting the cards: one call breaks the SAME findings into their concrete
// sub-problems (frequency × intensity, both 1-100), so every point is a facet of a card's problem —
// honest and consistent, just finer-grained. Falls back to the findings themselves if it fails.
async function generatePolarityData(findings, corpus, audience) {
    const main = (findings || []).map((f, i) => `${i + 1}: ${f.title}`).join('\n');
    const sample = (corpus || []).slice(0, 30).map(p => `${p.title} ${p.body}`.substring(0, 220)).join('\n---\n');
    try {
        const parsed = await callOpenAI({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You output only valid JSON.' },
                { role: 'user', content: `For "${audience}", the main problems are:\n${main}\n\nUsing these and the discussions below, produce 12-16 specific problems this audience faces. They MUST be facets/sub-problems OF the main problems above — do not invent unrelated ones. For each: "label" (2-5 words), "parent" (the number of the main problem it belongs to), "frequency" (integer 1-100 = how often it comes up), "intensity" (integer 1-100 = how painful/severe). Respond ONLY with JSON: {"points":[{"label","parent","frequency","intensity"}]}. Discussions:\n${sample}` }
            ],
            temperature: 0.3, max_completion_tokens: 900, response_format: { type: 'json_object' }
        });
        const pts = Array.isArray(parsed.points) ? parsed.points : [];
        const clean = pts.map(p => ({
            label: String(p.label || '').trim(),
            parent: (parseInt(p.parent, 10) || 1),
            x: Math.max(0, Math.min(100, Math.round(Number(p.frequency) || 0))),
            y: Math.max(0, Math.min(100, Math.round(Number(p.intensity) || 0)))
        })).filter(p => p.label && (p.x > 0 || p.y > 0));
        return clean.length >= 3 ? clean : null;
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

function loadPolarityMap() {
    _runTabOnce('polarity', async () => {
        const findings = await ensureFindings();
        let points = await generatePolarityData(findings, window._corpus || [], window.originalGroupName || '');
        if (!points) { // fallback to the findings themselves
            points = (findings || []).filter(f => typeof f.intensity === 'number')
                .map((f, i) => ({ label: f.title, parent: i + 1, x: Math.round(f.prevalence || 0), y: Math.round(f.intensity || 0) }));
        }
        renderPolarityMap(points);
        renderBubbleGuide(findings); // legend below the map
    });
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
    // Tell us whether the demographics panel is actually on screen now (and if not, what's hiding it).
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

// Reverse of transitionToStep2 — back to the search-term entry step.
function transitionToStep1() {
    const welcome = document.getElementById('welcome-div');
    const step1 = document.getElementById('step-1-container');
    const step2 = document.getElementById('subreddit-selection-container');
    if (step2) step2.classList.remove('visible');
    if (step1) step1.classList.remove('hidden');
    if (welcome) welcome.style.display = ''; // restore Webflow's default (visible)
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
            const gi = document.getElementById('group-input');
            if (gi) gi.value = pill.getAttribute('data-value');
            findBtn.click();
        });
    }

    // Look up #group-input / #subreddit-choices at CLICK time (not now) so it doesn't matter
    // whether they exist yet when the button is first wired.
    findBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('[Entry] find-communities-btn clicked');
        const groupInput = document.getElementById('group-input');
        const choices = document.getElementById('subreddit-choices');
        const groupName = (groupInput && groupInput.value.trim()) || '';
        if (!groupName) { alert('Please enter a group of people or pick a suggestion.'); return; }
        if (!choices) { console.error('[Entry] #subreddit-choices not found — nowhere to show results.'); return; }

        window.originalGroupName = groupName;
        transitionToStep2(groupName); // reveal the step-2 panel so the results are actually visible
        findBtn.disabled = true;
        choices.innerHTML = '<p class="loading-text">Finding communities…</p>';
        try {
            // CACHE: reuse a recent ranked-communities list for this audience (skips ~20 Reddit
            // lookups + 2 OpenAI calls). Falls through to live discovery (and saves it) on a miss.
            let ranked = await getCachedSubreddits(groupName);
            if (ranked && ranked.length) {
                console.log(`[Cache] communities HIT for "${groupName}" — skipped AI + Reddit`);
            } else {
                const names = await findSubredditsForGroup(groupName);
                console.log('[Entry] candidate subreddits:', names);
                ranked = await fetchAndRankSubreddits(names);
                setCachedSubreddits(groupName, ranked); // fire-and-forget save
            }
            console.log('[Entry] ranked subreddits:', ranked.length);
            renderSubredditChoices(ranked);
        } catch (error) {
            console.error('[Entry] find communities failed:', error);
            choices.innerHTML = '<p class="error-message">Could not load communities. Please try again.</p>';
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

    // #tab-hurts → lazy-load tab 2 (findings) on first open. Cached after that.
    const hurtsTab = document.getElementById('tab-hurts');
    if (hurtsTab && !hurtsTab.dataset.ppWired) {
        hurtsTab.dataset.ppWired = '1';
        hurtsTab.addEventListener('click', loadTabHurts);
    }

    // #polarity-tab → lazy-load the polarity map on first open.
    const polarityTab = document.getElementById('polarity-tab');
    if (polarityTab && !polarityTab.dataset.ppWired) {
        polarityTab.dataset.ppWired = '1';
        polarityTab.addEventListener('click', loadPolarityMap);
    }

    console.log('[Entry] wired ✓ — #find-communities-btn is live');
}

// Safety net: delegated click handlers so these buttons work even if Webflow renders them after
// init. Each is guarded by dataset.ppWired so it never double-fires with the direct listeners.
document.addEventListener('click', (e) => {
    const searchBtn = e.target.closest('#search-selected-btn');
    if (searchBtn && !searchBtn.dataset.ppWired) { e.preventDefault(); runProblemFinder(); return; }
    const backBtn = e.target.closest('#back-to-step1-btn');
    if (backBtn && !backBtn.dataset.ppWired) { e.preventDefault(); transitionToStep1(); return; }
    const hurtsTab = e.target.closest('#tab-hurts');
    if (hurtsTab && !hurtsTab.dataset.ppWired) { loadTabHurts(); return; } // don't preventDefault — let Webflow switch the tab
    const polTab = e.target.closest('#polarity-tab');
    if (polTab && !polTab.dataset.ppWired) { loadPolarityMap(); return; }

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
