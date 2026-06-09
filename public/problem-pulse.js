// =================================================================================
// PART 1 OF 3: GLOBAL VARIABLES, UTILITIES, SENTIMENT, EXTRACTION & DATA FETCHING
// =================================================================================

// --- 1. GLOBAL VARIABLES & CONSTANTS ---
const OPENAI_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/openai-proxy';
const REDDIT_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/reddit-proxy';
const HARD_MIN_SUBSCRIBERS = 1000;
const HARD_MIN_ACTIVE_USERS = 0;
const LENIENT_MIN_SUBSCRIBERS = 500;
const LENIENT_MIN_ACTIVE_USERS = 0;
let originalGroupName = '';
let _allRankedSubreddits = [];

const suggestions = [  "Dog Owners", "ADHD Adults", "Sneaker Buyers", "First-Time Parents", "Software Developers", "Small Business Owners", "Teachers", "Remote Workers", "Homeowners", "Freelancers"];
const positiveColors = ['#00a5ce', '#0090b5', '#00c0e6', '#7bd9ec', '#b3e8f3', '#006d85'];
const negativeColors = ['#fd80c7', '#d6539d', '#ff4fa3', '#ff99d6', '#fbb6ce', '#f472b6'];
const lemmaMap = { 'needs': 'need', 'wants': 'want', 'loves': 'love', 'loved': 'love', 'loving': 'love', 'hates': 'hate', 'wishes': 'wish', 'wishing': 'wish', 'solutions': 'solution', 'challenges': 'challenge', 'recommended': 'recommend', 'disappointed': 'disappoint', 'frustrated': 'frustrate', 'annoyed': 'annoy' };
const positiveWords = new Set(['love', 'amazing', 'awesome', 'beautiful', 'best', 'brilliant', 'celebrate', 'charming', 'dope', 'excellent', 'excited', 'exciting', 'epic', 'fantastic', 'flawless', 'gorgeous', 'happy', 'impressed', 'incredible', 'insane', 'joy', 'keen', 'lit', 'perfect', 'phenomenal', 'proud', 'rad', 'super', 'stoked', 'thrilled', 'vibrant', 'wow', 'wonderful', 'blessed', 'calm', 'chill', 'comfortable', 'cozy', 'grateful', 'loyal', 'peaceful', 'pleased', 'relaxed', 'relieved', 'satisfied', 'secure', 'thankful', 'want', 'wish', 'hope', 'desire', 'craving', 'benefit', 'bonus', 'deal', 'hack', 'improvement', 'quality', 'solution', 'strength', 'advice', 'tip', 'trick', 'recommend']);
const negativeWords = new Set(['angry', 'annoy', 'anxious', 'awful', 'bad', 'broken', 'hate', 'challenge', 'confused', 'crazy', 'critical', 'danger', 'desperate', 'disappoint', 'disgusted', 'dreadful', 'fear', 'frustrate', 'furious', 'horrible', 'irritated', 'jealous', 'nightmare', 'outraged', 'pain', 'panic', 'problem', 'rant', 'scared', 'shocked', 'stressful', 'terrible', 'terrified', 'trash', 'alone', 'ashamed', 'bored', 'depressed', 'discouraged', 'dull', 'empty', 'exhausted', 'failure', 'guilty', 'heartbroken', 'hopeless', 'hurt', 'insecure', 'lonely', 'miserable', 'sad', 'sorry', 'tired', 'unhappy', 'upset', 'weak', 'need', 'disadvantage', 'issue', 'flaw']);
const emotionalIntensityScores = { 'annoy': 3, 'irritated': 3, 'bored': 2, 'issue': 3, 'sad': 4, 'bad': 3, 'confused': 4, 'tired': 3, 'upset': 5, 'unhappy': 5, 'disappoint': 6, 'frustrate': 6, 'stressful': 6, 'awful': 7, 'hate': 8, 'angry': 7, 'broken': 5, 'exhausted': 5, 'pain': 7, 'miserable': 8, 'terrible': 8, 'worst': 9, 'horrible': 8, 'furious': 9, 'outraged': 9, 'dreadful': 8, 'terrified': 10, 'nightmare': 10, 'heartbroken': 9, 'desperate': 8, 'rage': 10, 'problem': 4, 'challenge': 5, 'critical': 6, 'danger': 7, 'fear': 7, 'panic': 8, 'scared': 6, 'shocked': 7, 'trash': 5, 'alone': 4, 'ashamed': 5, 'depressed': 8, 'discouraged': 5, 'dull': 2, 'empty': 6, 'failure': 7, 'guilty': 6, 'hopeless': 8, 'insecure': 5, 'lonely': 6, 'weak': 4, 'need': 5, 'disadvantage': 4, 'flaw': 4 };
const stopWords = ["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves", "like", "just", "dont", "can", "people", "help", "hes", "shes", "thing", "stuff", "really", "actually", "even", "know", "still", "post", "posts", "subreddit", "redditor", "redditors", "comment", "comments", "high", "low", "will", "sorry", "please", "thanks", "thank", "feel", "feeling", "got", "get", "go", "going", "take", "make", "sure", "want", "wanted", "think", "thinking", "thought", "see", "saw", "come", "came", "day", "days", "week", "weeks", "month", "months", "year", "years", "time", "times", "way", "ways", "eat", "eating", "ate", "sleep", "sleeping", "slept", "bed", "beds", "old", "new"];

const EMBEDDING_PROXY_URL = 'https://iridescent-fairy-a41db7.netlify.app/.netlify/functions/embeddings-proxy';
const SIM_THRESHOLD = 0.30; 

window._postEmbeddingCache = window._postEmbeddingCache || new Map();

function cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedTexts(texts, batchSize = 200) {
    const vectors = [];
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize).map(t => (t || '').substring(0, 1500));
        const payload = { model: "text-embedding-3-small", input: batch };
        const response = await fetch(EMBEDDING_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeddingPayload: payload })
        });
        const data = await response.json();
        if (!response.ok || data?.error) throw new Error('Embedding proxy returned an error.');
        const embObjs = data?.embeddingResponse?.data || [];
        embObjs.forEach(o => vectors.push(o.embedding));
    }
    return vectors;
}

// =================================================================================
// === HIDDEN GEMS ENGINE (statistics-first, surprise-curated) ===
// =================================================================================
const GEM_MIN_LIFT = 1.2;   
const GEM_MIN_CHI2 = 2.0;  
const GEM_MAX_SIM = 0.55;  
const GEM_VOCAB_UNIGRAMS = 120;   
const GEM_VOCAB_PHRASES = 90;    

function buildFeatureMatrix(posts) {
    const N = posts.length;
    const df = new Map();
    const featurePosts = new Map();

    const emotionTerms = new Set([
        ...positiveWords, ...negativeWords, ...Object.keys(emotionalIntensityScores),
        'guilt', 'guilty', 'shame', 'blame', 'embarrassed', 'judged', 'judgement', 'judgment',
        'avoid', 'isolate', 'isolated', 'isolation', 'lonely', 'loneliness', 'identity', 'confidence',
        'insecure', 'overwhelmed', 'obsessed', 'regret', 'resent', 'grief', 'cope', 'coping', 'anxiety'
    ].map(w => lemmatize(w)));

    posts.forEach((post, idx) => {
        const text = `${post.data.title || post.data.link_title || ''} ${post.data.selftext || post.data.body || ''}`.toLowerCase()
            .replace(/https?:\/\/\S+/g, ' ')                                                  
            .replace(/\b[a-z0-9-]+\.(com|org|net|io|co|uk|gg|tv|ly|me|dev|app|gov|edu)\b\S*/g, ' ') 
            .replace(/this (comment|post) was mass deleted[^.]*\.?/g, ' ')                     
            .replace(/\b(redact|redacted|powerdeletesuite|overwritten)\b/g, ' ');
        const cleanWords = text.replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);

        const seen = new Set();

        cleanWords.forEach(w => {
            if (w.length < 3 || stopWords.includes(w)) return;
            const lemma = lemmatize(w);
            if (lemma.length < 3 || stopWords.includes(lemma)) return;
            seen.add(lemma);
        });

        [...generateNgrams(cleanWords, 2), ...generateNgrams(cleanWords, 3)].forEach(ph => {
            if (ph.split(' ').every(t => t.length >= 3)) seen.add(ph);
        });

        seen.forEach(f => {
            df.set(f, (df.get(f) || 0) + 1);
            if (!featurePosts.has(f)) featurePosts.set(f, new Set());
            featurePosts.get(f).add(idx);
        });
    });

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const minDFuni    = clamp(Math.round(N * 0.005), 3, 15); 
    const boostMinDF  = clamp(Math.round(N * 0.003), 2, 10); 
    const minDFphrase = clamp(Math.round(N * 0.002), 2, 8);  
    const maxDF = Math.round(N * 0.5);

    const entries = [...df.entries()];

    const unigrams = entries
    .filter(([f, c]) => !f.includes(' ') && c <= maxDF && (emotionTerms.has(f) ? c >= boostMinDF : c >= minDFuni))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 250) 
    .map(([f]) => f);

    const phrases = entries
    .filter(([f, c]) => f.includes(' ') && c <= maxDF && c >= minDFphrase)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 150) 
    .map(([f]) => f);

    const vocab = [...unigrams, ...phrases];
    const types = new Map(vocab.map(f => [f, (!f.includes(' ') && emotionTerms.has(f)) ? 'emotion' : 'topic']));

    return { N, df, featurePosts, vocab, types };
}

function chiSquare2x2(a, b, c, d) {
    const n = a + b + c + d;
    const denom = (a + b) * (c + d) * (a + c) * (b + d);
    if (denom === 0) return 0;
    return (n * Math.pow(a * d - b * c, 2)) / denom;
}

function mineAssociations(matrix) {
    const { N, df, featurePosts, vocab } = matrix;
    const minSupport = N < 80 ? 2 : Math.min(5, Math.max(3, Math.round(N * 0.002)));
    const pairs = [];

    for (let i = 0; i < vocab.length; i++) {
        const X = vocab[i];
        const wordsX = new Set(X.split(' '));
        for (let j = i + 1; j < vocab.length; j++) {
            const Y = vocab[j];
            if (Y.split(' ').some(w => wordsX.has(w))) continue;

            const setX = featurePosts.get(X), setY = featurePosts.get(Y);
            if (!setX || !setY) continue;
            const [small, big] = setX.size <= setY.size ? [setX, setY] : [setY, setX];
            let support = 0;
            small.forEach(idx => { if (big.has(idx)) support++; });
            if (support < minSupport) continue;

            const dfX = df.get(X), dfY = df.get(Y);
            const lift = (support / N) / ((dfX / N) * (dfY / N));
            if (lift < GEM_MIN_LIFT) continue;

            const a = support, b = dfX - support, c = dfY - support, d = N - a - b - c;
            const chi2 = chiSquare2x2(a, b, c, d);
            if (chi2 < GEM_MIN_CHI2) continue;

            pairs.push({ x: X, y: Y, support, lift, chi2 });
        }
    }
    console.log(`[Hidden Gems] N=${N} vocab=${vocab.length} minSupport=${minSupport} candidates=${pairs.length}`);
    return pairs;
}

async function generateAndRenderHiddenGems(posts, audienceContext, meta = {}) {
    const grid = document.querySelector('.gem-card-grid');
    if (!grid) return;

    if (!window._gemBlueprint) {
        const bp = grid.querySelector('.gem-card-wrapper');
        if (bp) window._gemBlueprint = bp.cloneNode(true);
    }
    const GEM_BLUEPRINT = window._gemBlueprint;
    if (!GEM_BLUEPRINT) {
        console.error('Hidden Gems: .gem-card-wrapper blueprint not found inside .card-grid.');
        return;
    }

    grid.innerHTML = '<p class="loading-text">Reading discussions for hidden gems...</p>';

    if (!posts || posts.length < 25) {
        grid.innerHTML = '<p class="placeholder-text">Not enough discussions yet for reliable hidden gems. Try a Deep search or a longer time frame.</p>';
        return;
    }

    const searchedCount = Number.isFinite(meta.searchedCount) ? meta.searchedCount : posts.length;
    const searchedLabel = meta.searchedLabel || 'discussions';

    const setText = (sel, val) => { const el = document.querySelector(sel); if (el) el.innerText = val; };
    const surpriseLabel = (scores) => {
        if (!scores.length) return '';
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avg >= 9) return 'Very High';
        if (avg >= 8) return 'High';
        return 'Medium';
    };
    const disclaimerText = (n) => {
        if (n === 0) return 'None were strong enough to make the cut this time.';
        if (n === 1) return 'Only 1 hidden gem was strong enough to make the cut.';
        return `${n} hidden gems made the cut.`;
    };
    const updateGemHeader = (shownGems) => {
        const madeCut = shownGems.filter(g => g._tier !== 'near').length;
        const commercial = shownGems.filter(g => Number(g.commercial_value) >= 7 || g.category === 'commercial_leap').length;
        const scores = shownGems.map(g => Number(g.surprise_score)).filter(s => !isNaN(s));
        setText('.gem-search-statement', `We Searched ${Number(searchedCount).toLocaleString()} ${searchedLabel}`);
        setText('.gem-search-disclaimer', disclaimerText(madeCut));
        setText('.number-found', String(madeCut));
        setText('.surprise-score', surpriseLabel(scores) || 'Medium');
        setText('.com-oppertunites', String(commercial));
    };

    const UNIT_PHRASE = /\b(per|a|each)\s+(day|week|month|year|hour|night)\b|\byears?\s+old\b|\btimes?\s+a\b/i;
    const GENERIC_AUD = new Set(['buyers','buyer','lovers','lover','owners','owner','fans','fan','enthusiasts','enthusiast','users','user','people','adults','adult','community','shoppers','shopper','collectors','collector','addicts','addict','nerds','geeks','parents','parent','moms','dads','professionals','folks','gamers','readers','members']);
    const AUD_CORE = (() => {
        const set = new Set();
        (audienceContext || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
            .filter(w => w.length > 2 && !GENERIC_AUD.has(w))
            .forEach(w => { set.add(w); set.add(w.endsWith('s') ? w.slice(0, -1) : w + 's'); });
        return set;
    })();
    const FUNC_WORDS = new Set(['the','a','an','this','that','it','they','them','will','would','about','your','their','get','got','getting','rid','thing','things','stuff','really','very','just','like','some','any','more','most','want','need']);
    const labelOk = (s) => {
        const t = (s || '').toLowerCase().trim();
        const cleanAudience = (audienceContext || '').toLowerCase().trim();

        if (t.length < 3) return false;
        if (UNIT_PHRASE.test(t)) return false;

        if (t === cleanAudience) return false;
        if (t === cleanAudience.replace(/s$/, '')) return false;

        const words = t.split(/\s+/);
        if (words.length === 1 && AUD_CORE.has(words[0])) return false;

        if (words.every(w => FUNC_WORDS.has(w))) return false;
        if (!/[a-z]/i.test(t)) return false;
        return true;
    };

    const CATEGORY_LABELS = {
        emotional_leap: 'Emotional leap',
        behavioural_leap: 'Behavioural leap',
        commercial_leap: 'Commercial leap',
        contradiction: 'Contradiction'
    };

    try {
        let statisticalContext = '';
        try {
            const featureMatrix = buildFeatureMatrix(posts);
            const strongestPairs = mineAssociations(featureMatrix)
                .sort((a, b) => b.chi2 - a.chi2)
                .slice(0, 15);
            statisticalContext = strongestPairs
                .map(p => `- Unusual link: "${p.x}" is heavily correlated with "${p.y}" (co-occurs far more than chance)`)
                .join('\n');
        } catch (mErr) {
            console.warn('[Hidden Gems] statistical pass skipped:', mErr && mErr.message);
        }

        const scored = posts.map(p => {
            const text = (p.data.selftext || p.data.body || '').trim();
            const title = p.data.title || p.data.link_title || '';
            return { p, text, title, ups: p.data.ups || 0, len: text.length + title.length };
        }).filter(s => s.len >= 60);
        scored.sort((a, b) => (b.ups + b.len * 0.4) - (a.ups + a.len * 0.4));
        const sample = scored.slice(0, 45);

        if (sample.length < 8) {
            grid.innerHTML = '<p class="placeholder-text">Not enough substantial discussion to mine. Try a Deep search or a longer time frame.</p>';
            return;
        }

        const itemsText = sample.map((s, i) =>
            `[${i}] (r/${s.p.data.subreddit || '?'}, ${s.ups} ups) ${`${s.title} ${s.text}`.replace(/\s+/g, ' ').trim().slice(0, 420)}`
        ).join('\n');

        const prompt = `You are a sharp consumer-insight analyst studying the "${audienceContext}" audience by reading real Reddit discussions.

We ran a statistical association engine (Lift/Chi-Square) on these discussions and surfaced several term correlations. Use these correlations ONLY as hints or springboards.

SURFACED ASSOCIATIONS:
${statisticalContext || "(No strong correlations found)"}

CRITICAL RULES FOR SURPRISE AND ACTIONABILITY:
1. REJECT TAUTOLOGIES AND IDIOMS: Do not output standard collocations, dictionary pairs, or basic idioms. Pairs like "sorry + loss" (standard condolence), "high + energy" (standard dog descriptor), "potty + accident" (standard training term), or "sleep + bed" (where else would they sleep) are NOT hidden gems. They are linguistically linked, not behaviorally surprising. If a pair we surfaced is boring, IGNORE it.
2. LOOK FOR CONCEPTUAL LEAPS: A true hidden gem links two entirely distinct domains of the user's life (e.g., "balcony" + "potty" showing space constraints / apartment-dwelling workarounds; "working from home" + "separation anxiety" showing structural schedule impacts).
3. SCREENSHOT TEST: Ask yourself: "Would an experienced startup founder screenshot this slide to show their team because it reveals an unexpected consumer workaround, hack, or unaddressed market opportunity?" If not, do not return it. Prefer 2 highly surprising, actionable gems over 5 boring ones.

For each gem return:
- "category": one of emotional_leap | behavioural_leap | commercial_leap | contradiction
- "topic_a": 1-3 word label for the surface topic (a real concept; never a function word, unit, or the audience's own topic)
- "reveal_finding": 1-4 word label for the unexpected or commercial side
- "front_teaser": one sentence hinting at the surprise WITHOUT giving it away
- "reveal_summary": 1-2 plain sentences telling the real story behind it, grounded in the quote. No invented statistics, no comparison to the general population.
- "quote": a SHORT verbatim quote (<=160 chars) copied EXACTLY from ONE item that proves the gem
- "source_index": the [index] number that quote came from
- "surprise_score": integer 1-10, honest (only return gems >=6)
- "commercial_value": integer 1-10

Items:
${itemsText}

Respond ONLY with valid JSON: {"gems":[{"category":"...","topic_a":"...","reveal_finding":"...","front_teaser":"...","reveal_summary":"...","quote":"...","source_index":0,"surprise_score":8,"commercial_value":7}]}`;

        let parsed = [];
        try {
            const data = await callOpenAIProxyWithRetry({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: "You read real online discussions and explain statistically significant correlations with qualitative insights. You only assert what the quotes support, never invent statistics or compare to the general population, and you output only valid JSON." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.4,
                max_completion_tokens: 1800,
                response_format: { type: "json_object" }
            }, { tries: 2 });
            if (data && data.openaiResponse) parsed = JSON.parse(data.openaiResponse).gems || [];
        } catch (e) {
            console.error('[Hidden Gems] AI read failed.', e);
        }

        const norm = (str) => (str || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        const sampleNorm = sample.map(s => norm(`${s.title} ${s.text}`));

        const validated = [];
        parsed.forEach(g => {
            if (!g || !g.topic_a || !g.reveal_finding || !g.front_teaser || !g.reveal_summary || !g.quote) return;
            if (!CATEGORY_LABELS[g.category]) return;
            if (!labelOk(g.topic_a) || !labelOk(g.reveal_finding)) return;

            const qn = norm(g.quote);
            if (qn.length < 6) return;
            let idx = Number.isInteger(g.source_index) ? g.source_index : -1;
            let srcData = (idx >= 0 && sample[idx]) ? sample[idx].p.data : null;
            const probe = qn.slice(0, 40);
            const groundedAtIdx = srcData && sampleNorm[idx] && sampleNorm[idx].includes(probe);
            if (!groundedAtIdx) {
                const foundIdx = sampleNorm.findIndex(t => t.includes(probe));
                if (foundIdx === -1) return;       
                srcData = sample[foundIdx].p.data;
            }

            validated.push({
                category: g.category,
                topic_a: String(g.topic_a).trim(),
                reveal_finding: String(g.reveal_finding).trim(),
                front_teaser: String(g.front_teaser).trim(),
                reveal_summary: String(g.reveal_summary).trim(),
                quote: String(g.quote).trim().slice(0, 200),
                surprise_score: Number(g.surprise_score) || 0,
                commercial_value: Number(g.commercial_value) || 0,
                source: srcData
            });
        });

        const seen = new Set();
        const dedupe = (arr) => arr.filter(g => {
            const a = norm(g.topic_a), b = norm(g.reveal_finding);
            if (seen.has(a) || seen.has(b)) return false;
            seen.add(a); seen.add(b); return true;
        });

        const solid = dedupe(validated.filter(g => g.surprise_score >= 6).sort((x, y) => y.surprise_score - x.surprise_score));
        let shown = solid.slice(0, 4);
        shown.forEach(g => g._tier = 'gem');

        if (shown.length === 0) {
            const near = dedupe(validated.filter(g => g.surprise_score >= 5).sort((x, y) => y.surprise_score - x.surprise_score)).slice(0, 2);
            near.forEach(g => g._tier = 'near');
            shown = near;
        }

        if (shown.length === 0) {
            updateGemHeader([]);
            grid.innerHTML = '<p class="placeholder-text">No clear hidden gems stood out this time. Try a Deep search or a longer time frame to surface more.</p>';
            renderHiddenStatsFromGems([], posts, audienceContext);
            return;
        }

        updateGemHeader(shown);
        window._exportData = window._exportData || {}; window._exportData.gems = shown;

        grid.innerHTML = '';
        const set = (root, sel, val) => { const e = root.querySelector(sel); if (e) e.innerText = val; };
        shown.forEach(g => {
            const card = GEM_BLUEPRINT.cloneNode(true);
            card.classList.remove('is-flipped');
            card.style.display = '';
            set(card, '.topic-a', g.topic_a);
            set(card, '.front-summary', g.front_teaser);
            set(card, '.topic-a-back', g.topic_a);
            set(card, '.reveal-finding', g.reveal_finding);
            set(card, '.reveal-summary', g.reveal_summary);
            set(card, '.gem-category', CATEGORY_LABELS[g.category] || '');
            set(card, '.gem-tier', g._tier === 'near' ? 'Worth a look' : '');
            const stat = card.querySelector('.gem-stat');
            if (stat) {
                const src = g.source;
                const q = g.quote.length > 120 ? g.quote.slice(0, 117) + '...' : g.quote;
                stat.innerText = src ? `“${q}” — r/${src.subreddit}` : `“${q}”`;
            }
            card.addEventListener('click', () => card.classList.toggle('is-flipped'));
            grid.appendChild(card);
        });

        renderHiddenStatsFromGems(validated, posts, audienceContext);

    } catch (error) {
        console.error('Hidden Gems error:', error);
        grid.innerHTML = '<p class="error-message">Could not generate hidden gems.</p>';
    }
}

function renderHiddenStatsFromGems(gems, posts, audienceContext) {
    const c = document.getElementById('hidden-stats');
    if (!c) return;

    if (!window._hiddenStatBlueprint) {
        const bp = c.querySelector('.hidden-stat-card');
        if (bp) window._hiddenStatBlueprint = bp.cloneNode(true);
    }
    const STAT_BLUEPRINT = window._hiddenStatBlueprint;

    const texts = (posts || []).map(p =>
        `${p.data.title || p.data.link_title || ''} ${p.data.selftext || p.data.body || ''}`.toLowerCase()
    );
    const N = texts.length || 1;

    const GEN = new Set(['the','and','for','that','with','have','your','their','about','this','from','they','them',
        'what','when','will','would','people','really','very','just','like','some','more','most','also','they']);
    const AUD = new Set((audienceContext || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean));

    const dfCache = new Map();
    const df = (kw) => {
        if (!kw) return 0;
        if (dfCache.has(kw)) return dfCache.get(kw);
        const n = texts.reduce((a, t) => a + (t.includes(kw) ? 1 : 0), 0);
        dfCache.set(kw, n); return n;
    };
    const both = (a, b) => texts.reduce((n, t) => n + ((t.includes(a) && t.includes(b)) ? 1 : 0), 0);

    const salient = (label) => {
        const words = (label || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
            .filter(w => w.length > 2 && !GEN.has(w) && !AUD.has(w))
            .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) ? w.slice(0, -1) : w);
        if (!words.length) return null;
        let best = null, bestDf = 0;
        for (const w of words) { const d = df(w); if (d > bestDf) { bestDf = d; best = w; } }
        return best;
    };

    const used = new Set();
    const liftCards = [], prevCards = [];

    for (const g of (gems || [])) {
        const ka = salient(g.topic_a), kb = salient(g.reveal_finding);

        if (ka && kb && ka !== kb && !used.has(ka) && !used.has(kb)) {
            const dfA = df(ka), dfB = df(kb), bo = both(ka, kb);
            if (bo >= 2 && dfA > 0 && dfB > 0) {
                const lift = (bo / N) / ((dfA / N) * (dfB / N));
                if (isFinite(lift) && lift >= 1.3) {
                    used.add(ka); used.add(kb);
                    liftCards.push({
                        number: `${lift.toFixed(1)}x`,
                        sentence: `Among ${audienceContext}, discussions about ${g.topic_a} are far more likely to also mention ${g.reveal_finding}.`,
                        sort: lift * Math.log2(bo + 1)
                    });
                    continue; 
                }
            }
        }

        for (const [label, kw] of [[g.topic_a, ka], [g.reveal_finding, kb]]) {
            if (!kw || used.has(kw)) continue;
            const share = df(kw) / N;
            if (share >= 0.04 && share <= 0.7) {
                used.add(kw);
                prevCards.push({
                    number: `${Math.round(share * 100)}%`,
                    sentence: `of ${audienceContext} discussions touch on ${label}.`,
                    sort: share
                });
            }
        }
    }

    liftCards.sort((a, b) => b.sort - a.sort);
    prevCards.sort((a, b) => b.sort - a.sort);
    const out = [...liftCards];
    for (const p of prevCards) { if (out.length >= 4) break; out.push(p); }
    const top = out.slice(0, 4);
    window._exportData = window._exportData || {}; window._exportData.stats = top;

    if (top.length === 0) {
        c.innerHTML = '<p class="placeholder-text">No standout audience stats this time.</p>';
        return;
    }

    if (STAT_BLUEPRINT) {
        c.innerHTML = '';
        top.forEach(s => {
            const card = STAT_BLUEPRINT.cloneNode(true);
            card.style.display = '';
            const numEl = card.querySelector('.hidden-stat-number');
            const txtEl = card.querySelector('.hidden-stat-text');
            if (numEl) numEl.innerText = s.number;
            if (txtEl) txtEl.innerText = s.sentence;
            c.appendChild(card);
        });
    } else {
        const esc = (t) => (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        c.innerHTML = top.map(s => `
            <div class="hidden-stat-card" style="display:flex; gap:14px; align-items:center; padding:14px 16px; margin-bottom:10px; background:rgba(0,165,206,0.06); border-radius:12px;">
                <div class="hidden-stat-number" style="font-size:1.6rem; font-weight:700; color:#00a5ce; white-space:nowrap;">${esc(s.number)}</div>
                <div class="hidden-stat-text" style="font-size:0.98rem; line-height:1.4; color:#1f2937;">${esc(s.sentence)}</div>
            </div>
        `).join('');
    }
}

async function buildGroundingMap(keywords, posts) {
    const lowerTexts = posts.map(p =>
        `${p.data.title || p.data.link_title || ''} ${p.data.selftext || p.data.body || ''}`.toLowerCase()
    );
    const map = new Map();
    (keywords || []).forEach(kw => {
        if (kw) map.set(kw.toLowerCase().trim(), countKeywordMentions(kw, lowerTexts));
    });
    return map;
}

function groundingCount(keyword, groundingMap, lowerTexts) {
    if (!keyword) return 0;
    if (groundingMap) {
        const v = groundingMap.get(keyword.toLowerCase().trim());
        if (v !== undefined) return v;
    }
    return countKeywordMentions(keyword, lowerTexts);
}

function countKeywordMentions(keyword, lowerTexts) {
    if (!keyword) return 0;
    const words = keyword.toLowerCase().split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.includes(w))
        .map(w => lemmatize(w)); 
    if (words.length === 0) return 0;
    let count = 0;
    for (const text of lowerTexts) {
        let matched = 0;
        for (const w of words) { if (text.includes(w)) matched++; }
        if (matched / words.length >= 0.5) count++;
    }
    return count;
}

function getSeoConfidence(postCount) {
    if (postCount >= 120) {
        return { level: 'High confidence', key: 'high', text: `Built from ${postCount} community discussions. A broad, reliable sample for this audience.` };
    }
    if (postCount >= 50) {
        return { level: 'Medium confidence', key: 'medium', text: `Built from ${postCount} community discussions. Directional and useful, but validate before putting real budget behind it.` };
    }
    return { level: 'Low confidence', key: 'low', text: `Built from only ${postCount} community discussions. Treat these as early hints, not conclusions. A Deep search or longer time frame will sharpen them.` };
}

function renderSeoConfidence(confidence) {
    const banner = document.getElementById('seo-confidence-banner');
    if (!banner) return;
    banner.setAttribute('data-confidence', confidence.key);
    const labelEl = banner.querySelector('.seo-confidence-label');
    const textEl = banner.querySelector('.seo-confidence-text');
    if (labelEl) labelEl.innerText = confidence.level;
    if (textEl) textEl.innerText = confidence.text;
}

function generateNgrams(words, n) {
    const ngrams = [];
    if (n > words.length) {
        return ngrams;
    }
    for (let i = 0; i <= words.length - n; i++) {
        const ngramSlice = words.slice(i, i + n);
        if (!ngramSlice.some(word => stopWords.includes(word))) {
            ngrams.push(ngramSlice.join(' '));
        }
    }
    return ngrams;
}

async function classifySentimentWithAI(posts) {
    const BATCH_SIZE = 25; 
    let allSentiments = [];

    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
        const batch = posts.slice(i, i + BATCH_SIZE);
        const postsForAI = batch.map((p, index) => ({
            index: index,
            text: `Title: ${p.data.title || ''}. Body: ${(p.data.selftext || p.data.body || '').substring(0, 400)}`
        }));

        const prompt = `You are a sentiment analysis engine. For each post provided, classify its overall sentiment towards the main subject as "Positive", "Negative", or "Neutral". Respond ONLY with a valid JSON object with a single key "sentiments", which is an array of objects. Each object must have two keys: "post_index" and "sentiment".

        Example Response:
        { "sentiments": [ {"post_index": 0, "sentiment": "Positive"}, {"post_index": 1, "sentiment": "Negative"} ] }

        Posts to analyze:
        ${JSON.stringify(postsForAI)}`;

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are a precise JSON-only sentiment classifier." }, { role: "user", content: prompt }],
            temperature: 0,
            max_completion_tokens: 1500,
            response_format: { "type": "json_object" }
        };

        try {
            const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
            if (response && response.openaiResponse) {
                const parsed = JSON.parse(response.openaiResponse);
                if (parsed.sentiments && Array.isArray(parsed.sentiments)) {
                    const sentimentMap = new Map(parsed.sentiments.map(s => [s.post_index, s.sentiment]));
                    const batchSentiments = postsForAI.map(p => sentimentMap.get(p.index) || 'Neutral');
                    allSentiments.push(...batchSentiments);
                }
            } else {
                allSentiments.push(...Array(batch.length).fill('Neutral'));
            }
        } catch (error) {
            console.error("AI sentiment classification batch failed:", error);
            allSentiments.push(...Array(batch.length).fill('Neutral'));
        }
    }
    return allSentiments;
}

function countSentimentWords(posts) {
    let positive = 0, negative = 0;

    const negations = new Set([
        'not', 'no', 'never', 'dont', 'doesnt', 'isnt', 'arent',
        'wasnt', 'werent', 'havent', 'hadnt', 'cannot', 'cant', 'without'
    ]);

    posts.forEach(post => {
        const text = `${post.data.title || ''} ${post.data.selftext || post.data.body || ''}`.toLowerCase();
        const words = text.replace(/[^a-z\s']/g, '').split(/\s+/).filter(Boolean);

        words.forEach((rawWord, idx) => {
            if (rawWord.length < 3) return;
            const lemma = lemmatize(rawWord);

            const isPositive = positiveWords.has(lemma);
            const isNegative = negativeWords.has(lemma);

            if (isPositive || isNegative) {
                let isNegated = false;
                const startLookback = Math.max(0, idx - 2);
                for (let j = startLookback; j < idx; j++) {
                    if (negations.has(words[j])) { isNegated = true; break; }
                }

                if (isNegated) {
                    if (isPositive) negative++;
                    if (isNegative) positive++;
                } else {
                    if (isPositive) positive++;
                    if (isNegative) negative++;
                }
            }
        });
    });
    return { positive, negative };
}

async function generateSentimentContextWithAI(posts, brandName) {
    const samplePosts = posts.slice(0, 25);
    if (samplePosts.length === 0) {
        return { positive_theme: "", negative_theme: "", verdict: "No discussion found for this period." };
    }

    const postsForAI = samplePosts.map(p => `"${(p.data.title || '')} - ${(p.data.selftext || p.data.body || '').substring(0, 250)}"`).join('\n');

    const prompt = `You are a market research analyst. Below is a sample of user comments about "${brandName}".
    Your task is to provide a brief, insightful summary of the discussion.

    Respond ONLY with a valid JSON object with three keys:
    1.  "positive_theme": A single, short sentence describing the main reason for positive sentiment. If none, return "".
    2.  "negative_theme": A single, short sentence describing the main reason for negative sentiment. If none, return "".
    3.  "verdict": A single concluding sentence that explains the overall sentiment balance.

    User Comments:
    ${postsForAI}`;

    const openAIParams = {
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a concise market analyst outputting only JSON." }, { role: "user", content: prompt }],
        temperature: 0.1,
        max_completion_tokens: 300,
        response_format: { "type": "json_object" }
    };

    try {
        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            return JSON.parse(response.openaiResponse);
        }
    } catch (error) {
        console.error("AI context generation failed:", error);
    }
    return { positive_theme: "N/A", negative_theme: "N/A", verdict: "Could not generate context." };
}

function deduplicatePosts(posts) { const seen = new Set(); return posts.filter(post => { if (!post.data || !post.data.id) return false; if (seen.has(post.data.id)) return false; seen.add(post.data.id); return true; }); }
function formatDate(utcSeconds) { const date = new Date(utcSeconds * 1000); return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
async function fetchRedditForTermWithPagination(niche, term, totalLimit = 100, timeFilter = 'all', searchInComments = false) { let allPosts = []; let after = null; try { while (allPosts.length < totalLimit) { const payload = { searchTerm: term, niche: niche, limit: 25, timeFilter: timeFilter, after: after }; if (searchInComments) { payload.includeComments = true; } const response = await fetch(REDDIT_PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) { throw new Error(`Proxy Error: Server returned status ${response.status}`); } const data = await response.json(); if (!data.data || !data.data.children || !data.data.children.length) break; allPosts = allPosts.concat(data.data.children); after = data.data.after; if (!after) break; } } catch (err) { console.error(`Failed to fetch posts for term "${term}" via proxy:`, err.message); return []; } return allPosts.slice(0, totalLimit); }
async function fetchMultipleRedditDataBatched(niche, searchTerms, limitPerTerm = 100, timeFilter = 'all', searchInComments = false) { const allResults = []; for (let i = 0; i < searchTerms.length; i += 8) { const batchTerms = searchTerms.slice(i, i + 8); const batchPromises = batchTerms.map(term => fetchRedditForTermWithPagination(niche, term, limitPerTerm, timeFilter, searchInComments)); const batchResults = await Promise.all(batchPromises); batchResults.forEach(posts => { if (Array.isArray(posts)) { allResults.push(...posts); } }); if (i + 8 < searchTerms.length) { await new Promise(resolve => setTimeout(resolve, 500)); } } return deduplicatePosts(allResults); }

let _proxyActive = 0;
const _proxyWaiters = [];
const PROXY_MAX_CONCURRENT = 3;
function _acquireProxySlot() {
    if (_proxyActive < PROXY_MAX_CONCURRENT) { _proxyActive++; return Promise.resolve(); }
    return new Promise(resolve => _proxyWaiters.push(resolve));
}
function _releaseProxySlot() {
    if (_proxyWaiters.length) { const next = _proxyWaiters.shift(); next(); }
    else _proxyActive = Math.max(0, _proxyActive - 1);
}

async function limitedFetch(url, opts) {
    await _acquireProxySlot();
    try { return await fetch(url, opts); }
    finally { _releaseProxySlot(); }
}

async function callOpenAIProxyWithRetry(openaiPayload, { tries = 2, backoffMs = 600 } = {}) {
    for (let attempt = 0; attempt <= tries; attempt++) {
        try {
            const res = await limitedFetch(OPENAI_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ openaiPayload })
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.openaiResponse) return data;            
                if (data && data.error) console.warn(`[AI retry] proxy error (attempt ${attempt + 1}/${tries + 1}):`, data.error);
                else console.warn(`[AI retry] empty body (attempt ${attempt + 1}/${tries + 1}) - likely the 25s latency limit; retrying.`);
            } else {
                console.warn(`[AI retry] proxy HTTP ${res.status} (attempt ${attempt + 1}/${tries + 1})`);
            }
        } catch (e) {
            console.warn(`[AI retry] network error (attempt ${attempt + 1}/${tries + 1}):`, e && e.message);
        }
        if (attempt < tries) await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)));
    }
    return null;
}

function renderCountHeader(insightsCount, postsCount, audience) {
    const ch = document.getElementById('count-header');
    if (!ch) return;
    if (window._countHeaderBlueprint) {
        ch.innerHTML = window._countHeaderBlueprint;
        const set = (sel, val) => { const e = ch.querySelector(sel); if (e) e.innerText = val; };
        set('.count-insights', Number(insightsCount).toLocaleString());
        set('.count-posts', Number(postsCount).toLocaleString());
        set('.count-audience', audience || '');
    } else {
        ch.innerHTML = `Distilled <span class="header-pill pill-insights">${Number(insightsCount).toLocaleString()}</span> insights from <span class="header-pill pill-posts">${Number(postsCount).toLocaleString()}</span> posts for <span class="header-pill pill-audience">${audience}</span>`;
    }
}

function parseAISummary(aiResponse) {
    try {
        if (!aiResponse) {
            throw new Error("AI Response was empty or undefined.");
        }
        aiResponse = aiResponse.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim();
        const jsonMatch = aiResponse.match(/{[\s\S]*}/);
        if (!jsonMatch) {
            throw new Error("No JSON object in AI response.");
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.summaries || !Array.isArray(parsed.summaries) || parsed.summaries.length < 1) {
            throw new Error("AI response lacks a 'summaries' array.");
        }
        return parsed.summaries;
    } catch (error) {
        console.error("Parsing Error:", error);
        return [];
    }
}

function parseAIAssignments(aiResponse) { 
    try { 
        aiResponse = (aiResponse || '').replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim(); 
        const jsonMatch = aiResponse.match(/{[\s\S]*}/); 
        if (!jsonMatch) throw new Error("No JSON object in AI response."); 
        const parsed = JSON.parse(jsonMatch[0]); 
        if (!parsed.assignments || !Array.isArray(parsed.assignments)) throw new Error("AI response lacks an 'assignments' array."); 
        const valid = parsed.assignments.map(a => ({ postNumber: parseInt(a && a.postNumber, 10), finding: parseInt(a && a.finding, 10) })).filter(a => Number.isInteger(a.postNumber) && Number.isInteger(a.finding)); 
        return valid; 
    } catch (error) { 
        console.error("Parsing Error (assignments):", error); 
        return []; 
    } 
}

function filterPosts(posts, minUpvotes = 20) { return posts.filter(post => { const title = (post.data.title || post.data.link_title || '').toLowerCase(); const selftext = post.data.selftext || post.data.body || ''; if (title.includes('[ad]') || title.includes('sponsored') || post.data.upvote_ratio < 0.2 || post.data.ups < minUpvotes || !selftext || selftext.length < 20) return false; const isRamblingOrNoisy = (text) => { if (!text) return false; return /&#x[0-9a-fA-F]+;/g.test(text) || /[^a-zA-Z0-9\s]{5,}/g.test(text) || /(.)\1{6,}/g.test(text); }; return !isRamblingOrNoisy(title) && !isRamblingOrNoisy(selftext); }); }
function getTopKeywords(posts, topN = 10) { const freqMap = {}; posts.forEach(post => { const cleanedText = `${post.data.title || post.data.link_title || ''} ${post.data.selftext || post.data.body || ''}`.replace(/<[^>]+>/g, '').replace(/[^a-zA-Z0-9\s.,!?]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); const words = cleanedText.split(/\s+/); words.forEach(word => { if (!stopWords.includes(word) && word.length > 2) { freqMap[word] = (freqMap[word] || 0) + 1; } }); }); return Object.keys(freqMap).sort((a, b) => freqMap[b] - freqMap[a]).slice(0, topN); }
function getFirstTwoSentences(text) { if (!text) return ''; const sentences = text.match(/[^\.!\?]+[\.!\?]+(?:\s|$)/g); return sentences ? sentences.slice(0, 2).join(' ').trim() : text; }

async function assignPostsToFindings(summaries, posts) {
    const postsForAI = posts.slice(0, 50);
    const prompt = `You are an expert data analyst. Your task is to categorize Reddit posts into the most relevant "Finding" from a provided list.\n\nHere are the ${summaries.length} findings:\n${summaries.map((s, i) => `Finding ${i + 1}: ${s.title}`).join('\n')}\n\nHere are the ${postsForAI.length} Reddit posts:\n${postsForAI.map((p, i) => `Post ${i + 1}: ${(p.data.title || p.data.link_title || '').substring(0, 150)}`).join('\n')}\n\nINSTRUCTIONS: For each post, assign it to the most relevant Finding (from 1 to ${summaries.length}). Respond ONLY with a JSON object with a single key "assignments", which is an array of objects like {"postNumber": 1, "finding": 2}.`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a precise data categorization engine that outputs only JSON." }, { role: "user", content: prompt }], temperature: 0, max_completion_tokens: 1500, response_format: { "type": "json_object" } };
    try {
        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            return parseAIAssignments(response.openaiResponse);
        }
    } catch (error) {
        console.error("Assignment function error:", error);
    }
    return [];
}

function calculateRelevanceScore(post, finding) { let score = 0; const postTitle = (post.data.title || post.data.link_title || "").toLowerCase(); const postBody = (post.data.selftext || post.data.body || "").toLowerCase(); const findingTitleWords = finding.title.toLowerCase().split(' ').filter(word => word.length > 3 && !stopWords.includes(word)); const findingKeywords = (finding.keywords || []).map(k => k.toLowerCase()); let titleWordMatched = false, keywordMatched = false; for (const word of findingTitleWords) { const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); if (regex.test(postTitle)) { score += 5; titleWordMatched = true; } if (regex.test(postBody)) { score += 2; titleWordMatched = true; } } for (const keyword of findingKeywords) { const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); if (regex.test(postTitle)) { score += 3; keywordMatched = true; } if (regex.test(postBody)) { score += 1; keywordMatched = true; } } if (titleWordMatched && keywordMatched) { score += 10; } return score; }
function calculateFindingMetrics(validatedSummaries, filteredPosts) { const metrics = {}; const allProblemPostIds = new Set(); validatedSummaries.forEach((finding, index) => { metrics[index] = { supportCount: 0 }; }); filteredPosts.forEach(post => { let bestFindingIndex = -1; let maxScore = 0; validatedSummaries.forEach((finding, index) => { const score = calculateRelevanceScore(post, finding); if (score > maxScore) { maxScore = score; bestFindingIndex = index; } }); if (bestFindingIndex !== -1 && maxScore > 0) { metrics[bestFindingIndex].supportCount++; allProblemPostIds.add(post.data.id); } }); metrics.totalProblemPosts = allProblemPostIds.size; return metrics; }

function renderPosts(posts) {
    const container = document.getElementById("posts-container");
    if (!container) return;
    container.innerHTML = posts.map(post => {
        const content = post.data.selftext || post.data.body || 'No additional content.';
        const title = post.data.title || post.data.link_title || 'View Comment Thread';
        const num_comments = post.data.num_comments ? `| 💬 ${post.data.num_comments.toLocaleString()}` : '';
        return `
            <div class="insight">
                <a href="https://www.reddit.com${post.data.permalink}" target="_blank" rel="noopener noreferrer" class="insight-title">
                    ${title}
                </a>
                <p class="insight-content">
                    ${content.substring(0, 200) + '...'}
                </p>
                <small class="insight-meta">
                    r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} ${num_comments} | 🗓️ ${formatDate(post.data.created_utc)}
                </small>
            </div>
        `;
    }).join('');
}

function showSamplePosts(summaryIndex, assignments, allPosts, usedPostIds) {
    if (!assignments) return;
    const finding = window._summaries[summaryIndex];
    if (!finding) return;

    const container = document.getElementById(`reddit-div${summaryIndex + 1}`);
    if (!container) return;

    if (!SAMPLE_INSIGHT_BLUEPRINT) {
        const tpl = document.querySelector('.reddit-samples-posts .sample-insight');
        if (tpl) SAMPLE_INSIGHT_BLUEPRINT = tpl.cloneNode(true);
    }

    let relevantPosts = [];
    const addedPostIds = new Set();
    const addPost = (post) => {
        if (post && post.data && !usedPostIds.has(post.data.id) && !addedPostIds.has(post.data.id)) {
            relevantPosts.push(post);
            addedPostIds.add(post.data.id);
        }
    };

    const assignedPostNumbers = assignments.filter(a => a.finding === (summaryIndex + 1)).map(a => a.postNumber);
    assignedPostNumbers.forEach(postNum => {
        if (postNum - 1 < window._postsForAssignment.length) {
            addPost(window._postsForAssignment[postNum - 1]);
        }
    });

    if (relevantPosts.length < 8) {
        const candidatePool = allPosts.filter(p => !usedPostIds.has(p.data.id) && !addedPostIds.has(p.data.id));
        const scoredCandidates = candidatePool.map(post => ({
            post: post,
            score: calculateRelevanceScore(post, finding)
        })).filter(item => item.score >= 4).sort((a, b) => b.score - a.score);

        for (const candidate of scoredCandidates) {
            if (relevantPosts.length >= 8) break;
            addPost(candidate.post);
        }
    }

    const headerEl = container.querySelector('.reddit-samples-header');
    if (headerEl) headerEl.textContent = finding.title;

    const postsWrap = container.querySelector('.reddit-samples-posts');
    if (!postsWrap) return;
    postsWrap.innerHTML = '';

    if (relevantPosts.length === 0) {
        postsWrap.innerHTML = `<p class="no-posts-found">Could not find any highly relevant Reddit posts for this finding.</p>`;
        return;
    }
    if (!SAMPLE_INSIGHT_BLUEPRINT) {
        console.error('Sample posts: .sample-insight template not found inside .reddit-samples-posts.');
        return;
    }

    const finalPosts = relevantPosts.slice(0, 8);
    finalPosts.forEach(post => usedPostIds.add(post.data.id));

    finalPosts.forEach(post => {
        const card = SAMPLE_INSIGHT_BLUEPRINT.cloneNode(true);
        card.style.display = '';
        const content = post.data.selftext || post.data.body || 'No content.';
        const title = post.data.title || post.data.link_title || 'View Comment';
        const numComments = post.data.num_comments ? ` | 💬 ${post.data.num_comments.toLocaleString()}` : '';

        const titleEl = card.querySelector('.sample-insight-title');
        if (titleEl) titleEl.textContent = title;

        const contentEl = card.querySelector('.sample-insight-content');
        if (contentEl) contentEl.textContent = content.substring(0, 150) + '...';

        const metaEl = card.querySelector('.sample-insight-meta');
        if (metaEl) metaEl.textContent = `r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()}${numComments} | 🗓️ ${formatDate(post.data.created_utc)}`;

        const link = card.matches('a') ? card : card.querySelector('a');
        if (link) {
            link.href = `https://www.reddit.com${post.data.permalink}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
        postsWrap.appendChild(card);
    });
}

async function getRelatedSearchTermsAI(audience) {
    const prompt = `Given the target audience "${audience}", generate up to 5 related but distinct search terms or concepts that would help find communities for them. Think about activities, problems, life stages, and related interests. Respond ONLY with a valid JSON object with a single key "terms", which is an array of strings.`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a creative brainstorming assistant that outputs only JSON." }, { role: "user", content: prompt }], temperature: 0.4, max_completion_tokens: 150, response_format: { "type": "json_object" } };
    try {
        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse);
            return parsed.terms || [];
        }
    } catch (error) {
        console.error("Error generating related search terms:", error);
    }
    return [];
}

async function findSubredditsForGroup(groupName) {
    const relatedTerms = await getRelatedSearchTermsAI(groupName);
    window._audienceTopics = Array.isArray(relatedTerms) ? relatedTerms : [];
    const allTerms = [groupName, ...relatedTerms];
    const prompt = `Based on the following audience and related keywords: [${allTerms.join(', ')}], suggest up to 20 relevant and active Reddit subreddits. Prioritize a variety of communities, including both large general ones and smaller niche ones. Provide your response ONLY as a JSON object with a single key "subreddits" which contains an array of subreddit names (without "r/").`;
    const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an expert Reddit community finder providing answers in strict JSON format." }, { role: "user", content: prompt }], temperature: 0.2, max_completion_tokens: 300, response_format: { "type": "json_object" } };
    try {
        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse);
            if (!parsed.subreddits || !Array.isArray(parsed.subreddits)) throw new Error("AI response did not contain a 'subreddits' array.");
            return parsed.subreddits;
        }
    } catch (error) {
        console.error("Error finding subreddits:", error);
        alert("Sorry, I couldn't find any relevant communities. Please try another group name.");
    }
    return [];
}

let _redditActive = 0;
const _redditWaiters = [];
const REDDIT_MAX_CONCURRENT = 3;
function _acquireReddit() {
    if (_redditActive < REDDIT_MAX_CONCURRENT) { _redditActive++; return Promise.resolve(); }
    return new Promise(resolve => _redditWaiters.push(resolve));
}
function _releaseReddit() {
    if (_redditWaiters.length) { _redditWaiters.shift()(); }
    else _redditActive = Math.max(0, _redditActive - 1);
}

const _commentCache = new Map();

async function _fetchOneCommentThread(postId, tries = 2) {
    for (let attempt = 0; attempt <= tries; attempt++) {
        await _acquireReddit();
        try {
            const res = await fetch(REDDIT_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'comments', postId })
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 1 && data[1].data && data[1].data.children) {
                    return data[1].data.children.filter(c => c.kind === 't1');
                }
                return [];
            }
        } catch (e) {
            // fail-silent retry
        } finally {
            _releaseReddit();
        }
        if (attempt < tries) await new Promise(r => setTimeout(r, 900 * (attempt + 1)));
    }
    return [];
}

async function fetchCommentsForPosts(postIds, batchSize = 3) {
    let allComments = [];
    const toFetch = [];
    (postIds || []).forEach(id => {
        if (_commentCache.has(id)) allComments.push(...(_commentCache.get(id) || []));
        else if (id) toFetch.push(id);
    });
    for (let i = 0; i < toFetch.length; i += batchSize) {
        const batchIds = toFetch.slice(i, i + batchSize);
        const results = await Promise.all(batchIds.map(id => _fetchOneCommentThread(id)));
        results.forEach((comments, j) => { _commentCache.set(batchIds[j], comments); allComments.push(...comments); });
        if (i + batchSize < toFetch.length) await new Promise(resolve => setTimeout(resolve, 450));
    }
    return allComments;
}

function lemmatize(word) { if (lemmaMap[word]) return lemmaMap[word]; if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); return word; }

async function generateEmotionMapData(posts) { 
    try { 
        const topPostsText = posts.slice(0, 40).map(p => `Title: ${p.data.title || p.data.link_title}\nBody: ${(p.data.selftext || p.data.body).substring(0, 1000)}`).join('\n---\n'); 
        const prompt = `You are a world-class market research analyst for '${originalGroupName}'. Analyze the following text to identify the 15 most significant problems, pain points, or key topics.\n\nFor each one, provide:\n1. "problem": A short, descriptive name for the problem (e.g., "Finding Reliable Vendors", "Budgeting Anxiety").\n2. "intensity": A score from 1 (mild) to 10 (severe) of how big a problem this is.\n3. "frequency": A score from 1 (rarely mentioned) to 10 (frequently mentioned) based on its prevalence in the text.\n\nRespond ONLY with a valid JSON object with a single key "problems", which is an array of these objects.\nExample: { "problems": [{ "problem": "Catering Costs", "intensity": 8, "frequency": 9 }] }`; 
        const openAIParams = { model: "gpt-4o", messages: [{ role: "system", content: "You are a market research analyst that outputs only valid JSON." }, { role: "user", content: prompt }], temperature: 0.2, max_completion_tokens: 1500, response_format: { "type": "json_object" } }; 
        
        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 }); 
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse); 
            const aiProblems = parsed.problems || []; 
            if (aiProblems.length >= 3) { 
                console.log("Successfully used AI analysis for Problem Map."); 
                const chartData = aiProblems.map(item => { 
                    if (!item.problem || typeof item.intensity !== 'number' || typeof item.frequency !== 'number') return null; 
                    return { x: item.frequency, y: item.intensity, label: item.problem }; 
                }).filter(Boolean); 
                return chartData.sort((a, b) => b.x - a.x); 
            } else { 
                console.warn("AI analysis returned too few problems. Falling back to keyword analysis."); 
            } 
        }
    } catch (error) { 
        console.error("AI analysis for Problem Map failed:", error, "Falling back to reliable keyword-based analysis."); 
    } 
    
    const emotionFreq = {}; 
    posts.forEach(post => { 
        const text = `${post.data.title || post.data.link_title || ''} ${post.data.selftext || post.data.body || ''}`.toLowerCase(); 
        const words = text.replace(/[^a-z\s']/g, '').split(/\s+/); 
        words.forEach(rawWord => { 
            const lemma = lemmatize(rawWord); 
            if (emotionalIntensityScores[lemma]) { 
                emotionFreq[lemma] = (emotionFreq[lemma] || 0) + 1; 
            } 
        }); 
    }); 
    const chartData = Object.entries(emotionFreq).map(([word, freq]) => ({ x: freq, y: emotionalIntensityScores[word], label: word })); 
    return chartData.sort((a, b) => b.x - a.x).slice(0, 25); 
}
// =================================================================================
// PART 2 OF 3: CHARTS, SENTIMENT, DEEP DIVES & SEO PLANNERS
// =================================================================================

function renderEmotionMap(data) {
    const container = document.getElementById('emotion-map-container');
    if (!container) return;

    if (window.myEmotionChart) {
        window.myEmotionChart.destroy();
    }

    if (data.length < 3) {
        container.innerHTML = `<p class="chart-placeholder-text">Not enough distinct problems were found to build a map.</p>`;
        return;
    }

    container.innerHTML = `
        <div id="emotion-map-wrapper">
            <div id="emotion-map">
                <canvas id="emotion-chart-canvas"></canvas>
            </div>
            <button id="chart-zoom-btn"></button>
        </div>
    `;

    const ctx = document.getElementById('emotion-chart-canvas')?.getContext('2d');
    if (!ctx) return;

    const maxFreq = Math.max(...data.map(p => p.x));
    const allFrequencies = data.map(p => p.x);
    const minObservedFreq = Math.min(...allFrequencies);
    const collapsedMinX = 5;
    const isCollapseFeatureEnabled = minObservedFreq >= collapsedMinX;
    const initialMinX = isCollapseFeatureEnabled ? collapsedMinX : 0;

    window.myEmotionChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Problems/Topics',
                data: data,
                backgroundColor: '#00a5ce',
                borderColor: 'rgba(255, 255, 255, 0.5)',
                borderWidth: 1,
                pointRadius: (context) => 5 + (context.raw.x / maxFreq) * 20,
                pointHoverRadius: (context) => 8 + (context.raw.x / maxFreq) * 20,
                clip: false,
            }]
        },
        options: {
            maintainAspectRatio: false,
            layout: { padding: { top: 30, right: 35, bottom: 10, left: 10 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'nearest',
                    intersect: false,
                    callbacks: {
                        title: function (tooltipItems) { return tooltipItems[0].raw.label; },
                        label: function (context) { return ''; },
                        afterBody: function (tooltipItems) {
                            const point = tooltipItems[0].raw;
                            return `Frequency: ${point.x}, Intensity: ${point.y.toFixed(1)}`;
                        }
                    },
                    displayColors: false,
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 12 },
                    backgroundColor: '#d6539d',
                    titleColor: '#ffffff',
                    bodyColor: '#dddddd',
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Frequency (1-10)', color: 'white', font: { weight: 'bold' } },
                    min: initialMinX,
                    max: 10,
                    grid: { color: 'rgba(255, 255, 255, 0.15)' },
                    ticks: { color: 'white' }
                },
                y: {
                    title: { display: true, text: 'Problem Intensity (1-10)', color: 'white', font: { weight: 'bold' } },
                    min: 0,
                    max: 10,
                    grid: { color: 'rgba(255, 255, 255, 0.15)' },
                    ticks: { color: 'white' }
                }
            }
        }
    });

    const zoomButton = document.getElementById('chart-zoom-btn');
    zoomButton.style.display = 'none';

    if (isCollapseFeatureEnabled) {
        zoomButton.style.display = 'block';
        const updateButtonText = () => {
            const isCurrentlyCollapsed = window.myEmotionChart.options.scales.x.min !== 0;
            zoomButton.textContent = isCurrentlyCollapsed ? 'Zoom Out to See Full Range' : 'Zoom In to High-Frequency';
        };

        zoomButton.addEventListener('click', () => {
            const chart = window.myEmotionChart;
            const isCurrentlyCollapsed = chart.options.scales.x.min !== 0;
            chart.options.scales.x.min = isCurrentlyCollapsed ? 0 : collapsedMinX;
            chart.update('none');
            updateButtonText();
        });
        updateButtonText();
    }
}

async function generateAndRenderHybridSentiment(posts, audienceContext) {
    const positiveContainer = document.getElementById('positive-cloud');
    const negativeContainer = document.getElementById('negative-cloud');

    if (!positiveContainer || !negativeContainer) {
        console.error("Sentiment cloud containers not found.");
        return;
    }

    positiveContainer.innerHTML = `<p class="loading-text">Analyzing sentiment...</p>`;
    negativeContainer.innerHTML = `<p class="loading-text">Analyzing sentiment...</p>`;

    let positiveCount = 0, negativeCount = 0;
    const wordFreq = { positive: new Map(), negative: new Map() };

    posts.forEach(post => {
        const text = `${post.data.title || post.data.link_title || ''} ${post.data.selftext || post.data.body || ''}`.toLowerCase();
        const words = text.replace(/[^a-z\s']/g, '').split(/\s+/);
        const uniqueWordsInPost = { positive: new Set(), negative: new Set() };

        words.forEach(rawWord => {
            if (rawWord.length < 3 || stopWords.includes(rawWord)) return;
            const lemma = lemmatize(rawWord);
            if (positiveWords.has(lemma)) uniqueWordsInPost.positive.add(lemma);
            else if (negativeWords.has(lemma)) uniqueWordsInPost.negative.add(lemma);
        });

        uniqueWordsInPost.positive.forEach(word => {
            if (!wordFreq.positive.has(word)) wordFreq.positive.set(word, new Set());
            wordFreq.positive.get(word).add(post);
        });
        uniqueWordsInPost.negative.forEach(word => {
            if (!wordFreq.negative.has(word)) wordFreq.negative.set(word, new Set());
            wordFreq.negative.get(word).add(post);
        });
    });

    posts.forEach(post => {
        const text = `${post.data.title || ''} ${post.data.selftext || post.data.body || ''}`.toLowerCase();
        const words = text.replace(/[^a-z\s']/g, '').split(/\s+/);
        words.forEach(rawWord => {
            if (rawWord.length < 3) return;
            const lemma = lemmatize(rawWord);
            if (positiveWords.has(lemma)) positiveCount++;
            else if (negativeWords.has(lemma)) negativeCount++;
        });
    });
    renderSentimentScore(positiveCount, negativeCount);

    const phraseFreq = new Map();
    posts.forEach(post => {
        const text = `${post.data.title || ''} ${post.data.selftext || ''}`.toLowerCase().replace(/[^a-z\s']/g, '');
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const ngrams = [...generateNgrams(words, 2), ...generateNgrams(words, 3), ...generateNgrams(words, 4)];
        const uniqueNgramsInPost = new Set(ngrams);

        uniqueNgramsInPost.forEach(ngram => {
            if (!phraseFreq.has(ngram)) phraseFreq.set(ngram, new Set());
            phraseFreq.get(ngram).add(post);
        });
    });

    const candidatePhrases = Array.from(phraseFreq.entries())
        .filter(([_, postSet]) => postSet.size >= 2) 
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 100)
        .map(item => item[0]);

    let finalPositivePhrases = [], finalNegativePhrases = [];
    if (candidatePhrases.length > 0) {
        try {
            const prompt = `You are a market research analyst. Below is a list of common phrases from the "${audienceContext}" community. Your task is to filter this list. Identify phrases that express clear **positive sentiment** and **negative sentiment**. Ignore neutral phrases. Respond ONLY with a valid JSON object with two keys: "positive_phrases" and "negative_phrases", holding an array of the relevant strings you selected. Candidate Phrases: ${JSON.stringify(candidatePhrases)}`;
            const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are an expert sentiment filter that only outputs JSON." }, { role: "user", content: prompt }], temperature: 0.1, max_completion_tokens: 1000, response_format: { "type": "json_object" } };
            
            const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
            if (response && response.openaiResponse) {
                const parsed = JSON.parse(response.openaiResponse);
                finalPositivePhrases = parsed.positive_phrases || [];
                finalNegativePhrases = parsed.negative_phrases || [];
            }
        } catch (error) { console.error("AI phrase filtering failed, proceeding with words only.", error); }
    }

    const renderCloud = (container, title, wordMap, phraseList, colors) => {
        const topWords = Array.from(wordMap.entries())
            .map(([word, postSet]) => [word, { count: postSet.size, posts: postSet }])
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 23);

        const topPhrases = phraseList.map(phrase => {
            const postSet = phraseFreq.get(phrase);
            return [phrase, { count: postSet.size, posts: postSet }];
        }).filter(item => item[1]);

        const combinedData = [...topWords, ...topPhrases];
        const category = title.includes('Positive') ? 'positive' : 'negative';
        window._sentimentData = window._sentimentData || {};
        window._sentimentData[category] = Object.fromEntries(combinedData.map(([key, value]) => [key, value]));

        container.innerHTML = ''; 
        const cloudContainer = document.createElement('div');
        container.appendChild(cloudContainer); 

        if (combinedData.length < 3) {
            cloudContainer.innerHTML = `<p style="font-family: sans-serif; color: #777; padding: 1rem; text-align: center;">Not enough distinct terms found.</p>`; 
            return;
        }

        const counts = combinedData.map(item => item[1].count);
        const maxCount = Math.max(...counts);
        const minCount = Math.min(...counts);
        const minFontSize = 16, maxFontSize = 42;
        const cloudHTML = combinedData.map(([word, data]) => {
            const fontSize = minFontSize + ((data.count - minCount) / (maxCount - minCount || 1)) * (maxFontSize - minFontSize);
            const color = colors[Math.floor(Math.random() * colors.length)];
            const rotation = Math.random() * 8 - 4;
            return `<span class="cloud-word" data-word="${word}" style="font-size: ${fontSize.toFixed(1)}px; color: ${color}; transform: rotate(${rotation.toFixed(1)}deg);">${word}</span>`;
        }).join('');
        cloudContainer.innerHTML = cloudHTML;
    };

    renderCloud(positiveContainer, 'Positive Words & Phrases', wordFreq.positive, finalPositivePhrases, positiveColors);
    renderCloud(negativeContainer, 'Negative Words & Phrases', wordFreq.negative, finalNegativePhrases, negativeColors);
}

async function generateAndRenderToneMap(posts, audienceContext) {
    const container = document.getElementById('tone-map-container');
    if (!container || !TONE_CARD_BLUEPRINT) return;

    container.innerHTML = '<p class="loading-text">Performing deep tonal analysis...</p>';

    try {
        const topPostsText = posts.slice(0, 40).map(p =>
            `Topic: ${p.data.title || ''} - ${(p.data.selftext || p.data.body || '').substring(0, 200)}`
        ).join('\n---\n');

        const prompt = `Analyze the ${audienceContext} community. Identify 4 distinct conversation topics.
        For each topic, provide:
        1. "topic": Short title.
        2. "traits": Array of 4 adjectives, each with a "score" from 10-100 (intensity).
        3. "insights": Array of EXACTLY 3 short standalone sentences. Each sentence must be under 15 words and express ONE distinct strategic observation. Do not combine ideas. Example format: ["AI is creating higher expectations than it can consistently meet", "Developers increasingly value judgement over automation", "Frustration is directed at the gap between promise and reality"].
        4. "level": Overall intensity (LOW, MEDIUM, or HIGH).
        
        Respond ONLY as valid JSON with key 'tone_analysis'. Posts: ${topPostsText}`;

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are a brand psychologist who outputs only valid JSON." }, { role: "user", content: prompt }],
            temperature: 0.2,
            response_format: { "type": "json_object" }
        };

        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse);
            container.innerHTML = ''; 

            parsed.tone_analysis.forEach(item => {
                const card = TONE_CARD_BLUEPRINT.cloneNode(true);
                card.querySelector('.tone-topic-title').innerText = item.topic;
                const meaningEls = card.querySelectorAll('.tone-what-means');
                const insights = Array.isArray(item.insights) ? item.insights : [];
                meaningEls.forEach((el, i) => {
                    if (insights[i]) el.innerText = insights[i];
                    else el.innerText = '';
                });
                card.querySelector('.tone-intensity-label').innerText = `INTENSITY: ${item.level}`;

                const traitsContainer = card.querySelector('.tone-traits-container');
                traitsContainer.innerHTML = '';

                item.traits.forEach(trait => {
                    const traitRow = TONE_TRAIT_BLUEPRINT.cloneNode(true);
                    traitRow.querySelector('.tone-trait-name').innerText = trait.name || trait.adjective || trait.word;
                    const fillBar = traitRow.querySelector('.tone-bar-fill');
                    if (fillBar) fillBar.style.width = `${trait.score}%`;
                    traitsContainer.appendChild(traitRow);
                });
                container.appendChild(card);
            });
        }
    } catch (error) {
        console.error("Tone Map Error:", error);
        container.innerHTML = `<p>Tonal analysis unavailable.</p>`;
    }
}

function renderContextContent(word, posts) { 
    const contextBox = document.getElementById('context-box'); 
    if (!contextBox) return; 
    const highlightRegex = new RegExp(`\\b(${word.replace(/ /g, '\\s')}[a-z]*)\\b`, 'gi'); 
    const headerHTML = ` <div class="context-header"> <h3 class="context-title">Context for: "${word}"</h3> <button class="context-close-btn" id="context-close-btn">×</button> </div> `; 
    const snippetsHTML = posts.slice(0, 10).map(post => { 
        const fullText = `${post.data.title || post.data.link_title || ''}. ${post.data.selftext || post.data.body || ''}`; 
        const sentences = fullText.match(/[^.!?]+[.!?]+/g) || []; 
        const keywordRegex = new RegExp(`\\b${word.replace(/ /g, '\\s')}[a-z]*\\b`, 'i'); 
        let relevantSentence = sentences.find(s => keywordRegex.test(s)); 
        if (!relevantSentence) relevantSentence = getFirstTwoSentences(fullText); 
        const textToShow = relevantSentence ? relevantSentence.replace(highlightRegex, `<strong>$1</strong>`) : "Snippet not available."; 
        const metaHTML = ` <div class="context-snippet-meta"> <span>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</span> </div> `; 
        return ` <div class="context-snippet"> <p class="context-snippet-text">... ${textToShow} ...</p> ${metaHTML} </div> `; 
    }).join(''); 
    contextBox.innerHTML = headerHTML + `<div class="context-snippets-wrapper">${snippetsHTML}</div>`; 
    contextBox.style.display = 'block'; 
    const closeBtn = document.getElementById('context-close-btn'); 
    if (closeBtn) { 
        closeBtn.addEventListener('click', () => { 
            contextBox.style.display = 'none'; 
            contextBox.innerHTML = ''; 
        }); 
    } 
    contextBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
}

function showSlidingPanel(word, posts, category) { 
    const positivePanel = document.getElementById('positive-context-box'); 
    const negativePanel = document.getElementById('negative-context-box'); 
    const overlay = document.getElementById('context-overlay'); 
    if (!positivePanel || !negativePanel || !overlay) { 
        console.error("Sliding context panels or overlay not found in the DOM. Add the new HTML elements."); 
        renderContextContent(word, posts); 
        return; 
    } 
    const targetPanel = category === 'positive' ? positivePanel : negativePanel; 
    const otherPanel = category === 'positive' ? negativePanel : positivePanel; 
    const highlightRegex = new RegExp(`\\b(${word.replace(/ /g, '\\s')}[a-z]*)\\b`, 'gi'); 
    const headerHTML = `<div class="context-header"><h3 class="context-title">Context for: "${word}"</h3><button class="context-close-btn">×</button></div>`; 
    const snippetsHTML = posts.slice(0, 10).map(post => { 
        const fullText = `${post.data.title || post.data.link_title || ''}. ${post.data.selftext || post.data.body || ''}`; 
        const sentences = fullText.match(/[^.!?]+[.!?]+/g) || []; 
        const keywordRegex = new RegExp(`\\b${word.replace(/ /g, '\\s')}[a-z]*\\b`, 'i'); 
        let relevantSentence = sentences.find(s => keywordRegex.test(s)); 
        if (!relevantSentence) relevantSentence = getFirstTwoSentences(fullText); 
        const textToShow = relevantSentence ? relevantSentence.replace(highlightRegex, `<strong>$1</strong>`) : 'No relevant snippet found.'; 
        const metaHTML = `<div class="context-snippet-meta"><span>r/${post.data.subreddit} | 👍 ${post.data.ups.toLocaleString()} | 🗓️ ${formatDate(post.data.created_utc)}</span></div>`; 
        return `<div class="context-snippet"><p class="context-snippet-text">... ${textToShow} ...</p>${metaHTML}</div>`; 
    }).join(''); 
    targetPanel.innerHTML = headerHTML + `<div class="context-snippets-wrapper">${snippetsHTML}</div>`; 
    const close = () => { targetPanel.classList.remove('visible'); overlay.classList.remove('visible'); }; 
    targetPanel.querySelector('.context-close-btn').onclick = close; 
    overlay.onclick = close; 
    otherPanel.classList.remove('visible'); 
    targetPanel.classList.add('visible'); 
    overlay.classList.add('visible'); 
}

async function generateAndRenderBrandBrief(itemName, itemType) {
    const isBrand = itemType === 'brands';
    const targetPanel = document.getElementById(isBrand ? 'brand-detail-panel' : 'product-detail-panel');
    if (!targetPanel) return;

    targetPanel.innerHTML = '<div class="brief-content"><p class="loading-text">Building brief... <span class="loader-dots"></span></p></div>';

    if (briefCache.has(itemName)) {
        targetPanel.innerHTML = briefCache.get(itemName);
        if (isBrand && targetPanel.querySelector('#brand-momentum-chart-data')) {
            const cachedTrend = JSON.parse(targetPanel.querySelector('#brand-momentum-chart-data').textContent);
            if (cachedTrend) renderBrandMomentumChart(cachedTrend);
        }
        return;
    }

    const postsForAnalysis = (window._entityData?.[itemType]?.[itemName]?.posts || []);
    const topPosts = postsForAnalysis.slice(0, 20);
    const topPostsText = topPosts.map(p => `"${p.data.title || ''} - ${(p.data.selftext || p.data.body || '').substring(0, 300)}"`).join('\n');

    try {
        const prompt = isBrand ?
            `Analyze "${itemName}" based on: ${topPostsText}. Return JSON with: what_it_is, use_case, loves (array), hates (array), verdict.` :
            `Analyze category "${itemName}" based on: ${topPostsText}. Return JSON with: what_it_is, job_to_be_done, table_stakes (array), disruption_opportunities (array).`;

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are a fast market analyst. Output JSON." }, { role: "user", content: prompt }],
            temperature: 0.1,
            max_completion_tokens: 800,
            response_format: { "type": "json_object" }
        };

        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse);
            let htmlContent = '';
            if (isBrand) {
                htmlContent = `
                    <div class="brief-content">
                        <h3 class="brief-header">${itemName}</h3>
                        <div class="brief-section"><h4 class="brief-section-title">What It Is</h4><p class="brief-text">${parsed.what_it_is}</p></div>
                        <div class="brief-section">
                            <h4 class="brief-section-title">Momentum Trend</h4>
                            <div id="brand-momentum-chart" style="height:200px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.03); border-radius:8px; font-size:12px; color:#888;">
                                <span class="loader-dots">Crunching historical mentions...</span>
                            </div>
                        </div>
                        <div class="brief-section"><h4>Use Case</h4><p class="brief-text">${parsed.use_case}</p></div>
                        <div class="brief-section"><h4>Strengths</h4><ul class="brief-list">${parsed.loves.map(i => `<li>${i}</li>`).join('')}</ul></div>
                        <div class="brief-section"><h4>Pain Points</h4><ul class="brief-list">${parsed.hates.map(i => `<li>${i}</li>`).join('')}</ul></div>
                        <div class="brief-verdict" style="background:rgba(0,165,206,0.1); padding:15px; border-radius:8px;"><p><strong>Verdict:</strong> ${parsed.verdict}</p></div>
                    </div>`;
            } else {
                htmlContent = `
                    <div class="brief-content">
                        <h3 class="brief-header">${itemName}</h3>
                        <div class="brief-section"><h4>Category Info</h4><p>${parsed.what_it_is}</p></div>
                        <div class="brief-section"><h4>Job to be Done</h4><p>${parsed.job_to_be_done}</p></div>
                        <div class="brief-section"><h4>Table Stakes</h4><ul>${parsed.table_stakes.map(i => `<li>${i}</li>`).join('')}</ul></div>
                    </div>`;
            }

            targetPanel.innerHTML = htmlContent;
            briefCache.set(itemName, htmlContent);

            if (isBrand) {
                const selectedSubreddits = Array.from(document.querySelectorAll('#subreddit-choices input:checked')).map(cb => cb.value);
                const subredditQueryString = selectedSubreddits.map(sub => `subreddit:${sub}`).join(' OR ');

                fetchSentimentTrendData(itemName, subredditQueryString).then(trendResult => {
                    if (trendResult && trendResult.length > 0) {
                        renderBrandMomentumChart(trendResult);
                        const s = document.createElement('script');
                        s.id = 'brand-momentum-chart-data';
                        s.type = 'application/json';
                        s.textContent = JSON.stringify(trendResult);
                        targetPanel.querySelector('.brief-content').appendChild(s);
                    } else {
                        const chartEl = document.getElementById('brand-momentum-chart');
                        if (chartEl) chartEl.innerHTML = '<span>Not enough historical data to chart.</span>';
                    }
                }).catch(err => {
                    console.error('Momentum trend failed:', err);
                    const chartEl = document.getElementById('brand-momentum-chart');
                    if (chartEl) chartEl.innerHTML = '<span>Could not load momentum data.</span>';
                });
            }
        }
    } catch (error) {
        targetPanel.innerHTML = `<div class="brief-content"><p>Error loading content.</p></div>`;
    }
}

function renderBrandMomentumChart(data) {
    if (typeof Highcharts === 'undefined' || !data || data.length === 0) {
        const chartContainer = document.getElementById('brand-momentum-chart');
        if (chartContainer) chartContainer.innerHTML = '<p>Not enough data.</p>';
        return;
    }

    Highcharts.chart('brand-momentum-chart', {
        chart: { type: 'line', backgroundColor: 'transparent' },
        title: { text: null },
        credits: { enabled: false },
        xAxis: { categories: data.map(d => d.period), labels: { style: { color: '#888' } } },
        yAxis: { title: { text: null }, min: 0, max: 100, labels: { style: { color: '#888' } } },
        legend: { enabled: false },
        series: [{
            name: '% Positive',
            data: data.map(d => ({ y: d.positivePercentage, context: d.context })),
            color: '#00a5ce'
        }],
        tooltip: {
            useHTML: true,
            outside: true, 
            backgroundColor: '#FFFFFF',
            borderColor: '#E0E0E0',
            borderWidth: 1,
            padding: 16, 
            borderRadius: 10,
            shadow: true,
            style: { fontSize: '14px', zIndex: 9999 },
            formatter: function () {
                const context = this.point.options.context;
                let html = `<div style="min-width: 220px; max-width: 280px; white-space: normal; line-height: 1.4;">`;
                html += `<b>${this.key}</b><br/>`;
                html += `<span style="color:${this.series.color}">●</span> Positive: <b>${this.y}%</b>`;

                if (context) {
                    html += `<hr style="margin: 8px 0; border: 0; border-top: 1px solid #eee;">`;
                    if (context.positive_theme) html += `<div style="margin-bottom:4px"><span style="color:#28a745">🟢</span> ${context.positive_theme}</div>`;
                    if (context.negative_theme) html += `<div style="margin-bottom:8px"><span style="color:#dc3545">🔴</span> ${context.negative_theme}</div>`;
                    html += `<div style="font-size:12px; font-style:italic; color:#666;">${context.verdict}</div>`;
                }
                html += `</div>`;
                return html;
            }
        }
    });
}

function renderSentimentScore(positiveCount, negativeCount) {
    const container = document.getElementById('sentiment-score-container');
    if (!container) return;

    const total = positiveCount + negativeCount;
    if (total === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';

    const positivePercent = Math.round((positiveCount / total) * 100);
    const negativePercent = 100 - positivePercent;

    const segments = container.querySelectorAll('.score-segment');
    if (segments.length >= 2) {
        segments[0].style.width = `${positivePercent}%`;
        segments[1].style.width = `${negativePercent}%`;

        const posValue = segments[0].querySelector('.score-value');
        const negValue = segments[1].querySelector('.score-value');
        if (posValue) posValue.textContent = `${positivePercent}% Positive`;
        if (negValue) negValue.textContent = `${negativePercent}% Negative`;
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

    const benchmarkEl = container.querySelector('.sentiment-benchmark-text');
    if (benchmarkEl) {
        const REDDIT_BASELINE = 58;
        const diff = positivePercent - REDDIT_BASELINE;
        let benchmark;
        if (Math.abs(diff) <= 2) benchmark = 'Matches Reddit avg';
        else if (diff > 0) benchmark = `${diff}% above Reddit avg`;
        else benchmark = `${Math.abs(diff)}% below Reddit avg`;
        benchmarkEl.textContent = `${benchmark} (est.)`;
    }
}

async function generateAndRenderHistoricalSentiment(subredditQueryString) {
    const container = document.querySelector('.history-sentiment');
    if (!container) return;

    container.innerHTML = '<p class="loading-text">Charting sentiment over time... <span class="loader-dots"></span></p>';

    const sampleTerms = ["love", "hate", "best", "worst", "frustrating", "amazing"];
    const timePeriods = [
        { label: 'Past 6 Mo', value: '6month' },
        { label: 'Past 3 Mo', value: '3month' },
        { label: 'Past Month', value: 'month' },
        { label: 'Past Week', value: 'week' },
    ];

    try {
        const fetchPromises = timePeriods.map(p =>
            fetchMultipleRedditDataBatched(subredditQueryString, sampleTerms, 40, p.value)
        );
        const results = await Promise.allSettled(fetchPromises);

        const trendData = [];
        results.forEach((result, i) => {
            if (result.status !== 'fulfilled' || result.value.length === 0) return;
            const posts = deduplicatePosts(result.value);
            const { positive, negative } = countSentimentWords(posts);
            const total = positive + negative;
            if (total === 0) return;
            trendData.push({
                period: timePeriods[i].label,
                positive: Math.round((positive / total) * 100)
            });
        });

        renderHistoricalSentimentChart(trendData);
    } catch (err) {
        console.error("Historical sentiment chart failed:", err);
        container.innerHTML = '<p class="error-message">Could not load historical sentiment.</p>';
    }
}

async function generateAndRenderSubProblemChart(chartEl, finding, audienceContext) {
    if (!chartEl || !finding) return;

    const tpls = chartEl.querySelectorAll('.subproblem-node-template');
    if (tpls.length) {
        if (!SUBPROBLEM_NODE_BLUEPRINT) {
            const clean = Array.from(tpls).find(t => !t.classList.contains('node-green') && !t.classList.contains('node-orange')) || tpls[0];
            SUBPROBLEM_NODE_BLUEPRINT = clean.cloneNode(true);
            SUBPROBLEM_NODE_BLUEPRINT.classList.remove('node-green', 'node-orange');
        }
        tpls.forEach(t => { t.style.display = 'none'; });
    }
    if (!SUBPROBLEM_NODE_BLUEPRINT) {
        console.error('Sub-problem chart: .subproblem-node-template not found.');
        return;
    }

    const hub = chartEl.querySelector('.subproblem-hub');
    if (hub) {
        hub.style.zIndex = '3';
        hub.style.display = 'none';
        const t = hub.querySelector('.subproblem-hub-title');
        if (t) t.innerText = finding.title || '';
    }

    const loader = chartEl.querySelector('.subproblem-loader');
    const showLoader = () => { if (loader) loader.style.display = 'block'; };
    const hideLoader = () => { if (loader) loader.style.display = 'none'; };

    const render = (subProblems) => {
        chartEl.querySelectorAll('.sp-generated').forEach(el => el.remove());
        if (!subProblems || subProblems.length === 0) return;
        if (hub) hub.style.display = ''; 

        const measured = chartEl.clientWidth || chartEl.offsetWidth || 0;
        const size = measured > 0 ? measured : SUBPROBLEM_STAGE_SIZE;
        const center = size / 2;
        const radius = size * 0.36;
        const N = subProblems.length;
        const placed = [];

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.classList.add('sp-generated');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.style.position = 'absolute';
        svg.style.left = '0';
        svg.style.top = '0';
        svg.style.pointerEvents = 'none';
        svg.style.zIndex = '0';

        subProblems.forEach((sp, i) => {
            const angle = (-90 + i * (360 / N)) * Math.PI / 180;
            const x = center + radius * Math.cos(angle);
            const y = center + radius * Math.sin(angle);
            placed.push({ x, y });

            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', center);
            line.setAttribute('y1', center);
            line.setAttribute('x2', x);
            line.setAttribute('y2', y);
            line.setAttribute('stroke', '#ffffff');
            line.setAttribute('stroke-width', '1.5');
            svg.appendChild(line);
        });
        chartEl.insertBefore(svg, chartEl.firstChild);

        subProblems.forEach((sp, i) => {
            const { x, y } = placed[i];
            const node = SUBPROBLEM_NODE_BLUEPRINT.cloneNode(true);
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

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    };

    const cacheKey = finding.title;
    if (_subProblemCache.has(cacheKey)) {
        hideLoader(); 
        render(_subProblemCache.get(cacheKey));
        return;
    }

    showLoader(); 
    try {
        const findingPosts = (window._filteredPosts || []).filter(p => calculateRelevanceScore(p, finding) > 0);
        const basePosts = findingPosts.length >= 8 ? findingPosts : (window._filteredPosts || []);
        const topIds = [...basePosts].sort((a, b) => (b.data.ups || 0) - (a.data.ups || 0)).slice(0, 15).map(p => p.data.id);

        let comments = [];
        try {
            const raw = await fetchCommentsForPosts(topIds);
            comments = deduplicateByContent(raw).filter(c => (c.data.body || '').length >= 80);
        } catch (e) {
            console.warn('Sub-problem chart: comment fetch failed, using posts only.', e);
        }

        const corpus = [...basePosts, ...comments];
        const lowerTexts = corpus.map(p => `${p.data.title || p.data.link_title || ''} ${p.data.selftext || p.data.body || ''}`.toLowerCase());
        const corpusSize = corpus.length || 1;
        const corpusText = corpus.slice(0, 60).map(p => `${p.data.title || ''} ${(p.data.selftext || p.data.body || '').substring(0, 300)}`.trim()).join('\n---\n');

        const prompt = `You are analysing the "${audienceContext}" audience. The broad problem category is "${finding.title}": ${finding.body || ''}.
From the real discussions below (posts and comments), identify 6 to 8 specific recurring sub-problems WITHIN this category. Each must be a concrete issue people actually raise, not a restatement of the category.
For each, return a short 2 to 4 word "label", 2 to 4 "keywords" (single words or short phrases in the audience's own language) we can use to detect mentions, and an "icon" that best fits the sub-problem.
The "icon" MUST be chosen verbatim from this exact list: [${SUBPROBLEM_ICONS.join(', ')}]. If none fit well, use "circle-dot".
Respond ONLY with JSON: {"sub_problems":[{"label":"...","keywords":["...","..."],"icon":"..."}]}
Discussions:
${corpusText}`;

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You break a problem category into concrete recurring sub-problems and output only valid JSON." },
                { role: "user", content: prompt }
            ],
            temperature: 0.2,
            seed: 11,
            max_completion_tokens: 1200,
            response_format: { "type": "json_object" }
        };

        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse);
            const raw = Array.isArray(parsed.sub_problems) ? parsed.sub_problems : [];

            const countMentions = (keywords) => {
                let n = 0;
                for (const text of lowerTexts) {
                    const hit = (keywords || []).some(kw => {
                        const words = kw.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w)).map(w => lemmatize(w));
                        if (!words.length) return false;
                        let matched = 0;
                        for (const w of words) if (text.includes(w)) matched++;
                        return matched / words.length >= 0.5;
                    });
                    if (hit) n++;
                }
                return n;
            };

            const subProblems = raw
                .map(sp => {
                    const icon = SUBPROBLEM_ICONS.includes((sp.icon || '').toLowerCase().trim()) ? sp.icon.toLowerCase().trim() : 'circle-dot';
                    return { label: sp.label, icon, pct: Math.round((countMentions(sp.keywords) / corpusSize) * 100) };
                })
                .filter(sp => sp.label && sp.pct > 0)
                .sort((a, b) => b.pct - a.pct)
                .slice(0, 8);

            _subProblemCache.set(cacheKey, subProblems);
            hideLoader(); 
            render(subProblems);
        }
    } catch (error) {
        hideLoader(); 
        console.error('Sub-problem chart error:', error);
    }
}

async function computeSubProblems(finding, audienceContext) {
    if (!finding || !finding.title) return [];
    const cacheKey = finding.title;
    if (_subProblemCache.has(cacheKey)) return _subProblemCache.get(cacheKey);
    try {
        const findingPosts = (window._filteredPosts || []).filter(p => calculateRelevanceScore(p, finding) > 0);
        const basePosts = findingPosts.length >= 8 ? findingPosts : (window._filteredPosts || []);
        const topIds = [...basePosts].sort((a, b) => (b.data.ups || 0) - (a.data.ups || 0)).slice(0, 15).map(p => p.data.id);

        let comments = [];
        try {
            const raw = await fetchCommentsForPosts(topIds);
            comments = deduplicateByContent(raw).filter(c => (c.data.body || '').length >= 80);
        } catch (e) { }

        const corpus = [...basePosts, ...comments];
        const lowerTexts = corpus.map(p => `${p.data.title || p.data.link_title || ''} ${p.data.selftext || p.data.body || ''}`.toLowerCase());
        const corpusSize = corpus.length || 1;
        const corpusText = corpus.slice(0, 60).map(p => `${p.data.title || ''} ${(p.data.selftext || p.data.body || '').substring(0, 300)}`.trim()).join('\n---\n');

        const prompt = `You are analysing the "${audienceContext}" audience. The broad problem category is "${finding.title}": ${finding.body || ''}.
From the real discussions below (posts and comments), identify 6 to 8 specific recurring sub-problems WITHIN this category. Each must be a concrete issue people actually raise, not a restatement of the category.
For each, return a short 2 to 4 word "label", 2 to 4 "keywords" (single words or short phrases in the audience's own language) we can use to detect mentions, and an "icon" that best fits the sub-problem.
The "icon" MUST be chosen verbatim from this exact list: [${SUBPROBLEM_ICONS.join(', ')}]. If none fit well, use "circle-dot".
Respond ONLY with JSON: {"sub_problems":[{"label":"...","keywords":["...","..."],"icon":"..."}]}
Discussions:
${corpusText}`;

        const data = await callOpenAIProxyWithRetry({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You break a problem category into concrete recurring sub-problems and output only valid JSON." },
                { role: "user", content: prompt }
            ],
            temperature: 0.2,
            seed: 11,
            max_completion_tokens: 1200,
            response_format: { "type": "json_object" }
        }, { tries: 1 });
        if (!data || !data.openaiResponse) return [];

        const parsed = JSON.parse(data.openaiResponse);
        const raw = Array.isArray(parsed.sub_problems) ? parsed.sub_problems : [];

        const countMentions = (keywords) => {
            let n = 0;
            for (const text of lowerTexts) {
                const hit = (keywords || []).some(kw => {
                    const words = kw.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w)).map(w => lemmatize(w));
                    if (!words.length) return false;
                    let matched = 0;
                    for (const w of words) if (text.includes(w)) matched++;
                    return matched / words.length >= 0.5;
                });
                if (hit) n++;
            }
            return n;
        };

        const subProblems = raw
            .map(sp => {
                const icon = SUBPROBLEM_ICONS.includes((sp.icon || '').toLowerCase().trim()) ? sp.icon.toLowerCase().trim() : 'circle-dot';
                return { label: sp.label, icon, pct: Math.round((countMentions(sp.keywords) / corpusSize) * 100) };
            })
            .filter(sp => sp.label && sp.pct > 0)
            .sort((a, b) => b.pct - a.pct)
            .slice(0, 8);

        _subProblemCache.set(cacheKey, subProblems);
        return subProblems;
    } catch (e) {
        console.warn('[Sub-Problems] compute failed for "' + finding.title + '":', e && e.message);
        return [];
    }
}

async function pregenerateAllSubProblems(audienceContext) {
    const findings = window._summaries || [];
    if (!findings.length) return;
    const CONC = 1;
    for (let i = 0; i < findings.length; i += CONC) {
        await Promise.all(findings.slice(i, i + CONC).map(async (f, j) => {
            await computeSubProblems(f, audienceContext);
            const idx = i + j;
            const chartEl = document.querySelector(`.subproblem-chart[data-finding-index="${idx}"]`);
            if (chartEl) {
                try { await generateAndRenderSubProblemChart(chartEl, f, audienceContext); } catch (e) { }
            }
        }));
    }
    console.log(`[Sub-Problems] Pre-generated & auto-rendered for ${findings.length} findings.`);
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
        title: { text: null },
        credits: { enabled: false },
        xAxis: {
            categories: data.map(d => d.period),
            labels: { style: { color: '#475569' } },
            lineColor: 'rgba(0,0,0,0.12)',
            tickColor: 'rgba(0,0,0,0.12)'
        },
        yAxis: {
            title: { text: '% Positive', style: { color: '#64748b' } },
            min: 0, max: 100,
            labels: { format: '{value}%', style: { color: '#475569' } },
            gridLineColor: 'rgba(0,0,0,0.06)',
            plotLines: [{
                value: 58,
                color: 'rgba(100,116,139,0.5)',
                dashStyle: 'Dash',
                width: 1,
                label: { text: 'Reddit avg', style: { color: '#94a3b8', fontSize: '11px' }, align: 'left', x: 5, y: -4 }
            }]
        },
        legend: { enabled: false },
        tooltip: { valueSuffix: '% positive', backgroundColor: '#ffffff' },
        plotOptions: {
            areaspline: {
                color: '#00a5ce',
                lineWidth: 2,
                marker: { enabled: true, radius: 4, fillColor: '#00a5ce' },
                fillColor: {
                    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                    stops: [
                        [0, 'rgba(0,165,206,0.18)'],
                        [1, 'rgba(0,165,206,0.0)']
                    ]
                }
            }
        },
        series: [{ name: '% Positive', data: data.map(d => d.positive) }]
    });
}

async function generateAndRenderConstellation(items) {
    console.log("[Highcharts] Starting 'How They Shop' generation...");
    const prioritizedItems = items.sort((a, b) => (b.data.ups || 0) - (a.data.ups || 0)).slice(0, 80);
    console.log(`[Highcharts] Prioritized top ${prioritizedItems.length} items for shopping signal extraction.`);

    const validCategories = ["WillingnessToPay", "PriceSensitivity", "BrandLoyalty", "ResearchHabits", "Substitutes", "Dealbreakers"];
    const CATEGORY_LOOKUP = {};
    validCategories.forEach(c => { CATEGORY_LOOKUP[c.toLowerCase()] = c; });

    const VAGUE_THEMES = new Set(['frustration', 'problem', 'issue', 'pain point', 'wants better', 'general complaint', 'bad experience', 'dissatisfaction', 'annoyance', 'unhappy', 'confusion']);
    const isUsefulTheme = (t) => {
        const s = (t || '').toLowerCase().trim();
        if (s.length < 4) return false;            
        if (VAGUE_THEMES.has(s)) return false;     
        return true;
    };

    const COMMERCIAL_CUE = /\b(buy|buys|buying|bought|purchase[ds]?|purchasing|order(ed|ing)?|pay|pays|paid|paying|spend|spent|spending|afford|affordable|price[ds]?|pricing|cost[s]?|expensive|cheap(er)?|pricey|overpriced|worth|value|deal|discount|sale|subscription|subscribe[ds]?|brand[s]?|product[s]?|refund|return(ed|s)?|warranty|premium|budget|money|dollars?|pounds?|quid|switch(ed|ing)?|recommend(ed|ation|ations|s)?)\b|[$£€]\s?\d/i;
    const hasCommercialCue = (q) => COMMERCIAL_CUE.test(q || '');

    const LIFESTYLE_NOISE = /\b(calorie[s]?|\d{3,4}\s*cal\b|cico|cut out (carbs|bread|pasta|sugar|cookies|candy)|intermittent fasting|fasting|macros|reps|sets|workout[s]?|jog(ged|ging)?|run(ning)? \d|step count|water intake|meditat(e|ion|ing)|portion control)\b/i;
    const isLifestyleNoise = (q) => LIFESTYLE_NOISE.test(q || '');

    const BATCH_SIZE = 20;          
    const CONCURRENCY = 1;          
    const MIN_SIGNALS = 20;
    const enrichedSignals = [];     
    const backupSignals = [];       
    const seenThemes = new Set();
    let failedBatches = 0;

    let lastRenderCount = -1;
    const renderProgress = (final = false) => {
        const display = enrichedSignals.slice();
        if (display.length < MIN_SIGNALS && backupSignals.length) {
            display.push(...backupSignals.slice(0, MIN_SIGNALS - display.length));
        }
        if (!final && display.length === lastRenderCount) return;
        lastRenderCount = display.length;
        if (display.length) renderHighchartsBubbleChart(display);
        else if (final) renderHighchartsBubbleChart([]); 
    };

    const processBatch = async (startIndex) => {
        const batch = prioritizedItems.slice(startIndex, startIndex + BATCH_SIZE);
        const prompt = `You are a shopper-behaviour analyst studying how the "${window.originalGroupName || 'this'}" audience spends money: what they buy, what they pay for, and how they decide between products and brands.

From the numbered comments below, extract EVERY quote that reveals how this audience SHOPS or makes product decisions. Cast a WIDE net - this includes any of: an actual purchase; a price, cost or budget mention; a named product or brand; paying or subscribing; choosing between options; recommending, praising or warning against a product; asking what to buy or for recommendations; comparing options; what they feed/use/buy for their needs; a product that worked or disappointed them; or what made them switch or stick with something. Most posts in an interest community contain at least one shopping or product signal - be generous. Aim to surface 6-12 genuine signals per batch when the material supports it, but never invent signals that are not in the text.

The ONLY things you must reject are pure lifestyle, diet, habit and routine choices where nothing is bought and no product or brand is involved. Examples you MUST reject:
- "I cut out pasta, bread, cookies and candy." (a diet choice, nothing is bought)
- "I only eat around 1000-1500 Cal a day." (a habit, no purchase)
- "I utilized CICO (calories in, calories out), and exercise." (a method, no product)

For each genuine shopping signal return an object with:
- "quote": the exact phrase, verbatim and trimmed.
- "source_index": the comment number it came from.
- "category": EXACTLY one of [${validCategories.join(', ')}].
- "theme": a concrete 3 to 5 word shopping-behaviour label describing an action or pattern, never a feeling. Good: "Pays premium for quality", "Hunts for the cheapest option", "Switches brand after bad batch", "Trusts reviews before buying".

Category definitions (use these generously):
- WillingnessToPay: happy to spend, premium choices, "worth the money", "would pay more for", investing in quality.
- PriceSensitivity: budget limits, "too expensive", deal hunting, choosing cheaper options, sticker shock.
- BrandLoyalty: sticking with, recommending, praising, warning against or abandoning a specific named brand or product; mentioning a product they use and trust.
- ResearchHabits: how they decide what to buy, reading reviews, asking "what should I get", asking for recommendations, comparing options before buying.
- Substitutes: a different product, service or option they buy or use INSTEAD of another. Not a lifestyle method.
- Dealbreakers: what stops a purchase, returns, refunds, regret, distrust, or a product that disappointed or failed them.

Comments:
${batch.map((item, index) => `${index}. ${((item.data.body || item.data.selftext || '')).substring(0, 1000)}`).join('\n---\n')}

Respond ONLY with valid JSON: {"signals":[{"quote":"...","source_index":0,"category":"...","theme":"..."}]}`;

        try {
            const data = await callOpenAIProxyWithRetry({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are a precise shopper-behaviour analyst. You extract genuine buying, spending, brand-choice and product-research signals, and you reject only pure lifestyle, diet, habit and routine choices where nothing is bought. You output only valid JSON." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.2,
                max_completion_tokens: 2500,
                response_format: { "type": "json_object" }
            }, { tries: 2 });

            if (data && data.openaiResponse) {
                const parsed = JSON.parse(data.openaiResponse);
                if (parsed.signals && Array.isArray(parsed.signals)) {
                    parsed.signals.forEach(signal => {
                        const sourceIndex = parseInt(signal.source_index, 10);
                        const sourceItem = Number.isInteger(sourceIndex) ? prioritizedItems[startIndex + sourceIndex] : null;
                        if (!sourceItem || !signal.quote || !signal.category || !signal.theme) return;
                        
                        const canonicalCategory = CATEGORY_LOOKUP[String(signal.category).toLowerCase().replace(/[^a-z]/g, '')];
                        if (!canonicalCategory) return;
                        signal.category = canonicalCategory;
                        if (!isUsefulTheme(signal.theme)) return;
                        if (isLifestyleNoise(signal.quote) && !hasCommercialCue(signal.quote)) return;

                        const dedupKey = signal.theme.toLowerCase().trim() + '|' + signal.quote.substring(0, 40);
                        if (seenThemes.has(dedupKey)) return;
                        seenThemes.add(dedupKey);

                        const enriched = {
                            quote: signal.quote,
                            problem_theme: signal.theme,
                            category: signal.category,
                            source: sourceItem.data
                        };
                        if (hasCommercialCue(signal.quote)) enrichedSignals.push(enriched);
                        else backupSignals.push(enriched);
                    });
                }
            } else {
                throw new Error("Proxy returned no content after retries.");
            }
        } catch (error) {
            failedBatches++;
            console.error(`[Highcharts] Batch at index ${startIndex} failed:`, error.message);
        }
        renderProgress(); 
    };

    const starts = [];
    for (let i = 0; i < prioritizedItems.length; i += BATCH_SIZE) starts.push(i);
    for (let i = 0; i < starts.length; i += CONCURRENCY) {
        await Promise.all(starts.slice(i, i + CONCURRENCY).map(processBatch));
    }

    window._exportData = window._exportData || {}; window._exportData.signals = enrichedSignals;
    renderProgress(true); 
    console.log(`[Highcharts] Extracted ${enrichedSignals.length} shopping signals (${backupSignals.length} reserve, ${failedBatches}/${starts.length} batches failed).`);
}

async function runConstellationAnalysis(subredditQueryString, demandSignalTerms, timeFilter) {
    console.log("--- Starting 'How They Shop' Signal Analysis (in background) ---");
    window._fullCorpus = null; 

    const SHOPPING_SIGNAL_TERMS = [
        "worth the money", "worth every penny", "happily pay", "would pay more for", "best value for money",
        "overpriced", "too expensive", "cheaper alternative", "on a budget",
        "my favourite brand", "switched from", "stopped buying", "always buy", "go-to",
        "would recommend", "best one i've tried", "is it worth it", "waste of money", "regret buying", "returned it"
    ];

    try {
        const shoppingPosts = await fetchMultipleRedditDataBatched(subredditQueryString, SHOPPING_SIGNAL_TERMS, 60, timeFilter, false);
        const postIds = shoppingPosts.sort((a, b) => (b.data.ups || 0) - (a.data.ups || 0)).slice(0, 80).map(p => p.data.id);
        const highIntentComments = await fetchCommentsForPosts(postIds);
        const generalPosts = window._filteredPosts || [];
        const allItems = deduplicatePosts([...shoppingPosts, ...highIntentComments, ...generalPosts]);
        window._fullCorpus = allItems; 
        console.log(`[Constellation] shopping=${shoppingPosts.length} comments=${highIntentComments.length} general=${generalPosts.length} -> corpus=${allItems.length}`);
        await generateAndRenderConstellation(allItems);
    } catch (error) {
        console.error("'How They Shop' analysis failed in the background:", error);
        renderHighchartsBubbleChart([]);
    } finally {
        console.log("--- 'How They Shop' Analysis Complete. ---");
        const _corpus = window._fullCorpus || window._filteredPosts || [];
        try { renderSocialSplitChart(_corpus); } catch (e) { console.warn('[Social Split] failed', e); }
        try { generateAndRenderWaterholes(_corpus, window.originalGroupName || ''); } catch (e) { console.warn('[Waterholes] failed', e); }
        try { generateAndRenderPodcasts(_corpus, window.originalGroupName || ''); } catch (e) { console.warn('[Podcasts] failed', e); }
    }
}

function setConstellationPanelState(state, data) {
    const panel = document.getElementById('bubble-content');
    if (!panel) return false;
    const loader = panel.querySelector('.bubble-loader');
    const empty  = panel.querySelector('.bubble-empty');
    const prompt = panel.querySelector('.bubble-prompt');
    const detail = panel.querySelector('.bubble-detail');
    if (!loader && !empty && !prompt && !detail) return false; 

    const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
    show(loader, state === 'loading');
    show(empty,  state === 'empty');
    show(prompt, state === 'prompt');
    show(detail, state === 'detail');

    if (state === 'detail' && detail && data) {
        const set = (sel, val) => { const e = detail.querySelector(sel); if (e) e.innerText = val; };
        set('.bubble-detail-title', data.name || '');
        set('.bubble-detail-quote', `“${data.quote || ''}”`);
        const src = data.source || {};
        set('.bubble-detail-meta', src.subreddit ? `r/${src.subreddit} | 👍 ${(src.ups || 0).toLocaleString()}` : '');
        const link = detail.querySelector('.bubble-detail-source');
        if (link) link.setAttribute('href', `https://www.reddit.com${src.permalink || ''}`);
    }
    return true;
}

async function generateAndRenderMindsetSummary(posts, audienceContext) {
    const container = document.getElementById('mindset-summary-container');
    const archetypeHeadingEl = document.getElementById('archetype-heading');
    const archetypeDescEl = document.getElementById('archetype-d');

    const resolveWrapper = (anchorId, index) => {
        const anchor = document.getElementById(anchorId);
        if (anchor) {
            if (anchor.classList.contains('numbers-wrapper')) return anchor;
            const within = anchor.querySelector('.numbers-wrapper');
            if (within) return within;
            const up = anchor.closest('.numbers-wrapper');
            if (up) return up;
            return anchor;
        }
        return document.querySelectorAll('.numbers-wrapper')[index] || null;
    };

    const valuesWrapper = resolveWrapper('characteristics-d', 0);
    const rejectsWrapper = resolveWrapper('reject-d', 1);

    if (!container || !archetypeHeadingEl || !archetypeDescEl || !valuesWrapper || !rejectsWrapper) {
        console.error("Mindset render aborted: standard element missing.");
        return;
    }

    archetypeHeadingEl.textContent = 'Analyzing...';
    archetypeDescEl.textContent = '';
    valuesWrapper.innerHTML = '<p class="loading-text">Watching how they actually behave...</p>';
    rejectsWrapper.innerHTML = '<p class="loading-text">Noticing what sets them off...</p>';

    const trimToSentences = (text, max) => {
        if (!text) return '';
        const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g);
        return parts ? parts.slice(0, max).join(' ').trim() : text.trim();
    };

    const populateItem = (blueprint, item) => {
        const clone = blueprint.cloneNode(true);
        const titleEl = clone.querySelector('.mindset-item-title, .mindset-item-heading, .mindset-item-name');
        const descEl = clone.querySelector('.mindset-item-desc');
        const text = (typeof item === 'string')
            ? item
            : (item && item.title ? `${item.title}. ${item.description || ''}`.trim() : (item && item.description) || '');

        if (descEl) {
            descEl.innerText = text;
            if (titleEl) titleEl.innerText = ''; 
        } else if (titleEl) {
            titleEl.innerText = text;
        } else {
            clone.innerText = text;
        }
        return clone;
    };

    const renderSection = (wrapper, blueprints, items, emptyMsg) => {
        wrapper.innerHTML = '';
        if (!items || items.length === 0) {
            wrapper.innerHTML = `<p class="placeholder-text">${emptyMsg}</p>`;
            return;
        }
        items.forEach((item, i) => {
            const bp = blueprints[i] || blueprints[blueprints.length - 1];
            wrapper.appendChild(populateItem(bp, item));
        });
    };

    try {
        const topPostsText = posts.slice(0, 40).map(p => `Title: ${p.data.title || ''}\nContent: ${p.data.selftext || p.data.body || ''}`.substring(0, 800)).join('\n---\n');
        const prompt = `You are a strategist who has spent months lurking inside the "${audienceContext}" community on Reddit. Below are real discussions. Write field notes, not a market research report. Be observational, psychologically sharp and specific to THIS audience. Ground every line in what the posts actually reveal.

Respond ONLY with a valid JSON object with these keys:
1. "archetype": A short, 2-3 word evocative name for this audience.
2. "summary": EXACTLY 2 short sentences, 40 words total maximum. A sharp character study. No padding.
3. "values": An array of exactly 3 strings. Each is ONE observational sentence (max 20 words).
4. "rejects": An array of exactly 3 strings. Each is ONE observational sentence (max 20 words).

Posts:
${topPostsText}`;

        const openAIParams = {
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a sharp cultural observer who writes psychologically specific field notes about online communities. You output only valid JSON." },
                { role: "user", content: prompt }
            ],
            temperature: 0.6,
            max_completion_tokens: 1100,
            response_format: { "type": "json_object" }
        };

        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse);
            const { archetype, summary, values, rejects } = parsed;

            archetypeHeadingEl.textContent = archetype || '';
            archetypeDescEl.textContent = trimToSentences(summary, 2);

            renderSection(valuesWrapper, MINDSET_VALUES_BLUEPRINT, values, 'Could not read this audience clearly enough yet.');
            renderSection(rejectsWrapper, MINDSET_REJECTS_BLUEPRINT, rejects, 'Could not read this audience clearly enough yet.');
        }
    } catch (error) {
        console.error("Mindset summary generation error:", error);
        archetypeHeadingEl.textContent = 'Analysis Failed';
        archetypeDescEl.textContent = 'Could not generate the audience mindset summary. Please try again.';
        valuesWrapper.innerHTML = '';
        rejectsWrapper.innerHTML = '';
    }
}

async function generateAndRenderStrategicPillars(posts, audienceContext) {
    const goalsContainer = document.getElementById('goals-pillar');
    const fearsContainer = document.getElementById('fears-pillar');
    if (!goalsContainer || !fearsContainer) return;

    const capturePillarBlueprint = (container, label) => {
        const own = container.querySelector('.pillar-item-template');
        if (own) return own.cloneNode(true); 
        if (PILLAR_BLUEPRINT) return PILLAR_BLUEPRINT.cloneNode(true); 
        return null;
    };

    if (!PILLAR_GOALS_BLUEPRINT) PILLAR_GOALS_BLUEPRINT = capturePillarBlueprint(goalsContainer, 'goals');
    if (!PILLAR_FEARS_BLUEPRINT) PILLAR_FEARS_BLUEPRINT = capturePillarBlueprint(fearsContainer, 'fears');
    if (!PILLAR_GOALS_BLUEPRINT || !PILLAR_FEARS_BLUEPRINT) return;

    goalsContainer.innerHTML = '';
    fearsContainer.innerHTML = '';

    try {
        const topPostsText = posts.slice(0, 40).map(p => `Title: ${p.data.title || ''}\nContent: ${p.data.selftext || p.data.body || ''}`.substring(0, 800)).join('\n---\n');
        const prompt = `You have spent months inside the "${audienceContext}" community reading how they actually talk. Below are real discussions. Surface their real emotional drivers, not business objectives.
"goals": 3 things they are really hoping for beneath the surface, in their own emotional terms.
"fears": 3 things that genuinely keep them awake at night.

Write each as a short, specific, emotionally honest thought a real person might have, around 12 words or fewer each. Ground every line in the posts.
Respond ONLY with JSON: {"goals": ["...", "...", "..."], "fears": ["...", "...", "..."]}

Posts:
${topPostsText}`;

        const openAIParams = {
            model: "gpt-4o",
            messages: [{ role: "system", content: "You are a perceptive observer of human motivation who writes honest, specific, non-corporate insight. Output only valid JSON." }, { role: "user", content: prompt }],
            temperature: 0.6,
            response_format: { "type": "json_object" }
        };

        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse);
            const populatePillars = (container, blueprint, items, swapClass) => {
                (items || []).forEach(text => {
                    const clone = blueprint.cloneNode(true);
                    clone.style.removeProperty('display');
                    const textNode = clone.querySelector('.pillar-item-text') || clone.querySelector('[class*="pillar-item-text"]') || clone;
                    textNode.innerText = text;
                    if (swapClass) {
                        textNode.classList.remove('pillar-item-text');
                        textNode.classList.add(swapClass);
                    }
                    container.appendChild(clone);
                });
            };

            populatePillars(goalsContainer, PILLAR_GOALS_BLUEPRINT, parsed.goals);
            populatePillars(fearsContainer, PILLAR_FEARS_BLUEPRINT, parsed.fears, 'pillar-item-fear');
        }
    } catch (error) {
        console.error("Strategic pillars generation error:", error);
    }
}

async function generateAndRenderAIPrompt(posts, audienceContext) {
    const container = document.getElementById('ai-prompt-container');
    if (!container) return;

    container.innerHTML = `<h3 class="dashboard-section-title">Generative AI Prompt</h3><p class="loading-text">Crafting a tone of voice prompt...</p>`;

    try {
        const topPostsText = posts.slice(0, 30).map(p => `"${p.data.title || ''} ${getFirstTwoSentences(p.data.selftext || p.data.body || '')}"`).join('\n');
        const prompt = `You are a world-class brand strategist and copywriter. Analyze the following sample of posts from the "${audienceContext}" community. Your task is to create a "Generative AI Prompt" that a marketer could use to write content in the authentic voice of this audience.
        - **tone:** 3-4 descriptive adjectives for the overall emotional tone.
        - **vocabulary:** 3-5 key slang words, acronyms, or insider phrases they use.
        - **style:** 2-3 bullet points describing their writing style.
        - **sentiment:** 1 sentence describing their general outlook.

        Respond ONLY with a valid JSON object with the keys "tone", "vocabulary", "style", and "sentiment".
        Sample Posts:\n${topPostsText}`;

        const openAIParams = {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are a brand strategist who creates structured JSON output for AI prompts." }, { role: "user", content: prompt }],
            temperature: 0.2,
            max_completion_tokens: 500,
            response_format: { "type": "json_object" }
        };

        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse);
            const promptText = `Write a blog post about [YOUR TOPIC] for an audience of ${audienceContext}.
            
Your writing should adopt the following characteristics:

**TONE:**
- ${parsed.tone.join('\n- ')}

**VOCABULARY:**
- Use terms like: ${parsed.vocabulary.join(', ')}

**STYLE:**
- ${parsed.style.join('\n- ')}

**SENTIMENT:**
- ${parsed.sentiment}
`;

            container.innerHTML = `
                <h3 class="dashboard-section-title">Generative AI Prompt</h3>
                <div class="ai-prompt-content" id="ai-prompt-text">${promptText}</div>
            `;
        }
    } catch (error) {
        console.error("AI prompt generation error:", error);
        container.innerHTML = `
            <h3 class="dashboard-section-title">Generative AI Prompt</h3>
            <p class="loading-text" style="color: red;">Could not generate AI prompt.</p>
        `;
    }
}

async function generateAndRenderSeoSunburst(posts, audienceContext) {
    const container = document.getElementById('keyword-sunburst');
    if (!container) {
        console.error('Content map container div "keyword-sunburst" not found.');
        return;
    }

    container.innerHTML = '<p class="loading-text">Mapping the topics this audience actually discusses...</p>';
    const lowerTexts = posts.map(p => `${p.data.title || p.data.link_title || ''} ${p.data.selftext || p.data.body || ''}`.toLowerCase());
    const totalDiscussions = lowerTexts.length;
    const confidence = getSeoConfidence(posts.length);
    renderSeoConfidence(confidence);

    try {
        const topPostsText = posts.slice(0, 50).map(p => `Title: ${p.data.title || ''}\nContent: ${p.data.selftext || p.data.body || ''}`.substring(0, 800)).join('\n---\n');
        const prompt = `You are a content strategist for the "${audienceContext}" audience. Below are real discussions from this community. Build a content plan whose topics reflect the ACTUAL language, questions, and pain points in these discussions.
        - Do NOT invent search volumes, traffic numbers, or any metrics.
        - Only use topics and phrasings that are supported by the discussions.
        - The most specific topics must sound like something this audience would say.

        Organize the plan using these three keys:
        - "problem_aware": topics for people who feel the problem but are not yet looking for a solution.
        - "solution_seeking": topics for people actively comparing approaches or solutions.
        - "purchase_intent": topics for people ready to choose or buy.

        For each, provide an array of 2-5 broad themes ("keyword").
        - For EACH theme, provide "secondary_keywords" (sub-themes).
        - For EACH sub-theme, provide "long_tail_keywords" (specific angles).
        - For EACH specific angle, provide "content_examples" containing objects like {"title": "..."}.

        Discussions to base everything on:
        ${topPostsText}`;

        const openAIParams = {
            model: "gpt-4o",
            messages: [{ role: "system", content: "You are a content strategist who grounds every idea in the supplied discussions and never fabricates metrics." }, { role: "user", content: prompt }],
            temperature: 0.2,
            response_format: { "type": "json_object" }
        };

        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const seoPlan = JSON.parse(response.openaiResponse);
            const allKeywords = [];
            ['problem_aware', 'solution_seeking', 'purchase_intent'].forEach(intent => {
                (seoPlan[intent] || []).forEach(primary => {
                    if (primary.keyword) allKeywords.push(primary.keyword);
                    (primary.secondary_keywords || []).forEach(sec => {
                        if (sec.keyword) allKeywords.push(sec.keyword);
                        (sec.long_tail_keywords || []).forEach(lt => {
                            if (lt.keyword) allKeywords.push(lt.keyword);
                        });
                    });
                });
            });
            const groundingMap = await buildGroundingMap(allKeywords, posts);

            generateAndRenderActionCards(seoPlan, audienceContext, lowerTexts, confidence, groundingMap);

            const sunburstData = [
                { id: 'root', parent: '', name: 'Content Plan', levelName: 'Content plan' },
                { id: 'pa', parent: 'root', name: 'Feeling the Problem', color: '#6AA9FF', levelName: 'Journey stage' },
                { id: 'ss', parent: 'root', name: 'Comparing Solutions', color: '#9B7CFF', levelName: 'Journey stage' },
                { id: 'pi', parent: 'root', name: 'Ready to Buy', color: '#5ED1B8', levelName: 'Journey stage' }
            ];

            const processIntent = (intentId, stageName, intentData) => {
                if (!intentData || !Array.isArray(intentData)) return;

                intentData.forEach((primary, i) => {
                    const primaryId = `${intentId}_p_${i}`;
                    sunburstData.push({ id: primaryId, parent: intentId, name: primary.keyword, stageName: stageName, levelName: 'Theme' });

                    (primary.secondary_keywords || []).forEach((secondary, j) => {
                        const secondaryId = `${primaryId}_s_${j}`;
                        sunburstData.push({ id: secondaryId, parent: primaryId, name: secondary.keyword, stageName: stageName, levelName: 'Sub-theme' });

                        (secondary.long_tail_keywords || []).forEach((longtail, k) => {
                            const longtailId = `${secondaryId}_l_${k}`;
                            const mentions = groundingCount(longtail.keyword, groundingMap, lowerTexts);
                            sunburstData.push({ id: longtailId, parent: secondaryId, name: longtail.keyword, stageName: stageName, levelName: 'Specific angle', mentions: mentions });

                            (longtail.content_examples || []).forEach((content, l) => {
                                sunburstData.push({ id: `${longtailId}_c_${l}`, parent: longtailId, name: content.title, value: Math.max(mentions, 1), stageName: stageName, levelName: 'Content idea', mentions: mentions });
                            });
                        });
                    });
                });
            };

            processIntent('pa', 'Feeling the Problem', seoPlan.problem_aware);
            processIntent('ss', 'Comparing Solutions', seoPlan.solution_seeking);
            processIntent('pi', 'Ready to Buy', seoPlan.purchase_intent);

            const seriesName = sunburstData.find(d => d.id === 'root')?.name || 'Content Plan';

            Highcharts.chart(container, {
                chart: { type: 'sunburst', height: '650px', backgroundColor: null },
                title: { text: null },
                credits: { enabled: false },
                breadcrumbs: { showFullPath: false, useHTML: true },
                plotOptions: { sunburst: { animation: { duration: 1000 }, borderColor: '#FFFFFF', borderWidth: 1 } },
                series: [{
                    type: 'sunburst',
                    name: seriesName,
                    data: sunburstData,
                    allowDrillToNode: true,
                    cursor: 'pointer',
                    dataLabels: {
                        format: '{point.name}',
                        filter: { property: 'innerArcLength', operator: '>', value: 20 },
                        rotationMode: 'circular',
                        style: { color: '#FFFFFF', textOutline: 'none', fontWeight: '400' }
                    },
                    levels: [
                        { level: 1, levelIsConstant: false, dataLabels: { enabled: true, filter: { property: 'value', operator: '>', value: -1 }, style: { fontSize: '1.1em', fontWeight: '400', color: '#FFFFFF', textOutline: 'none' } } },
                        { level: 2, colorByPoint: true },
                        { level: 3, colorVariation: { key: 'brightness', to: -0.25 } },
                        { level: 4, colorVariation: { key: 'brightness', to: 0.25 } },
                        { level: 5, colorVariation: { key: 'brightness', to: -0.45 } },
                        { level: 6, colorVariation: { key: 'brightness', to: 0.45 } }
                    ]
                }],
                tooltip: {
                    useHTML: true,
                    headerFormat: '',
                    pointFormatter: function () {
                        const point = this;
                        let html = `<div style="min-width: 250px; max-width: 400px; font-size: 14px; white-space: normal; word-wrap: break-word;">`;
                        const capitalizedName = point.name.replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase());
                        html += `<b>Topic:</b> <b>${capitalizedName}</b><br/>`;
                        if (point.levelName) html += `<b>Level:</b> ${point.levelName}<br/>`;
                        if (point.stageName) html += `<b>Stage:</b> ${point.stageName}<br/>`;
                        if (point.mentions !== undefined) {
                            html += `<b>Appeared in:</b> ${point.mentions} of ${totalDiscussions} discussions<br/>`;
                        }
                        html += `</div>`;
                        return html;
                    }
                },
                exporting: { enabled: true },
                accessibility: { enabled: true }
            });
        }
    } catch (error) {
        console.error("Failed to generate or render the content plan:", error);
        container.innerHTML = `<p class="error-message">Could not generate the content plan.</p>`;
    }
}
// =================================================================================
// PART 3 OF 3: RESOURCES, DASHBOARD HOOKS & EXCEL EXPORTER
// =================================================================================

async function generateProblemOfferPairsAI(summaries) {
    if (!summaries || summaries.length === 0) return [];

    const problemTitles = summaries.map(s => s.title);
    const prompt = `You are a startup advisor. For each customer problem provided for the audience "${originalGroupName}", generate a single, concise "offer angle" or "solution".
    Respond ONLY with a valid JSON object with a single key "pairs". The value should be an array of objects, where each object has two keys: "problem" and "offer". 
    CRITICAL: Ensure there is one object for each problem provided, and that neither the "problem" nor the "offer" value is an empty string.

    Example Response:
    { "pairs": [ { "problem": "Models take forever to train", "offer": "Cut training time by 60%" } ] }

    Problems to solve:
    ${JSON.stringify(problemTitles)}
    `;

    const openAIParams = {
        model: "gpt-4o",
        messages: [{ role: "system", content: "You are a startup advisor creating problem-solution pairs in strict JSON format." }, { role: "user", content: prompt }],
        temperature: 0.6,
        max_completion_tokens: 2000,
        response_format: { "type": "json_object" }
    };

    try {
        const response = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        if (response && response.openaiResponse) {
            const parsed = JSON.parse(response.openaiResponse);
            if (parsed.pairs && Array.isArray(parsed.pairs)) return parsed.pairs;
        }
    } catch (error) {
        console.error("Problem/Offer pair generation failed:", error);
    }
    return [];
}

function setupGrowthKitInteraction() {
    const audienceName = window.originalGroupName || 'your audience';
    const headerPrefix = document.getElementById('growth-header-prefix');
    const headerLabel = document.getElementById('growth-header-label');
    const dropdownList = document.querySelector('#growth-header-dropdown .w-dropdown-list');

    if (headerPrefix) {
        headerPrefix.innerHTML = `Growth Plan to target <span class="audience-highlight">${audienceName}</span> struggling with`;
    }
    if (headerLabel) {
        headerLabel.textContent = 'broad problems';
    }

    function filterGrowthPlan(problemTitle) {
        if (!headerPrefix || !headerLabel) return;
        const currentAudience = window.originalGroupName || 'your audience';
        headerPrefix.innerHTML = `Growth Plan to target <span class="audience-highlight">${currentAudience}</span> struggling with`;

        if (problemTitle === 'all') {
            headerLabel.textContent = 'broad problems';
        } else {
            headerLabel.textContent = problemTitle;
        }
    }

    document.addEventListener('click', function (event) {
        const clickedButton = event.target.closest('.generate-growth-btn');
        if (!clickedButton) return;

        const parentCard = clickedButton.closest('.findings-block');
        const problemTitleElement = parentCard ? parentCard.querySelector('.section-title') : null;
        const growthTabLink = document.getElementById('growth-tab-link');

        if (problemTitleElement && growthTabLink) {
            const title = problemTitleElement.textContent.trim();
            filterGrowthPlan(title); 
            growthTabLink.click();   
        }
    });

    const growthTabLinkLazy = document.getElementById('growth-tab-link');
    if (growthTabLinkLazy) {
        growthTabLinkLazy.addEventListener('click', () => {
            if (window._growthTabLoaded) return;
            const posts = window._filteredPosts;
            if (!posts || !posts.length) return; 
            window._growthTabLoaded = true;
            const audience = window.originalGroupName || '';
            generateAndRenderAIPrompt(posts, audience);
            generateAndRenderSeoSunburst(posts, audience);
        });
    }

    if (dropdownList) {
        dropdownList.addEventListener('click', function (event) {
            const clickedLink = event.target.closest('.w-dropdown-link');
            if (!clickedLink) return;

            event.preventDefault();
            const selectedProblem = clickedLink.getAttribute('data-problem');
            filterGrowthPlan(selectedProblem);

            const dropdownToggle = document.querySelector('#growth-header-dropdown .w-dropdown-toggle');
            if (dropdownToggle && dropdownToggle.getAttribute('aria-expanded') === 'true') {
                dropdownToggle.click();
            }
        });
    }
}

function renderDiscoveryList(containerId, data, title, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let slots = container.querySelectorAll('.discovery-list-item');

    if (slots.length && data && data.length > slots.length) {
        const template = slots[slots.length - 1];
        for (let k = slots.length; k < data.length; k++) {
            const clone = template.cloneNode(true);
            template.parentNode.appendChild(clone);
        }
        slots = container.querySelectorAll('.discovery-list-item');
    }

    slots.forEach(slot => {
        slot.style.display = 'none';
        slot.style.opacity = '0'; 
    });

    if (!data || data.length === 0) return;

    data.forEach(([name, details], index) => {
        if (slots[index]) {
            const slot = slots[index];
            const rankEl = slot.querySelector('.rank');
            const nameEl = slot.querySelector('.name');
            const countEl = slot.querySelector('.count');

            if (rankEl) rankEl.textContent = `${index + 1}.`;
            if (nameEl) nameEl.textContent = name;
            if (countEl) countEl.textContent = `${details.count} mentions`;

            slot.setAttribute('data-word', name);
            slot.setAttribute('data-type', type);
            slot.style.display = 'flex';
            setTimeout(() => { slot.style.opacity = '1'; }, index * 50);
        }
    });
}

function renderIncludedSubreddits(subreddits) {
    const container = document.getElementById('included-subreddits-container');
    if (!container) return;

    container.innerHTML = `
        <h3 class="dashboard-section-title">Analysis Based On</h3>
        <div class="subreddit-tag-list">
            <p class="placeholder-text">Loading community details...</p>
        </div>
    `;

    try {
        const detailPromises = subreddits.map(sub => fetchSubredditDetails(sub));
        Promise.all(detailPromises).then(detailsArray => {
            const tagsHTML = detailsArray.map((details, index) => {
                const subName = subreddits[index];
                const detailsString = details ? JSON.stringify(details).replace(/'/g, "&apos;") : "{}";

                if (!details) {
                    return `
                        <div class="subreddit-tag-detailed subreddit-tag-detailed--error">
                            <div class="tag-header">r/${subName}</div>
                            <div class="tag-body">Details could not be loaded.</div>
                        </div>
                    `;
                }

                const description = details.public_description || 'No public description available.';
                const members = formatMemberCount(details.subscribers);
                const activityText = getActivityLabel(details.active_user_count, details.subscribers);
                const activityEmoji = activityIconFor(activityText);
                return `
                    <div class="subreddit-tag-detailed">
                        <div>
                            <div class="tag-header">
                                <span class="tag-name">r/${subName}</span>
                                <span class="tag-activity">${activityEmoji} ${activityText}</span>
                            </div>
                            <p class="tag-description">
                                ${description.substring(0, 150)}${description.length > 150 ? '...' : ''}
                            </p>
                            <div class="tag-footer">
                                <span class="tag-members"><strong>${members}</strong> members</span>
                            </div>
                        </div>
                        <div class="tag-footer-action">
                            <button class="remove-sub-btn" data-subname="${subName}" data-sub-details='${detailsString}'>
                                Remove
                            </button>
                            <a href="https://www.reddit.com/r/${subName}" target="_blank" rel="noopener noreferrer" class="view-sub-btn">
                                View on Reddit
                            </a>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <h3 class="dashboard-section-title">Analysis Based On</h3>
                <div class="subreddit-tag-list">${tagsHTML}</div>
            `;
        });
    } catch (error) {
        console.error("Error rendering subreddit details:", error);
        const tags = subreddits.map(sub => `<div class="subreddit-tag">r/${sub}</div>`).join('');
        container.innerHTML = `
            <h3 class="dashboard-section-title">Analysis Based On</h3>
            <div class="subreddit-tag-list">
                ${tags}
                <p class="error-message">Could not load community details.</p>
            </div>
        `;
    }
}

async function renderAndHandleRelatedSubreddits(analyzedSubs) {
    const container = document.getElementById('similar-subreddits-container');
    if (!container) return;

    container.innerHTML = `
        <h3 class="dashboard-section-title related-communities-title">Related Communities to Explore</h3>
        <div class="subreddit-tag-list">
            <p class="placeholder-text">Finding similar communities...</p>
        </div>
    `;

    container.removeEventListener('click', handleAddRelatedSubClick);
    container.addEventListener('click', handleAddRelatedSubClick);

    try {
        const detailPromises = analyzedSubs.map(sub => fetchSubredditDetails(sub));
        const detailsArray = await Promise.all(detailPromises);
        const validDetails = detailsArray.filter(Boolean).map(d => ({ name: d.display_name, description: d.public_description || '' }));
        if (validDetails.length === 0) throw new Error("Could not get details for source subreddits.");

        const relatedSubNames = await findRelatedSubredditsAI(validDetails, originalGroupName);
        const newSubNames = relatedSubNames.filter(name => !analyzedSubs.some(s => s.toLowerCase() === name.toLowerCase()));

        if (newSubNames.length === 0) {
            container.querySelector('.subreddit-tag-list').innerHTML = `<p class="placeholder-text">No new related communities were found.</p>`;
            return;
        }

        const rankedRelatedSubs = await fetchAndRankSubreddits(newSubNames);
        if (rankedRelatedSubs.length === 0) {
            container.querySelector('.subreddit-tag-list').innerHTML = `<p class="placeholder-text">No suitable communities found after validation.</p>`;
            return;
        }

        const tagsHTML = rankedRelatedSubs.slice(0, 10).map(sub => {
            const subDetailsString = JSON.stringify(sub).replace(/'/g, "&apos;");
            const members = formatMemberCount(sub.members);
            const activityText = sub.activityLabel;
            const activityEmoji = activityIconFor(activityText);
            const description = sub.description.trim() ? sub.description : `A community for discussions and content related to r/${sub.name}.`;

            return `
                <div class="subreddit-tag-detailed">
                    <div>
                        <div class="tag-header">
                            <span class="tag-name">r/${sub.name}</span>
                            <span class="tag-activity">${activityEmoji} ${activityText}</span>
                        </div>
                        <p class="tag-description">
                            ${description.substring(0, 150)}${description.length > 150 ? '...' : ''}
                        </p>
                        <div class="tag-footer">
                            <span class="tag-members"><strong>${members}</strong> members</span>
                        </div>
                    </div>
                    <div class="tag-footer-action">
                        <button class="add-related-sub-btn" data-subname="${sub.name}" data-sub-details='${subDetailsString}'>
                            + Add to Analysis
                        </button>
                        <a href="https://www.reddit.com/r/${sub.name}" target="_blank" rel="noopener noreferrer" class="view-sub-btn">
                            View on Reddit
                        </a>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelector('.subreddit-tag-list').innerHTML = tagsHTML;
    } catch (error) {
        console.error("Error in renderAndHandleRelatedSubreddits:", error);
        container.querySelector('.subreddit-tag-list').innerHTML = `<p class="error-message">Could not load related community suggestions.</p>`;
    }
}

async function generateAndRenderPodcasts(posts, audienceContext) {
    const container = document.getElementById('podcasts');
    if (!container) return;
    if (!window._podcastBlueprint) {
        const bp = container.querySelector('.podcasts-list-item');
        if (bp) window._podcastBlueprint = bp.cloneNode(true);
    }
    const blueprint = window._podcastBlueprint;
    if (!blueprint) { console.warn('[Media] no template found.'); return; }

    // local-first mining: read directly from loaded memory rather than hitting Reddit API
    const corpus = posts || window._fullCorpus || window._filteredPosts || [];
    if (corpus.length < 5) { renderPodcasts(container, blueprint, []); return; }

    const mediaMatch = /\b(podcast|podcasts|episode|episodes|youtube|yt|channel|channels|video|videos|watch|vlog|vlogs|show|shows|book|books|newsletter|newsletters|substack|blog|blogs|read|reading|article|articles)\b/i;
    const pool = corpus.filter(p => mediaMatch.test(`${p.data.title || ''} ${p.data.selftext || p.data.body || ''}`));

    console.log(`[Media] Local mining pool: ${pool.length} items out of ${corpus.length} total posts/comments.`);
    if (pool.length === 0) { renderPodcasts(container, blueprint, []); return; }

    const sampleText = pool.slice(0, 70).map((p, i) =>
        `[${i}] ${`${p.data.title || ''} ${p.data.selftext || p.data.body || ''}`.replace(/\s+/g, ' ').slice(0, 600)}`
    ).join('\n');

    const prompt = `From these "${audienceContext}" discussions, extract the specific SHOWS, CHANNELS, & READING resources this audience follows: PODCASTS, YOUTUBE channels, and books/newsletters they mention watching, listening to, or recommending.
For each item, return:
- "type": "podcast", "youtube", "book", "newsletter", or "blog".
- "name": the actual title / channel name / book title exactly as mentioned - a real proper name, NEVER a descriptive phrase or sentence fragment.
- "focus": a SHORT phrase for what it is about (genre/topic), ONLY if clearly stated; otherwise "".

RULES: Only include real, specific resources actually NAMED in the text. NEVER invent names or descriptions. If none are named, return an empty list.
Discussions:
${sampleText}

Respond ONLY with valid JSON: {"media":[{"type":"youtube","name":"...","focus":"..."}]}`;

    let parsed = [];
    try {
        const data = await callOpenAIProxyWithRetry({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You extract only explicitly-named podcasts, books, newsletters, blogs, and video channels from text. You never invent names, and you output only valid JSON." },
                { role: "user", content: prompt }
            ],
            temperature: 0.1,
            max_completion_tokens: 1000,
            response_format: { type: "json_object" }
        }, { tries: 2 });
        if (data && data.openaiResponse) parsed = JSON.parse(data.openaiResponse).media || [];
    } catch (e) {
        console.warn('[Media] extraction failed:', e && e.message);
    }

    const allText = pool.map(p => `${p.data.title || ''} ${p.data.selftext || p.data.body || ''}`).join(' [SEP] ').toLowerCase();
    const seen = new Set();
    const items = [];
    
    (parsed || []).forEach(w => {
        if (!w || !w.name) return;
        const name = String(w.name).trim();
        const key = name.toLowerCase();
        if (key.length < 3 || seen.has(key)) return;
        const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = allText.match(new RegExp(`\\b${esc}\\b`, 'gi'));
        const count = m ? m.length : 0;
        if (count === 0) return;
        seen.add(key);
        const type = ['podcast', 'youtube', 'book', 'newsletter', 'blog'].includes(String(w.type || '').toLowerCase()) ? String(w.type).toLowerCase() : 'blog';
        items.push({ type, name, focus: (w.focus || '').trim(), count });
    });
    
    items.sort((a, b) => b.count - a.count);
    const top = items.slice(0, 8);
    
    top.forEach(it => {
        if (it.type === 'youtube') {
            it.link = `https://www.youtube.com/results?search_query=${encodeURIComponent(it.name)}`;
        } else if (it.type === 'book') {
            it.link = `https://www.google.com/search?tbm=bks&q=${encodeURIComponent(it.name)}`;
        } else if (it.type === 'podcast') {
            it.link = `https://www.google.com/search?q=${encodeURIComponent(it.name + ' podcast')}`;
        } else {
            it.link = `https://www.google.com/search?q=${encodeURIComponent(it.name)}`;
        }
    });
    renderPodcasts(container, blueprint, top);
}

function renderPodcasts(container, blueprint, items) {
    container.querySelectorAll('.podcasts-list-item').forEach(el => el.remove());
    if (!items || !items.length) {
        const empty = blueprint.cloneNode(true);
        empty.style.display = '';
        const n = empty.querySelector('.podcast-name'); 
        if (n) n.innerText = 'No resources or media were named in these discussions.';
        
        ['.podcast-focus', '.podcast-meta'].forEach(sel => { 
            const e = empty.querySelector(sel); 
            if (e) e.style.display = 'none'; 
        });
        
        const img = empty.querySelector('.podcast-image'); 
        if (img) img.style.display = 'none';
        
        const link = empty.querySelector('.podcast-link'); 
        if (link) link.style.display = 'none';
        
        container.appendChild(empty);
        return;
    }
    items.forEach(it => {
        const node = blueprint.cloneNode(true);
        node.style.display = '';
        node.setAttribute('data-media-type', it.type || 'podcast'); 
        
        const set = (sel, val) => { const e = node.querySelector(sel); if (e) e.innerText = val; };
        set('.podcast-name', it.name);
        
        const typeLabel = it.type ? it.type.charAt(0).toUpperCase() + it.type.slice(1) : 'Resource';
        set('.podcast-focus', it.focus ? `Focus: ${it.focus}` : `Type: ${typeLabel}`);
        set('.podcast-meta', `Mentioned ${it.count} ${it.count === 1 ? 'time' : 'times'}`);
        
        const img = node.querySelector('.podcast-image');
        if (img) {
            img.style.display = 'none'; 
        }
        
        const link = node.querySelector('.podcast-link');
        if (link) {
            link.style.display = ''; 
            if (it.link) {
                link.setAttribute('href', it.link);
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            }
        }
        container.appendChild(node);
    });
}

function renderSocialSplitChart(posts) {
    const el = document.getElementById('social-split-chart');
    if (!el) return;
    const texts = (posts || []).map(p => `${p.data.title || ''} ${p.data.selftext || p.data.body || ''}`.toLowerCase());
    if (!texts.length) return;

    const PLATFORMS = [
        { name: 'Instagram',   color: '#FF6FB5', keys: ['instagram', 'insta', 'reels'] },
        { name: 'TikTok',      color: '#36E0D0', keys: ['tiktok', 'tik tok'] },
        { name: 'YouTube',     color: '#FF8C66', keys: ['youtube'] },
        { name: 'Facebook',    color: '#6C8CFF', keys: ['facebook', 'fb group', 'fb groups'] },
        { name: 'X / Twitter', color: '#7CC7FF', keys: ['twitter', 'tweet', 'x.com'] },
        { name: 'Discord',     color: '#8B7CFF', keys: ['discord'] },
        { name: 'Telegram',    color: '#5ED1D8', keys: ['telegram'] },
        { name: 'WhatsApp',    color: '#57D9A3', keys: ['whatsapp', 'whats app'] },
        { name: 'Snapchat',    color: '#FFD56B', keys: ['snapchat'] },
        { name: 'Pinterest',   color: '#FF8FA3', keys: ['pinterest'] },
        { name: 'LinkedIn',    color: '#5B9BD5', keys: ['linkedin'] }
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
    const MIN_TOTAL = 12;
    if (data.length === 0 || grandTotal < MIN_TOTAL) {
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
    let acc = 0;
    const stops = [];
    data.forEach((d) => {
        const start = acc;
        const end = start + (d.count / total) * 360;
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

async function generateAndRenderWaterholes(posts, audienceContext) {
    const container = document.getElementById('watering-holes');
    if (!container) return;
    if (!window._waterholeBlueprint) {
        const bp = container.querySelector('.watering-holes-list-item');
        if (bp) window._waterholeBlueprint = bp.cloneNode(true);
    }
    const blueprint = window._waterholeBlueprint;
    if (!blueprint) { console.warn('[Waterholes] no template.'); return; }

    // local-first mining: read from rich pre-loaded memory to eliminate 429 proxy rate limits
    const corpus = posts || window._fullCorpus || window._filteredPosts || [];
    if (corpus.length < 5) return;
    const sampleText = corpus.slice(0, 60).map((p, i) =>
        `[${i}] ${`${p.data.title || ''} ${p.data.selftext || p.data.body || ''}`.replace(/\s+/g, ' ').slice(0, 500)}`
    ).join('\n');

    const prompt = `From these "${audienceContext}" discussions, find WHERE THIS AUDIENCE ACTUALLY HANGS OUT outside of Reddit - their "watering holes". Look across EVERY kind of gathering place they mention, not just chat apps:
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
        const data = await callOpenAIProxyWithRetry({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You find where an audience gathers OFF Reddit - any named community, group, forum, site, app, social account, or in-person meetup - across every platform, not just chat apps. You never invent names, numbers or descriptions, and you output only valid JSON." },
                { role: "user", content: prompt }
            ],
            temperature: 0.1,
            max_completion_tokens: 800,
            response_format: { type: "json_object" }
        }, { tries: 2 });
        if (data && data.openaiResponse) parsed = JSON.parse(data.openaiResponse).waterholes || [];
    } catch (e) {
        console.warn('[Waterholes] extraction failed:', e && e.message);
    }

    const allText = corpus.map(p => `${p.data.title || ''} ${p.data.selftext || p.data.body || ''}`).join(' [SEP] ').toLowerCase();
    const seen = new Set();
    const items = [];
    (parsed || []).forEach(w => {
        if (!w || !w.name) return;
        const name = String(w.name).trim();
        const key = name.toLowerCase();
        if (key.length < 2 || seen.has(key)) return;
        const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = allText.match(new RegExp(`\\b${esc}\\b`, 'gi'));
        const count = m ? m.length : 0;
        if (count === 0) return; 
        seen.add(key);
        const platform = (w.platform && String(w.platform).trim()) ? String(w.platform).trim() : 'Other';
        items.push({ platform, name, context: (w.context || '').trim(), count });
    });
    items.sort((a, b) => b.count - a.count);
    renderWaterholes(container, blueprint, items.slice(0, 8));
}

function renderWaterholes(container, blueprint, items) {
    container.querySelectorAll('.watering-holes-list-item').forEach(el => el.remove());
    if (!items || !items.length) {
        const empty = blueprint.cloneNode(true);
        empty.style.display = '';
        const nameEl = empty.querySelector('.waterhole-name');
        const set = (sel, val) => { const e = empty.querySelector(sel); if (e) e.innerText = val; };
        set('.waterhole-platform', '');
        set('.waterhole-meta', '');
        if (nameEl) nameEl.innerText = 'No non-Reddit communities were named in these discussions.';
        container.appendChild(empty);
        return;
    }
    items.forEach(it => {
        const node = blueprint.cloneNode(true);
        node.style.display = '';
        node.setAttribute('data-platform', it.platform.toLowerCase());
        const set = (sel, val) => { const e = node.querySelector(sel); if (e) e.innerText = val; };
        set('.waterhole-platform', it.platform);
        set('.waterhole-name', it.name);
        set('.waterhole-meta', it.context || `Mentioned ${it.count} ${it.count === 1 ? 'time' : 'times'}`);
        container.appendChild(node);
    });
}

function initializeDashboardInteractivity() {
    document.addEventListener('click', async (e) => {
        const briefBtn = e.target.closest('.brief-button');
        if (briefBtn) {
            const item = briefBtn.closest('.discovery-list-item') || briefBtn;
            const itemName = item.getAttribute('data-word') || briefBtn.getAttribute('data-word');
            const itemType = item.getAttribute('data-type') || briefBtn.getAttribute('data-type');

            if (itemName && itemType) {
                const panelId = itemType === 'brands' ? 'brand-detail-panel' : 'product-detail-panel';
                const panel = document.getElementById(panelId);
                if (panel) panel.classList.add('visible'); 
                generateAndRenderBrandBrief(itemName, itemType);
            }
            return;
        }

        const backBtn = e.target.closest('.brief-back-btn');
        if (backBtn) {
            document.querySelectorAll('#brand-detail-panel, #product-detail-panel').forEach(p => p.classList.remove('visible'));
            return;
        }

        const pill = e.target.closest('.finding-pill');
        if (pill) {
            const pillsWrap = document.getElementById('finding-pills-wrap');
            if (pillsWrap) {
                pillsWrap.querySelectorAll('.finding-pill').forEach(p => p.classList.remove('active'));
            }
            pill.classList.add('active');

            const findingTitle = pill.dataset.finding;
            const relevantPosts = getPostsForFinding(findingTitle);
            await generateAndRenderSeoSunburst(relevantPosts, window.originalGroupName || '');
            return;
        }
    });
}

async function runProblemFinder(options = {}) {
    const { isUpdate = false } = options;

    if (!isUpdate && !SEO_CARD_BLUEPRINT) {
        const container = document.getElementById('keyword-opportunities-container');
        if (container) {
            const cardTemplate = container.querySelector('.action-card-blueprint');
            if (cardTemplate) {
                SEO_CARD_BLUEPRINT = cardTemplate.cloneNode(true);
                const itemTemplate = cardTemplate.querySelector('.action-item-blueprint');
                if (itemTemplate) SEO_ITEM_BLUEPRINT = itemTemplate.cloneNode(true);
            }
        }
    }

    if (!isUpdate && !PHRASE_BLUEPRINT) {
        const found = document.getElementById('phrase-term') || document.querySelector('.phrase-item-template');
        if (found) {
            PHRASE_BLUEPRINT = found.cloneNode(true);
            PHRASE_BLUEPRINT.id = '';
        }
    }

    if (!isUpdate && !PILLAR_BLUEPRINT) {
        const found = document.querySelector('.pillar-item-template');
        if (found) PILLAR_BLUEPRINT = found.cloneNode(true);
    }
    
    if (!VOICE_PILL_BLUEPRINT) {
        const container = document.querySelector('.voice-adjective-tags');
        if (container) {
            const foundPill = container.querySelector('.voice-adjective-tags');
            if (foundPill) VOICE_PILL_BLUEPRINT = foundPill.cloneNode(true);
        }
    }
    
    if (!HOOK_CARD_BLUEPRINT) {
        const foundCard = document.querySelector('.hook-pattern-card');
        if (foundCard) {
            HOOK_CARD_BLUEPRINT = foundCard.cloneNode(true);
            const foundItem = HOOK_CARD_BLUEPRINT.querySelector('.hook-proof-item');
            if (foundItem) HOOK_ITEM_BLUEPRINT = foundItem.cloneNode(true);
        }
    }
    
    if (!MINDSET_ITEM_BLUEPRINT) {
        const foundMindset = document.querySelector('.mindset-item-template');
        if (foundMindset) MINDSET_ITEM_BLUEPRINT = foundMindset.cloneNode(true);
    }

    if (!AVOID_SWAP_BLUEPRINT) {
        const foundSwap = document.querySelector('.avoid-instead-row'); 
        if (foundSwap) AVOID_SWAP_BLUEPRINT = foundSwap.cloneNode(true);
    }
    
    if (!LANGUAGE_AVOID_BLUEPRINT) {
        const found = document.querySelector('.avoid-term-template');
        if (found) LANGUAGE_AVOID_BLUEPRINT = found.cloneNode(true);
    }
    
    if (!LANGUAGE_USE_BLUEPRINT) {
        const found = document.querySelector('.use-term-template');
        if (found) LANGUAGE_USE_BLUEPRINT = found.cloneNode(true);
    }

    if (!isUpdate && !SEO_CARD_BLUEPRINT) {
        const container = document.getElementById('keyword-opportunities-container');
        if (container) {
            const cardTemplate = container.querySelector('.action-card-blueprint');
            if (cardTemplate) {
                SEO_CARD_BLUEPRINT = cardTemplate.cloneNode(true);
                const itemTemplate = cardTemplate.querySelector('.action-item-blueprint');
                if (itemTemplate) SEO_ITEM_BLUEPRINT = itemTemplate.cloneNode(true);
            }
        }
    }

    if (!isUpdate && !FINDING_PILL_BLUEPRINT) {
        const wrap = document.getElementById('finding-pills-wrap');
        if (wrap) {
            const pillTemplate = wrap.querySelector('.finding-pill');
            if (pillTemplate) FINDING_PILL_BLUEPRINT = pillTemplate.cloneNode(true);
        }
    }

    if (!TONE_CARD_BLUEPRINT) {
        const card = document.querySelector('.tone-card-blueprint');
        if (card) {
            TONE_CARD_BLUEPRINT = card.cloneNode(true);
            TONE_TRAIT_BLUEPRINT = card.querySelector('.tone-trait-row').cloneNode(true);
        }
    }
    
    const growthHeaderPrefix = document.getElementById('growth-header-prefix');
    if (growthHeaderPrefix) {
        growthHeaderPrefix.innerHTML = `Growth Plan to target <span class="audience-highlight">${originalGroupName}</span> struggling with`;
    }
    const searchButton = document.getElementById('search-selected-btn');
    if (!searchButton) { console.error("Could not find button."); return; }
    const selectedCheckboxes = document.querySelectorAll('#subreddit-choices input:checked');
    if (selectedCheckboxes.length === 0) { alert("Please select at least one community."); return; }
    const selectedSubreddits = Array.from(selectedCheckboxes).map(cb => cb.value);

    const subredditQueryString = selectedSubreddits.map(sub => `subreddit:${sub}`).join(' OR ');
    if (!isUpdate) {
        searchButton.classList.add('is-loading');
        searchButton.disabled = true;
    }
    const problemTerms = ["problem", "challenge", "frustration", "annoyance", "wish I could", "hate that", "help with", "solution for"];
    const deepProblemTerms = ["struggle", "issue", "difficulty", "pain point", "pet peeve", "disappointed", "advice", "workaround", "how to", "fix", "rant", "vent"];
    const demandSignalTerms = ["i'd pay good money for", "buy it in a second", "i'd subscribe to", "throw money at it", "where can i buy", "happily pay", "shut up and take my money", "sick of doing this manually", "can't find anything that", "waste so much time on", "has to be a better way", "shouldn't be this hard", "why is there no tool for", "why is there no app for", "tried everything and nothing works", "tool almost did what i wanted", "it's missing", "tried", "gave up on it", "if only there was an app", "i wish someone would build", "why hasn't anyone made", "waste hours every week", "such a timesuck", "pay just to not have to think", "rather pay than do this myself"];
    const resultsWrapper = document.getElementById('results-wrapper-b');
    const resultsMessageDiv = document.getElementById("results-message");
    const countHeaderDiv = document.getElementById("count-header");
    if (!isUpdate) {
        if (resultsWrapper) { resultsWrapper.style.display = 'none'; resultsWrapper.style.opacity = '0'; }
        ["count-header", "filter-header", "pulse-results", "posts-container", "emotion-map-container", "overview-div", "included-subreddits-container", "similar-subreddits-container", "context-box", "positive-context-box", "negative-context-box", "power-phrases"].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
        if (resultsMessageDiv) resultsMessageDiv.innerHTML = "";
        for (let i = 1; i <= 5; i++) {
            const block = document.getElementById(`findings-block${i}`);
            if (block) {
                block.style.display = 'none';
                const prevalenceWrapper = block.querySelector('.prevalence-container-wrapper');
                if (prevalenceWrapper) {
                    prevalenceWrapper.innerHTML = "<p class='loading-text' style='text-align: center; padding: 2rem;'>Brewing insights...</p>";
                }
            }
        }
    }
    try {
        if (!isUpdate) startProblemBubbles();
        console.log("--- STARTING PHASE 1: FAST ANALYSIS ---");
        const panelContent = document.getElementById('bubble-content');
        if (!setConstellationPanelState('loading') && panelContent) {
            panelContent.innerHTML = `<div class="panel-placeholder">Loading purchase signals... <span class="loader-dots"></span></div>`;
        }
        const searchDepth = document.querySelector('input[name="search-depth"]:checked')?.value || 'quick';
        let generalSearchTerms = (searchDepth === 'deep') ? [...problemTerms, ...deepProblemTerms] : problemTerms;
        let limitPerTerm = (searchDepth === 'deep') ? 75 : 40;
        const selectedTimeRaw = document.querySelector('input[name="timePosted"]:checked')?.value || "all";
        const selectedMinUpvotes = parseInt(document.querySelector('input[name="minVotes"]:checked')?.value || "20", 10);
        const timeMap = { week: "week", month: "month", "6months": "year", year: "year", all: "all" };
        const selectedTime = timeMap[selectedTimeRaw] || "all";
        const problemItems = await fetchMultipleRedditDataBatched(subredditQueryString, generalSearchTerms, limitPerTerm, selectedTime, false);
        const allItems = deduplicatePosts(problemItems);
        if (allItems.length === 0) throw new Error("No initial problem posts found. Try different communities or a broader search.");
        const filteredItems = filterPosts(allItems, selectedMinUpvotes);
        if (filteredItems.length < 10) throw new Error("Not enough high-quality content found after filtering. Try a 'Deep' search or a longer time frame.");
        window._filteredPosts = filteredItems;
        window._exportData = {}; 
        window._growthTabLoaded = false; 
        generateAndRenderOverview(filteredItems, originalGroupName);
        renderPosts(filteredItems);
        generateAndRenderHybridSentiment(filteredItems, originalGroupName);
        generateEmotionMapData(filteredItems).then(renderEmotionMap);
        renderIncludedSubreddits(selectedSubreddits);
        generateAndRenderVoiceProfile(filteredItems, originalGroupName);
        generateAndRenderLanguageToAvoid(filteredItems, originalGroupName);
        generateAndRenderHookPatterns(filteredItems, originalGroupName);
        generateAndRenderToneMap(filteredItems, originalGroupName);
        generateAndRenderMindsetSummary(filteredItems, originalGroupName);
        generateAndRenderStrategicPillars(filteredItems, originalGroupName);
        
        showBrandLoader();
        extractAndValidateEntities(filteredItems, originalGroupName).then(entities => { renderDiscoveryList('top-brands-container', entities.topBrands, 'Top Brands & Specific Products', 'brands'); renderDiscoveryList('top-products-container', entities.topProducts, 'Top Generic Products', 'products'); });
        renderCountHeader(filteredItems.length, allItems.length, originalGroupName);
        const stableSorted = [...filteredItems].sort((a, b) =>
            (b.data.ups || 0) - (a.data.ups || 0) ||
            (b.data.created_utc || 0) - (a.data.created_utc || 0) ||
            String(a.data.id).localeCompare(String(b.data.id))
        );
        const topKeywords = getTopKeywords(stableSorted, 10);
        const topPosts = stableSorted.slice(0, 40);
        const combinedTexts = topPosts.map(post => `${post.data.title || post.data.link_title || ''}. ${getFirstTwoSentences(post.data.selftext || post.data.body || '')}`).join("\n\n");  
        const openAIParams = { model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a helpful assistant that summarizes user-provided text into between 1 and 5 core common struggles and provides authentic quotes." }, { role: "user", content: `Your task is to analyze the provided text about the niche "${originalGroupName}" and identify 1 to 5 common problems. You MUST provide your response in a strict JSON format. The JSON object must have a single top-level key named "summaries". The "summaries" key must contain an array of objects. Each object in the array represents one common problem and must have the following keys: "title", "body", "count", "quotes", "keywords". CRITICAL RULES FOR QUOTES: The "quotes" array must contain exactly 3 strings, and each string MUST be 63 characters or less. Here are the top keywords to guide your analysis: [${topKeywords.join(', ')}]. Make sure the niche "${originalGroupName}" is naturally mentioned in each "body". Prioritise the most common, clearly recurring problems that appear across many of the posts, and avoid niche one-off complaints, so the analysis stays consistent if the tool is run again on the same audience. Example of the required output format: { "summaries": [ { "title": "Example Title 1", "body": "Example body text about the problem.", "count": 50, "quotes": ["A short quote under 63 chars.", "Another quote under 63 chars.", "A final quote under 63 chars."], "keywords": ["keyword1", "keyword2"] } ] }. Here is the text to analyze: \`\`\`${combinedTexts}\`\`\`` }], temperature: 0.0, max_completion_tokens: 1500, seed: 11, response_format: { "type": "json_object" } };
        
        const openAIData = await callOpenAIProxyWithRetry(openAIParams, { tries: 2 });
        let summaries = [];
        if (openAIData && openAIData.openaiResponse) {
            summaries = parseAISummary(openAIData.openaiResponse);
        }

        if (summaries.length === 0) {
            console.warn("AI failed to generate summaries. Using fallback.");
            summaries = [{
                title: "General Insights",
                body: `Community members in ${originalGroupName} are discussing various topics. View the raw posts below for details.`,
                count: filteredItems.length,
                quotes: ["Look at raw posts for details", "No specific quotes found", "Check the posts below"],
                keywords: ["Discussion"]
            }];
        }

        const validatedSummaries = summaries.filter(finding =>
            filteredItems.filter(post => calculateRelevanceScore(post, finding) > 0).length >= 1
        );
        const finalSummaries = validatedSummaries.length > 0 ? validatedSummaries : summaries;
        const metrics = calculateFindingMetrics(finalSummaries, filteredItems);

        const sortedFindings = validatedSummaries.map((summary, index) => ({
            summary,
            prevalence: Math.round((metrics[index].supportCount / (metrics.totalProblemPosts || 1)) * 100),
            supportCount: metrics[index].supportCount
        })).sort((a, b) => b.prevalence - a.prevalence);

        console.log("CHECKPOINT A: Analysis is complete. Found these findings:", sortedFindings);
        window._summaries = sortedFindings.map(item => item.summary);
        populateFindingPills();

        for (let i = 1; i <= 5; i++) {
            const block = document.getElementById(`findings-block${i}`);
            if (block) block.style.display = "none";
        }
        sortedFindings.forEach((findingData, index) => {
            const displayIndex = index + 1;
            if (displayIndex > 5) return;
            const block = document.getElementById(`findings-block${displayIndex}`);
            if (!block) return;
            const content = document.getElementById(`findings-${displayIndex}`);
            const btn = block.querySelector('.sample-posts-button');
            block.style.display = "flex";
            if (content) {
                const { summary, prevalence, supportCount } = findingData;
                const titleEl = content.querySelector('.section-title');
                if (titleEl) titleEl.textContent = summary.title;
                const teaserEl = content.querySelector('.summary-teaser');
                const fullEl = content.querySelector('.summary-full');
                const seeMoreBtn = content.querySelector('.see-more-btn');
                if (teaserEl && fullEl && seeMoreBtn) {
                    if (summary.body.length > 95) {
                        teaserEl.textContent = summary.body.substring(0, 95) + "…";
                        fullEl.textContent = summary.body;
                        teaserEl.style.display = 'inline';
                        fullEl.style.display = 'none';
                        seeMoreBtn.style.display = 'inline-block';
                        seeMoreBtn.textContent = 'See more';
                        const newBtn = seeMoreBtn.cloneNode(true);
                        seeMoreBtn.parentNode.replaceChild(newBtn, seeMoreBtn);
                        newBtn.addEventListener('click', function () {
                            const isHidden = teaserEl.style.display !== 'none';
                            teaserEl.style.display = isHidden ? 'none' : 'inline';
                            fullEl.style.display = isHidden ? 'inline' : 'none';
                            newBtn.textContent = isHidden ? 'See less' : 'See more';
                        });
                    } else {
                        teaserEl.textContent = summary.body;
                        teaserEl.style.display = 'inline';
                        fullEl.style.display = 'none';
                        seeMoreBtn.style.display = 'none';
                    }
                }
                const quotesContainer = content.querySelector('.quotes-container');
                if (quotesContainer) {
                    const quoteElements = quotesContainer.querySelectorAll('.quote');
                    summary.quotes.forEach((quoteText, i) => {
                        if (quoteElements[i]) {
                            if (quoteText) {
                                quoteElements[i].textContent = `"${quoteText}"`;
                                quoteElements[i].style.display = 'block';
                            } else {
                                quoteElements[i].style.display = 'none';
                            }
                        }
                    });
                }
                const metricsWrapper = content.querySelector('.prevalence-container-wrapper');
                if (metricsWrapper) {
                    metricsWrapper.innerHTML = (sortedFindings.length === 1) ? `<div class="prevalence-container"><div class="prevalence-header">Primary Finding</div><div class="single-finding-metric">Supported by ${supportCount} Posts</div><div class="prevalence-subtitle">This was the only significant problem theme identified.</div></div>` : `<div class="prevalence-container"><div class="prevalence-header">${prevalence >= 30 ? "High" : prevalence >= 15 ? "Medium" : "Low"} Prevalence</div><div class="prevalence-bar-background"><div class="prevalence-bar-foreground" style="width: ${prevalence}%; background-color: ${prevalence >= 30 ? "#296fd3" : prevalence >= 15 ? "#5b98eb" : "#aecbfa"};">${prevalence}%</div></div><div class="prevalence-subtitle">Represents ${prevalence}% of all identified problems.</div></div>`;
                }
            }
            if (btn) {
                btn.onclick = () => showSamplePosts(index, window._assignments, window._filteredPosts, window._usedPostIds);
            }
        });
        try {
            window._postsForAssignment = filteredItems.slice(0, 75);
            window._usedPostIds = new Set();
            const assignments = await assignPostsToFindings(window._summaries, window._postsForAssignment);
            window._assignments = assignments;
            for (let i = 0; i < window._summaries.length; i++) {
                if (i >= 5) break;
                showSamplePosts(i, assignments, filteredItems, window._usedPostIds);
            }
        } catch (err) {
            console.error("Failed to assign posts to findings:", err);
            for (let i = 1; i <= 5; i++) { const redditDiv = document.getElementById(`reddit-div${i}`); if (redditDiv) { redditDiv.innerHTML = `<div style="font-style: italic; color: #999;">Could not load sample posts.</div>`; } }
        }

        if (countHeaderDiv && countHeaderDiv.textContent.trim() !== "") {
            if (resultsWrapper) {
                resultsWrapper.style.setProperty('display', 'flex', 'important');
                setTimeout(() => {
                    if (resultsWrapper) {
                        resultsWrapper.style.opacity = '1';
                        if (!isUpdate) {
                            resultsWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            const fullHeader = document.getElementById('full-header');
                            if (fullHeader) {
                                fullHeader.classList.add('header-hidden');
                                fullHeader.addEventListener('transitionend', () => {
                                    fullHeader.style.display = 'none';
                                }, { once: true });
                            }
                        }
                    }
                }, 50);
            }
        }
        setTimeout(() => runConstellationAnalysis(subredditQueryString, demandSignalTerms, selectedTime), 1500);
        setTimeout(() => renderAndHandleRelatedSubreddits(selectedSubreddits), 2500);
        setTimeout(() => {
            Promise.resolve(enhanceDiscoveryWithComments(window._filteredPosts, originalGroupName))
                .finally(() => recoverBrandsWithShopping(subredditQueryString, selectedTime, originalGroupName));
        }, 5000);
        setTimeout(() => generateAndRenderHistoricalSentiment(subredditQueryString), 3500);
        setTimeout(async () => {
            let gemCorpus = window._filteredPosts || [];
            try {
                const topIds = gemCorpus.slice(0, 40).map(p => p.data.id);
                const rawComments = await fetchCommentsForPosts(topIds);
                const comments = deduplicateByContent(rawComments).filter(c => (c.data.body || '').length >= 40);
                gemCorpus = [...gemCorpus, ...comments];
                console.log(`[Hidden Gems] Mining ${gemCorpus.length} items (${window._filteredPosts.length} posts + ${comments.length} comments).`);
            } catch (e) {
                console.warn('Hidden Gems: comment fetch failed, using posts only.', e);
            }
            generateAndRenderHiddenGems(gemCorpus, originalGroupName, { searchedCount: gemCorpus.length, searchedLabel: 'posts and comments' });
        }, 4000);
        setTimeout(() => pregenerateAllSubProblems(originalGroupName), 14000);

    } catch (err) {
        console.error("A fatal error occurred:", err);
        alert("An error occurred during analysis. Please check the console for details. Error: " + err.message);
        if (resultsMessageDiv) resultsMessageDiv.innerHTML = `<p class='error' style="color: red; text-align: center;">❌ ${err.message}</p>`;
        if (resultsWrapper) { resultsWrapper.style.setProperty('display', 'flex', 'important'); resultsWrapper.style.opacity = '1'; }
    } finally {
        if (!isUpdate) {
            stopProblemBubbles();
            searchButton.classList.remove('is-loading');
            searchButton.disabled = false;
        }
    }
}

function initializeProblemFinderTool() {
    console.log("Problem Finder elements found. Initializing...");
    const welcomeDiv = document.getElementById('welcome-div');
    const pillsContainer = document.getElementById('pf-suggestion-pills');
    const groupInput = document.getElementById('group-input');
    const findCommunitiesBtn = document.getElementById('find-communities-btn');
    const searchSelectedBtn = document.getElementById('search-selected-btn');
    const step1Container = document.getElementById('step-1-container');
    const step2Container = document.getElementById('subreddit-selection-container');
    const inspireButton = document.getElementById('inspire-me-button');
    const choicesContainer = document.getElementById('subreddit-choices');
    const audienceTitle = document.getElementById('pf-audience-title');
    const backToStep1Btn = document.getElementById('back-to-step1-btn');
    
    if (backToStep1Btn) {
        backToStep1Btn.addEventListener('click', () => {
            stopCommunityLoader();
            if (searchSelectedBtn) searchSelectedBtn.classList.add('pf-btn-disabled');
            step2Container.classList.remove('visible');
            step1Container.classList.remove('hidden');
            if (welcomeDiv) welcomeDiv.style.display = '';
            choicesContainer.innerHTML = '';
            if (audienceTitle) audienceTitle.innerHTML = '';

            const fs = document.getElementById('pf-found-summary'); if (fs) fs.textContent = '';
            const fc = document.getElementById('pf-found-count-text'); if (fc) fc.textContent = '';
        });
    }
    if (!findCommunitiesBtn || !searchSelectedBtn || !choicesContainer) {
        console.error("Critical error: A key UI element was not found.");
        return;
    }
    const transitionToStep2 = () => {
        if (step2Container.classList.contains('visible')) return;
        if (welcomeDiv) { welcomeDiv.style.display = 'none'; }
        step1Container.classList.add('hidden');
        step2Container.classList.add('visible');
        if (audienceTitle) audienceTitle.innerHTML = `Select Subreddits For: <span class="pf-audience-name">${originalGroupName}</span>`;
    };

    if (pillsContainer) {
        pillsContainer.innerHTML = suggestions.map(s => `<div class="pf-suggestion-pill" data-value="${s}">${s}</div>`).join('');
        pillsContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('pf-suggestion-pill')) {
                groupInput.value = event.target.getAttribute('data-value');
                findCommunitiesBtn.click();
            }
        });
    }

    if (inspireButton) {
        inspireButton.addEventListener('click', () => {
            if (pillsContainer) pillsContainer.classList.toggle('visible');
        });
    }
    findCommunitiesBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        const groupName = groupInput.value.trim();
        if (!groupName) {
            alert("Please enter a group of people or select a suggestion.");
            return;
        }
        originalGroupName = groupName;
        window.originalGroupName = groupName;
        transitionToStep2();

        if (searchSelectedBtn) searchSelectedBtn.classList.add('pf-btn-disabled');
        startCommunityLoader(choicesContainer);

        try {
            const initialSuggestions = await findSubredditsForGroup(groupName);
            const rankedSubreddits = await fetchAndRankSubreddits(initialSuggestions);
            displaySubredditChoices(rankedSubreddits);
        } catch (error) {
            console.error("Failed subreddit validation:", error);
            displaySubredditChoices([]);
        } finally {
            stopCommunityLoader();
            const hasChoices = !!document.querySelector('#subreddit-choices input[type="checkbox"]');
            if (searchSelectedBtn) searchSelectedBtn.classList.toggle('pf-btn-disabled', !hasChoices);
        }
    });

    searchSelectedBtn.addEventListener("click", (event) => {
        event.preventDefault();
        runProblemFinder();
    });

    initializeDashboardInteractivity();
    setupGrowthKitInteraction();
    console.log("Problem Finder tool successfully initialized.");
}

function waitForElementAndInit() {
    const keyElementId = 'find-communities-btn';
    let retries = 0;
    const maxRetries = 50;
    const intervalId = setInterval(() => {
        const keyElement = document.getElementById(keyElementId);
        if (keyElement) {
            clearInterval(intervalId);
            if (!window._countHeaderBlueprint) {
                const ch = document.getElementById('count-header');
                if (ch && ch.innerHTML.trim()) window._countHeaderBlueprint = ch.innerHTML;
            }
            initializeProblemFinderTool();
        } else {
            retries++;
            if (retries > maxRetries) {
                clearInterval(intervalId);
                console.error(`Initialization FAILED. Element "#${keyElementId}" not found.`);
            }
        }
    }, 100);
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('#export-findings-btn, .export-findings-btn');
    if (!btn) return;
    e.preventDefault();
    exportFindingsToSpreadsheet();
});

document.addEventListener('DOMContentLoaded', waitForElementAndInit);

document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('bubble-content');
    if (!panel) return;
    ['.bubble-loader', '.bubble-empty', '.bubble-prompt', '.bubble-detail'].forEach(sel => {
        const el = panel.querySelector(sel);
        if (el) el.style.display = 'none';
    });
});
