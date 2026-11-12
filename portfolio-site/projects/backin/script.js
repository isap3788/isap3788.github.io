// BackIn site interactions. Motion effects are skipped when the user prefers reduced motion.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;

document.documentElement.classList.add("js");
document.getElementById("year").textContent = new Date().getFullYear();

// ---------- Mobile menu ----------
const nav = document.querySelector(".nav");
const menuBtn = document.querySelector(".menu-btn");
menuBtn.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menuBtn.setAttribute("aria-expanded", open);
  menuBtn.innerHTML = open ? '<i class="ph ph-x"></i>' : '<i class="ph ph-list"></i>';
});
document.querySelectorAll(".nav-links a").forEach((a) =>
  a.addEventListener("click", () => {
    nav.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.innerHTML = '<i class="ph ph-list"></i>';
  })
);

// ---------- Scroll reveal ----------
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      revealObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.15 }
);
document.querySelectorAll(".reveal, .steps-line").forEach((el) => revealObserver.observe(el));

// ---------- Count-up numbers (replays every time a stat scrolls into view) ----------
const countFrames = new Map(); // element -> running requestAnimationFrame id

function formatCount(el, n) {
  const decimals = parseInt(el.dataset.decimals || "0", 10);
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function runCount(el) {
  cancelAnimationFrame(countFrames.get(el));
  const target = parseFloat(el.dataset.count);
  if (reduceMotion) return (el.textContent = formatCount(el, target));

  const duration = 1600;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = formatCount(el, target * eased);
    if (t < 1) countFrames.set(el, requestAnimationFrame(tick));
  };
  countFrames.set(el, requestAnimationFrame(tick));
}

function resetCount(el) {
  cancelAnimationFrame(countFrames.get(el));
  el.textContent = formatCount(el, 0);
}

const countObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const el = entry.target;
      if (entry.intersectionRatio >= 0.6 && !el.dataset.counted) {
        el.dataset.counted = "true";
        runCount(el);
      } else if (!entry.isIntersecting) {
        // Fully off screen: reset quietly so it counts up again next time
        delete el.dataset.counted;
        if (!reduceMotion) resetCount(el);
      }
    });
  },
  { threshold: [0, 0.6] }
);
document.querySelectorAll("[data-count]").forEach((el) => countObserver.observe(el));

// ---------- Statement: words light up in sequence ----------
document.querySelectorAll("[data-words]").forEach((el) => {
  const words = el.textContent.trim().split(/\s+/);
  el.innerHTML = words
    .map((w) => `<span class="word${/sharpened/i.test(w) ? " hl" : ""}">${w}</span>`)
    .join(" ");
  const spans = el.querySelectorAll(".word");
  const obs = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      spans.forEach((s, i) => setTimeout(() => s.classList.add("lit"), i * 55));
      obs.disconnect();
    },
    { threshold: 0.5 }
  );
  obs.observe(el);
});

// ---------- Comeback Archive tabs ----------
const ARCHIVE = [
  {
    icon: "ph-baby", label: "Parental leave",
    title: "Out running a household. Still running projects.",
    reframe: "Parental leave doesn't erase project management, budgeting, negotiation, or crisis response. It just doesn't call itself that on a payslip. Your file starts with the skills, not the leave dates.",
    help: "We match you to employers with returnship tracks built for exactly this break, and help you translate the last year into role-ready language.",
  },
  {
    icon: "ph-heartbeat", label: "Caregiving",
    title: "Managed a family's hardest year. That's operations experience.",
    reframe: "Coordinating care, appointments, budgets, and other people's needs under pressure is the work most job descriptions ask for. We name it that way.",
    help: "Your file leads with the coordination, advocacy, and decision-making the break required, then matches you to roles that value it.",
  },
  {
    icon: "ph-first-aid", label: "Illness & recovery",
    title: "You don't owe anyone a medical explanation to get hired.",
    reframe: "Recovery is reason enough. BackIn never asks you to disclose more than you want. Your file talks about readiness and skills, not diagnosis.",
    help: "We coach a short, confident answer to \"what were you doing?\" that closes the topic and moves the conversation back to your work.",
  },
  {
    icon: "ph-airplane-tilt", label: "Sabbatical",
    title: "You stepped back on purpose. That's not a red flag.",
    reframe: "A deliberate pause reads as foresight to the right employer. Someone who can plan a break can plan a project.",
    help: "Your file frames the sabbatical as intentional and time-boxed, with a clear reason for returning now.",
  },
  {
    icon: "ph-map-pin-line", label: "Relocation",
    title: "New city, same track record.",
    reframe: "Moving takes logistics, planning, and adaptability. It interrupts a job, not a career.",
    help: "We surface local employers hiring relocators and flag roles that credit your experience in your previous market.",
  },
  {
    icon: "ph-battery-low", label: "Burnout",
    title: "You stepped away before it cost you more. That's judgment.",
    reframe: "Recognizing burnout and acting on it is self-management, a skill most workplaces need more of, not less.",
    help: "We point you toward teams with healthier pace signals, and help you set boundaries in the interview, not just after you're hired.",
  },
  {
    icon: "ph-key", label: "Incarceration",
    title: "A second chance, backed by employers who've already said yes.",
    reframe: "BackIn works with fair-chance employers who have committed to hiring people with records. You're not the test case. You're the next hire.",
    help: "Your file connects you to fair-chance roles and reentry support, with coaching on disclosure timing that protects you.",
  },
];

const tabsEl = document.querySelector(".archive-tabs");
const panel = document.querySelector(".archive-panel");

ARCHIVE.forEach((file, i) => {
  const btn = document.createElement("button");
  btn.className = "archive-tab";
  btn.setAttribute("role", "tab");
  btn.innerHTML = `<i class="ph ${file.icon}"></i>${file.label}`;
  btn.addEventListener("click", () => showFile(i));
  btn.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = (i + dir + ARCHIVE.length) % ARCHIVE.length;
    showFile(next);
    tabsEl.children[next].focus();
  });
  tabsEl.appendChild(btn);
});

function showFile(i) {
  const file = ARCHIVE[i];
  [...tabsEl.children].forEach((t, j) => {
    t.setAttribute("aria-selected", j === i);
    t.tabIndex = j === i ? 0 : -1;
  });
  panel.querySelector(".file-no").textContent = `File 0${i + 1} / ${file.label}`;
  panel.querySelector(".file-title").textContent = file.title;
  panel.querySelector(".file-reframe").textContent = file.reframe;
  panel.querySelector(".file-help").textContent = file.help;
  panel.classList.remove("swap");
  void panel.offsetWidth; // restart the animation
  panel.classList.add("swap");
}
showFile(0);

// ---------- Marquee: duplicate content for a seamless loop ----------
const track = document.querySelector(".marquee-track");
if (track) track.innerHTML += track.innerHTML;

if (!reduceMotion) {
  // ---------- Hero: rotating break reasons ----------
  const reasons = ["parental leave.", "caregiving.", "a sabbatical.", "recovery.", "a big move.", "burnout.", "a fresh start."];
  const wordEl = document.querySelector(".rotator-word");
  let r = 0;
  setInterval(() => {
    wordEl.classList.remove("in");
    wordEl.classList.add("out");
    setTimeout(() => {
      r = (r + 1) % reasons.length;
      wordEl.textContent = reasons[r];
      wordEl.classList.remove("out");
      wordEl.classList.add("in");
    }, 350);
  }, 2400);

  if (finePointer) {
    // ---------- Hero photo tilt ----------
    document.querySelectorAll("[data-tilt]").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const b = el.getBoundingClientRect();
        const x = (e.clientX - b.left) / b.width - 0.5;
        const y = (e.clientY - b.top) / b.height - 0.5;
        el.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
      });
      el.addEventListener("pointerleave", () => (el.style.transform = ""));
    });

    // ---------- Spotlight tiles ----------
    document.querySelectorAll("[data-spotlight]").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const b = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - b.left}px`);
        el.style.setProperty("--my", `${e.clientY - b.top}px`);
      });
    });

    // ---------- Magnetic buttons ----------
    document.querySelectorAll(".magnetic").forEach((btn) => {
      btn.addEventListener("pointermove", (e) => {
        const b = btn.getBoundingClientRect();
        btn.style.transform = `translate(${(e.clientX - b.left - b.width / 2) * 0.22}px, ${(e.clientY - b.top - b.height / 2) * 0.3}px)`;
      });
      btn.addEventListener("pointerleave", () => (btn.style.transform = ""));
    });
  }
}

// ---------- Modals: sign-up, employer, contact, privacy, terms ----------
const modal = document.querySelector(".modal");
const modalContent = modal.querySelector(".modal-content");

const escapeHTML = (str) =>
  String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function openModal(name, trigger) {
  const tpl = document.getElementById(`tpl-${name}`);
  if (!tpl) return;
  modalContent.replaceChildren(tpl.content.cloneNode(true));

  // App Store / Google Play buttons tailor the sign-up copy
  const platform = trigger?.dataset.platform;
  const platformText = modalContent.querySelector("[data-platform-text]");
  if (platformText) platformText.textContent = platform ? ` for ${platform}` : "";
  modal.dataset.platform = platform || "";

  modal.showModal();
  modalContent.querySelector("input, textarea, select")?.focus();
}

document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-modal]");
  if (trigger) {
    e.preventDefault();
    nav.classList.remove("open");
    openModal(trigger.dataset.modal, trigger);
    return;
  }
  if (e.target.closest(".modal-close, [data-close]")) modal.close();
});

// Click on the dimmed backdrop closes the modal
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.close();
});

// ---------- Form validation ----------
function validateField(input) {
  const field = input.closest(".field");
  if (!field) return true;
  const error = field.querySelector(".error");
  let message = "";
  const value = input.value.trim();

  if (input.required && !value) {
    message = input.tagName === "SELECT" ? "Please choose an option." : "This field is required.";
  } else if (input.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    message = "Enter a valid email, like name@example.com.";
  }

  field.classList.toggle("invalid", Boolean(message));
  input.setAttribute("aria-invalid", Boolean(message));
  error.textContent = message;
  return !message;
}

modal.addEventListener("input", (e) => {
  if (e.target.closest(".field.invalid")) validateField(e.target);
});

const SUCCESS = {
  signup: (d) => `
    <h2 id="modal-title">You're in, ${d.name}!</h2>
    <p>Check <b>${d.email}</b> for your ${modal.dataset.platform ? escapeHTML(modal.dataset.platform) + " " : ""}download link.
       Your first matches arrive within 48 hours.</p>
    <div class="summary">
      <span>Break: <b>${d.break}</b></span>
      <span>Time away: <b>${d.time}</b></span>
      <span>Returning to: <b>${d.field}</b></span>
    </div>`,
  employer: (d) => `
    <h2 id="modal-title">Thanks, ${d.name}.</h2>
    <p>A partnerships lead will email <b>${d.email}</b> within one business day to plan ${d.company}'s returnship.</p>
    <div class="summary">
      <span>Company size: <b>${d.size}</b></span>
      <span>Roles: <b>${d.roles}</b></span>
    </div>`,
  contact: (d) => `
    <h2 id="modal-title">Message sent.</h2>
    <p>Thanks, ${d.name}. We'll reply to <b>${d.email}</b> within two business days.</p>
    <div class="summary"><span>Your message: <b>${d.message}</b></span></div>`,
};

modal.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const inputs = [...form.querySelectorAll("input:not([type=checkbox]), select, textarea")];
  const allValid = inputs.map(validateField).every(Boolean);
  if (!allValid) {
    form.querySelector(".invalid input, .invalid select, .invalid textarea")?.focus();
    return;
  }

  const data = {};
  new FormData(form).forEach((value, key) => (data[key] = escapeHTML(value.trim())));

  // Demo only: simulate sending to a server
  const submit = form.querySelector("[type=submit]");
  submit.disabled = true;
  submit.innerHTML = '<i class="ph-bold ph-circle-notch spin"></i> Sending...';

  setTimeout(() => {
    modalContent.innerHTML = `
      <div class="success">
        <div class="success-icon"><i class="ph-bold ph-check"></i></div>
        ${SUCCESS[form.dataset.form](data)}
        <button type="button" class="btn btn-primary btn-block" data-close>Back to BackIn</button>
      </div>`;
    modalContent.querySelector("[data-close]").focus();
  }, 1100);
});

// ---------- Purple aura: follows the mouse, then drifts slowly when idle ----------
const aura = document.querySelector(".cursor-aura");
const canDrift = !reduceMotion;
if (aura && (finePointer || canDrift)) {
  const IDLE_AFTER = 2500;   // ms without mouse movement before drifting
  const FOLLOW = reduceMotion ? 1 : 0.12; // how tightly it tracks the cursor
  const GLIDE = 0.02;        // easing toward the drift path
  const DRIFT_SPEED = 90;    // max px per second while drifting (lower = calmer)
  const RAMP = 4000;         // ms to ease from still into full drift speed

  let targetX = innerWidth / 2, targetY = innerHeight / 2;
  let x = targetX, y = targetY;
  let lastMove = -Infinity;  // touch devices never move a cursor, so they drift from the start

  if (finePointer) {
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      targetX = e.clientX;
      targetY = e.clientY;
      lastMove = performance.now();
      aura.classList.add("on");
    });
    // Mouse left the window: start drifting right away (or hide if drifting is off)
    document.documentElement.addEventListener("pointerleave", () => {
      lastMove = -Infinity;
      if (!canDrift) aura.classList.remove("on");
    });
  }
  if (canDrift) aura.classList.add("on");

  const loop = (now) => {
    const idleFor = now - lastMove - IDLE_AFTER;
    let ease = FOLLOW;
    let maxStep = Infinity;
    if (idleFor > 0 && canDrift) {
      // Slow, looping figure-eight path across the middle of the screen
      const t = now / 1000;
      targetX = innerWidth * (0.5 + 0.3 * Math.sin(t * 0.13));
      targetY = innerHeight * (0.5 + 0.25 * Math.sin(t * 0.21 + 1));
      ease = GLIDE;
      // Ease in from a standstill, then never move faster than DRIFT_SPEED
      const r = Math.min(1, idleFor / RAMP);
      maxStep = (DRIFT_SPEED * r * r * (3 - 2 * r)) / 60;
    }
    let dx = (targetX - x) * ease;
    let dy = (targetY - y) * ease;
    const step = Math.hypot(dx, dy);
    if (step > maxStep) {
      dx *= maxStep / step;
      dy *= maxStep / step;
    }
    x += dx;
    y += dy;
    aura.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------- iPhone app preview: tappable demo controls ----------
const phone = document.querySelector(".phone");
if (phone) {
  const appScroll = phone.querySelector(".app-scroll");

  phone.addEventListener("click", (e) => {
    const save = e.target.closest(".app-save");
    if (save) {
      const saved = save.classList.toggle("saved");
      save.innerHTML = saved ? '<i class="ph-fill ph-heart"></i>' : '<i class="ph ph-heart"></i>';
      save.setAttribute("aria-label", saved ? "Unsave job" : "Save job");
    }

    const apply = e.target.closest(".app-apply");
    if (apply && !apply.classList.contains("applied")) {
      apply.textContent = "Sending...";
      setTimeout(() => {
        apply.classList.add("applied");
        apply.innerHTML = '<i class="ph-bold ph-check"></i> Applied';
      }, 700);
    }

    if (e.target.closest(".app-icon-btn")) phone.querySelector(".app-badge")?.classList.add("cleared");

    const tab = e.target.closest(".app-tabs button");
    if (tab) {
      phone.querySelectorAll(".app-tabs button").forEach((b) => {
        const active = b === tab;
        b.classList.toggle("active", active);
        const icon = b.querySelector("i");
        icon.classList.toggle("ph-fill", active);
        icon.classList.toggle("ph", !active);
      });
      // Each tab jumps to its matching part of the home feed
      const targets = { Home: 0, Matches: ".app-match", Coach: ".app-coach", Profile: ".app-progress" };
      const target = targets[tab.textContent.trim()];
      const el = typeof target === "string" ? appScroll.querySelector(target) : null;
      appScroll.scrollTo({ top: el ? el.offsetTop - 64 : 0 });
    }
  });

  // Progress ring fills up when the phone scrolls into view
  const ring = phone.querySelector(".ring");
  const goal = Number(ring.style.getPropertyValue("--p")) || 72;
  ring.style.setProperty("--p", reduceMotion ? goal : 0);
  ring.querySelector("span").textContent = reduceMotion ? `${goal}%` : "0%";
  const ringObs = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting || reduceMotion) return;
    ringObs.disconnect();
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / 1400, 1);
      const val = Math.round(goal * (1 - Math.pow(1 - t, 3)));
      ring.style.setProperty("--p", val);
      ring.querySelector("span").textContent = `${val}%`;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { threshold: 0.4 });
  ringObs.observe(phone);
}
