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
- **A simple checklist.** Each day shows **X of Y done** — every task counts the same. A number or time
  task counts as done once its target is reached (partial progress is shown but doesn't check it off).
  Excused tasks and skipped days are left out; History and Stats show how much you got done and how
  consistent each task is.
- **Daily schedule.** The Schedule tab is a calendar for the day (hours down the side). Tap a time or
  **+ Add** to place one of your tasks — or anything else, like "Dentist" — with a start time and length;
  tasks can keep their slot every day they're due. Tap a block to move it, change it or check it off.
- **Categories like playlists.** The Goals tab shows your categories as cards (e.g. 📚 Reading) or all
  goals in one list. Open a category to see its goals, add a new goal there, or move existing goals in.
  On Today, categories start folded with their progress (e.g. "Health · 2 of 4 done") — tap to open.
- **Schedules.** Every day, certain days of the week (e.g. only Mondays), **a number of days a week on
  any days** (e.g. Gym 3× a week: it shows every day until done 3 times that week, and skipped days never
  count against you), every few days, specific dates, or any time.
- **Either/or goals.** One task, several options — e.g. *Exercise* = Workout **or** Stretch. Tap it and
  pick which one you did; any option checks it off.
- **Consistency.** Stats ranks your goals from most to least consistent (how often each was met on its
  scheduled days), shows whether each is improving or slipping, and each goal's page shows its rank.
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
