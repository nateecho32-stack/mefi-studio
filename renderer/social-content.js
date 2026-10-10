// Shared room content. A message never contacts an author's website merely by
// being displayed. Links show their real destination and embeds require a click.
// No fetched HTML, favicons, remote thumbnails or executable markup is accepted.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (label, run) => { const el = node("button", "ghost rooms-button", label); el.type = "button"; el.addEventListener("click", run); return el; };
  const privateEnd = /(?:^|\.)(?:localhost|local|lan|internal|home|arpa|intranet|test|invalid|example)$/i;
  const secretKey = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|key|token|secret|password|passwd|authorization|auth|code|session|sessionid|jwt|signature|sig|x-amz-signature)$/i;
  function inspect(value) {
    if (typeof value !== "string" || value.length > 2048 || /[\s\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069\\]/.test(value)) return { ok: false, reason: "This link contains hidden characters or is too long." };
    let url;
    try { url = new URL(value); } catch { return { ok: false, reason: "This link is incomplete." }; }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port) return { ok: false, reason: "Only HTTPS links without a login or custom port can open here." };
    if (!host.includes(".") || host.startsWith("[") || /^\d+(?:\.\d+)*$/.test(host) || privateEnd.test(host)) return { ok: false, reason: "Private-network addresses cannot open from chat." };
    if ([...url.searchParams.keys()].some((key) => secretKey.test(key)) || /(?:token|password|secret|access_token|api_key)=/i.test(url.hash)) return { ok: false, reason: "This link may contain a login or secret. Ask for a public share link." };
    const label = host; // ASCII/punycode from URL, never a member-supplied label.
    let embed = null;
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
      const id = host === "youtu.be" ? url.pathname.slice(1) : url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(?:shorts|embed)\/([^/]+)$/.exec(url.pathname)?.[1];
      if (/^[A-Za-z0-9_-]{11}$/.test(id || "")) embed = { provider: "YouTube", host: "www.youtube-nocookie.com", url: `https://www.youtube-nocookie.com/embed/${id}` };
    } else if (["vimeo.com", "www.vimeo.com"].includes(host) && /^\/\d{1,12}$/.test(url.pathname)) {
      embed = { provider: "Vimeo", host: "player.vimeo.com", url: `https://player.vimeo.com/video${url.pathname}?dnt=1` };
    } else if (host === "open.spotify.com" && /^\/(track|album|playlist|episode|show)\/[A-Za-z0-9]{22}$/.test(url.pathname)) {
      embed = { provider: "Spotify", host, url: `https://open.spotify.com/embed${url.pathname}` };
    }
    return { ok: true, url: url.href, host: label, embed };
  }
  const links = words => [...String(words??"").matchAll(/https?:\/\/[^\s<>]+/gi)].map(match=>({raw:match[0],checked:inspect(match[0].replace(/[.,!?;:)\]}]+$/, ""))}));
  function checkPost(text) {
    const unsafe=links(text).find(link=>!link.checked.ok);
    return unsafe ? {ok:false,reason:`Remove or replace the unsafe link before sending. ${unsafe.checked.reason}`} : {ok:true};
  }
  function content(text) {
    const body = node("div", "rooms-social-content");
    const words = String(text ?? "");
    const matches = links(words);
    let displayed=words;
    for(const match of matches)if(!match.checked.ok)displayed=displayed.replace(match.raw,"[Link hidden: use a public HTTPS share link]");
    body.append(node("p", "rooms-message-text", displayed));
    try { if (localStorage.getItem("mefiStudio.social.content") === "off") return body; } catch { /* default: click-to-load */ }
    for (const match of matches.slice(0,4)) {
      const checked = match.checked;
      const card = node("div", "rooms-link-card");
      if (!checked.ok) { card.append(node("span", "muted", checked.reason)); body.append(card); continue; }
      card.append(node("strong", "", checked.host));
      const destination = node("span", "rooms-link-destination", checked.url);
      card.append(destination);
      const actions = node("div", "rooms-row-actions");
      const open = button("Open link…", () => {
        if (window.confirm?.(`Open ${checked.host} in your browser?\n\n${checked.url}\n\nThe site can see your IP address and browser details. Studio has not checked its contents. Never enter a password just because someone shared a link.`) !== true) return;
        void Promise.resolve(window.mefiStudio?.openExternal?.(checked.url)).catch(() => {});
      });
      actions.append(open);
      if (checked.embed) {
        const preview = button(`Load ${checked.embed.provider} player`, () => {
          if (card.querySelector?.("iframe")) return;
          const frame = node("iframe", "rooms-link-player");
          frame.title = `${checked.embed.provider} player`;
          frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
          frame.setAttribute("referrerpolicy", "no-referrer");
          frame.setAttribute("allow", "encrypted-media; fullscreen; picture-in-picture");
          frame.loading = "lazy";
          frame.src = checked.embed.url;
          card.append(frame);
          preview.disabled = true;
          const stop = button("Close player", () => { frame.remove(); stop.remove(); preview.disabled = false; });
          actions.append(stop);
        });
        actions.append(preview);
        card.append(node("span", "muted", `Loading the player connects to ${checked.embed.host} and shares your IP address. Nothing loads before you choose.`));
      }
      card.append(actions); body.append(card);
    }
    return body;
  }
  window.MefiSocialContent = { inspect, content, checkPost };
})();
