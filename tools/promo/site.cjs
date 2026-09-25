// Assemble a public Pages site from the existing website draft and promo kit.
// This command writes local output only. Deploy dist/promo/pages to gh-pages.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..'),BASE=path.join(ROOT,'website'),OUT=path.join(ROOT,'dist/promo/pages');
fs.mkdirSync(OUT,{recursive:true});
for(const name of ['assets','wiki','download.html','community.html','404.html','.nojekyll'])fs.cpSync(path.join(BASE,name),path.join(OUT,name),{recursive:true});
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='.git')continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(html|js|md|json)$/.test(e.name)){let s=fs.readFileSync(f,'utf8').replaceAll('nateecho32-stack.github.io/mefi-studio-site/','nateecho32-stack.github.io/mefi-studio/').replaceAll('nateecho32-stack/mefi-studio-site','nateecho32-stack/mefi-studio');if(e.name==='site.js')s=s.replace('siteBranch: "main"','siteBranch: "gh-pages"');fs.writeFileSync(f,s);}}}
walk(OUT);
fs.mkdirSync(path.join(OUT,'media'),{recursive:true});
for(const legacy of ['01-main-showcase','02-build-by-blocks','03-agent-constellation','01-chaos-to-clarity','02-connected-studio','03-node-ballet','mefi-thought-form'])for(const ext of ['mp4','png']){const file=path.join(OUT,'media',`${legacy}.${ext}`);if(fs.existsSync(file))fs.unlinkSync(file);}
for(const name of ['mefi-work-in-motion'])for(const ext of ['mp4','png'])fs.copyFileSync(path.join(ROOT,'dist/promo',`${name}.${ext}`),path.join(OUT,'media',`${name}.${ext}`));
fs.copyFileSync(path.join(ROOT,'docs/promo-posts.md'),path.join(OUT,'media','social-posts.md'));
const index=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mefi's Studio AI+ — Your idea. A whole studio.</title>
<meta name="description" content="A free, open-source Windows workspace for coding agents. Explore your project, follow the work and review its evidence. Watch the 30-second showcase.">
<meta property="og:title" content="Mefi's Studio AI+ — Your idea. A whole studio."><meta property="og:description" content="Explore the project. Follow the agents. Verify the result."><meta property="og:type" content="website"><meta property="og:image" content="https://nateecho32-stack.github.io/mefi-studio/media/01-chaos-to-clarity.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/favicon.ico"><link rel="stylesheet" href="assets/site.css"><link rel="stylesheet" href="assets/launch.css"></head>
<body class="launch"><a class="skip-link" href="#main">Skip to content</a>
<header class="nav"><div class="container nav-inner"><a class="brand" href="index.html"><span class="wordmark">M+</span>Mefi's Studio AI+</a><nav class="nav-links" aria-label="Site"><a href="#showcase">Watch</a><a href="download.html">Download</a><a href="wiki/">Wiki</a><a href="https://discord.gg/xgfKc5pVxG">Discord</a><a href="https://github.com/nateecho32-stack/mefi-studio">GitHub ↗</a></nav></div></header>
<main id="main">
<section class="launch-hero container"><div class="eyebrow">LOCAL-FIRST · OPEN SOURCE · WINDOWS</div><h1>Your idea.<br>A whole studio.</h1><p class="launch-lede">Talk it through. Hand it over.<br>Watch coding agents work, then check the result.</p><div class="hero-actions"><a class="btn btn-primary" href="download.html">Get the latest release →</a><a class="btn" href="#showcase">Watch the 30-second tour</a></div><p class="release-hint" data-latest-hint>Portable Windows app · <a href="https://github.com/nateecho32-stack/mefi-studio/releases/latest">Latest release on GitHub</a></p><div class="hero-mark" aria-hidden="true"><span>PLAN</span><span>MAP</span><span>BUILD</span><b>M+</b><span>CHECK</span><span>LEARN</span><span>SHIP</span></div></section>
<section id="showcase" class="container showcase"><div class="eyebrow">THE MAIN SHOWCASE</div><h2>The studio, evolved.</h2><p>From chaos to connected work. A circle story, followed by a tour of the actual interface.</p><video controls playsinline preload="metadata" poster="media/01-chaos-to-clarity.png" aria-label="Main showcase, 30 seconds"><source src="media/01-chaos-to-clarity.mp4" type="video/mp4"> <a href="media/01-chaos-to-clarity.mp4">Download the showcase</a>.</video><p class="preview-note">Development preview: the footage includes the Agent Brain update. The download page identifies the latest published build; features in development may arrive in a later release.</p><div class="hero-actions"><a class="btn btn-primary" href="media/01-chaos-to-clarity.mp4" download>Download main video</a><a class="btn" href="wiki/#/whats-new">Everything since 0.3.0</a></div></section>
<section class="container launch-features"><div class="eyebrow">FROM IDEA TO EVIDENCE</div><h2>See where the work goes.</h2><div class="feature-cards">
<article><span>01</span><h3>Explore the project</h3><p>Move from systems to parts to files. Put a task where it belongs.</p></article>
<article><span>02</span><h3>Follow the agents</h3><p>Agent Brain pipelines show the steps, delegated work and reports coming home.</p></article>
<article><span>03</span><h3>Keep useful patterns</h3><p>The Playbook records pipeline recipes for future tasks.</p></article>
<article><span>04</span><h3>Bring your AI</h3><p>Connect your provider, a coding CLI or a local model. OpenRouter joins the options.</p></article>
<article><span>05</span><h3>Stay in your flow</h3><p>Music, radio, links and a floating video player stay close to your work.</p></article>
<article><span>06</span><h3>Review the evidence</h3><p>Keep current activity, task history and recorded checks together.</p></article>
</div></section>
<section class="container alternate"><div class="eyebrow">TWO MORE WAYS TO SHARE IT</div><h2>Pick your cut.</h2><div class="alternate-grid"><article><video controls playsinline preload="none" poster="media/02-connected-studio.png" aria-label="Connected studio, square video"><source src="media/02-connected-studio.mp4" type="video/mp4"></video><h3>Connected studio</h3><p>A readable feature tour. 1080 × 1080. 30 seconds. Silent.</p><a class="btn" href="media/02-connected-studio.mp4" download>Download square video</a></article><article><video controls playsinline preload="none" poster="media/03-node-ballet.png" aria-label="Node ballet, vertical video"><source src="media/03-node-ballet.mp4" type="video/mp4"></video><h3>Node ballet</h3><p>Circles meet, connect and grow. 1080 × 1920. 30 seconds. Silent.</p><a class="btn" href="media/03-node-ballet.mp4" download>Download vertical video</a></article></div></section>
<section class="container launch-bottom"><div class="eyebrow">MAKE SOMETHING REAL</div><h2>Build with Mefi.</h2><p>Free software. Your own projects. Your choice of provider.</p><div class="hero-actions"><a class="btn btn-primary" href="download.html">Download for Windows</a><a class="btn" href="https://discord.gg/xgfKc5pVxG">Join the community</a><a class="btn" href="media/social-posts.md">Social post copy</a></div></section>
</main><footer><div class="container foot-inner"><p>© 2026 MefiMaxi · MIT License</p><div class="foot-links"><a href="wiki/">Wiki</a><a href="community.html">Community</a><a href="https://github.com/nateecho32-stack/mefi-studio/blob/main/CHANGELOG.md">Full changelog</a><a href="https://github.com/nateecho32-stack/mefi-studio">Source</a></div></div></footer><script src="assets/site.js"></script></body></html>`;
const revisedIndex=index.replaceAll('01-chaos-to-clarity','mefi-work-in-motion').replace('From chaos to connected work. A circle story, followed by a tour of the actual interface.','Work in Motion. Follow an agent as tasks branch, images are inspected and finished work returns through the tree.').replace('Development preview: the footage includes the Agent Brain update.','Concept film for the Agent Brain development preview.').replace(/<section class="container alternate">[\s\S]*?<\/section>/,'');
fs.writeFileSync(path.join(OUT,'index.html'),revisedIndex);
fs.writeFileSync(path.join(OUT,'assets/launch.css'),`
.launch{--bg:#f0f0e8;--bg-2:#e7ebe1;--panel:#e3e9df;--panel-solid:#e3e9df;--hairline:#cdd7ca;--hairline-strong:#a8bbaa;--accent:#246c53;--accent-bright:#125a40;--ivory:#101716;--text:#1b2622;--muted:#52645a;--dim:#627168;--ink:#101716;--font-display:system-ui,'Segoe UI',sans-serif;--shadow:none;--shadow-lg:none;--max:1200px;--gutter:28px;background:#f0f0e8;color-scheme:light}.launch h1,.launch h2,.launch h3{font-weight:720;letter-spacing:-.04em}.launch h1{font-size:clamp(3.6rem,8vw,6.8rem);line-height:1.04;max-width:800px}.launch h2{font-size:clamp(2rem,4vw,3.5rem)}.launch .nav{background:#f0f0e8ed}.wordmark{background:#101716;color:#a8f5d1;padding:4px 7px;border-radius:8px;font-family:system-ui;font-weight:800}.launch .brand{font-family:system-ui;font-weight:750}.launch .btn{background:transparent;border-radius:9px;padding:13px 20px;border:1px solid #a4b4a6;color:#101716;font-weight:650}.launch .btn-primary{background:#101716;color:#a8f5d1;border-color:#101716}.launch .launch-hero{padding-top:100px;padding-bottom:90px;position:relative;overflow:hidden}.launch-lede{font-size:clamp(1.1rem,2.2vw,1.65rem);color:#52645a;line-height:1.5;margin:28px 0}.release-hint{margin-top:20px;color:#627168;font-size:.88rem}.hero-mark{position:absolute;right:55px;top:210px;width:270px;display:grid;grid-template-columns:repeat(3,1fr);gap:13px;transform:rotate(-7deg)}.hero-mark span,.hero-mark b{border-radius:13px;background:#d1e7d7;padding:25px 5px;text-align:center;font-size:.78rem;font-weight:700}.hero-mark span:nth-child(2n){background:#101716;color:#a8f5d1}.hero-mark b{grid-column:span 3;background:#a8f5d1;font-size:2.2rem;letter-spacing:-.08em;padding:25px}.launch section{padding-top:65px;padding-bottom:65px}.launch video{display:block;width:100%;border-radius:18px;background:#0d111b}.showcase video{margin:30px 0 20px}.preview-note{font-size:.88rem;max-width:820px;color:#52645a}.feature-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:36px}.feature-cards article{border:1px solid #c4d1c2;border-radius:15px;padding:26px;background:#e8ede4}.feature-cards article>span{font:18px ui-monospace,Consolas,monospace;color:#246c53}.feature-cards h3{margin-top:42px;font-size:1.5rem}.feature-cards p{color:#52645a;line-height:1.6}.alternate-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:30px}.alternate-grid video{height:480px;object-fit:contain}.alternate-grid h3{font-size:1.6rem;margin-top:22px}.launch-bottom{border-top:1px solid #c4d1c2}.launch footer{background:#e1e8dc}.launch .hero-actions{flex-wrap:wrap}.launch video:focus-visible,.launch a:focus-visible{outline:3px solid #248260;outline-offset:4px}@media(max-width:1050px){.hero-mark{right:25px;width:220px;opacity:.7}.launch h1{max-width:670px;font-size:5rem}}@media(max-width:820px){.hero-mark{display:none}.feature-cards{grid-template-columns:1fr 1fr}.alternate-grid video{height:350px}.launch .launch-hero{padding-top:60px}.launch h1{font-size:4.6rem}}@media(max-width:560px){.launch{--gutter:20px}.launch .nav-links{margin-left:0;font-size:.8rem;gap:0}.launch .nav-links a{padding:5px 8px}.launch .nav-inner{padding-top:12px;padding-bottom:10px}.launch h1{font-size:3.5rem}.feature-cards,.alternate-grid{grid-template-columns:1fr}.alternate-grid video{height:auto;max-height:580px}.launch section{padding-top:42px;padding-bottom:42px}.feature-cards h3{margin-top:24px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`);
const updates=`# What's new since 0.3.0

The latest packaged release is shown on the [download page](../../download.html). The videos preview the current development work; the complete record is the [app changelog](https://github.com/nateecho32-stack/mefi-studio/blob/main/CHANGELOG.md).

## The Agent Brain update (development)

- A visible pipeline for each task, with steps, delegated agents and reports returning to the parent.
- The Playbook records pipeline recipes from prior work.
- A project map connects systems, parts and files, using current files, recent git history and verified runs.
- A companion collects what needs your attention and summarizes work since you were away.
- A redesigned Home, centralized agent controls and clearer task activity, history and verification.
- OpenRouter as a companion provider, with a searchable model list.
- A Music & video dropdown for local music, radio and links; a persistent floating media player.
- More reliable task admission, handoffs, project switching, resume behavior and Brain map drafts.

Desk tools, nested delegation and head drafts are optional and start off. Shared listening requires a configured rooms hub.

## Released in 0.3.3

- Discord community perks and controls for a separate Server Styler checkout.
- A regrouped navigation rail and provider-wide usage readings.
- Questions that fold repeats instead of creating endless follow-ups.
- Task run history and clearer owner decisions.
- Safer settings saves, local-only web previews, encrypted keys and checksummed updates.

## Watch and share

[Work in Motion — 30-second showcase](../../media/mefi-work-in-motion.mp4)

[Read every change](https://github.com/nateecho32-stack/mefi-studio/blob/main/CHANGELOG.md).
`;
fs.writeFileSync(path.join(OUT,'wiki/pages/whats-new.md'),updates);
const pagesFile=path.join(OUT,'wiki/pages.json'),pages=JSON.parse(fs.readFileSync(pagesFile,'utf8'));
pages.sections[0].pages.find(p=>p.slug==='whats-new').summary='Released changes since 0.3.0 and the Agent Brain development preview';fs.writeFileSync(pagesFile,JSON.stringify(pages,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'README.md'),`# Mefi's Studio AI+ website\n\nPublic site: https://nateecho32-stack.github.io/mefi-studio/\n\nGitHub Pages publishes the root of the gh-pages branch. The main branch holds the Electron application. This site includes the download page, wiki and Work in Motion, a silent 30-second task-tree concept film.\n\nPreview with a loopback-only static server. Edit these static files on gh-pages and push to update the site. No build tooling or secrets are required. The download page reads the app's latest GitHub release and falls back to the releases link.\n\nThe Agent Brain update is labeled as a development preview until its build is published. The animation uses original illustrative graphics and no live user data. Earlier promotional directions are superseded.\n`);
console.log('Prepared public Pages source:',OUT);
