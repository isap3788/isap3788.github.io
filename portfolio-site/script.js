/* Bella Paul portfolio: all the interactive bits. No libraries. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

  /* ---------- split headings into letters ---------- */
  let charIndex = 0;
  $$("[data-split]").forEach((el) => {
    const text = el.textContent;
    el.textContent = "";
    for (const ch of text) {
      const span = document.createElement("span");
      span.className = ch === " " ? "char space" : "char";
      span.textContent = ch === " " ? " " : ch;
      span.style.setProperty("--i", charIndex++);
      span.setAttribute("aria-hidden", "true");
      el.appendChild(span);
    }
  });
  const heroTitle = $(".hero-title");
  if (!reduced) heroTitle.classList.add("intro");
  setTimeout(() => heroTitle.classList.remove("intro"), 2200);

  /* ---------- pointer state ---------- */
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, moved: false };
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.moved = true;
  }, { passive: true });

  /* ---------- custom cursor ---------- */
  const cursor = $(".cursor");
  const dot = $(".cursor-dot");
  const label = $(".cursor-label");
  const ring = { x: mouse.x, y: mouse.y };
  if (finePointer) {
    document.documentElement.style.cursor = "none";
    const style = document.createElement("style");
    style.textContent = "a,button,.sticker,.bubble,[data-cursor]{cursor:none!important}";
    document.head.appendChild(style);

    document.addEventListener("pointerover", (e) => {
      const t = e.target.closest("[data-cursor], a, button");
      cursor.classList.remove("is-hover", "is-link");
      if (!t) return;
      if (t.dataset.cursor) {
        label.textContent = t.dataset.cursor;
        cursor.classList.add("is-hover");
      } else cursor.classList.add("is-link");
    });
    addEventListener("pointerdown", () => cursor.classList.add("is-down"));
    addEventListener("pointerup", () => cursor.classList.remove("is-down"));
    document.addEventListener("mouseleave", () => { cursor.classList.add("is-hidden"); dot.classList.add("is-hidden"); });
    document.addEventListener("mouseenter", () => { cursor.classList.remove("is-hidden"); dot.classList.remove("is-hidden"); });
  }

  /* ---------- kinetic letters ---------- */
  const kineticChars = $$(".hero-title .char, .contact-title .char");
  function updateLetters() {
    for (const c of kineticChars) {
      const r = c.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const dx = mouse.x - (r.left + r.width / 2);
      const dy = mouse.y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      const f = clamp(1 - d / 260, 0, 1); // 1 = right under the cursor
      const e = f * f * (3 - 2 * f);
      c.style.setProperty("--w", Math.round(700 + 100 * e - 450 * e * e));
      c.style.setProperty("--wd", Math.round(88 + 12 * e));
      c.style.setProperty("--y", (-18 * e).toFixed(1) + "px");
      c.style.setProperty("--r", (dx > 0 ? -6 : 6) * e + "deg");
      c.style.color = e > 0.55 ? "var(--tomato)" : "";
    }
  }

  /* ---------- magnetic buttons ---------- */
  if (finePointer && !reduced) {
    $$(".magnetic").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.28;
        const y = (e.clientY - r.top - r.height / 2) * 0.4;
        el.style.transform = `translate(${x}px, ${y}px)`;
      });
      el.addEventListener("pointerleave", () => (el.style.transform = ""));
    });
  }

  /* ---------- 3D tilt ---------- */
  if (finePointer && !reduced) {
    $$(".tilt").forEach((el) => {
      const zone = el.closest(".project-device, .about-photo") || el;
      zone.addEventListener("pointermove", (e) => {
        if (el.classList.contains("no-tilt")) return;
        const r = zone.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty("--ry", (px * 14).toFixed(2) + "deg");
        el.style.setProperty("--rx", (-py * 10).toFixed(2) + "deg");
      });
      zone.addEventListener("pointerleave", () => {
        el.style.setProperty("--ry", "0deg");
        el.style.setProperty("--rx", "0deg");
      });
    });
  }

  /* ---------- reveal on scroll ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  $$(".reveal").forEach((el) => io.observe(el));

  /* ---------- scroll: progress, nav, dark work section, laptop lids ---------- */
  const bar = $(".progress span");
  const nav = $(".nav");
  const work = $("#work");
  const lids = $$("[data-lid]");
  let lastY = scrollY;
  function onScroll() {
    const y = scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    nav.classList.toggle("is-hidden", y > lastY && y > 300);
    lastY = y;

    const wr = work.getBoundingClientRect();
    document.body.classList.toggle("is-dark", wr.top < innerHeight * 0.55 && wr.bottom > innerHeight * 0.45);

    for (const l of lids) {
      const r = l.getBoundingClientRect();
      // 0 when the laptop's top hits the bottom of the screen, 1 when it is 35% up
      const p = reduced ? 1 : clamp((innerHeight - r.top) / (innerHeight * 0.55), 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      l.querySelector(".laptop-lid").style.setProperty("--lid", (-92 * (1 - eased)).toFixed(2) + "deg");
    }
  }
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();

  /* ---------- hover-to-scroll screens ---------- */
  function measureScreens() {
    $$(".scroll-screen").forEach((screen) => {
      const img = screen.querySelector("img");
      if (!img || !img.naturalWidth) return;
      const imgH = screen.clientWidth * (img.naturalHeight / img.naturalWidth);
      const dist = Math.max(0, imgH - screen.clientHeight);
      screen.style.setProperty("--scroll-to", -dist + "px");
      screen.style.setProperty("--scroll-dur", clamp(dist / 260, 2, 12).toFixed(1) + "s");
    });
  }
  $$(".scroll-screen img").forEach((img) => img.complete ? measureScreens() : img.addEventListener("load", measureScreens));
  addEventListener("resize", measureScreens);
  // Touch: tap to toggle the scroll
  $$(".scroll-screen").forEach((s) => s.addEventListener("click", () => { if (!finePointer) s.classList.toggle("auto"); }));

  /* ---------- Creature Clash: demo video + live game ---------- */
  const gameScreen = $(".game-screen");
  const video = $(".game-video");
  if (video) {
    video.addEventListener("canplay", () => { video.classList.add("ready"); video.play().catch(() => {}); }, { once: true });
    const vio = new IntersectionObserver(([en]) => {
      if (en.isIntersecting) { if (video.preload === "none") { video.preload = "auto"; video.load(); } video.play().catch(() => {}); }
      else video.pause();
    }, { threshold: 0.3 });
    vio.observe(video);
  }
  function fitGame(frame) {
    const w = 1280, h = 800;
    const s = gameScreen.clientWidth / w;
    Object.assign(frame.style, { width: w + "px", height: h + "px", transform: `scale(${s})`, transformOrigin: "0 0", inset: "0 auto auto 0" });
  }
  function playGame() {
    if (gameScreen.classList.contains("playing")) return;
    gameScreen.classList.add("playing");
    gameScreen.closest(".laptop").classList.add("no-tilt");
    gameScreen.closest(".laptop").style.setProperty("--rx", "0deg");
    gameScreen.closest(".laptop").style.setProperty("--ry", "0deg");
    video && video.pause();
    const frame = document.createElement("iframe");
    frame.src = "projects/creature-clash/";
    frame.title = "Creature Clash, playable demo";
    frame.allow = "fullscreen; pointer-lock; autoplay";
    fitGame(frame);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "game-close";
    close.textContent = "✕ close game";
    close.addEventListener("click", () => {
      frame.remove(); close.remove();
      gameScreen.classList.remove("playing");
      gameScreen.closest(".laptop").classList.remove("no-tilt");
    });
    gameScreen.append(frame, close);
    frame.addEventListener("mouseenter", () => cursor.classList.add("is-hidden"));
    frame.addEventListener("mouseleave", () => cursor.classList.remove("is-hidden"));
    addEventListener("resize", () => frame.isConnected && fitGame(frame));
    gameScreen.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }
  $$("[data-play-game]").forEach((b) => b.addEventListener("click", playGame));

  /* ---------- confetti ---------- */
  function confetti(x, y, n = 70) {
    if (reduced) return;
    const colors = ["#ff5b37", "#d4ff3f", "#6a5cff", "#ff9ecf", "#3ce3ff", "#16130f"];
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      const size = 6 + Math.random() * 8;
      Object.assign(p.style, {
        position: "fixed", left: x + "px", top: y + "px", width: size + "px", height: size * (Math.random() > .5 ? 1 : .45) + "px",
        background: colors[i % colors.length], borderRadius: Math.random() > .6 ? "50%" : "2px", zIndex: 999, pointerEvents: "none",
      });
      document.body.appendChild(p);
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 260;
      p.animate([
        { transform: "translate(0,0) rotate(0)", opacity: 1 },
        { transform: `translate(${Math.cos(a) * v}px, ${Math.sin(a) * v + 260}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ], { duration: 1100 + Math.random() * 700, easing: "cubic-bezier(.2,.7,.4,1)" }).onfinish = () => p.remove();
    }
  }

  /* ---------- Degree Tracker stand-in ---------- */
  const ringEl = $("[data-ring]");
  const reqs = $$("[data-reqs] li");
  reqs.forEach((li) => (li.dataset.start = li.dataset.done));
  function paintReq(li) {
    const done = +li.dataset.done, total = +li.dataset.total;
    li.querySelector(".req-bar span").style.width = (done / total) * 100 + "%";
    li.querySelector("small").textContent = `${done} / ${total}`;
    li.classList.toggle("done", done === total);
  }
  function updateRing(fromEl) {
    let earned = 0, total = 0;
    reqs.forEach((li) => { earned += +li.dataset.done; total += +li.dataset.total; });
    const pct = Math.round((earned / total) * 100);
    ringEl.style.setProperty("--p", pct);
    $("[data-ring-num]").textContent = pct + "%";
    $("[data-ring-credits]").textContent = `${earned} / ${total}`;
    $("[data-ring-left]").textContent = total - earned === 0 ? "Done!" : `${total - earned} cr`;
    if (pct === 100 && fromEl) {
      const r = ringEl.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + r.height / 2, 90);
    }
  }
  reqs.forEach(paintReq);
  $$("[data-reqs] li:not(.locked) button").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const li = b.parentElement;
    li.dataset.done = li.dataset.done === li.dataset.total ? li.dataset.start : li.dataset.total;
    paintReq(li);
    updateRing(b);
  }));
  const tasks = $$("[data-tasks] li");
  const paintWeek = () => ($("[data-week-done]").textContent = `${tasks.filter((t) => t.classList.contains("done")).length}/${tasks.length}`);
  $$("[data-tasks] button").forEach((b) => b.addEventListener("click", () => {
    b.parentElement.classList.toggle("done");
    paintWeek();
    if (b.parentElement.classList.contains("done")) {
      const r = b.getBoundingClientRect();
      confetti(r.left + 20, r.top + r.height / 2, 18);
    }
  }));
  paintWeek();

  /* ---------- fact cards (tap on touch) ---------- */
  $$(".fact").forEach((f) => f.addEventListener("click", () => f.classList.toggle("on")));

  /* ---------- draggable stickers ---------- */
  $$(".sticker").forEach((s) => {
    let sx, sy, ox = 0, oy = 0;
    s.addEventListener("pointerdown", (e) => {
      s.setPointerCapture(e.pointerId);
      s.classList.add("dragging");
      sx = e.clientX - ox; sy = e.clientY - oy;
    });
    s.addEventListener("pointermove", (e) => {
      if (!s.classList.contains("dragging")) return;
      ox = e.clientX - sx; oy = e.clientY - sy;
      s.style.transform = `translate(${ox}px, ${oy}px)`;
    });
    const end = () => s.classList.remove("dragging");
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
  });

  /* ---------- skill bubbles: a floating, connected web ---------- */
  const pit = $("[data-pit]");
  const tip = $(".bubble-tip");
  const web = $("[data-web]");
  const SVGNS = "http://www.w3.org/2000/svg";
  const bubbles = $$(".bubble", pit).map((el, i) => ({
    el, id: el.dataset.id, i, r: 50, x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
    phase: i * 1.7, speed: 0.00035 + (i % 4) * 0.00008,
  }));
  const byId = Object.fromEntries(bubbles.map((b) => [b.id, b]));
  // edges (deduped) from each bubble's data-links
  const edges = [];
  const seen = new Set();
  bubbles.forEach((a) => {
    (a.el.dataset.links || "").split(/\s+/).filter(Boolean).forEach((id) => {
      const c = byId[id]; if (!c) return;
      const key = [a.id, c.id].sort().join("|");
      if (seen.has(key)) return; seen.add(key);
      const g = document.createElementNS(SVGNS, "g");
      const line = document.createElementNS(SVGNS, "line");
      const dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("r", 3);
      g.append(line, dot); web.append(g);
      edges.push({ a, c, g, line, dot, off: Math.random() });
    });
  });
  const neighbors = (b) => edges.filter((e) => e.a === b || e.c === b).map((e) => (e.a === b ? e.c : e.a));

  let W = 0, H = 0, pitActive = false, focused = null;
  const pitMouse = { x: -999, y: -999, inside: false };
  function sizePit() {
    W = pit.clientWidth; H = pit.clientHeight;
    const mobile = W < 600;
    const scale = mobile ? clamp(W / 560, 0.55, 0.7) : clamp(W / 1100, 0.6, 1);
    bubbles.forEach((b) => {
      const s = (+b.el.dataset.size || 110) * scale;
      b.r = s / 2;
      b.el.style.setProperty("--s", s + "px");
      const [px, py] = (mobile ? b.el.dataset.mpos : b.el.dataset.pos).split(",").map(Number);
      b.ax = clamp((px / 100) * W, b.r + 6, W - b.r - 6);
      const usable = mobile ? H - 96 : H; // leave room for the tooltip on phones
      b.ay = clamp((py / 100) * usable, b.r + 6, usable - b.r - 6);
    });
  }
  function placeBubbles() {
    sizePit();
    bubbles.forEach((b) => { b.x = b.ax; b.y = b.ay; b.vx = b.vy = 0; });
  }
  function stepPit(now = 0) {
    const drift = reduced ? 0 : 1;
    for (const b of bubbles) {
      // each bubble bobs around its home spot on a slow looping path
      const t = now * b.speed + b.phase;
      const tx = b.ax + Math.sin(t) * 14 * drift;
      const ty = b.ay + Math.cos(t * 1.3) * 10 * drift;
      b.vx += (tx - b.x) * 0.012;
      b.vy += (ty - b.y) * 0.012;
      // the cursor nudges bubbles aside a little as it passes
      if (pitMouse.inside && drift) {
        const dx = b.x - pitMouse.x, dy = b.y - pitMouse.y, d = Math.hypot(dx, dy);
        const reach = b.r + 70;
        if (d < reach && d > b.r * 0.6) {
          const push = (1 - d / reach) * 0.35;
          b.vx += (dx / d) * push; b.vy += (dy / d) * push;
        }
      }
      b.vx *= 0.9; b.vy *= 0.9;
    }
    // keep a little breathing room between neighbors
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i], c = bubbles[j];
        const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + c.r + 12;
        if (d >= min) continue;
        const f = ((min - d) / d) * 0.04;
        a.vx -= dx * f; a.vy -= dy * f; c.vx += dx * f; c.vy += dy * f;
      }
    }
    for (const b of bubbles) {
      b.x = clamp(b.x + b.vx, b.r, W - b.r);
      b.y = clamp(b.y + b.vy, b.r, H - b.r);
      const k = b === focused ? 1.08 : 1;
      b.el.style.transform = `translate(${b.x - b.r}px, ${b.y - b.r}px) scale(${k})`;
    }
    // lines run edge to edge, with a little dot travelling along each one
    for (const e of edges) {
      const dx = e.c.x - e.a.x, dy = e.c.y - e.a.y, d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const x1 = e.a.x + ux * (e.a.r + 4), y1 = e.a.y + uy * (e.a.r + 4);
      const x2 = e.c.x - ux * (e.c.r + 4), y2 = e.c.y - uy * (e.c.r + 4);
      e.line.setAttribute("x1", x1); e.line.setAttribute("y1", y1);
      e.line.setAttribute("x2", x2); e.line.setAttribute("y2", y2);
      const p = reduced ? 0.5 : (now * 0.00018 + e.off) % 1;
      e.dot.setAttribute("cx", x1 + (x2 - x1) * p);
      e.dot.setAttribute("cy", y1 + (y2 - y1) * p);
    }
  }
  function focusBubble(b) {
    focused = b;
    pit.classList.toggle("focus", !!b);
    const near = b ? neighbors(b) : [];
    bubbles.forEach((o) => {
      o.el.classList.toggle("lit", o === b);
      o.el.classList.toggle("linked", near.includes(o));
    });
    edges.forEach((e) => e.g.classList.toggle("on", !!b && (e.a === b || e.c === b)));
    if (!b) { tip.classList.remove("on"); return; }
    const name = (o) => o.el.querySelector(".b-name").textContent;
    const pairs = near.length ? ` · pairs with ${near.map(name).join(", ")}` : "";
    tip.innerHTML = `<b>${name(b)}</b> · ${b.el.dataset.tip}${pairs}`;
    tip.classList.add("on");
  }
  bubbles.forEach((b) => {
    b.el.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") focusBubble(b); });
    b.el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && focused === b) focusBubble(null); });
    b.el.addEventListener("focus", () => focusBubble(b));
    b.el.addEventListener("blur", () => { if (focused === b) focusBubble(null); });
    b.el.addEventListener("click", () => {
      focusBubble(focused === b && !matchMedia("(hover: hover)").matches ? null : b);
    });
  });
  pit.addEventListener("click", (e) => { if (e.target === pit) focusBubble(null); });
  pit.addEventListener("pointermove", (e) => {
    const r = pit.getBoundingClientRect();
    pitMouse.x = e.clientX - r.left; pitMouse.y = e.clientY - r.top;
    pitMouse.inside = e.pointerType === "mouse";
  });
  pit.addEventListener("pointerleave", () => (pitMouse.inside = false));
  addEventListener("resize", () => sizePit());

  placeBubbles();
  stepPit(0);
  if (!reduced) {
    new IntersectionObserver(([en]) => { pitActive = en.isIntersecting; }, { rootMargin: "200px" }).observe(pit);
  }

  /* ---------- main loop ---------- */
  function frame() {
    if (finePointer) {
      ring.x += (mouse.x - ring.x) * 0.18;
      ring.y += (mouse.y - ring.y) * 0.18;
      cursor.style.translate = `${ring.x}px ${ring.y}px`;
      dot.style.translate = `${mouse.x}px ${mouse.y}px`;
    }
    if (mouse.moved && !reduced) { updateLetters(); mouse.moved = false; }
    if (pitActive) stepPit(performance.now());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
