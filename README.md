# Bella Paul · Portfolio

Plain HTML + CSS + JS. No build step, so it can be hosted anywhere as a static site.

## Edit it
Search `index.html` for `EDIT:` to find everything that still needs your info:

- **Your photo:** save it as `assets/me.jpg` (portrait, ~1000px tall). A placeholder shows until then.
- **About text, fun facts, email and social links.**
- **Creature Clash demo video:** record a clip (Cmd+Shift+5 on Mac → Record Selected Portion), convert to MP4,
  save as `assets/creature-clash-demo.mp4`. It autoplays in the laptop; the screenshot shows until then.
  The "Play the demo here" button runs the real game inside the laptop either way.
- **Degree Tracker:** paste your Figma prototype link, and (optionally) swap the HTML stand-in screens
  for your exported Figma frames (instructions in the comment above the phones).

## Files
- `index.html` content
- `styles.css` look and layout (colors and fonts are at the top in `:root`)
- `script.js` cursor, kinetic letters, tilt, scroll effects, the bubble physics pit, game embed
- `assets/` screenshots and your photo/video
- `projects/` live copies of BackIn and Creature Clash that the site links to and embeds.
  After changing either project, run `sh portfolio/sync-projects.sh` from the repo root to refresh them.

## Run it locally
From the repo root, the `bella-portfolio` entry in `.claude/launch.json` serves it at http://localhost:5176.

## Publish it
Any static host works. Point it at this `portfolio/` folder.

- **Netlify (easiest):** app.netlify.com/drop → drag the `portfolio` folder in. Add a custom domain under Domain settings.
- **Vercel:** New Project → import the repo → set Root Directory to `portfolio`, Framework Preset "Other".
- **GitHub Pages (what this site uses):**
  1. On github.com, create a new **public** repository named `<your-username>.github.io` (no README).
  2. On the empty repo page, click **uploading an existing file** and drag in everything *inside* this `portfolio/` folder (so `index.html` sits at the top level), then **Commit changes**.
  3. Go to **Settings → Pages**, set Source to **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
  4. After a minute or two the site is live at `https://<your-username>.github.io/`.
  To update it later, upload the changed files the same way (same names overwrite). Run `sh portfolio/sync-projects.sh` first if BackIn or Creature Clash changed.

Buy a domain (e.g. yourname.com) from Namecheap, Cloudflare or Porkbun and connect it in the host's settings.
