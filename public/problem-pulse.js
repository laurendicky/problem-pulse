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

console.log('%c[problem-pulse-v2] BUILD 17 — stronger relevance, clickable posts, Highcharts polarity map', 'color:#00a5ce;font-weight:bold');

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
        const corpus = await buildCorpus(subreddits);
        window._corpus = corpus;
        window._analysisSubreddits = subreddits;
        window._tabLoaded = {}; // new search → invalidate cached tabs so they reload for this audience
        console.log(`[Analysis] corpus ready: ${corpus.length} posts from ${subreddits.length} subreddits`);
        if (!corpus.length) {
            alert('No discussions found for those communities. Try different ones.');
            return;
        }
        // Part 3 — Tab 1 ("Who they are"). All read from the corpus; nothing refetched.
        showLoader('Analysing audience…');
        const audience = window.originalGroupName || '';
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
    const sample = corpus.slice(0, 30)
        .map(p => `Title: ${p.title}\nContent: ${p.body}`.substring(0, 500))
        .join('\n---\n');

    const payload = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You distil community discussions into a few core problems with authentic quotes. Output only valid JSON.' },
            { role: 'user', content: `Analyse these discussions about "${audience}" and identify 1 to 5 of the most common, clearly recurring problems. Respond ONLY with a JSON object: {"findings":[{"title","summary","quotes","keywords","intensity"}]}. Rules — "title": 3-6 words, plain and specific. "summary": ONE or TWO short sentences, punchy, human-sounding, intriguing, NO waffle, ~30 words max, and naturally mention "${audience}". "quotes": exactly 3 short authentic-sounding strings, each ≤ 80 characters. "keywords": 3-6 lowercase words for matching related posts. "intensity": an integer 0-100 rating how emotionally severe/painful this problem is for ${audience} (how much stress/distress it causes), judged INDEPENDENTLY of how often it comes up. Prioritise the most common recurring problems; avoid one-off complaints. Posts:\n${sample}` }
        ],
        temperature: 0.2,
        max_completion_tokens: 1100,
        seed: 11,
        response_format: { type: 'json_object' }
    };

    try {
        const parsed = await callOpenAI(payload);
        let findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        if (!findings.length) { console.warn('[Findings] none generated'); return; }
        const ranked = computeFindingPrevalence(findings, corpus).slice(0, 5);
        window._findings = ranked;
        // Assign each post to its single best-matching finding (no repeats), most relevant first.
        window._findingPosts = assignPostsToFindings(ranked, corpus, 8);
        window._subProblemCache = {}; // new findings → drop cached subproblems
        ranked.forEach((f, idx) => renderFindingCard(idx + 1, f));
        console.log('[Findings] rendered:', ranked.length);
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

function openFindingModal(blockIndex) {
    const modal = getFindingModal(blockIndex);
    if (!modal) { console.warn(`[Modal] #findings-${blockIndex}-modal not found`); return; }
    const finding = (window._findings || [])[blockIndex - 1];

    const header = modal.querySelector('.reddit-samples-header');
    if (header) {
        const block = document.getElementById('findings-block' + blockIndex);
        const fallback = block && block.querySelector('.section-title') ? block.querySelector('.section-title').textContent : '';
        header.textContent = (finding && finding.title) || fallback;
    }
    renderFindingPosts(modal, blockIndex, finding);

    modal.style.display = 'flex'; // open first so the chart has a measurable width
    const chartEl = modal.querySelector('.subproblem-chart');
    if (chartEl && finding) renderSubproblemsInto(chartEl, finding); // fire-and-forget; loader shows meanwhile
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

// Each post goes to its single best-matching finding (no repeats across findings), only if it clears
// the relevance bar; keep the most relevant per finding.
function assignPostsToFindings(findings, corpus, perFinding) {
    perFinding = perFinding || 8;
    const posts = dedupeByTitle(corpus);
    const buckets = findings.map(() => []);
    posts.forEach(post => {
        let bestIdx = -1, bestScore = 0;
        findings.forEach((f, i) => { const s = scorePostForFinding(post, f); if (s > bestScore) { bestScore = s; bestIdx = i; } });
        if (bestIdx >= 0 && bestScore >= RELEVANCE_MIN_SCORE) buckets[bestIdx].push({ post, score: bestScore });
    });
    return buckets.map(arr => arr
        .sort((a, b) => b.score - a.score || (b.post.score - a.post.score))
        .slice(0, perFinding)
        .map(x => x.post));
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
async function renderSubproblemsInto(chartEl, finding) {
    const loader = chartEl.querySelector('.subproblem-loader');
    if (loader) loader.style.display = 'block';
    try {
        const analysisPosts = matchPostsForFinding(finding, window._corpus || [], 40);
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

function renderPolarityMap(findings) {
    const container = document.getElementById('emotion-map-container');
    if (!container) { console.warn('[Polarity] #emotion-map-container not found'); return; }
    if (typeof Highcharts === 'undefined') {
        console.error('[Polarity] Highcharts not loaded');
        container.innerHTML = '<p class="chart-placeholder-text">Chart library not found.</p>';
        return;
    }
    const pts = (findings || []).filter(f => typeof f.intensity === 'number');
    if (!pts.length) { container.innerHTML = '<p class="chart-placeholder-text">Not enough problems to map yet.</p>'; return; }

    const data = pts.map(f => ({
        x: Math.max(0, Math.min(100, Math.round(f.prevalence || 0))),
        y: Math.max(0, Math.min(100, Math.round(f.intensity || 0))),
        z: Math.max(1, Math.round(f.prevalence || 1)),
        label: f.title
    }));

    if (window._polarityChart && window._polarityChart.destroy) window._polarityChart.destroy();
    window._polarityChart = Highcharts.chart(container, {
        chart: { type: 'bubble', backgroundColor: 'transparent', spacing: [20, 20, 20, 20] },
        title: { text: '' }, credits: { enabled: false }, legend: { enabled: false },
        xAxis: { title: { text: 'How often it comes up', style: { color: '#888' } }, min: 0, gridLineColor: 'rgba(0,0,0,0.06)', lineColor: 'rgba(0,0,0,0.15)', labels: { style: { color: '#888' } } },
        yAxis: { title: { text: 'How painful it is', style: { color: '#888' } }, min: 0, max: 100, tickInterval: 25, gridLineColor: 'rgba(0,0,0,0.06)', lineColor: 'rgba(0,0,0,0.15)', labels: { style: { color: '#888' } } },
        tooltip: { useHTML: true, headerFormat: '', pointFormat: '<b>{point.label}</b><br>Frequency: {point.x}%<br>Intensity: {point.y}/100' },
        plotOptions: {
            bubble: { minSize: 18, maxSize: 70, marker: { fillColor: 'rgba(0,165,206,0.75)', lineColor: '#ffffff', lineWidth: 1.5 } },
            series: { dataLabels: { enabled: true, format: '{point.label}', style: { color: '#1f2d3d', textOutline: 'none', fontWeight: '500', fontSize: '11px' }, allowOverlap: false } }
        },
        series: [{ data }],
        responsive: { rules: [{ condition: { maxWidth: 500 }, chartOptions: { xAxis: { title: { text: 'Frequency' } }, yAxis: { title: { text: 'Intensity' } }, plotOptions: { series: { dataLabels: { style: { fontSize: '9px' } } } } } }] }
    });
    console.log('[Polarity] map rendered with', data.length, 'problems');
}

function loadPolarityMap() {
    _runTabOnce('polarity', async () => {
        const findings = await ensureFindings();
        renderPolarityMap(findings);
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
