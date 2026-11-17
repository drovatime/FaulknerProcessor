# Carver

A retro word processor for fiction, set in a writing cabin on the Pacific Northwest coast.
It runs in any browser and installs like an app on your phone or desktop. It works offline and
syncs your writing between devices through a private GitHub repository that you own.

## What's inside

- **A binder, like Scrivener's.** It holds projects, folders, subfolders, scenes and notes. You can drag and drop to
  reorder, and on a phone you use the `⋯` menu (Move up/down, Move to…). Each new project starts with
  *Manuscript*, *Outline*, *Characters*, *Places*, *Notes* and *Research* folders. New characters and
  places come with a fill-in-the-blanks template.
- **The writing page.** It uses a typewriter typeface (Courier Prime, Special Elite, or Literata). It has typewriter
  scrolling, smart quotes, `--` → em dash, `...` → ellipsis, and `⁂` scene breaks.
- **The window.** It's an animated pixel-art view of the coast with sea stacks, a lighthouse, gulls, surf, drizzle and fog.
  The time of day follows your clock. On the desk, a pixel typewriter types along with you: keys press, the
  carriage moves, and the bell rings on Return. Optional synthesized typewriter sounds go with it.
- **Corkboard and Outline views** for any folder. You can edit synopses on the index cards, and set status, labels and word
  targets.
- **The inspector** shows the synopsis, status, label, word target, margin notes and **snapshots** (save a copy before a big
  revision and restore it later).
- **Daily word goal**, project word counts, focus mode (`Ctrl/⌘+Shift+F`), and search across the binder.
- **Compile & export with a live page preview.** Formats:
  - **Manuscript submission** (standard Shunn format for agents and editors) → Word or PDF
  - **KDP paperback** (5×8 to 6×9 trims; the gutter grows automatically with page count to meet KDP's minimums) → PDF or Word
  - **Paperback for IngramSpark and other printers** and **Large print** → PDF or Word
  - **eBook** for Kindle, Apple Books, Kobo and Google Play → EPUB
  - **Reading copy** for beta readers → PDF, Word, Markdown or text

  You can choose the typeface, size, line spacing, chapter heading style, scene-break marker, title and copyright pages,
  a dedication, and which chapters to include.
- **Uploads.** Drop files onto any folder, or use **Upload**. Word (`.docx`), Markdown, text and HTML files become editable
  notes, and a file with several headings can be split into one note per heading. PDFs and images are kept as attachments
  you can view in the app. They sync too, and you can copy a PDF's text into a note.
- **Backup.** You can download a full backup of your binder.
- **Three themes:** Driftwood (light), Foghorn (sepia) and Tidepool (dark).

## Installing it as an app

Once Carver is online (step 1 below), open its address on each device:

- **iPhone / iPad:** in Safari, tap **Share → Add to Home Screen**.
- **Android:** in Chrome, tap **⋮ → Install app**.
- **Mac / Windows:** in Chrome or Edge, click the install icon at the right end of the address bar. On a Mac you can also use Safari's
  **File → Add to Dock**.

It then opens full-screen with its own icon, and it works offline.

## 1. Put it online (once)

The app is a static site in `app/`. There's no build step.

**GitHub Pages:** merge to `main`. In the repo's *Settings → Pages*, set **Source: GitHub Actions**.
The included workflow publishes `app/` to `https://<you>.github.io/<repo>/`.
(GitHub Pages on a *private* repo needs a paid plan. This code repo holds no writing, so it can safely be public.
Your writing lives in a separate private "vault" repo. Netlify or Cloudflare Pages also work:
point them at the `app/` folder.)

## 2. Turn on sync (once)

1. Create a new **private** GitHub repo, e.g. `carver-vault`. Leave it empty.
2. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   for *Repository access*, choose *Only select repositories* → `carver-vault`. For *Repository permissions*, set
   **Contents: Read and write**. Choose a long expiration.
3. In Carver, open ⚙ **Settings → Sync across devices**. Enter your username, `carver-vault` and the token,
   then press **Connect**.
4. On your other devices, open the site and **Add to Home Screen / Install**. Then either enter the same three
   values, or use **Copy setup code** on the first device and **Paste setup code** on the new one.

### How sync behaves

- Every keystroke is saved on the device first (IndexedDB), so it works with no signal.
- Sync runs a few seconds after you stop typing, every minute while open, when you switch back to the app,
  and when you press `Ctrl/⌘+S`. The chip in the top bar shows the status.
- Each binder item is one JSON file in the vault (`items/<id>.json`). Each sync is a single commit, so your
  vault's Git history works as a full version history.
- If the same scene is edited on two devices before they sync, nothing is lost. The newer edit wins and the
  other version is kept next to it as "… (conflict copy)".

## Development

```bash
cd app && python3 -m http.server 8080   # then open http://localhost:8080
node tests/e2e.mjs                      # two-device sync test against a mocked GitHub API (needs Playwright)
```

Bundled libraries (Word import, zip/EPUB, PDF viewing) are in `app/vendor/`, with their licenses listed in `app/vendor/LICENSES.md`.
