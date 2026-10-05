# My Day — your own daily goal system

A personal daily goal tracker where **you** design the system: what each goal is, when it applies,
how it's measured, what counts as done, and how much it matters. You log what actually happened;
the app scores each day exactly by your rules and keeps your history trustworthy.

It's an installable web app (PWA): no app store, works offline, and all data stays on your phone.

## Put it on your phone

### 1. Publish it (one time, ~2 minutes, free)

1. On GitHub, open this repository → **Settings** → **Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Under **Branch**, pick `claude/goal-tracking-app-design-bdxftm` (or `main` once this is merged) and folder **/ (root)** → **Save**.
4. Wait a minute, refresh the page. GitHub shows the address, which will be
   **https://yosefliberman770-source.github.io/Checklist-/**

### 2. Install it

**iPhone (must be Safari):**
1. Open the address above in **Safari**.
2. Tap the **Share** button (square with an arrow) → scroll → **Add to Home Screen** → **Add**.
3. Open **My Day** from your home screen. It runs full-screen, like a normal app.

**Android (Chrome):**
1. Open the address in **Chrome**.
2. Tap **Install** when prompted, or the **⋮** menu → **Add to Home screen / Install app**.

### 3. Keep your data safe

Your goals and entries are stored only on that phone. Use **Settings → Save backup** every so often and
save the file to Files / iCloud Drive / Google Drive. **Restore backup** brings everything back
(on a new phone, too). Don't clear Safari's website data for this site unless you have a backup.

### Optional daily reminder

**Settings → Reminder → Add to my calendar** adds one daily calendar event with an alert at the time
you pick. It works even when the app is closed; delete the event to stop it.

## How it works

- **Goals** are measured as *Done / not done*, a *number* (count, amount, distance, %, anything with
  your own unit), or *time*. Targets can be *at least*, *no more than*, *between*, *exactly*, or none.
- **Log what really happened.** Tap **✓ Done** to fill in the target, then adjust with − / + or tap the
  value to type the exact amount — under or over the target.
- **Parts.** Split a goal (e.g. Reading → Fiction 20, Nonfiction 10, History 12, Romance 6 pages).
  Choose whether *each part counts* (extra fiction doesn't cover missed history) or *only the total counts*.
- **Importance** (Low · Normal · High · Top, each twice the one before) is the only thing that sets how
  much a goal affects your score.
- **Day score** = weighted average of each scheduled goal's credit (0–100%). Unscheduled goals never
  count as failures; excused goals and skipped days are left out; a missing entry is a miss — never a 0
  value that accidentally "meets" a *no more than* goal. Tap the score for the exact breakdown.
- **History stays honest.** Changing what a goal means asks *from when* it applies. Past days keep the
  settings they had, so old scores never silently change.

## Development

No build step — plain HTML, CSS and JavaScript modules.

```sh
npm test          # scoring engine tests (Node 18+)
npx serve .       # run locally at http://localhost:3000
node tools/make-icons.mjs   # regenerate PNG icons from icons/icon.svg (needs Playwright)
```

When you change app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

| File | What it does |
|---|---|
| `js/engine.js` | Scoring, schedules, versions, period statistics (pure, tested) |
| `js/store.js` | On-device storage (IndexedDB), backup/CSV |
| `js/views/*.js` | Screens: Today, History, Stats, Goals, goal editor, Settings |
| `sw.js`, `manifest.webmanifest` | Offline support and home-screen install |
