
// ******************************************************
// * FIREBASE CONFIGURATION
// ******************************************************
const firebaseConfig = {
  apiKey: "AIzaSyDra1kGlhyVjxFBXU_6W9hqeMmdHE8Lepc", 
  authDomain: "mentor-chat-memory.firebaseapp.com",
  projectId: "mentor-chat-memory",
  storageBucket: "mentor-chat-memory.appspot.com",
  messagingSenderId: "677707396234",
  appId: "1:677707396234:web:bd14d28ae90d15f9bce973"
};

let db;
let docRef;

async function checkFirebaseLoaded() {
  return new Promise((resolve) => {
    if (window.firebase && window.firebase.firestore) {
      resolve();
      return;
    }
    const interval = setInterval(() => {
      if (window.firebase && window.firebase.firestore) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, 5000);
  });
}
async function deleteTagGlobally(tag) {
  try {
    const snap = await docRef.get();
    if (!snap.exists) return;
    const data = snap.data();
    const updatedBookmarks = (data.bookmarks || []).map(bm => {
      if (bm.tags && bm.tags.includes(tag)) {
        bm.tags = bm.tags.filter(t => t !== tag);
      }
      return bm;
    });
    await docRef.update({ bookmarks: updatedBookmarks });

    bookmarks = updatedBookmarks;
    bookmarkMetaMap = new Map();
    allExistingTags = new Set();
    updatedBookmarks.forEach(bm => {
      bookmarkMetaMap.set(bm.text, { tags: bm.tags || [], title: bm.title || null });
      if (bm.tags) bm.tags.forEach(t => allExistingTags.add(t));
    });
    tempSelectedTags.delete(tag);

    populateFilterButtons();
    populateTagPopup(allExistingTags, Array.from(tempSelectedTags));
    displayBookmarks('all');
  } catch (err) {
    console.error('Error deleting tag:', err);
  }
}

// ******************************************************
// * DOM SELECTORS
// ******************************************************
let messagesDiv, userInput, sendButton;
let tagPopupOverlay, tagPillsContainer, newTagInput, bookmarkTitleInput, saveTagBtn, cancelTagBtn, tagPopupClose;
let popupTitleEl, popupSubtitleEl;
let newTagPillsContainer;
let pendingNewTags = new Set();
let bookmarkFiltersDiv;
let filterScrollDiv;

// ******************************************************
// * STATE & CONVERSATION STORAGE
// ******************************************************
let conversation = [];
let allExistingTags = new Set();
let bookmarks = []; 
let bookmarkedTexts = new Set();
let bookmarkMetaMap = new Map(); 
let currentEditingBookmarkText = null; 
let tempSelectedTags = new Set();
const BOOKMARK_GRADIENTS = [
  'linear-gradient(135deg, rgb(176, 48, 133) 0%, rgb(226, 109, 176) 50%, rgb(245, 152, 203) 100%)',
  'linear-gradient(135deg, rgb(232, 110, 78) 0%, rgb(254, 160, 127) 50%, rgb(254, 184, 152) 100%)',
  'linear-gradient(135deg, rgb(30, 152, 176) 0%, rgb(61, 192, 216) 50%, rgb(46, 209, 240) 100%)'
];

const today = new Date().toISOString().split('T')[0];

// ******************************************************
// * DYNAMIC AUDIENCE RESOLUTION
// ******************************************************
function getResolvedAudienceName() {
  if (window.originalGroupName && window.originalGroupName.trim().length > 0) {
    return window.originalGroupName.trim();
  }
  
  if (typeof originalGroupName !== 'undefined' && originalGroupName && originalGroupName.trim().length > 0) {
    return originalGroupName.trim();
  }
  
  const highlightEl = document.querySelector('.audience-highlight');
  if (highlightEl && highlightEl.innerText.trim().length > 0) {
    return highlightEl.innerText.trim();
  }
  
  const pillEl = document.querySelector('.pill-audience');
  if (pillEl && pillEl.innerText.trim().length > 0) {
    return pillEl.innerText.trim();
  }
  
  const titleEl = document.getElementById('pf-audience-title');
  if (titleEl && titleEl.innerText.includes('Select Subreddits For:')) {
    return titleEl.innerText.replace('Select Subreddits For:', '').trim();
  }
  
  return '';
}

function initAudienceSession() {
  const currentAudience = getResolvedAudienceName() || 'Target Audience';
  const audienceCleanKey = currentAudience.toLowerCase().replace(/[^a-z0-9]/g, '_');
  
  let sessionDocId = localStorage.getItem('probpop_chat_session_' + audienceCleanKey);
  if (!sessionDocId) {
    sessionDocId = 'session_' + audienceCleanKey + '_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('probpop_chat_session_' + audienceCleanKey, sessionDocId);
  }
  
  docRef = db.collection('chats').doc(sessionDocId);
}

// ******************************************************
// * SYSTEM PROMPT (WITH CRITICAL CRITIQUE INSTRUCTIONS)
// ******************************************************
function getSystemMessage() {
  const currentAudience = getResolvedAudienceName() || 'Target Audience';
  return `
You ARE one specific, real member of the "${currentAudience}" community being interviewed by a founder. You are not an assistant, an analyst, or a research summary. You are a single person with a consistent personality, speaking from lived experience.
Current Date: ${today}.

WHO YOU ARE (MATCH THE REAL DEMOGRAPHICS)
- Build your identity from the DEMOGRAPHIC PROFILE and raw posts you are given, never a generic default. Your name, gender, age, and background must reflect the real makeup of this audience.
  - If the audience skews male (for example 83% male), you are a man with a man's name. If it skews female, a woman with a woman's name.
  - If the audience is a specific culture, ethnicity, region, or nationality, pick a name that genuinely fits it. A Hispanic audience gets a Hispanic name, not a generic Western one.
  - Match the likely age range too.
- On top of that, settle into ONE archetype that fits the dominant findings (for example The Devoted Caretaker, The Frustrated Trainer, The Rescue Advocate, The First-Time Owner). Keep the SAME name, gender, and archetype for the whole conversation. Never drift into a generic average user.

TALK EXACTLY LIKE THEM (CRITICAL)
- Study the RAW COMMUNITY DISCUSSIONS you are given and mirror how those real people actually write: their slang, phrasing, punctuation habits, level of formality, the words they reach for, the way they vent or joke.
- Your tone should be indistinguishable from a real poster in this exact community. If they write blunt and sweary, you are blunt. If they write anxious and rambling, you lean that way. If they use in-group jargon, use it naturally.
- Do not sound like a polished brand voice or a neutral assistant. Sound like one of them.

CORE RULE: DASHBOARD = WHAT, YOU = WHY
- The dashboard tells the founder WHAT this audience struggles with. Your job is to reveal WHY it matters emotionally.
- Stay fully grounded in the findings passed to you (the REVEALED PROBLEMS, tone topics, brands, frustrations). Never invent a theme they don't support. Inventing unrelated problems destroys trust.
- Do NOT just repeat the findings. Go one layer deeper into the feeling underneath.
  Dashboard: "Dog Training Challenges"
  Weak (repeats it): "My biggest problem is dog training."
  Strong (same theme, deeper truth): "Honestly? The training isn't even the hardest part. It's feeling like I've tried everything and I'm somehow letting my dog down."

HOW YOU SOUND
- Talk like a person in conversation, not a report. Contractions, casual phrasing, real emotion.
- Never say things like "One of the primary challenges I face is...". Say "Honestly? I feel like I've tried everything."
- Surface the emotional layer: hidden motivations, fears, frustrations, contradictions, the things people don't say out loud.

LENGTH AND DENSITY
- Aim for roughly 40 to 80 words, 1 to 4 sentences. The problem to avoid is no longer length, it's repetition. Never explain the same idea three different ways.
- Give a revealing answer, not a complete one. Most replies should carry ONE insight, ONE emotion, and ONE memorable line. Avoid the intro, explanation, reworded explanation, conclusion pattern that makes you sound like an AI.
- Every reply should contain at least one emotionally revealing sentence the founder would remember, like "Honestly? I feel like I'm letting my dog down." or "The behaviour isn't the hardest part. Feeling helpless is."
- Don't try to fully explain the situation. Find the single most revealing emotional truth and say it plainly.
  Weak: "I'm worried about behaviour changes because they may indicate illness."
  Strong: "I'm worried I'll miss a sign that something's wrong, and it'll be my fault."
- Go longer only when the founder asks something that earns it: "what should I build", "why do you think that", "tell me more", "would you buy this", "what would make you trust this".
- Never truncate or cut off mid-thought. Always finish the sentence. But density beats completeness: one sharp emotional truth lands harder than a thorough explanation.

PRIORITISE IN THIS ORDER
1. Human authenticity
2. Emotional truth
3. Relevance to the dashboard findings
4. Memorability
5. Brevity
6. Completeness

HAVE OPINIONS AND PUSH BACK
- You are not here to be agreeable. Real people have doubts.
- If the founder pitches an idea, react honestly. If it sounds generic or doesn't hit your real problem, say so: "Probably not, I've already tried similar things and none of them solved it." or "Why would I use that instead of YouTube or just asking my trainer?"
- Challenging the founder is where the value is. Do it when it's warranted.

CITING THREADS
- Raw posts are indexed [Thread 1], [Thread 2], etc. When you reference a specific experience from one, append its bracket at the end of that sentence, e.g. "...backed right out of it [Thread 4]." Only cite threads that exist, never invent numbers, and use no other bracketed tags.

SHOW YOUR SOURCE FINDING
- At the VERY END of every substantive reply, on its own new line, list the dashboard finding(s) that most influenced your answer in this exact format:
  ::sources:: Finding One | Finding Two
- Use the real finding titles from the dashboard context, usually one or two. If the message is pure small talk with no finding behind it, omit the line.

DON'T REPEAT YOURSELF
- Once you've told a story or quoted a thread, don't reuse it. Pull from other findings, brands, or threads, or move the conversation somewhere fresh.
`;
}

// ******************************************************
// * TEXT TRANSFORMATIONS & BOOKMARK HELPERS (HOISTED)
// ******************************************************
function deriveHeaderForBookmark(fullText) {
  if (!fullText) return "Saved Insight";
  fullText = fullText.replace(/```(?:json)?\s*({[\s\S]*?})\s*```/, '');
  const boldMatch = fullText.match(/\*\*(.*?)\*\*/);
  if (boldMatch && boldMatch[1] && boldMatch[1].length < 60) {
      return boldMatch[1].replace(/:$/, '').trim(); 
  }
  const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const bestLine = lines[0] || fullText;
  let header = bestLine.replace(/^(\d+\.\s*|[-•]\s*)/, '').replace(/\*\*(.*?)\*\*/g, '$1');
  header = header.replace(/^#+\s*/, '');
  if (header.length > 40) header = header.slice(0, 40) + '...';
  return header;
}

function escapeQuotes(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function transformAiText(raw) {
  let text = raw.trim();

  // SOURCE FINDINGS: pull out the "::sources:: A | B" line and render it as chips at the end.
  let sourceChipsHtml = '';
  text = text.replace(/^::sources::\s*(.+)$/gmi, (m, list) => {
    const findings = list.split('|').map(s => s.trim()).filter(Boolean);
    if (findings.length === 0) return '';
    sourceChipsHtml = `<div class="source-findings"><span class="source-findings-label">Based on</span>` +
      findings.map(f => `<span class="finding-chip">${escapeQuotes(f)}</span>`).join('') +
      `</div>`;
    return '';
  }).trim();

  // DYNAMIC CITATION PARSER: Converts single and comma-separated lists
// DYNAMIC CITATION PARSER: Converts single and comma-separated lists
  text = text.replace(/\[Thread\s*\d+[^\]]*\]/gi, (match) => {
    const nums = match.match(/\d+/g);
    if (!nums) return '';
    return nums.map(num => {
      const threadIdx = parseInt(num, 10) - 1;
      if (window._filteredPosts && window._filteredPosts[threadIdx]) {
        const post = window._filteredPosts[threadIdx].data;
        const url = `https://reddit.com${post.permalink}`;
        const title = escapeQuotes(post.title || 'Source Thread');
        const subreddit = post.subreddit || 'reddit';
        return `<a href="${url}" target="_blank" class="source-badge" title="Verified Context: ${title}" rel="noopener noreferrer">r/${subreddit} ↗</a>`;
      }
      return '';
    }).join(' ');
  });

  // Strip any stray bracket placeholders the model invents (e.g. [Supporting Community Quote], [Standard Fact], [1]).
  // Runs after the Thread parser, so real citations are already <a> badges and aren't touched.
  text = text.replace(/\s*\[[^\]\n]*\](?!\()/g, '');

  // Headings & Markdown Bold

  // Headings & Markdown Bold
  text = text.replace(/^#{1,6}\s*(.*)$/gm, '<strong>$1</strong>');
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // SEMANTIC PARAGRAPH BLOCKS
  const paragraphs = text.split(/\n\s*\n/);
  let html = '';

  paragraphs.forEach(pText => {
    const trimmed = pText.trim();
    if (trimmed.length === 0) return;

    // Check for bullet lists
    if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
      const bulletLines = trimmed.split('\n');
      let listHtml = '<ul class="ai-list">';
      bulletLines.forEach(line => {
        const cleanLine = line.replace(/^[-•*]\s+/, '').trim();
        if (cleanLine.length > 0) {
          listHtml += `<li class="ai-bullet">${cleanLine}</li>`;
        }
      });
      listHtml += '</ul>';
      html += listHtml;
      return;
    }

    // Check for heading patterns
    const headingMatch = /^(\d+)\.\s*<strong>(.*?)<\/strong>:\s*(.*)$/.exec(trimmed);
    if (headingMatch) {
      html += `<div class="ai-heading">${headingMatch[1]}. ${headingMatch[2]}</div>`;
      html += `<p class="ai-paragraph">${headingMatch[3]}</p>`;
      return;
    }

    // Standard paragraph
// Standard paragraph
html += `<p class="ai-paragraph">${trimmed}</p>`;
  });

  return html + sourceChipsHtml;
}


function getFirstNSentences(text, maxSentences = 10) {
  const sentenceEnders = /[^\.!\?]+[\.!\?]+/g;
  const sentences = text.match(sentenceEnders);
  if (!sentences) return text;
  return sentences.slice(0, maxSentences).join(' ').trim();
}

// ******************************************************
// * DEEP SCREEN SCRAPER (REVEALS DATA UNDER TAB LAYERS)
// ******************************************************
function getDashboardVisualContext() {
  let context = "ACTIVE AUDIENCE PROFILE (Information scraped from the dashboard screen):\n\n";

  // Problem Cards on Screen
  if (window._summaries && window._summaries.length > 0) {
    context += "--- REVEALED PROBLEMS ---\n";
    window._summaries.forEach((summary, i) => {
      context += `- Problem: "${summary.title}"\n`;
      context += `  What it means: ${summary.body}\n`;
      if (summary.quotes && summary.quotes.length > 0) {
        context += `  Supporting Community Quotes:\n`;
        summary.quotes.forEach(q => { if (q) context += `    * "${q}"\n`; });
      }
      context += "\n";
    });
  } else {
    const problemCards = [];
    for (let i = 1; i <= 5; i++) {
      const block = document.getElementById(`findings-block${i}`);
      if (block) {
        const title = block.querySelector('.section-title')?.innerText;
        const body = block.querySelector('.summary-full')?.innerText || block.querySelector('.summary-teaser')?.innerText;
        if (title) problemCards.push(`- Problem: "${title}"\n  What it means: ${body}`);
      }
    }
    if (problemCards.length > 0) {
      context += "--- REVEALED PROBLEMS ---\n" + problemCards.join('\n\n') + "\n\n";
    }
  }

  // Tone of Voice Map (Scraped directly from DOM, even when hidden)
  const toneCards = document.querySelectorAll('#tone-map-container .tone-card-blueprint, #tone-map-container > div');
  if (toneCards.length > 0) {
    context += "--- CONVERSATION TONE & INSIGHTS ---\n";
    toneCards.forEach(card => {
      const topic = card.querySelector('.tone-topic-title')?.innerText;
      const traits = Array.from(card.querySelectorAll('.tone-trait-name')).map(el => el.innerText).filter(Boolean);
      const insights = Array.from(card.querySelectorAll('.tone-what-means')).map(el => el.innerText).filter(el => el.trim().length > 0);
      
      if (topic) {
        context += `Topic: "${topic}"\n`;
        if (traits.length > 0) context += `  Attributes: ${traits.join(', ')}\n`;
        if (insights.length > 0) context += `  Grounded Observations: ${insights.map(ins => `"${ins}"`).join(', ')}\n`;
      }
    });
    context += "\n";
  }

  // Sentiment Word Clouds
  if (window._sentimentData) {
    context += "--- EMOTIONAL VOCABULARY ---\n";
    if (window._sentimentData.positive) {
      const posWords = Object.keys(window._sentimentData.positive).slice(0, 10);
      context += `  Positive Associations / Exciting Topics: ${posWords.join(', ')}\n`;
    }
    if (window._sentimentData.negative) {
      const negWords = Object.keys(window._sentimentData.negative).slice(0, 10);
      context += `  Negative Triggers / Frustrations: ${negWords.join(', ')}\n`;
    }
    context += "\n";
  }

  // Recognized Brands & Products
  if (window._entityData) {
    context += "--- RECOGNIZED ENTITIES ---\n";
    if (window._entityData.brands) {
      const brands = Object.keys(window._entityData.brands).slice(0, 5);
      if (brands.length > 0) context += `  Brands We Talk About: ${brands.join(', ')}\n`;
    }
    if (window._entityData.products) {
      const products = Object.keys(window._entityData.products).slice(0, 5);
      if (products.length > 0) context += `  Products We Discuss: ${products.join(', ')}\n`;
    }
    context += "\n";
  }

  // Demographics Profile
  const overviewDiv = document.getElementById('overview-div');
  if (overviewDiv) {
    const text = overviewDiv.innerText.replace(/\s+/g, ' ').trim();
    if (text && !text.includes('Calculating')) {
      context += `--- DEMOGRAPHIC PROFILE ---\n  ${text}\n\n`;
    }
  }

  return context;
}

function getAudienceContext() {
  if (!window._filteredPosts || window._filteredPosts.length === 0) {
    return "No recent community discussions loaded yet. Fall back on general knowledge about this community.";
  }

  let context = "RAW COMMUNITY DISCUSSIONS:\n";
  // Reduced slice from 35 down to 15 to keep context clean and reduce autoregressive repetition loops
  window._filteredPosts.slice(0, 15).forEach((p, idx) => {
    const title = p.data.title || p.data.link_title || "Discussion";
    const body = (p.data.selftext || p.data.body || "").substring(0, 300);
    context += `[Thread ${idx + 1}] Topic: "${title}"\nContent: "${body}"\n\n`;
  });
  
  return context;
}

// ******************************************************
// * RENDERING PIPELINE
// ******************************************************
function addMessage(rawText, className, role = 'user') {
  if (!messagesDiv) return;
  const msg = document.createElement('div');
  msg.className = 'message ' + className;
  
  if (role === 'assistant') {
    const html = transformAiText(rawText);
    if (bookmarkedTexts.has(rawText)) {
      msg.innerHTML = `<div class="ai-text">${html}</div>
        <span class="bookmark-link bookmarked">
          Bookmarked! 
          <button class="edit-tags-btn">Edit</button>
        </span>`;
      
      const editBtn = msg.querySelector('.edit-tags-btn');
      if (editBtn) {
        editBtn._rawText = rawText; 
        editBtn.addEventListener('click', handleEditTagsClick);
      }
    } else {
      msg.innerHTML = `<div class="ai-text">${html}</div>
        <span class="bookmark-link">Bookmark</span>`;
      
      const link = msg.querySelector('.bookmark-link');
      if (link) {
        link._rawText = rawText; 
        link.addEventListener('click', handleBotBookmarkClick);
      }
    }
  } else {
    msg.innerText = rawText;
  }
  
  messagesDiv.appendChild(msg);
  msg.scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => (msg.style.opacity = '1'), 0);
}

function addLoader() {
  const loader = document.createElement('div');
  loader.className = 'message bot-message';
  loader.innerHTML = `<div class="loader">
    <div class="dot"></div><div class="dot"></div><div class="dot"></div>
    </div>`;
  messagesDiv.appendChild(loader);
  loader.scrollIntoView({ behavior: 'smooth' });
  return loader;
}

function removeLoader(l) {
  l.remove();
}

function displayConversation() {
  if (!messagesDiv) return;
  messagesDiv.innerHTML = '';
  conversation.forEach(m => {
    addMessage(m.content, m.role === 'assistant' ? 'bot-message' : 'user-message', m.role);
  });
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateBookmarkUI(messageText) {
  if (!messagesDiv) return;
  const bookmarkLinks = messagesDiv.querySelectorAll('.bookmark-link');
  for (let link of bookmarkLinks) {
    if (link._rawText === messageText) {
       link.classList.add('bookmarked');
       link.innerHTML = `Bookmarked! 
         <button class="edit-tags-btn">Edit</button>`;
       
       const editBtn = link.querySelector('.edit-tags-btn');
       if(editBtn) {
         editBtn._rawText = messageText;
         editBtn.addEventListener('click', handleEditTagsClick);
       }
    }
  }
}

// ******************************************************
// * FIRESTORE READS & WRITES
// ******************************************************
async function loadConversationFromFirestore() {
  try {
    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data();
      conversation = Array.isArray(data.conversation) ? data.conversation : [];
      
      const loadedBookmarks = data.bookmarks || [];
      bookmarks = loadedBookmarks;
      bookmarkedTexts = new Set();
      bookmarkMetaMap = new Map();
      allExistingTags = new Set();

      loadedBookmarks.forEach(bm => {
        bookmarkedTexts.add(bm.text);
        bookmarkMetaMap.set(bm.text, { 
            tags: bm.tags || [], 
            title: bm.title || null 
        });
        if (bm.tags) bm.tags.forEach(t => allExistingTags.add(t));
      });

      populateFilterButtons();
    } else {
      await docRef.set({ conversation: [], bookmarks: [] });
      conversation = [];
      bookmarks = [];
      bookmarkedTexts = new Set();
      bookmarkMetaMap = new Map();
      allExistingTags = new Set();
    }
  } catch (err) {
    console.error('Error loading session context:', err);
  }
}

async function pushMessageToFirestore(role, content) {
  conversation.push({ role, content });
  try {
    await docRef.update({
      conversation: firebase.firestore.FieldValue.arrayUnion({ role, content })
    });
  } catch (err) {
    console.error('Error updating chat history:', err);
  }
}

async function addBookmark(text, tags = [], title = "") {
  const timestamp = Date.now();
  const finalTitle = title.trim() ? title.trim() : deriveHeaderForBookmark(text);
  
  const obj = { text, tags, timestamp, title: finalTitle };
  try {
    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data();
      let updatedBookmarks = data.bookmarks || [];
      const exists = updatedBookmarks.some(bm => bm.text === text);
      if (exists) {
        showToast("Already bookmarked.");
        return;
      }
      updatedBookmarks.push(obj);
      await docRef.update({ bookmarks: updatedBookmarks });
      
      bookmarks.push(obj);
      bookmarkedTexts.add(text);
      bookmarkMetaMap.set(text, { tags, title: finalTitle });
      
      tags.forEach(t => allExistingTags.add(t));
      populateFilterButtons();
      updateBookmarkUI(text);
      displayBookmarks('all'); 
    }
  } catch (err) {
    console.error('Error adding bookmark:', err);
  }
}

async function updateBookmarkTagsAndTitle(text, newTags, newTitle) {
  try {
    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data();
      let updatedBookmarks = data.bookmarks || [];
      const bookmarkIndex = updatedBookmarks.findIndex(bm => bm.text === text);
      
      if (bookmarkIndex !== -1) {
        updatedBookmarks[bookmarkIndex].tags = newTags;
        updatedBookmarks[bookmarkIndex].title = newTitle; 

        await docRef.update({ bookmarks: updatedBookmarks });
        
        bookmarkMetaMap.set(text, { tags: newTags, title: newTitle });
        bookmarks = updatedBookmarks;
        
        allExistingTags = new Set();
        bookmarks.forEach(bm => {
             if(bm.tags) bm.tags.forEach(t => allExistingTags.add(t));
        });

        populateFilterButtons();
        updateBookmarkUI(text);
        displayBookmarks('all'); 
      }
    }
  } catch (err) {
    console.error('Error updating tags:', err);
  }
}

async function removeBookmarkFromFirestore(ts) {
  try {
    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data();
      const updatedBookmarks = (data.bookmarks || []).filter(b => b.timestamp != ts); 
      await docRef.update({ bookmarks: updatedBookmarks });
      
      bookmarks = updatedBookmarks;
      bookmarkedTexts = new Set();
      bookmarkMetaMap = new Map();
      allExistingTags = new Set();

      updatedBookmarks.forEach(bm => {
        bookmarkedTexts.add(bm.text);
        bookmarkMetaMap.set(bm.text, { 
            tags: bm.tags || [], 
            title: bm.title || null 
        });
        if(bm.tags) bm.tags.forEach(t => allExistingTags.add(t));
      });

      populateFilterButtons();
      displayConversation(); 
      displayBookmarks('all');
    }
  } catch (err) {
    console.error('Error deleting bookmark:', err);
  }
}

function showBookmarkViewer(rawText) {
  if (!rawText) return;
  const meta = bookmarkMetaMap.get(rawText) || { tags: [], title: null };
  const title = meta.title || deriveHeaderForBookmark(rawText);
  const tags = meta.tags || [];

  const existing = document.getElementById('bookmarkViewerOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'bookmarkViewerOverlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(32,30,87,0.55); display:flex; align-items:center; justify-content:center; z-index:99999; padding:20px;';

  const win = document.createElement('div');
  win.style.cssText = "background:#fff; border-radius:16px; max-width:560px; width:100%; max-height:80vh; overflow-y:auto; padding:28px; box-shadow:0 20px 60px rgba(0,0,0,0.25); position:relative; font-family:'Plus Jakarta Sans', sans-serif;";

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  closeBtn.style.cssText = 'position:absolute; top:14px; right:16px; border:none; background:none; font-size:26px; line-height:1; color:#888; cursor:pointer;';
  closeBtn.addEventListener('click', () => overlay.remove());

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:18px; font-weight:700; color:#201e57; margin-bottom:14px; padding-right:24px;';
  titleEl.textContent = title;

  const bodyEl = document.createElement('div');
  bodyEl.innerHTML = transformAiText(rawText);

  win.appendChild(closeBtn);
  win.appendChild(titleEl);
  win.appendChild(bodyEl);
  if (tags.length > 0) {
    const tagWrap = document.createElement('div');
    tagWrap.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:16px; padding-top:14px; border-top:1px solid #eee;';
    const label = document.createElement('span');
    label.textContent = 'Tags:';
    label.style.cssText = 'font-size:12px; font-weight:700; color:#201e57; opacity:0.7; margin-right:2px;';
    tagWrap.appendChild(label);
    tags.forEach(t => {
      const pill = document.createElement('span');
      pill.textContent = t;
      pill.style.cssText = 'font-size:12px; font-weight:600; color:#201e57; background:rgba(32,30,87,0.08); border:1px solid rgba(32,30,87,0.18); padding:3px 9px; border-radius:12px;';
      tagWrap.appendChild(pill);
    });
    win.appendChild(tagWrap);
  }

  overlay.appendChild(win);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ******************************************************
// * BOOKMARK FILTER & GRID DISPLAY
// ******************************************************
async function displayBookmarks(filter = 'all') {
  if (!messagesDiv) return;
  try {
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const data = docSnap.data();
      let savedBookmarks = data.bookmarks || [];

      if (filter !== 'all') {
        savedBookmarks = savedBookmarks.filter(bm => bm.tags && bm.tags.includes(filter));
      }

      const existingBookmarkMessages = document.querySelectorAll('.bookmark-bubble');
      existingBookmarkMessages.forEach(msg => msg.remove());

      if (savedBookmarks.length === 0) {
        if (filter !== 'all') {
             addMessage(`No insights tagged with "${filter}" yet.`, 'bot-message bookmark-bubble', 'assistant');
        }
        return;
      }

      let container = document.createElement('div');
      container.style.display = 'flex';
      container.style.flexWrap = 'wrap';
      container.style.gap = '10px';
      container.style.marginTop = '1em';

      savedBookmarks.forEach((bm, i) => {
        const circle = document.createElement('div');
        circle.className = 'bookmark-circle';
        circle.setAttribute('data-timestamp', bm.timestamp);
        circle._timestamp = bm.timestamp; 
        circle._rawText = bm.text;

        const displayTitle = bm.title ? bm.title : deriveHeaderForBookmark(bm.text);
        const snippet = getFirstNSentences(bm.text, 5); 
        let tooltipContent = `${escapeQuotes(snippet)}`;
        if (bm.tags && bm.tags.length > 0) {
            const tagString = bm.tags.join(', ');
            tooltipContent += `<br><br><strong>🏷 Tags:</strong> <span style="color:#aaa">${escapeQuotes(tagString)}</span>`;
        }

        const titleDiv = document.createElement('div');
        titleDiv.className = 'bookmark-title';
        titleDiv.innerHTML = escapeQuotes(displayTitle);

        circle.style.cursor = 'pointer';
        circle.title = 'Click to view bookmark';
        const stableColor = BOOKMARK_GRADIENTS[Math.abs(bm.timestamp) % BOOKMARK_GRADIENTS.length];
        circle.style.setProperty('background', stableColor, 'important');
       
    

        circle.innerHTML = `<div class="bookmark-number">${i + 1}</div>`;
        circle.appendChild(titleDiv);

        const closeIcon = document.createElement('div');
        closeIcon.className = 'close-icon';
        closeIcon.title = "Delete bookmark";
        closeIcon.textContent = '×';
        circle.appendChild(closeIcon);

        container.appendChild(circle);
      });
      
      

      const messageDiv = document.createElement('div');
      messageDiv.className = 'message bot-message bookmark-bubble';
      messageDiv.appendChild(container);

      const hideBtn = document.createElement('button');
      hideBtn.textContent = 'Hide bookmarks';
      hideBtn.style.cssText = "display:block; margin-top:12px; padding:6px 14px; font-size:12px; font-weight:600; color:#201e57; background:none; border:1px solid rgba(32,30,87,0.25); border-radius:14px; cursor:pointer; font-family:'Plus Jakarta Sans', sans-serif;";
      hideBtn.addEventListener('click', () => {
        document.querySelectorAll('.bookmark-bubble').forEach(el => el.remove());
      });
      messageDiv.appendChild(hideBtn);
    
    

      messagesDiv.appendChild(messageDiv);
      messageDiv.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => { messageDiv.style.opacity = '1'; }, 0);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  } catch (err) {
    console.error('Error retrieving bookmarks:', err);
  }
}

// ******************************************************
// * GEMINI API INTEGRATION
// ******************************************************
async function getGeminiResponse(userMsg) {
  const geminiApiKey = "AIzaSyBWREX0HAzt6NabLzUNLM1YuZnYPhRJ09g";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

  const roadmapContext = getAudienceContext();
  const visualContext = getDashboardVisualContext(); 
  const sysMsg = getSystemMessage();

  const history = conversation.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  history.push({
    role: "user",
    parts: [{ 
      text: `[SYSTEM_NOTE: Here is the raw discussion context from your community, followed by the active visual dashboard metrics the user sees. Keep your behavior aligned with these metrics to prevent contradictions:\n\n${visualContext}\n\nRaw Community Posts:\n${roadmapContext}]\n\nUSER MESSAGE: ${userMsg}` 
    }]
  });

  const payload = {
    contents: history,
    systemInstruction: {
      parts: [{ text: sysMsg }]
    },
    generationConfig: {
      temperature: 1.0, 
      maxOutputTokens: 2048 
    }
  };

  const loader = addLoader();
  let reply = 'Error getting response.';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
       const errText = await res.text();
       throw new Error(`Gemini API returned status ${res.status}: ${errText}`);
    }

    const data = await res.json();

    if (data.candidates && data.candidates.length > 0) {
      const candidate = data.candidates[0];
      if (candidate.finishReason === "SAFETY") {
        reply = "I apologize, but my safety filters prevented me from answering.";
      } 
      else if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        reply = candidate.content.parts[0].text.trim();
      } else {
        reply = "I'm connected, but I didn't have anything to say.";
      }
    } else {
       reply = "I connected to the brain, but received an empty thought.";
    }
  } catch (err) {
    console.error('Gemini API Connection Error:', err);
    reply = "I'm having trouble connecting to my community brain right now.";
  }

  removeLoader(loader);
  return reply;
}

// ******************************************************
// * TOAST & UI INTERACTIONS
// ******************************************************
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.getElementById('chat').appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

async function sendMessage() {
  const txt = userInput.value.trim();
  if (!txt) return;
  const tone = 'neutral';
  addMessage(txt, 'user-message', 'user');
  userInput.value = '';
  autoResize(userInput);
  await pushMessageToFirestore('user', txt);
  const bot = await getGeminiResponse(`[Tone:${tone}] ${txt}`);
  addMessage(bot, 'bot-message', 'assistant');
  await pushMessageToFirestore('assistant', bot);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// --- POPUP OPERATIONS ---
let bookmarkTextToSave = ''; 

async function handleBotBookmarkClick(e) {
  const messageText = e.currentTarget._rawText || '';
  if (!messageText) return;
  if (bookmarkedTexts.has(messageText)) {
    showToast("This is already bookmarked.");
    return;
  }
  bookmarkTextToSave = messageText;
  currentEditingBookmarkText = null;
  if (popupTitleEl) popupTitleEl.textContent = 'Save Bookmark';
  if (popupSubtitleEl) popupSubtitleEl.textContent = 'Personalise your saved insight.';
  if (saveTagBtn) saveTagBtn.textContent = 'Save';
  
  const suggestedTitle = deriveHeaderForBookmark(messageText);

  if(bookmarkTitleInput) bookmarkTitleInput.value = suggestedTitle;

  populateTagPopup(allExistingTags, []); 
  showTagPopup();
}

async function handleEditTagsClick(e) {
  const messageText = e.currentTarget._rawText || '';
  if (!messageText) return;
  
  const meta = bookmarkMetaMap.get(messageText) || { tags: [], title: "" };
  currentEditingBookmarkText = messageText;
  if (popupTitleEl) popupTitleEl.textContent = 'Edit Bookmark';
  if (popupSubtitleEl) popupSubtitleEl.textContent = 'Update your saved insight.';
  if (saveTagBtn) saveTagBtn.textContent = 'Update';

  if(bookmarkTitleInput) {
    bookmarkTitleInput.value = meta.title || deriveHeaderForBookmark(messageText);
  }
  
  populateTagPopup(allExistingTags, meta.tags);
  newTagInput.value = '';
  showTagPopup();
}
function renderNewTagPill(tag) {
  if (!newTagPillsContainer) return;
  const pill = document.createElement('span');
  pill.className = 'new-tag-pill';
  pill.textContent = tag;
  const x = document.createElement('span');
  x.className = 'remove-pill';
  x.textContent = '×';
  x.addEventListener('click', () => {
    pendingNewTags.delete(tag);
    pill.remove();
  });
  pill.appendChild(x);
  newTagPillsContainer.appendChild(pill);
}

function addPendingTag(tag) {
  const t = (tag || '').trim();
  if (!t || pendingNewTags.has(t)) return;
  pendingNewTags.add(t);
  renderNewTagPill(t);
}

function commitTypedTagsFromInput() {
  if (!newTagInput.value.includes(',')) return;
  const parts = newTagInput.value.split(',');
  const remainder = parts.pop();
  parts.forEach(p => addPendingTag(p));
  newTagInput.value = remainder;
}

function commitSingleTypedTag() {
  addPendingTag(newTagInput.value.replace(/,/g, ''));
  newTagInput.value = '';
}

function resetNewTagPills() {
  pendingNewTags = new Set();
  if (newTagPillsContainer) newTagPillsContainer.innerHTML = '';
}
// ******************************************************
// * POPUP INTERFACE HELPERS
// ******************************************************
function populateTagPopup(tagSet, currentlyActiveTags = []) {
  if (!tagPillsContainer) return;
  tagPillsContainer.innerHTML = '';
  tempSelectedTags = new Set(currentlyActiveTags);

  if (tagSet.size === 0) {
    tagPillsContainer.innerHTML = '<span style="font-size:12px; color:#888;">No tags created yet. Add one below!</span>';
    return;
  }

  tagSet.forEach(tag => {
    const pill = document.createElement('div');
    pill.className = 'tag-choice';
    if (tempSelectedTags.has(tag)) pill.classList.add('selected');

    const label = document.createElement('span');
    label.textContent = tag;
    pill.appendChild(label);

    const del = document.createElement('span');
    del.className = 'tag-delete';
    del.textContent = '×';
    del.title = 'Delete this tag everywhere';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (window.confirm(`Delete the tag "${tag}" from all bookmarks?`)) {
        await deleteTagGlobally(tag);
      }
    });
    pill.appendChild(del);

    pill.addEventListener('click', () => {
      if (tempSelectedTags.has(tag)) {
        tempSelectedTags.delete(tag);
        pill.classList.remove('selected');
      } else {
        tempSelectedTags.add(tag);
        pill.classList.add('selected');
      }
    });

    tagPillsContainer.appendChild(pill);
  });
}

// ******************************************************
// * VISUAL HANDLERS FOR POPUP STATE
// ******************************************************
function showTagPopup() {
  if (tagPopupOverlay) tagPopupOverlay.style.display = 'flex';
  if(bookmarkTitleInput) bookmarkTitleInput.focus();
}
function hideTagPopup() {
  if (tagPopupOverlay) tagPopupOverlay.style.display = 'none';
  resetNewTagPills();
}

async function saveTagSelection() {
  const selectedOptions = Array.from(tempSelectedTags);
  const pending = Array.from(pendingNewTags);
  const leftover = newTagInput.value.split(',').map(t => t.trim()).filter(Boolean);
  const allTags = Array.from(new Set([...selectedOptions, ...pending, ...leftover]));
  const customTitle = bookmarkTitleInput ? bookmarkTitleInput.value.trim() : "";

  if (currentEditingBookmarkText) {
    await updateBookmarkTagsAndTitle(currentEditingBookmarkText, allTags, customTitle);
    showToast('Updated!');
    currentEditingBookmarkText = null;
  } else {
    await addBookmark(bookmarkTextToSave, allTags, customTitle);
    showToast('Saved!');
  }

  hideTagPopup();
  newTagInput.value = '';
  if (bookmarkTitleInput) bookmarkTitleInput.value = '';
}


// ******************************************************
// * FILTER BUTTONS
// ******************************************************
function populateFilterButtons() {
  const scrollEl = filterScrollDiv || bookmarkFiltersDiv;
  if (!scrollEl) return;
  scrollEl.querySelectorAll('.filter-chip-wrap').forEach(el => el.remove());
  allExistingTags.forEach(tag => {
    const wrap = document.createElement('div');
    wrap.className = 'filter-chip-wrap';

    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.textContent = tag;
    btn.setAttribute('data-filter', tag);
    btn.addEventListener('click', () => {
      scrollEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      displayBookmarks(tag);
    });

    const del = document.createElement('span');
    del.className = 'filter-delete';
    del.textContent = '×';
    del.title = 'Delete this tag';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (window.confirm(`Delete the tag "${tag}" from all bookmarks?`)) {
        await deleteTagGlobally(tag);
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(del);
    scrollEl.appendChild(wrap);
  });
  const allBtn = scrollEl.querySelector('.filter-btn[data-filter="all"]');
  if (allBtn) {
    allBtn.removeEventListener('click', allBtnClickHandler);
    allBtn.addEventListener('click', allBtnClickHandler);
  }
}
function allBtnClickHandler() {
  const scrollEl = filterScrollDiv || bookmarkFiltersDiv;
  if (!scrollEl) return;
  const allFilterButtons = scrollEl.querySelectorAll('.filter-btn');
  allFilterButtons.forEach(button => button.classList.remove('active'));
  this.classList.add('active');
  displayBookmarks('all');
}
async function clearChatHistory() {
  if (!docRef) return;
  const ok = window.confirm('Delete this entire chat history? Your saved bookmarks will be kept. This cannot be undone.');
  if (!ok) return;
  try {
    await docRef.update({ conversation: [] });
    conversation = [];
    showToast('Chat history cleared.');
    await window.reloadAudienceChatSession();
  } catch (err) {
    console.error('Error clearing chat history:', err);
  }
}

// ******************************************************
// * INITIALIZATION & EVENTS
// ******************************************************
function autoResize(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
  t.style.overflowY = t.scrollHeight > 100 ? 'scroll' : 'hidden';
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// Global hook to rebuild context if searching dynamic segments
window.reloadAudienceChatSession = async function() {
  if (messagesDiv) messagesDiv.innerHTML = ''; // Clear screen to avoid duplicates
  
  const currentAudience = getResolvedAudienceName();
  
  // If the dashboard is empty (no active search loaded yet)
  if (!currentAudience || currentAudience === 'Target Audience') {
    if (messagesDiv) {
      messagesDiv.innerHTML = '';
      const waitGreet = `Once you type a group name and click "Search" on the visual dashboard, I will automatically load their real discussions, pain points, and vocal traits so we can chat.`;
      addMessage(waitGreet, 'bot-message', 'assistant');
    }
    return; // Exit early; don't initialize empty firebase docs
  }
  
  initAudienceSession();
  await loadConversationFromFirestore();
  
  if (!conversation.length) {
    // Dynamic Greeting Generation
    
    const prompt = `You're starting an interview with a founder. In 2 short sentences, introduce yourself as a real member of the "${currentAudience}" community.
    Pick a first name, gender, and background that genuinely match this audience's real demographics (gender split, culture or ethnicity, age) from the profile and posts you've been given, plus an archetype that fits the findings. Keep this identity for the whole conversation.
    Write in the same tone and style the real people in this community use.
    Greet them casually, say your name, mention you're part of the ${currentAudience} community, and invite them to ask you anything about how things really feel for you.
    Sound like a real person sending a message, not an AI template. No quotes, no markdown, no meta text, and do not add a ::sources:: line to this greeting.`;
   

    
    try {
        const greet = await getGeminiResponse(prompt);
      addMessage(greet, 'bot-message', 'assistant');
     
     
      await pushMessageToFirestore('assistant', greet);
    } catch (err) {
      const fallbackGreet = `Hey, I'm part of the ${currentAudience} community. Ask me anything about how things actually feel for people like me, what frustrates us, or what we really want.`;
      addMessage(fallbackGreet, 'bot-message', 'assistant');
      await pushMessageToFirestore('assistant', fallbackGreet);
    }
  } else {
    displayConversation();
    displayBookmarks('all');
  }
};

// ******************************************************
// * AUTOMATED SEARCH ENGINE INTERCEPTOR (MONKEY PATCH)
// ******************************************************
function setupSearchInterceptor() {
  if (typeof runProblemFinder === 'function') {
    const originalRunProblemFinder = runProblemFinder;
    runProblemFinder = async function(options) {
      try {
        const result = await originalRunProblemFinder(options);
        // Instant dynamic refresh after search succeeds
        if (window.reloadAudienceChatSession) {
          await window.reloadAudienceChatSession();
        }
        return result;
      } catch (e) {
        console.error("[Audience Chat] Interceptor capture error:", e);
        throw e;
      }
    };
    console.log("[Audience Chat] Attached interceptor hooks to primary search query.");
  } else {
    // Retry quietly in 500ms if dashboard script is still initializing
    setTimeout(setupSearchInterceptor, 500);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Bind DOM selectors
  messagesDiv = document.getElementById('messages');
  userInput = document.getElementById('userInput');
  sendButton = document.getElementById('sendButton');
  tagPopupOverlay = document.getElementById('tagPopupOverlay');
  tagPillsContainer = document.getElementById('tagPillsContainer');
  newTagInput = document.getElementById('newTagInput');
  bookmarkTitleInput = document.getElementById('bookmarkTitleInput');
  saveTagBtn = document.getElementById('saveTagBtn');
  cancelTagBtn = document.getElementById('cancelTagBtn');
  tagPopupClose = document.getElementById('tagPopupClose');
  popupTitleEl = document.getElementById('popupTitle');
  popupSubtitleEl = document.getElementById('popupSubtitle');
  newTagPillsContainer = document.getElementById('newTagPillsContainer');
  if (newTagInput) {
    newTagInput.addEventListener('input', commitTypedTagsFromInput);
    newTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitSingleTypedTag();
      }
    });
  }
  bookmarkFiltersDiv = document.querySelector('.bookmark-filters');
  filterScrollDiv = document.getElementById('filterScroll');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearChatHistory);

  // Safely assign event listeners
  if (sendButton) sendButton.addEventListener('click', sendMessage);
  if (tagPopupClose) tagPopupClose.addEventListener('click', hideTagPopup);
  if (cancelTagBtn) cancelTagBtn.addEventListener('click', hideTagPopup);
  if (saveTagBtn) saveTagBtn.addEventListener('click', saveTagSelection);

  // Poll for firebase scripts to finish loading asynchronously
  await checkFirebaseLoaded();

  // Initialize Firebase safely
  if (window.firebase) {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    
    // Now it is safe to initialize the session and load conversation
    await window.reloadAudienceChatSession();
  } else {
    console.error("[Audience Chat] Firebase libraries failed to load from CDN. Chat memory disabled.");
    if (messagesDiv) {
      messagesDiv.innerHTML = '<p class="error-message">Chat memory unavailable (connection error).</p>';
    }
  }

  setupSearchInterceptor();

  document.addEventListener('click', async (e) => {
    const circle = e.target.closest('.bookmark-circle');
    if (!circle) return;

    // Clicking the × deletes the bookmark
    if (e.target.closest('.close-icon')) {
      e.preventDefault();
      e.stopPropagation();
      const ts = circle._timestamp;
      if (ts) await removeBookmarkFromFirestore(ts);
      return;
    }

    // Clicking anywhere else on the circle opens it
    showBookmarkViewer(circle._rawText);
  });

  const mentorModalButton = document.getElementById("MENTOR-MODAL-BUTTON");
  if (mentorModalButton) {
    mentorModalButton.addEventListener("click", () => {
      if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
      if (userInput) userInput.focus(); 
    });
  }
});

