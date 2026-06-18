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

console.log('%c[problem-pulse-v2] BUILD 57 — corpus comment-enrichment (top 20 posts, background + Firestore-cached) feeding the Where charts for accurate platform/location/media readings', 'color:#00a5ce;font-weight:bold');

const suggestions = ['Dog Owners', 'New Parents', 'Home Bakers', 'Freelance Designers', 'Runners', 'Houseplant Lovers'];

// --- proxy helpers ----------------------------------------------------------
// Shared OpenAI concurrency gate. We fire a LOT of AI calls (findings + 5 talk panels + sub-problems
// + polarity), and bursting them all at once overloads the single Netlify function — the slow ones
// then time out and come back WITHOUT the CORS header, which the browser reports as a CORS error.
// Capping concurrency + retrying transient failures makes that self-heal.
const OPENAI_MAX_CONCURRENT = 3;
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

async function callOpenAI(payload, { timeoutMs = 45000, retries = 2 } = {}) {
    await _acquireOpenAISlot();
    try {
        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await _callOpenAIOnce(payload, timeoutMs);
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
    // Dedupe by name (case-insensitive) so the same community can't appear twice — duplicates were
    // causing colliding checkbox ids (clicking one toggled the one beside it).
    const seen = new Set();
    subs = subs.filter(s => {
        const k = (s.name || '').toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
    });

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
    // Cap the subreddit OR-query: Reddit search silently returns NOTHING when there are too many
    // "subreddit:" filters (this is why 19-subreddit audiences came back with 0 posts). The top ~12
    // by membership cover the bulk of the discussion.
    const searchSubs = subreddits.slice(0, 12);
    const subredditQuery = buildSubredditQuery(searchSubs);
    const terms = await getDomainFrustrationTerms(audience);
    console.log('[Corpus] frustration terms:', terms, `| searching ${searchSubs.length}/${subreddits.length} subreddits`);

    const queries = buildProblemQueries(terms);
    let batches = await Promise.all(queries.map(q => fetchPostsForQuery(subredditQuery, q)));
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
            commentsText: (p.commentsText || '').slice(0, 1500), // top-comment text (Where-tab signal)
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

async function runProblemFinder() {
    if (_analysisRunning) {
        console.warn('[Analysis] already running — ignoring duplicate trigger.');
        return;
    }
    const subreddits = getSelectedSubreddits();
    if (!subreddits.length) { showMessage('Select at least one community to analyse.'); return; }

    // Thin-data warning: a single small community rarely has enough discussion for rich insights.
    if (subreddits.length === 1) {
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
        // Did the user customise the selection (uncheck some communities)? If so, the corpus is a
        // bespoke subset — DON'T serve the cached full-audience corpus, and DON'T save this one
        // (it isn't the canonical mapping). Only the default full selection uses/writes the cache.
        const fullSet = window._allRankedSubredditNames || [];
        const isCustomised = fullSet.length > 0 && subreddits.length < fullSet.length;

        let corpus = isCustomised ? null : await getCachedCorpus(audience);
        if (corpus && corpus.length) {
            console.log(`[Analysis] cache HIT — using ${corpus.length} cached posts, skipped Reddit`);
        } else {
            corpus = await buildCorpus(subreddits, audience);
            if (isCustomised) console.log('[Analysis] customised selection — corpus NOT cached');
        }
        window._corpus = corpus;
        // BACKGROUND comment enrichment for the Where tab (doesn't block Tab 1). Only fetches when the
        // corpus lacks comment text (fresh build, or an older cache from before this feature). We write
        // the cache AFTER enrichment so the stored corpus is the rich one (skipped for customised sets).
        const _needsComments = corpus.some(p => !p.commentsText);
        window._corpusEnrichedPromise = (async () => {
            if (!_needsComments) return;
            try { await enrichCorpusWithComments(corpus); } catch (e) { console.warn('[Comments] enrichment failed', e); }
            if (!isCustomised) setCachedCorpus(audience, corpus); // fire-and-forget save for the next searcher
        })();
        window._analysisSubreddits = subreddits;
        // New search → clear everything tab-related so it regenerates for this audience.
        window._tabLoaded = {};
        window._findings = null; window._findingsPromise = null; window._assignmentPromise = null;
        window._findingPosts = null; window._findingPostsFull = null; window._polarityPromise = null;
        window._talkPromise = null; // Tab 3 regenerates for the new audience
        window._wherePromise = null; window._platformPanelsRendered = false; // Tab 4 regenerates too
        window._corpusEnrichedPromise = null; // re-enrich comments for the new audience
        if (window._polarityChart && window._polarityChart.destroy) { window._polarityChart.destroy(); window._polarityChart = null; }
        console.log(`[Analysis] corpus ready: ${corpus.length} posts`);
        if (!corpus.length) {
            showMessage('No discussions found for those communities. Try different ones.');
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
        // Pre-warm Tab 2 (findings + post assignment) and the polarity map in the background while
        // the user reads Tab 1, so switching to those tabs is near-instant. No Reddit here, so it's
        // safe to run quietly. A small delay lets Tab 1's render settle first.
        // STAGGERED pre-fetch: firing all four tabs at once bursts ~12 OpenAI calls at the proxy and
        // the slow ones 504. We spread them out — findings + polarity first (the primary insights),
        // then talk, then where — so the proxy/OpenAI never sees the whole herd at once.
        setTimeout(() => { try { loadTabHurts(); loadPolarityMap(); } catch (e) { /* non-fatal */ } }, 400);
        setTimeout(() => { try { loadTabTalk(); } catch (e) { /* non-fatal */ } }, 2500);
        setTimeout(() => { try { loadTabWhere(); } catch (e) { /* non-fatal */ } }, 5000);
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
            { role: 'user', content: `Estimate the demographics of the audience "${audience}" using BOTH the audience name and the language/slang/life-experiences in these Reddit posts. CRITICAL: if the audience name itself explicitly implies a gender, age, or life stage, let that strongly anchor the estimate — e.g. "Women in Business" or "New Moms" → ~90-100% female; "New Dads" → ~90-100% male; "Retirees" → mostly 45+; "Teen ..." → mostly 18-24. Only deviate from an explicit cue if the posts clearly contradict it. You MUST provide numerical percentages. Respond ONLY with a valid JSON object: "male_pct" (integer), "female_pct" (integer), "age_18_24" (integer), "age_25_45" (integer), "age_45_plus" (integer), "top_life_stage" (a 3-4 word string, e.g. "Young Professionals"). Text: ${sample}` }
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
        window._assignmentPromise = assignPostsToFindings(ranked, corpus)
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
                topUpFindingPosts(ranked, corpus, 6, 8);
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
        if (!points) { // fallback to the findings themselves
            points = (findings || []).filter(f => typeof f.intensity === 'number')
                .map((f, i) => ({ label: f.title, parent: i + 1, x: Math.round(f.prevalence || 0), y: Math.round(f.intensity || 0) }));
        }
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
            model: 'gpt-4o-mini',
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
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a brand psychologist who outputs only valid JSON.' },
                { role: 'user', content: `Analyse the "${audience}" community. Identify 4 distinct conversation topics. For each: "topic" (short title), "traits" (array of 4 objects, each {"name": adjective, "score": integer 10-100 intensity}), "insights" (array of EXACTLY 3 standalone sentences, each under 15 words, one observation each), "level" (LOW, MEDIUM, or HIGH). Respond ONLY as valid JSON where the value of key "tone_analysis" is a JSON ARRAY of exactly 4 such objects (not an object). Posts: ${sample}` }
            ],
            temperature: 0.2, max_completion_tokens: 1200, response_format: { type: 'json_object' }
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
            model: 'gpt-4o-mini',
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
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a content strategist. You are brief and punchy. Output only valid JSON.' },
                { role: 'user', content: `Analyse these top posts for "${audience}". Identify 4-6 modern hook patterns. Respond ONLY as valid JSON with key "patterns", each object: "category" (hook name), "short_summary" (≤10 words), "strategy" (≤20 words on why it works), "example_ids" (array of 3 post IDs from the list), "emotion_type" (a SHORT 2-3 word emotional driver, unique to this pattern; use "&" instead of "and"), "impact_level" (exactly one of "Very High Impact","High Impact","Medium Impact"), "emotional_intensity" (integer 0-100), "viral_potential" (integer 0-100), "community_impact" (one of "Very High","High","Medium","Low"). Posts:\n${listForAI}` }
            ],
            temperature: 0.1, max_completion_tokens: 1200, response_format: { type: 'json_object' }
        });
        wrapper.innerHTML = '';
        (parsed.patterns || []).forEach(pattern => {
            const card = window._hookCardBlueprint.cloneNode(true);
            card.style.removeProperty('display');
            const set = (sel, val) => { const e = card.querySelector(sel); if (e) e.innerText = val; };
            set('.hook-category', pattern.category || '');
            set('.hook-why', pattern.short_summary || '');
            set('.why-reason', pattern.strategy || '');
            set('.emotion-hook', (pattern.emotion_type || '').replace(/\s+and\s+/gi, ' & ')); // enforce "&"
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
    const list = (items || []).filter(it => it && it.term);
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
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a market-research sentiment analyst. Output only valid JSON.' },
                { role: 'user', content: `From these "${audience}" discussions, extract the language that carries clear sentiment. Respond ONLY as valid JSON: {"positive":[{"term":"...","weight":1-10}], "negative":[{"term":"...","weight":1-10}], "positive_pct": <integer 0-100, the overall share of positive vs negative sentiment>}. Give 15-22 items each for positive and negative — use the audience's ACTUAL words and short phrases (2-4 words), not generic labels; weight = how common/strong it is. Posts:\n${sample}` }
            ],
            temperature: 0.2, max_completion_tokens: 1100, response_format: { type: 'json_object' }
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

async function enrichCorpusWithComments(corpus, topN = 20) {
    if (!corpus || !corpus.length) return corpus;
    const targets = corpus
        .filter(p => p.id && (p.comments || 0) > 0 && !p.commentsText)
        .sort((a, b) => ((b.score || 0) + (b.comments || 0)) - ((a.score || 0) + (a.comments || 0)))
        .slice(0, topN);
    await Promise.all(targets.map(async p => {
        const bodies = await fetchPostComments(p.id);
        if (bodies.length) p.commentsText = pruneText(bodies.join(' ')).slice(0, 1500);
    }));
    console.log(`[Comments] enriched ${targets.filter(p => p.commentsText).length}/${targets.length} top posts`);
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
            model: 'gpt-4o-mini',
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
        { name: 'Instagram', color: '#FF6FB5', keys: ['instagram', 'insta', 'reels'] },
        { name: 'TikTok', color: '#36E0D0', keys: ['tiktok', 'tik tok'] },
        { name: 'YouTube', color: '#FF8C66', keys: ['youtube'] },
        { name: 'Facebook', color: '#6C8CFF', keys: ['facebook', 'fb group', 'fb groups'] },
        { name: 'X / Twitter', color: '#7CC7FF', keys: ['twitter', 'tweet', 'x.com'] },
        { name: 'Discord', color: '#8B7CFF', keys: ['discord'] },
        { name: 'Telegram', color: '#5ED1D8', keys: ['telegram'] },
        { name: 'WhatsApp', color: '#57D9A3', keys: ['whatsapp', 'whats app'] },
        { name: 'Snapchat', color: '#FFD56B', keys: ['snapchat'] },
        { name: 'Pinterest', color: '#FF8FA3', keys: ['pinterest'] },
        { name: 'LinkedIn', color: '#5B9BD5', keys: ['linkedin'] }
    ];
    const fullText = texts.join(' \n ');
    const countKeys = (keys) => {
        const pat = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|');
        const m = fullText.match(new RegExp('\\b(' + pat + ')\\b', 'gi'));
        return m ? m.length : 0;
    };
    let data = PLATFORMS.map(pl => ({ name: pl.name, color: pl.color, count: countKeys(pl.keys) }))
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
    const LOC_INTENT = "(?:i'?m|i am|we'?re|we are)\\s+(?:from|in|living\\s+in|based\\s+in|located\\s+in)|live\\s+in|living\\s+in|based\\s+in|located\\s+in|here\\s+in|from";
    const countStrong = (keys) => { const pat = keys.map(esc).join('|'); const m = fullText.match(new RegExp('\\b(?:' + LOC_INTENT + ')\\s+(?:the\\s+)?(' + pat + ')\\b', 'gi')); return m ? m.length : 0; };
    let data = COUNTRIES.map(c => {
        const mentions = countKeys(c.keys), strong = countStrong(c.keys);
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
        ? `Weighted toward stated location — ${strongTotal} explicit "I'm based in…" phrase${strongTotal === 1 ? '' : 's'} found among ${grandTotal} country mentions, and counted more heavily.`
        : `Based on ${grandTotal} country/region mentions. No explicit "I'm based in…" phrases were found, so this reflects countries discussed rather than confirmed residence.`;
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

// --- Shared engine for the named-entity panels (experts / tools / events) ----
// All three: filter corpus by signal → sample → AI extract → ground against the
// corpus → top up with labelled AI suggestions if thin → render self-contained HTML.
async function _renderWhereEntityPanel(corpus, audience, cfg) {
    const el = document.getElementById(cfg.elId);
    if (!el) return;
    if ((corpus || []).length < 5) return;
    el.innerHTML = `<p class="loading-text" style="text-align:center; color:#9ca3af; padding:1rem;">${cfg.loading}</p>`;
    let pool = corpus.filter(p => cfg.signal.test(_whereTextOf(p)));
    if (pool.length < 15) pool = corpus.slice();
    const stableId = p => String(p.id || '');
    const sample = pool.sort((a, b) => ((b.score || 0) - (a.score || 0)) || (stableId(a) < stableId(b) ? -1 : 1))
        .slice(0, 70).map((p, i) => `[${i}] ${_whereTextOf(p).replace(/\s+/g, ' ').slice(0, 450)}`).join('\n');
    let parsed = [];
    try {
        const data = await callOpenAI({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: cfg.system }, { role: 'user', content: cfg.prompt(audience, sample) }],
            temperature: 0.1, max_completion_tokens: 700, response_format: { type: 'json_object' }
        });
        parsed = data[cfg.key] || [];
    } catch (e) { console.warn(`[Where/${cfg.elId}] extraction failed:`, e && e.message); }
    const segments = corpus.map(p => _whereTextOf(p).toLowerCase());
    const audienceTokens = new Set(String(audience || '').toLowerCase().split(/\s+/).filter(Boolean));
    const seen = new Set(); const items = [];
    (parsed || []).forEach(w => {
        if (!w || !w.name) return;
        const name = String(w.name).trim(); const key = name.toLowerCase();
        const minLen = cfg.minLen || 3;
        if (seen.has(key) || key.length < minLen) return;
        const tokens = key.split(/\s+/).filter(Boolean);
        if (minLen >= 4 && tokens.length === 1 && key.length < 5) return;
        if (tokens.every(t => audienceTokens.has(t))) return;
        const { total, contextHits } = countNameInContext(key, segments, cfg.context);
        if (total === 0) return;
        if (contextHits === 0 && total < 2) return;
        seen.add(key);
        items.push({ name, sub: (w[cfg.subKey] || '').trim(), count: total, strong: contextHits });
    });
    items.sort((a, b) => (b.strong - a.strong) || (b.count - a.count));
    let top = items.slice(0, 8).map(it => ({ ...it, suggested: false }));
    if (top.length < 4) {
        const have = new Set(top.map(it => it.name.toLowerCase()));
        const suggestions = await aiSuggestEntities(audience, cfg.suggest, [...have], 6 - top.length);
        suggestions.forEach(s => {
            if (!s || !s.name) return;
            const nm = String(s.name).trim();
            if (!nm || have.has(nm.toLowerCase())) return;
            have.add(nm.toLowerCase());
            top.push({ name: nm, sub: (s.note || '').trim(), count: 0, strong: 0, suggested: true });
        });
    }
    if (!top.length) { el.innerHTML = `<p class="placeholder-text" style="text-align:center; color:#9ca3af; padding:1rem;">${cfg.empty}</p>`; return; }
    const radius = cfg.round ? '50%' : '9px';
    const sBadge = `<span style="flex:0 0 auto; font-size:0.68rem; font-weight:700; color:${cfg.accent}; background:${cfg.accentBg}; padding:2px 8px; border-radius:999px;">Suggested</span>`;
    el.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:10px; font-family:'Plus Jakarta Sans', system-ui, sans-serif;">
        ${top.map(it => `
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="flex:0 0 34px; height:34px; border-radius:${radius}; background:${cfg.accentBg}; color:${cfg.accent}; font-weight:800; display:flex; align-items:center; justify-content:center; font-size:0.82rem;">${(it.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || '?').toUpperCase()}</span>
            <div style="flex:1; min-width:0;">
              <div style="font-size:0.98rem; font-weight:700; color:#1f2937;">${_escapeHtml(it.name)}</div>
              ${it.sub ? `<div style="font-size:0.8rem; color:#6b7280;">${_escapeHtml(it.sub)}</div>` : ''}
            </div>
            ${it.suggested ? sBadge : `<span style="flex:0 0 auto; font-size:0.68rem; font-weight:700; color:#6b7280; background:rgba(0,0,0,0.06); padding:2px 8px; border-radius:999px;">Mentioned ${it.count} ${it.count === 1 ? 'time' : 'times'}</span>`}
          </div>`).join('')}
        ${top.some(it => it.suggested) ? `<p style="margin:8px 0 0; font-size:0.72rem; color:#9ca3af;">“Suggested” entries are common for this audience, added by AI because few were explicitly named — not verified mentions.</p>` : ''}
      </div>`;
}

// --- 4) EXPERTS / influencers (#thought-leaders) ----------------------------
function generateAndRenderExperts(corpus, audience) {
    return _renderWhereEntityPanel(corpus, audience, {
        elId: 'thought-leaders', key: 'people', subKey: 'role', minLen: 4, round: true,
        accent: '#7C5CFF', accentBg: 'rgba(124,92,255,0.12)',
        loading: 'Finding the people they follow…',
        empty: 'No influencers, creators or channels were clearly named in these discussions.',
        signal: /\b(recommend|recommends|recommended|follow|following|read|reading|author|wrote|writes|expert|guru|coach|mentor|trainer|trainers|vet|vets|behaviou?rist|breeder|listen|listening|interview|influencer|creator|podcast|channel|youtube|video|videos|account|method|book|books)\b/i,
        context: /\b(recommend|recommends|recommended|follow|following|watch|watching|subscribe|subscribed|guru|coach|mentor|expert|trainer|trainers|vet|vets|behaviou?rist|breeder|advice|teaches|taught|course|method|channel|video|videos|account|page|insta|instagram|tiktok|youtube|podcast|interview|influencer|creator|author|wrote)\b/i,
        system: 'You extract only explicitly-named people, content creators, channels and social accounts that an audience follows or references. You never invent names or roles, and you output only valid JSON.',
        prompt: (a, s) => `From these "${a}" discussions, extract the INFLUENCERS and PEOPLE this audience follows, watches, recommends, or cites — including content creators, YouTubers, TikTokers, Instagram accounts, podcast hosts, named channels, coaches, authors, experts and well-known figures in this space.
For each return:
- "name": the real name, channel name, or @handle exactly as commonly written. Never a description or a generic role.
- "role": a SHORT phrase for who they are / their platform, ONLY if clear from context; otherwise "".
RULES: Only real, clearly-named people, creators or channels actually referenced by this audience. NEVER invent names or roles. Do not return the audience's own anonymous usernames, generic role words, or product/company brands that aren't a creator or personality. If none are clearly named, return an empty list.
Discussions:
${s}
Respond ONLY with JSON: {"people":[{"name":"...","role":"..."}]}`,
        suggest: { what: 'influencers, content creators and channels (YouTubers, TikTok / Instagram creators, well-known coaches or experts)', verb: 'follows, watches or learns from', examples: 'Give actual names or @handles people in this space would recognise.' }
    });
}

// --- 5) TOOLS & apps (#tools-apps) ------------------------------------------
function generateAndRenderTools(corpus, audience) {
    return _renderWhereEntityPanel(corpus, audience, {
        elId: 'tools-apps', key: 'tools', subKey: 'use', minLen: 3, round: false,
        accent: '#00a5ce', accentBg: 'rgba(0,165,206,0.14)',
        loading: 'Finding the apps & tools they use…',
        empty: 'No specific apps, tools or websites were clearly named in these discussions.',
        signal: /\b(app|apps|website|websites|site|online|tool|tools|software|platform|use|using|used|tried|subscription|subscribe|account|sign up|signed up|download|downloaded|login|log in|switched)\b|\.(com|io|app|net|org)\b/i,
        context: /\b(use|using|used|app|website|site|online|tool|software|platform|switch|switched|tried|recommend|subscription|subscribe|download|downloaded|account|sign up|signed up|login|log in|workflow|setup|set up|plugin|integration|dashboard)\b/i,
        system: 'You extract only explicitly-named apps, websites, online services, software and digital tools that an audience uses. You never invent names, never return physical products/gear/food/clothing or generic categories, and you output only valid JSON.',
        prompt: (a, s) => `From these "${a}" discussions, extract the real APPS, WEBSITES, online SERVICES, SOFTWARE and digital TOOLS this audience actually uses (e.g. an app like Rover, software like Notion, a website like Chewy, a platform like YouTube).
For each return:
- "name": the real app / website / tool name exactly as commonly written. A real proper name — never a generic category, an activity, or a description.
- "use": a SHORT phrase for what it is / what they use it for, ONLY if clear from context; otherwise "".
RULES: Only real, clearly-named apps, websites, online services or software actually referenced by this audience. NEVER invent names. Do NOT return PHYSICAL products, gear, food, supplements or clothing, nor generic categories or personal names. If none are clearly named, return an empty list.
Discussions:
${s}
Respond ONLY with JSON: {"tools":[{"name":"...","use":"..."}]}`,
        suggest: { what: 'apps, websites, online services and digital tools', verb: 'uses', examples: 'Real app / website / software names only (no physical products).' }
    });
}

// --- 6) EVENTS & places (#events-places) ------------------------------------
function generateAndRenderEvents(corpus, audience) {
    return _renderWhereEntityPanel(corpus, audience, {
        elId: 'events-places', key: 'events', subKey: 'what', minLen: 3, round: false,
        accent: '#00a5ce', accentBg: 'rgba(0,165,206,0.14)',
        loading: 'Finding where they go in the real world…',
        empty: 'No specific events or places were clearly named in these discussions.',
        signal: /\b(attend|attended|attending|went|going|visit|visited|store|stores|shop|shops|park|parks|trail|trails|club|clubs|facility|center|centre|clinic|vet|daycare|kennel|conference|convention|expo|meetup|meet up|show|shows|festival|workshop|class|classes|competition|trial|trials|seminar|event|events|fair|venue|near me|local|location)\b/i,
        context: /\b(attend|attended|attending|went|going|visit|visited|go|take|took|drove|near|nearby|local|store|shop|shopping|bought|buy|park|parks|trail|club|facility|center|centre|clinic|vet|daycare|kennel|conference|convention|expo|meetup|show|shows|festival|workshop|class|classes|competition|trial|trials|venue|booth|ticket|tickets|hosted|held|located|at the)\b/i,
        system: 'You extract only explicitly-named real-world places and events an audience physically visits or attends — stores, shops, parks, clubs, venues, vet clinics, shows, expos, competitions. You never invent names, never return generic categories or online-only platforms, and you output only valid JSON.',
        prompt: (a, s) => `From these "${a}" discussions, extract the real-world PLACES and EVENTS this audience physically goes to — named stores/shops, parks, trails, clubs, training facilities, vet clinics, daycares, venues, AND named shows, expos, meetups, competitions, classes, conferences or festivals.
For each return:
- "name": the real place or event name exactly as commonly written. A real proper name — never a generic category, an activity, or a description.
- "what": a SHORT phrase for what it is, ONLY if clear from context; otherwise "".
RULES: Only real, clearly-named places or events actually referenced by this audience. NEVER invent names. Do NOT return generic categories, online-only websites/apps, personal names, or vague descriptions. If none are clearly named, return an empty list.
Discussions:
${s}
Respond ONLY with JSON: {"events":[{"name":"...","what":"..."}]}`,
        suggest: { what: 'real-world events, conferences, expos, meetups, shows, competitions or notable places/venues', verb: 'attends or visits in person', examples: 'Real, named events or places only — no online-only platforms.' }
    });
}

// --- 7) WATERHOLES (#watering-holes, blueprint .watering-holes-list-item) -----
async function generateAndRenderWaterholes(corpus, audience) {
    const container = document.getElementById('watering-holes');
    if (!container) return;
    if (!window._waterholeBlueprint) {
        const bp = container.querySelector('.watering-holes-list-item');
        if (bp) window._waterholeBlueprint = bp.cloneNode(true);
    }
    const blueprint = window._waterholeBlueprint;
    if (!blueprint) { console.warn('[Where/Waterholes] no .watering-holes-list-item template'); return; }
    if ((corpus || []).length < 5) return;
    const sampleText = corpus.slice(0, 60).map((p, i) => `[${i}] ${_whereTextOf(p).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
    const prompt = `From these "${audience}" discussions, find WHERE THIS AUDIENCE ACTUALLY HANGS OUT outside of Reddit - their "watering holes". Look across EVERY kind of gathering place they mention, not just chat apps:
- Chat groups: Discord servers, Slack workspaces, Telegram groups/channels.
- Social groups: Facebook Groups, WhatsApp groups, Instagram pages/hashtags, YouTube channels/communities, TikTok, X/Twitter communities.
- Sites & apps: dedicated forums, niche websites, blogs, or apps where they congregate.
- Real life: recurring in-person meetups, clubs, events, conventions, or local groups.
For each place return:
- "platform": the kind of place, e.g. "Discord", "Slack", "Telegram", "Facebook", "Instagram", "YouTube", "TikTok", "Forum", "Website", "App", "In-person", or "Other".
- "name": the place's name exactly as it appears (verbatim).
- "context": a SHORT phrase for what it is about, ONLY if clearly stated; otherwise "".
RULES: Only include places actually NAMED in the text. NEVER invent names, member counts or descriptions. Reddit and subreddits do NOT count. If they genuinely name no off-Reddit places, return an empty list.
Discussions:
${sampleText}
Respond ONLY with JSON: {"waterholes":[{"platform":"Facebook","name":"...","context":"..."}]}`;
    let parsed = [];
    try {
        const data = await callOpenAI({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You find where an audience gathers OFF Reddit - any named community, group, forum, site, app, social account, or in-person meetup - across every platform, not just chat apps. You never invent names, numbers or descriptions, and you output only valid JSON.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.1, max_completion_tokens: 800, response_format: { type: 'json_object' }
        });
        parsed = data.waterholes || [];
    } catch (e) { console.warn('[Where/Waterholes] extraction failed:', e && e.message); }
    const allText = corpus.map(p => _whereTextOf(p)).join(' [SEP] ').toLowerCase();
    const seen = new Set(); const items = [];
    (parsed || []).forEach(w => {
        if (!w || !w.name) return;
        const name = String(w.name).trim(); const key = name.toLowerCase();
        if (key.length < 2 || seen.has(key)) return;
        const count = groundNameCount(key, allText);
        if (count === 0) return;
        seen.add(key);
        items.push({ platform: (w.platform && String(w.platform).trim()) || 'Other', name, context: (w.context || '').trim(), count });
    });
    items.sort((a, b) => b.count - a.count);
    renderWhereWaterholes(container, blueprint, items.slice(0, 8));
}

function renderWhereWaterholes(container, blueprint, items) {
    container.querySelectorAll('.watering-holes-list-item').forEach(el => el.remove());
    if (!items || !items.length) {
        const empty = blueprint.cloneNode(true); empty.style.display = '';
        const set = (sel, val) => { const e = empty.querySelector(sel); if (e) e.innerText = val; };
        set('.waterhole-platform', ''); set('.waterhole-meta', '');
        const nameEl = empty.querySelector('.waterhole-name'); if (nameEl) nameEl.innerText = 'No non-Reddit communities were named in these discussions.';
        container.appendChild(empty); return;
    }
    items.forEach(it => {
        const node = blueprint.cloneNode(true); node.style.display = '';
        node.setAttribute('data-platform', it.platform.toLowerCase());
        const set = (sel, val) => { const e = node.querySelector(sel); if (e) e.innerText = val; };
        set('.waterhole-platform', it.platform);
        set('.waterhole-name', it.name);
        set('.waterhole-meta', it.context || `Mentioned ${it.count} ${it.count === 1 ? 'time' : 'times'}`);
        container.appendChild(node);
    });
}

// --- 8) MEDIA: podcasts / channels (#podcasts, blueprint .podcasts-list-item) -
// Corpus-only: dropped the dedicated Reddit media search + per-podcast iTunes lookups
// for speed. Grounds names in the corpus and links to a search; no cover art.
async function generateAndRenderMedia(corpus, audience) {
    const container = document.getElementById('podcasts');
    if (!container) return;
    if (!window._podcastBlueprint) {
        const bp = container.querySelector('.podcasts-list-item');
        if (bp) window._podcastBlueprint = bp.cloneNode(true);
    }
    const blueprint = window._podcastBlueprint;
    if (!blueprint) { console.warn('[Where/Media] no .podcasts-list-item template'); return; }
    if ((corpus || []).length < 5) return;
    const mediaMatch = /\b(podcast|podcasts|episode|episodes|youtube|yt|channel|channels|video|videos|watch|series|show|shows)\b/i;
    let pool = corpus.filter(p => mediaMatch.test(_whereTextOf(p)));
    if (!pool.length) { renderWherePodcasts(container, blueprint, []); return; }
    const STRONG_MEDIA = /\b(podcast|podcasts|episode|episodes|youtube|channel|channels|substack|newsletter|spotify)\b/i;
    pool.sort((a, b) => (STRONG_MEDIA.test(_whereTextOf(b)) ? 1 : 0) - (STRONG_MEDIA.test(_whereTextOf(a)) ? 1 : 0));
    const sampleText = pool.slice(0, 40).map((p, i) => `[${i}] ${_whereTextOf(p).replace(/\s+/g, ' ').slice(0, 450)}`).join('\n');
    const prompt = `From these "${audience}" discussions, extract the SHOWS & CHANNELS this audience follows: PODCASTS, YOUTUBE channels, and audio/video shows they mention watching, listening to, or recommending.
For each, return:
- "type": "podcast", "youtube", or "show".
- "name": the actual TITLE / channel name exactly as mentioned - a real proper name, NEVER a descriptive phrase or sentence fragment.
- "focus": a SHORT phrase for what it is about, ONLY if clearly stated; otherwise "".
RULES: Only return real, clearly-named shows or channels. NEVER invent names or numbers, and never return generic phrases or fragments. If none are clearly named, return an empty list.
Discussions:
${sampleText}
Respond ONLY with JSON: {"media":[{"type":"youtube","name":"...","focus":"..."}]}`;
    let parsed = [];
    try {
        const data = await callOpenAI({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You extract only explicitly-named podcasts, YouTube channels and shows from text. You never invent names, numbers or descriptions, and you output only valid JSON.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.1, max_completion_tokens: 800, response_format: { type: 'json_object' }
        });
        parsed = data.media || [];
    } catch (e) { console.warn('[Where/Media] extraction failed:', e && e.message); }
    const allText = pool.map(p => _whereTextOf(p)).join(' [SEP] ').toLowerCase();
    const seen = new Set(); const items = [];
    (parsed || []).forEach(w => {
        if (!w || !w.name) return;
        const name = String(w.name).trim(); const key = name.toLowerCase();
        if (key.length < 3 || seen.has(key)) return;
        const count = groundNameCount(key, allText);
        if (count === 0) return;
        seen.add(key);
        const type = ['podcast', 'youtube', 'show'].includes(String(w.type || '').toLowerCase()) ? String(w.type).toLowerCase() : 'show';
        items.push({ type, name, focus: (w.focus || '').trim(), count });
    });
    items.sort((a, b) => b.count - a.count);
    renderWherePodcasts(container, blueprint, items.slice(0, 8));
}

function renderWherePodcasts(container, blueprint, items) {
    container.querySelectorAll('.podcasts-list-item').forEach(el => el.remove());
    if (!items || !items.length) {
        const empty = blueprint.cloneNode(true); empty.style.display = '';
        const n = empty.querySelector('.podcast-name'); if (n) n.innerText = 'No podcasts or channels were named in these discussions.';
        ['.podcast-focus', '.podcast-meta', '.media-type', '.prevalence-tag', '.prevelance-tag'].forEach(sel => { const e = empty.querySelector(sel); if (e) e.innerText = ''; });
        const img = empty.querySelector('.podcast-image'); if (img) img.style.display = 'none';
        container.appendChild(empty); return;
    }
    items.forEach(it => {
        const node = blueprint.cloneNode(true); node.style.display = '';
        node.setAttribute('data-media-type', it.type || 'podcast');
        const set = (sel, val) => { const e = node.querySelector(sel); if (e) e.innerText = val; };
        set('.podcast-name', it.name);
        set('.podcast-focus', it.focus ? `Focus: ${it.focus}` : '');
        set('.media-type', it.type === 'youtube' ? 'YouTube' : (it.type === 'show' ? 'Show' : 'Podcast'));
        set('.podcast-meta', '');
        const tier = mentionTier(it.count); set('.prevalence-tag', tier); set('.prevelance-tag', tier);
        const img = node.querySelector('.podcast-image'); if (img) img.style.display = 'none'; // corpus-only: no cover art
        const link = node.querySelector('.podcast-link');
        if (link) {
            const url = it.type === 'podcast'
                ? `https://www.google.com/search?q=${encodeURIComponent(it.name + ' podcast')}`
                : `https://www.youtube.com/results?search_query=${encodeURIComponent(it.name)}`;
            link.setAttribute('href', url); link.setAttribute('target', '_blank');
        }
        container.appendChild(node);
    });
}

// Lazy-load Tab 4 once, cached. Instant charts render synchronously; the 5 AI panels
// run in parallel (corpus-only). The tab label shimmers until all panels resolve.
function loadTabWhere() {
    if (!window._tabLoaded) window._tabLoaded = {};
    if (window._tabLoaded.where) return window._wherePromise || Promise.resolve();
    if (!window._corpus || !window._corpus.length) return Promise.resolve();
    window._tabLoaded.where = true;
    setTabLoading('tab-where', true);
    const audience = window.originalGroupName || '';
    window._wherePromise = (async () => {
        // Wait for the background comment enrichment so the charts count over posts + comments (far
        // more accurate). The shimmer covers this wait; enrichment is usually already done by now.
        try { await (window._corpusEnrichedPromise || Promise.resolve()); } catch (e) { /* enrich is best-effort */ }
        const corpus = window._corpus;
        try { renderSocialSplitChart(corpus); } catch (e) { console.warn('[Where/Social] failed', e); }
        try { renderLocationChart(corpus); } catch (e) { console.warn('[Where/Location] failed', e); }
        try { renderActiveHours(corpus); } catch (e) { console.warn('[Where/Hours] failed', e); }
        await Promise.all([
            generateAndRenderWaterholes(corpus, audience),
            generateAndRenderMedia(corpus, audience),
            generateAndRenderExperts(corpus, audience),
            generateAndRenderTools(corpus, audience),
            generateAndRenderEvents(corpus, audience)
        ]);
    })().catch(e => { console.warn('[Where] failed', e); window._tabLoaded.where = false; })
        .finally(() => setTabLoading('tab-where', false));
    return window._wherePromise;
}

function openTabWhere() {
    if (window._tabLoaded && window._tabLoaded.where) return;
    if (!window._corpus || !window._corpus.length) return;
    loadTabWhere();
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
    window._findings = null; window._findingsPromise = null; window._assignmentPromise = null;
    window._findingPosts = null; window._findingPostsFull = null;
    window._polarityPromise = null; window._subProblemCache = {}; window._tabLoaded = {};
    if (window._polarityChart && window._polarityChart.destroy) { window._polarityChart.destroy(); window._polarityChart = null; }
    console.log('[Reset] back to start — ready for a new search');
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
        if (!groupName) { showMessage('Please enter a group of people or pick a suggestion.'); return; }
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
    if (hurtsTab && !hurtsTab.dataset.ppWired) { openTabHurts(); return; } // don't preventDefault — let Webflow switch the tab
    const polTab = e.target.closest('#polarity-tab');
    if (polTab && !polTab.dataset.ppWired) { openPolarityMap(); return; }
    const talkTab = e.target.closest('#tab-talk');
    if (talkTab && !talkTab.dataset.ppWired) { openTabTalk(); return; }
    const whereTab = e.target.closest('#tab-where');
    if (whereTab && !whereTab.dataset.ppWired) { openTabWhere(); return; }

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
