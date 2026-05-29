<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-MTB5XXPVTB"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-MTB5XXPVTB');
</script>

<style>

/* =================================================================== */
/* === GLOBAL STYLES & CSS VARIABLES                             === */
/* =================================================================== */

:root {
  /* --- Fonts --- */
  --font-primary: 'Plus Jakarta Sans', sans-serif;
  --font-secondary: 'Inter', sans-serif;
  --font-serif: 'Georgia', serif;
  --font-monospace: 'Menlo', 'Consolas', monospace;
  --font-default: Arial, sans-serif;

  /* --- Colors --- */
  --color-text-light: #ffffff;
  --color-text-dark: #333;
  --color-text-medium: #555;
  --color-text-subtle: #777;
  --color-text-primary-brand: #0e3ea7;
  --color-text-secondary-brand: #374ca0;
  --color-text-link: #007bff;

  --bg-body: #f9f9f9;
  --bg-light: #ffffff;
  --bg-off-white: #f8f9fa;
  --bg-accent-positive: #00a9da;
  --bg-accent-negative: #d6539d;
  --bg-accent-brand: #05328b;

  --border-color: #e0e4e8;
  --border-color-light: #f1f3f5;
  --border-radius-soft: 8px;
  --border-radius-medium: 12px;
  --border-radius-round: 20px;
  --border-radius-pill: 50px;

  /* --- Spacing --- */
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;
}

body {
  font-family: var(--font-default);
  margin: var(--spacing-xl);
  background-color: var(--bg-body);
}


/* =================================================================== */
/* === UTILITY & SHARED COMPONENT STYLES                         === */
/* =================================================================== */

/* --- Status & Placeholder Text --- */
.loading,
.error,
.no-results-message,
.chart-placeholder-text,
.discovery-list-placeholder,
.faq-placeholder,
.placeholder-text,
.no-posts-found {
  font-family: var(--font-secondary);
  color: var(--color-text-subtle);
  padding: var(--spacing-md);
  text-align: center;
  font-style: italic;
  background-color: var(--bg-off-white);
  border: 1px dashed #ced4da;
  border-radius: var(--border-radius-soft);
}

.error,
.error-message,
.placeholder-text--error {
  color: #dc3545;
  font-weight: bold;
}

.loading {
  color: var(--color-text-light);
  margin-top: 60px;
  letter-spacing: 0.1rem;
  border: none;
  background-color: transparent;
}

.no-results-message {
  color: var(--color-text-light);
  font-weight: normal;
  font-size: 14px;
  letter-spacing: 0.1rem;
  max-width: 350px;
  border: none;
  background-color: transparent;
}

/* --- Section Titles --- */
.finding .section-title,
.related-communities-title {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: var(--spacing-md);
  padding-bottom: 0;
  border-bottom: 0 solid #e0e6ed;
  letter-spacing: 0.1rem;
}
.finding .section-title {
  margin-bottom: var(--spacing-sm);
}
.related-communities-title {
  margin-top: 2.5rem;
}


/* =================================================================== */
/* === MAIN LAYOUT & SECTIONS                                    === */
/* =================================================================== */

#problem-pulse {
  background-color: var(--bg-light);
  padding: var(--spacing-xl);
  border-radius: var(--border-radius-soft);
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  width: 100vw;
}
#problem-pulse h2 {
  margin-bottom: var(--spacing-md);
}
#problem-pulse label {
  font-weight: bold;
}
#pulse-results {
  margin-top: var(--spacing-xl);
}

#filter-header {
  margin-bottom: 10px;
  color: #ffffffa8;
  font-family: var(--font-primary);
  letter-spacing: 0.1rem;
  font-size: 12px;
}

#sort-posts {
  border-radius: 15px;
  padding: 10px;
  margin-bottom: 20px;
}


/* =================================================================== */
/* === COMPONENT: INSIGHTS & POSTS                               === */
/* =================================================================== */

/* --- Main Insight Cards --- */
/* NOTE: Merged from two conflicting definitions to preserve original browser rendering. */
.insight, .summary {
  background-color: #ffffff99 !important;
  padding: 1rem 1.1rem !important;
  border-radius: var(--border-radius-round) !important;
  border: 0 !important; /* Preserving !important from original rule */
  color: var(--color-text-secondary-brand);
  font-size: 16px;
  font-weight: 400;
  box-shadow: 2px 5px 10px 2px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(20px);
  margin-bottom: var(--spacing-md);
  transition: box-shadow 0.2s ease-in-out, transform 0.2s ease-in-out;
}
.insight:hover {
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}
.insight p {
  margin: 0.5rem 0;
}
.insight small {
  color: var(--color-text-medium);
}
.insight a, .insight-title {
  font-size: 1.2rem;
  font-weight: bold;
  color: #201e57 !important;
  text-decoration: none;
  padding: 0;
  display: inline-block;
  transition: transform 0.2s ease, color 0.2s ease;
}
.insight a:hover {
  transform: scale(1.02);
}
.insight-title:hover {
  color: #0056b3;
  text-decoration: underline;
}

.summary-full {
  font-weight: normal;
  display: block;
  margin-top: 2px;
}

/* --- Reddit Sample Posts (in side panel) --- */
.reddit-samples-header {
  font-weight: 500 !important;
  letter-spacing: 0.1rem;
  margin-bottom: 30px !important;
  color: var(--color-text-light) !important;
  font-size: 1.2rem;
  text-align: center;
}
.reddit-samples-posts {
  background-color: #fafafa00;
  padding: 10px 30px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-height: 90vh;
  width: 60vw;
  overflow-y: scroll;
}
.sample-insight {
  border: 1px solid var(--border-color);
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  background: #fafafa;
  border-radius: var(--border-radius-soft);
}
.sample-insight-title {
  font-weight: bold;
  font-size: 1rem;
  color: var(--color-text-link);
  text-decoration: none;
}
.sample-insight-title:hover {
  text-decoration: underline;
}
.sample-insight-content {
  font-size: 0.9rem;
  margin: var(--spacing-sm) 0;
  color: var(--color-text-dark);
  line-height: 1.5;
}
.insight-content { /* Specific to main insight cards */
  font-size: 0.9rem;
  margin: 0.75rem 0;
  color: var(--color-text-dark);
  line-height: 1.6;
}
.sample-insight-meta, .insight-meta {
  font-size: 0.8rem;
  color: var(--color-text-medium);
  display: block;
}


/* =================================================================== */
/* === COMPONENT: SENTIMENT ANALYSIS                             === */
/* =================================================================== */

.sentiment-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background-color: #f7f9fc;
  border-radius: 16px;
  border: 1px solid #e0e6ed;
  padding: var(--spacing-lg);
}
.sentiment-title {
  font-family: var(--font-secondary);
  font-size: 1.1rem;
  font-weight: 700;
  text-align: center;
  margin: 0 0 var(--spacing-lg) 0;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid;
}
.sentiment-title.positive {
  color: #00a5ce;
  border-bottom-color: #A5D6A7;
}
.sentiment-title.negative {
  color: var(--bg-accent-negative);
  border-bottom-color: #EF9A9A;
}
#sentiment-score-bar {
  width: 100%;
  display: flex;
  height: 30px;
  border-radius: 30px;
  overflow: hidden;
  font-weight: 600;
  color: white;
  margin-bottom: 0;
  letter-spacing: 0.1rem;
  border: 0.5px solid var(--color-text-light);
}
.score-segment {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.12px;
}
.score-segment.positive {
  background-color: #00a5cea5;
}
.score-segment.negative {
  background-color: #d6539dad;
}

/* --- Word Cloud --- */
#positive-cloud,
#negative-cloud {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 12px 18px;
  min-height: 250px;
  flex-grow: 1;
}
.cloud-word {
  background: var(--bg-light);
  display: inline-block;
  text-transform: uppercase;
  line-height: 1;
  padding: 4px 12px;
  border-radius: 30px;
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  letter-spacing: 0.5px;
  cursor: pointer;
  margin: 3px;
  box-shadow: 4px 3px 9px 2px rgb(0 0 139 / 28%);
}
.cloud-word:hover {
  transform: scale(1.15) !important;
  z-index: 10;
}






/* =================================================================== */
/* === COMPONENT: FAQ ACCORDION                                  === */
/* =================================================================== */

/* NOTE: Merged from two definitions for accuracy. */
.faq-item {
  border: 1px solid #e0e6ed;
  border-radius: var(--border-radius-pill);
  margin-bottom: var(--spacing-sm);
  overflow: hidden;
  border-bottom: 1px solid #e9ecef; /* This overrides the border shorthand's bottom */
}
.faq-item.active .faq-question::after {
  transform: translateY(-50%) rotate(45deg);
}
.faq-item.active .faq-answer {
  max-height: 20rem; /* A large enough value to show content */
}
.faq-question {
  width: 100%;
  text-align: left;
  background-color: var(--bg-light);
  border: none;
  padding: 1rem 1.5rem;
  font-family: var(--font-secondary);
  font-weight: 600;
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  outline: none;
}
.faq-question::after {
  content: '+';
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.5rem;
  color: #0277BD;
  transition: transform 0.3s ease-in-out;
}
.faq-answer {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  background-color: #f9f9fc;
}
.faq-answer-content { /* Added for inner padding */
  padding: 0 1.5rem 1.25rem 0;
  font-family: var(--font-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--color-text-medium);
}


/* =================================================================== */
/* === COMPONENT: SLIDING CONTEXT PANELS                         === */
/* =================================================================== */

.context-slide-panel {
  position: fixed;
  top: 0;
  width: 90%;
  max-width: 550px;
  height: 100vh;
  background-color: var(--bg-light);
  box-shadow: 0 0 25px rgba(0,0,0,0.35);
  z-index: 1001;
  overflow-y: auto;
  transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  display: flex;
  flex-direction: column;
}
.context-slide-panel.from-left {
  left: 0;
  transform: translateX(-105%);
}
.context-slide-panel.from-right {
  right: 0;
  transform: translateX(105%);
}
.context-slide-panel.visible {
  transform: translateX(0);
}
.context-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0,0,0,0.5);
  z-index: 1000;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.4s ease, visibility 0s 0.4s;
}
.context-overlay.visible {
  opacity: 1;
  visibility: visible;
  transition: opacity 0.4s ease;
  cursor: pointer;
}
.context-slide-panel .context-header, .context-header {
  position: sticky;
  top: 0;
  background-color: var(--bg-light);
  padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid #eee;
  z-index: 5;
}
.context-slide-panel .context-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background-color: #f0f2f5;
  border-bottom: 1px solid #ddd;
}
.context-slide-panel .context-title, .context-title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  padding-right: 2.5rem;
}
.context-slide-panel .context-title {
  font-family: var(--font-secondary);
  font-size: 1.2rem;
  color: #1c1e21;
}
.context-slide-panel .context-close-btn, .context-close-btn {
  position: absolute;
  top: var(--spacing-sm);
  right: var(--spacing-lg);
  background: none;
  border: none;
  font-size: 2.5rem;
  font-weight: 300;
  line-height: 1;
  color: #aaa;
  cursor: pointer;
  padding: 0;
  transition: all 0.2s ease;
}
.context-close-btn:hover {
  color: var(--color-text-dark);
  transform: scale(1.1);
}
.context-slide-panel .context-close-btn {
  position: static;
  font-size: 2.2rem;
  font-weight: bold;
  color: #606770;
  padding: 0 8px;
}
.context-slide-panel .context-snippets-wrapper, .context-snippets-wrapper {
  padding: var(--spacing-lg);
  flex-grow: 1;
}
.context-slide-panel .context-snippets-wrapper {
  padding: 8px 20px 20px;
}
.context-slide-panel .context-snippet, .context-snippet {
  padding: var(--spacing-md);
  border: 1px solid var(--border-color-light);
  border-radius: var(--border-radius-soft);
  margin-bottom: var(--spacing-md);
  background-color: #f9f9f9;
}
.context-slide-panel .context-snippet {
  border-color: #e0e0e0;
  padding: 12px;
  margin-bottom: 12px;
  background: #fafafa;
  border-radius: 6px;
}
.context-slide-panel .context-snippet-text, .context-snippet-text {
  font-family: var(--font-secondary);
  color: var(--color-text-dark);
  line-height: 1.6;
  margin: 0 0 var(--spacing-md) 0;
}
.context-slide-panel .context-snippet-text {
  font-size: 0.95rem;
  margin-bottom: 0.75rem;
}
.context-snippet-text strong {
  background-color: #fff8c5;
  padding: 2px 3px;
  border-radius: 3px;
  font-weight: 700;
}
.context-slide-panel .context-snippet-text strong {
  background-color: #fff4a3;
  padding: 1px 3px;
}
.context-slide-panel .context-snippet-meta, .context-snippet-meta {
  font-family: var(--font-secondary);
  font-size: 0.8rem;
  color: var(--color-text-medium);
  margin-top: var(--spacing-md);
  border-top: 1px solid #eee;
  padding-top: 0.75rem;
}
.context-slide-panel .context-snippet-meta {
  color: #65676b;
  border-top: none;
  padding-top: 0;
  margin-top: 0;
}


/* =================================================================== */
/* === COMPONENT: CHARTS & VISUALIZATIONS (EMOTION MAP)          === */
/* =================================================================== */

#emotion-map-container {
  position: relative;
  width: 100%;
}
#emotion-map {
  width: 70vw;
  margin-bottom: 50px;
  height: 400px;
  padding: 10px;
  border-radius: var(--border-radius-soft);
}
#problem-map-description {
  color: var(--color-text-light);
  letter-spacing: 0.1rem;
}
#emotion-map-wrapper {
  position: relative;
  width: 100%;
}
#chart-zoom-btn {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: none; /* Toggled by JS */
  margin: var(--spacing-md) auto 0;
  padding: 0.5rem 1rem;
  font-family: var(--font-secondary);
  font-weight: 500;
  font-size: 0.85rem;
  color: var(--color-text-light);
  background-color: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: var(--border-radius-round);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}
#chart-zoom-btn:hover {
  background-color: rgba(255, 255, 255, 0.3);
}
.chart-description {
  font-size: 0.9rem;
  color: var(--color-text-medium);
  margin-bottom: var(--spacing-sm);
  text-align: center;
}

/* --- Constellation Map --- */
.constellation-star {
  position: absolute;
  border-radius: 50%;
  transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
  cursor: pointer;
  box-shadow: 0 0 8px 1px rgba(255, 255, 255, 0.3);
  z-index: 999;
}
.constellation-star:hover {
  transform: scale(1.8);
  z-index: 999;
  box-shadow: 0 0 25px 6px rgba(255, 255, 255, 0.7);
}
#constellation-side-panel .panel-content {
  padding: var(--spacing-md);
  overflow-y: auto;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.panel-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: #201e57;
  font-size: 1.1rem;
}
.panel-content .quote {
  font-size: 1.2rem;
  font-style: italic;
  margin-bottom: var(--spacing-lg);
  padding: var(--spacing-md);
  background-color: var(--bg-accent-brand);
  border-radius: 30px;
  word-wrap: break-word;
  max-height: 250px;
  overflow: scroll;
}
.panel-content .problem-theme {
  font-size: 1rem;
  margin-bottom: var(--spacing-lg);
  font-weight: bold;
}
.panel-content .meta-info {
  font-size: 0.9rem;
  color: #636f7f;
  margin-bottom: var(--spacing-lg);
}
.panel-content .full-thread-link {
  display: inline-block;
  padding: 10px 20px;
  background-color: #00ace8;
  color: var(--color-text-light);
  text-decoration: none;
  border-radius: var(--border-radius-pill);
  font-weight: bold;
  font-family: var(--font-primary);
  letter-spacing: 0.05rem;
  transition: background-color 0.2s;
}
.panel-content .full-thread-link:hover {
  background-color: var(--bg-accent-negative);
}


/* =================================================================== */
/* === MISCELLANEOUS COMPONENTS                                  === */
/* =================================================================== */

/* --- Prevalence Bar --- */
.prevalence-container {
  margin-top: 0;
}
.prevalence-header {
  font-size: 0.7rem;
  font-weight: normal;
  margin-bottom: 4px;
}
.prevalence-bar-background {
  background-color: #ffffff4d;
  border-radius: 15px;
  overflow: hidden;
  height: 10px;
  display: flex;
  align-items: center;
}
.prevalence-bar-foreground {
  color: #ffffff00;
  text-align: right;
  padding: 2px 8px;
  font-weight: bold;
  font-size: 0.8rem;
  white-space: nowrap;
  transition: width 0.5s ease-in-out;
}
.prevalence-subtitle {
  font-size: 0.7rem;
  color: #374ca07d;
  margin-top: 4px;
}

/* --- Mention Count --- */
.mention-count {
  font-size: 0.9rem;
  color: #0807658a;
  margin-top: var(--spacing-sm);
  text-align: center;
  margin-bottom: 10px;
  width: 80%;
}

/* --- Purchase Intent Signals --- */
#purchase-intent-container {
  background-color: var(--bg-light);
  border: 1px solid #ddd;
  border-radius: var(--border-radius-soft);
  padding: 16px;
  margin-bottom: 20px;
}
.purchase-intent-item {
  border: 1px solid #e8e8e8;
  background-color: #fafcff;
  border-left: 4px solid #27ae60;
  padding: 12px 16px;
  margin-bottom: 12px;
  border-radius: 4px;
}
.purchase-intent-item .problem-summary {
  font-weight: bold;
  color: var(--color-text-dark);
  margin-bottom: 8px;
  font-size: 1rem;
}
.purchase-intent-item .quote {
  font-family: var(--font-serif);
  font-style: italic;
  color: var(--color-text-medium);
  margin: 0;
  padding-left: 10px;
}

/* --- Power Phrases (Accordion List) --- */



/* --- Header Pills --- */
.header-pill {
  display: inline-block;
  padding: 3px 12px;
  border-radius: var(--border-radius-pill);
  font-weight: 600;
  margin: 0 3px;
  line-height: 1.5;
  font-size: 0.95em;
  vertical-align: middle;
}
.pill-insights {
  background-color: #E0F2FE;
  color: #0C4A6E;
}
.pill-posts {
  background-color: #F3F4F6;
  color: #4B5563;
}
.pill-audience {
  background-color: #E0E7FF;
  color: #3730A3;
}

/* --- Bubble Chart Detail Panel --- */
.bubble-detail-title {
  font-family: var(--font-primary);
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 0.75rem;
  color: var(--color-text-dark);
}
.bubble-detail-quote {
  font-family: var(--font-primary);
  font-size: 1rem;
  line-height: 1.6;
  margin-bottom: var(--spacing-lg);
  font-style: normal;
  color: var(--color-text-medium);
}
.bubble-detail-meta {
  font-family: var(--font-primary);
  font-size: 0.8rem;
  color: var(--color-text-subtle);
  margin-bottom: 0.75rem;
  margin-top: var(--spacing-lg);
}
.bubble-detail-source {
  font-family: var(--font-primary);
  font-size: 0.9rem;
  text-decoration: none;
  background-color: var(--bg-accent-positive);
  color: var(--color-text-light);
  padding: 8px 12px;
  border-radius: var(--border-radius-pill);
  transition: background-color 0.2s ease, transform 0.2s ease;
  display: inline-block;
  width: fit-content;
}
.bubble-detail-source:hover {
  transform: scale(1.2);
}

/* --- AI Prompt --- */
#ai-prompt-container {
  padding: var(--spacing-lg);
  background-color: #f3f4f6;
  border-radius: var(--border-radius-soft);
  margin-top: var(--spacing-xl);
  border: 1px solid #d1d5db;
}
#ai-prompt-container .loading-text,
#mindset-summary-container .loading-text {
  font-family: var(--font-secondary);
  color: var(--color-text-subtle);
  font-style: italic;
}
.ai-prompt-content {
  background-color: var(--bg-light);
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: var(--spacing-md);
  font-family: var(--font-monospace);
  font-size: 0.9rem;
  line-height: 1.7;
  color: #111827;
  white-space: pre-wrap;
  position: relative;
}
.ai-prompt-content strong {
  color: #000;
}


/* --- Keyword Opportunities --- */
#keyword-opportunities-container {
  margin-top: var(--spacing-xl);
}
.keyword-clusters-grid {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  margin-top: var(--spacing-md);
}
.keyword-cluster {
  padding: var(--spacing-lg);
  background-color: var(--bg-off-white);
  border-radius: var(--border-radius-soft);
  border: 1px solid #dee2e6;
}
.keyword-cluster-header {
  display: flex;
  align-items: center;
  margin-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.75rem;
}
.keyword-cluster-icon {
  margin-right: 0.75rem;
  font-size: 1.5rem;
}
.keyword-cluster-title {
  font-family: var(--font-primary);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text-dark);
}
.keyword-cluster-description {
  font-family: var(--font-primary);
  font-size: 0.8rem;
  color: var(--color-text-medium);
  margin-top: 4px;
}
.keyword-list {
  list-style-type: none;
  padding-left: 0;
  margin: 0;
}
.keyword-list li {
  font-family: var(--font-primary);
  font-size: 0.95rem;
  padding: var(--spacing-sm);
  border-radius: 4px;
  margin-bottom: var(--spacing-sm);
  background-color: var(--bg-light);
  border: 1px solid var(--border-color);
}

/* =================================================================== */
/* === SUBREDDIT SELECTION & CARDS                               === */
/* =================================================================== */

/* --- Included Subreddits List (Simple Tags) --- */
.subreddit-tag-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: stretch;
  gap: var(--spacing-md);
}
.subreddit-tag {
  font-family: var(--font-secondary);
  font-size: 0.85rem;
  background-color: #e0e6ed;
  padding: 0.25rem 0.75rem;
  border-radius: 16px;
  color: var(--color-text-medium);
}

/* --- Detailed Subreddit Cards --- */
.subreddit-tag-detailed {
  background: #ffffff33;
  border: 0.5px solid var(--color-text-light);
  border-radius: 30px;
  padding: 20px;
  margin: 8px;
  width: 280px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  backdrop-filter: blur(20px);
}
.tag-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.tag-name {
  font-weight: bold;
  font-size: 1rem;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.05rem;
}
.tag-activity {
  font-size: 0.8rem;
  background: #e9ecef;
  color: #495057;
  padding: 3px 8px;
  border-radius: var(--border-radius-medium);
  flex-shrink: 0;
  margin-left: 8px;
}
.tag-description {
  font-size: 0.85rem;
  color: #495057;
  margin: 0 0 10px 0;
  line-height: 1.4;
  flex-grow: 1;
  word-wrap: break-word;
}
.tag-footer {
  font-size: 0.8rem;
  color: #6c757d;
  text-align: right;
  border-top: 1px solid var(--border-color-light);
  padding-top: 8px;
}
.tag-footer-action {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

/* --- Subreddit Selection Checkboxes --- */
.subreddit-choice {
  display: flex;
  margin-bottom: var(--spacing-sm);
}
.subreddit-choice input[type="checkbox"] {
  display: none;
}
.subreddit-choice label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-soft);
  background-color: var(--bg-light);
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.subreddit-choice label:hover {
  border-color: #adb5bd;
}
.subreddit-choice input[type="checkbox"]:checked + label {
  border-color: var(--color-text-link);
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.2);
}
.sub-name {
  font-weight: 600;
  color: #343a40;
}
.sub-pills {
  display: flex;
  gap: var(--spacing-sm);
}
.pill {
  padding: 0.2rem 0.6rem;
  border-radius: var(--border-radius-medium);
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
}
.members-pill {
  background-color: var(--border-color-light);
  color: #495057;
}
.activity-pill[data-activity="Hot"] {
  background-color: #f0fff4;
  color: #2f855a;
}
.activity-pill[data-activity="Warm"] {
  background-color: #fffbeb;
  color: #b45309;
}
.activity-pill[data-activity="Cool"] {
  background-color: #f9fafb;
  color: #4b5563;
}

/* --- Buttons for Subreddits --- */
.remove-sub-btn,
.add-related-sub-btn,
.view-sub-btn,
.load-more-button {
  flex-grow: 1;
  padding: 8px 12px;
  border-radius: var(--border-radius-pill);
  border: 1px solid var(--color-text-light);
  background-color: var(--bg-accent-positive);
  color: var(--color-text-light);
  font-weight: 500;
  font-family: var(--pf-font-family); /* Assumes --pf-font-family is defined elsewhere */
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-decoration: none;
  text-align: center;
}
.remove-sub-btn:hover {
  background-color: #f5c6cb;
  border-color: #c82333;
}
.add-related-sub-btn:hover {
  background-color: #0056b3;
  border-color: #0056b3;
}
.view-sub-btn {
  background-color: #ffffff8c;
  color: #00ace8;
  border-color: #05ace9;
}
.view-sub-btn:hover {
  background-color: #e2e6ea;
  border-color: #5a6268;
}
.load-more-button {
  display: block;
  margin: var(--spacing-md) auto;
  flex-grow: 0; /* Override */
}
.load-more-button:hover {
  transform: translateY(-2px);
  background-color: #e9ecef;
}

/* ======================================================= */
/* == NEW STYLES FOR BRANDSCAPE & POWER PHRASES   == */
/* ======================================================= */

/* --- Side Panel Styling --- */
.custom-side-panel {
  position: fixed;
  top: 0;
  height: 100vh;
  width: 500px;
  max-width: 90%;
  background-color: #ffffff;
  box-shadow: 0 0 25px rgba(0,0,0,0.15);
  z-index: 1001;
  transform: translateX(100%);
  transition: transform 0.4s cubic-bezier(0.23, 1, 0.32, 1);
  overflow-y: auto;
}
.custom-side-panel.left { left: 0; transform: translateX(-100%); }
.custom-side-panel.right { right: 0; transform: translateX(100%); }
.custom-side-panel.visible { transform: translateX(0); }
.context-overlay.visible { opacity: 1; pointer-events: auto; }

/* --- Competitive Brief Card Styling --- */
.brief-content { padding: 2rem; }
.brief-header { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 1.5rem; font-weight: 700; color: #333; margin-bottom: 1.5rem; }
.brief-section { margin-bottom: 2rem; }
.brief-section-title { display: flex; align-items: center; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 1.1rem; font-weight: 700; color: #333; margin-bottom: 1rem; border-bottom: 1px solid #e0e4e8; padding-bottom: 0.5rem; }
.brief-section-icon { margin-right: 0.75rem; font-size: 1.5rem; }
.brief-text, .brief-list { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 1rem; line-height: 1.7; color: #444; }
.brief-list { list-style-type: none; padding-left: 0; margin: 0; }
.brief-list li { position: relative; padding-left: 25px; margin-bottom: 0.75rem; }
.brief-list li::before { position: absolute; left: 0; top: 4px; font-size: 1.1rem; }
.brief-list.loves li::before { content: '🟢'; }
.brief-list.hates li::before { content: '🔴'; }
.brief-list.stakes li::before { content: '🔵'; }
#brand-momentum-chart { width: 100%; height: 250px; margin-bottom: 0.5rem; }
.brief-ai-insight { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 0.9rem; color: #555; text-align: center; font-style: italic; }





#brand-momentum-chart {
  width: 100%;
  height: 250px; /* Adjust height as needed */
  margin-bottom: 0.5rem;
}

/* Styling for the new elements in the side panel */
.brief-header-subtext {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 1rem;
  color: #555;
  margin-top: -1.25rem;
  margin-bottom: 1.5rem;
}

.brief-verdict {
  margin-top: 2rem;
  padding: 1rem;
  background-color: #f3f4f6;
  border-radius: 6px;
  border-left: 4px solid #00a5ce;
}
.brief-verdict strong {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 1.1rem;
  color: #333;
}
.brief-verdict p {
  font-family: 'Plus Jakarta Sans', sans-serif;
  margin: 0.5rem 0 0 0;
  color: #444;
  line-height: 1.6;
}
/* --- Add this CSS for the Keyword View Switcher --- */

.keyword-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.view-switcher {
    display: flex;
    border-radius: 6px;
    background-color: #f0f2f5;
    padding: 4px;
}

.view-btn {
    padding: 6px 12px;
    border: none;
    background-color: transparent;
    color: #555;
    font-weight: 500;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.2s ease, color 0.2s ease;
}

.view-btn.active {
    background-color: #ffffff;
    color: #007bff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.keyword-view {
    display: none; /* Hide views by default */
}

.keyword-view.active {
    display: block; /* Show the active view */
}

/* Optional: Style for the card grid layout */
#keyword-cards-view.active {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1rem;
}


.card-toggle-button {
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.4);
    color: #4a5568;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0.6rem 1.2rem;
    border-radius: 20px;
    cursor: pointer;
    margin-bottom: 10px;
    transition: all 0.2s ease;
}

.card-toggle-button:hover {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(0, 0, 0, 0.1);
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
    transform: translateY(-2px);
}

/* --- MODIFIED: Grid and Card styles for <details> element --- */
.action-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 1.75rem;
    padding: 1rem;
        max-height: 70vh;
    overflow-y: scroll;
}

/* Card is now a <details> element */
.action-card {
    background: rgba(255, 255, 255, 0.65);
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 36px;
    box-shadow: 2px 3px 7px 4px rgba(31, 38, 135, 0.15);
    transition: all 0.3s ease;
}

.action-card[open] {
    box-shadow: 2px 3px 7px 4px rgba(31, 38, 135, 0.15);
}

.action-card .action-item-list {
    padding: 0 1.75rem 1.75rem 1.75rem;
}

/* The clickable header of the main card */
.action-card-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.75rem;
    cursor: pointer;
    list-style: none; /* Hide default marker */
}
.action-card-summary::-webkit-details-marker { display: none; }

.action-card-title {
    font-size: 1.6rem;
    font-weight: 700;
    color: #1a202c;
    margin: 0 0 0.3rem 0;
}

.action-card-subtitle {
    font-size: 0.95rem;
    color: #4a5568;
    margin: 0;
}

.action-card-arrow {
    font-size: 2em;
    font-weight: 300;
    color: #718096;
    transition: transform 0.3s ease;
}

.action-card[open] > .action-card-summary > .action-card-arrow {
    transform: rotate(90deg);
}

/* --- UNCHANGED: Inner dropdown styles --- */
.action-item-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.action-item-dropdown {
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.4);
    transition: background-color 0.2s ease;
    overflow: hidden;
}

.action-item-dropdown[open] { background: rgba(255, 255, 255, 0.7); }

.action-item-summary {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.9rem 1.1rem;
    font-size: 1rem;
    font-weight: 500;
    color: #2d3748;
    cursor: pointer;
    list-style: none;
}
.action-item-summary::-webkit-details-marker { display: none; }

.action-item-summary::after {
    content: '›';
    font-size: 1.5em;
    font-weight: 300;
    line-height: 1;
    margin-left: auto;
    color: #718096;
    transition: transform 0.2s ease;
}

.action-item-dropdown[open] > .action-item-summary::after { transform: rotate(90deg); }
.action-item-icon { font-size: 1.1rem; opacity: 0.7; }
.action-item-context {
    padding: 1rem 1.25rem 1.25rem 1.25rem;
    border-top: 1px solid rgba(0, 0, 0, 0.08);
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
}
.context-label { margin-right: 20px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 0.3rem; }
.context-value { font-size: 0.95rem; font-weight: 500; padding: 0.4rem 0.8rem; border-radius: 20px; width: fit-content; }
.context-prose { font-size: 0.95rem; color: #4a5568; line-height: 1.6; margin: 0; padding: 0.75rem; border-radius: 6px; border-left: 3px solid; }

.context-item.primary .context-label { color: #2563eb; }
.context-item.secondary .context-label { color: #16a34a; }
.context-item.primary .context-value { background-color: #dbeafe; color: #1e40af; }

.context-item.secondary .context-value { background-color: #d1fae5; color: #065f46; }
.context-item.longtail .context-label { color: #d97706; }
.context-item.longtail .context-value { background-color: #fef3c7; color: #92400e; }
.context-item.why .context-label { color: #9333ea; }
.context-item.why .context-prose { background-color: #f5f3ff; border-left-color: #9333ea; }
}

/*
  ======================================================================
  === PASTE THIS CSS INTO YOUR STYLESHEET FOR THE BREADCRUMB FIX =======
  ======================================================================
*/

/* Step 1: Prepare the chart's container.
   This creates a "boundary box" for us to position the breadcrumbs inside of. */
#keyword-sunburst {
  position: relative !important;
  /* Creates 30px of clean, empty space at the top for the breadcrumbs to live in */
  padding-top: 30px !important;
}

/* Step 2: Target the breadcrumbs group, pull it out of the chart's flow,
   and pin it to the top of the container we prepared in Step 1. */
#keyword-sunburst .highcharts-breadcrumbs-group {
  position: absolute !important;
  top: 10px !important;    /* Position it 10px from the top edge */
  left: 10px !important;   /* Position it 10px from the left edge */
  /* Make it span the full width of the container, minus some padding */
  width: calc(100% - 20px) !important;
}

/* Step 3: Force the text inside the breadcrumbs to wrap.
   This prevents it from running off the edge of the screen. */
#keyword-sunburst .highcharts-breadcrumbs-group text {
    white-space: normal !important;
    word-break: break-word !important;
}


  .reddit-samples-posts {
    width: 85svw;
  }

</style>
