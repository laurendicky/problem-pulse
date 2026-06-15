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

console.log('[problem-pulse-v2] script loaded');

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

// Combine the problem terms into as few Reddit queries as possible. Single words go in OR groups
// of 4; phrases are quoted individually. Fewer queries = fewer requests = faster + gentler.
function buildProblemQueries() {
    const queries = [];
    for (let i = 0; i < PROBLEM_TERMS_SINGLE.length; i += 4) {
        const group = PROBLEM_TERMS_SINGLE.slice(i, i + 4);
        queries.push(group.length > 1 ? '(' + group.join(' OR ') + ')' : group[0]);
    }
    PROBLEM_TERMS_PHRASE.forEach(p => queries.push(`"${p}"`));
    return queries;
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

// Keep posts with a real title and at least a little traction; flatten to a lean shape so the rest
// of the app never touches Reddit's raw envelope.
function normalizeCorpus(children) {
    return children
        .map(c => c.data)
        .filter(d => d && d.title && (d.ups || 0) >= CORPUS_MIN_SCORE)
        .map(d => ({
            id: d.id,
            subreddit: d.subreddit,
            title: d.title,
            body: d.selftext || '',
            score: d.ups || 0,
            comments: d.num_comments || 0,
            created: d.created_utc || 0,
            permalink: d.permalink ? `https://reddit.com${d.permalink}` : ''
        }));
}

// Build the corpus: consolidated queries (gate-throttled) → dedupe → normalize. One fetch, reused.
async function buildCorpus(subreddits) {
    const subredditQuery = buildSubredditQuery(subreddits);
    const queries = buildProblemQueries();
    const batches = await Promise.all(queries.map(q => fetchPostsForQuery(subredditQuery, q)));
    const corpus = normalizeCorpus(dedupePosts(batches.flat()));
    corpus.sort((a, b) => b.score - a.score); // most-upvoted first
    return corpus;
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

// The loader div (#full-loader-msg) is display:none in Webflow, so we must set an explicit visible
// value to override that — setting '' would just fall back to the none. The user owns its look.
function showLoader(message) {
    const el = document.getElementById('full-loader-msg');
    if (!el) { console.warn('[Loader] #full-loader-msg NOT FOUND'); return; }
    el.style.display = 'flex';
    if (message) el.setAttribute('data-status', message);
    _debugVisibility('full-loader-msg');
}
function hideLoader() {
    const el = document.getElementById('full-loader-msg');
    if (el) el.style.display = 'none';
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

    showLoader('Gathering discussions…');
    try {
        const corpus = await buildCorpus(subreddits);
        window._corpus = corpus;
        window._analysisSubreddits = subreddits;
        console.log(`[Analysis] corpus ready: ${corpus.length} posts from ${subreddits.length} subreddits`);
        if (!corpus.length) {
            alert('No discussions found for those communities. Try different ones.');
            return;
        }
        // Part 3 — first analysis: audience demographics. Reads from the corpus; nothing refetched.
        showLoader('Analysing audience…');
        await generateAndRenderWho(corpus, window.originalGroupName || '');
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
            const names = await findSubredditsForGroup(groupName);
            console.log('[Entry] candidate subreddits:', names);
            const ranked = await fetchAndRankSubreddits(names);
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

    console.log('[Entry] wired ✓ — #find-communities-btn is live');
}

// Safety net: delegated click handlers so these buttons work even if Webflow renders them after
// init. Each is guarded by dataset.ppWired so it never double-fires with the direct listeners.
document.addEventListener('click', (e) => {
    const searchBtn = e.target.closest('#search-selected-btn');
    if (searchBtn && !searchBtn.dataset.ppWired) { e.preventDefault(); runProblemFinder(); return; }
    const backBtn = e.target.closest('#back-to-step1-btn');
    if (backBtn && !backBtn.dataset.ppWired) { e.preventDefault(); transitionToStep1(); return; }
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
