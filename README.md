# Planner — Cefalo

A calm, themeable planner. Pure HTML + CSS + vanilla JS — no build step, no framework, no backend.

> Live demo: deploy in one click to Vercel (see below).

## Run locally

```bash
python3 -m http.server 5173
# visit http://localhost:5173
```

Or just open `index.html` in any modern browser.

## What's in the box

- **Top app bar** — brand · `Today` / `Goals` tabs · bell · tweaks · avatar
- **Day header** — greeting (auto morning/afternoon/evening) · date · day‑progress ring · prev/next day
- **Left rail** — mini calendar with task dots and selectable days · autosaving Notes pad
- **To‑do card** — filter pills (All / Open / Done) · tasks with duration + category pills · expandable subtasks · inline rename · "Add a task" rounded input
- **Tweaks panel** — 5 accents, dark mode, 3 heading fonts (Inter / Newsreader / JetBrains Mono), 3 densities, 3 corner radii — all persisted
- **Responsive** — calendar + notes stack under the to‑do card on tablet/mobile

Keyboard: `N` focus new‑task input · `D` toggle dark · `Esc` close panels.

## Stack

- HTML + CSS + ES modules
- Icons: [Lucide](https://lucide.dev) via CDN
- Fonts: Inter (rsms.me) · Newsreader & JetBrains Mono (Google Fonts)
- Persistence: `localStorage` (keys: `cefalo.planner.v3`, `cefalo.planner.tweaks.v1`, `cefalo.planner.notes.v1`)

## File map

```
planner/
├── index.html         ← app shell (appbar + page grid + tweaks panel)
├── app.js             ← state, render, persistence, events
├── styles/
│   ├── tokens.css     ← themeable design tokens (accent / dark / density / radius / font)
│   └── app.css        ← layout + components + responsive
├── vercel.json        ← static deploy config
└── README.md
```

## Deploy to Vercel

The repo is a static site, so Vercel needs no build step.

### One‑click (dashboard)

1. Push this repo to GitHub (instructions below).
2. Go to <https://vercel.com/new> and import the repo.
3. Framework Preset: **Other** · Build Command: *empty* · Output Directory: *empty* (`vercel.json` handles it).
4. Click **Deploy**.

### CLI

```bash
npm i -g vercel
vercel            # first run links the project
vercel --prod     # ship to production
```
