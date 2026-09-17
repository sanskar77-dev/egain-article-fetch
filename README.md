# eGain Article Fetch

A browser console script for pulling Article ID, Title, Author, and Last Modified date out of the **eGain AI Knowledge Hub**, including articles nested several folders deep — without needing eGain's internal API (which isn't accessible externally).

## Why this exists

Clicking a folder in eGain's Knowledge Hub only shows articles placed **directly** inside that folder — it does not automatically include articles from its subfolders. Manually clicking into every subfolder of a large tree (dozens or hundreds of folders) to note down article IDs is slow and error-prone. This script automates that walk.

## How to use it

1. Open the eGain AI Knowledge Hub in Chrome, on any folder — as long as the folder tree on the left is visible.
2. Open DevTools (`F12`, or `Cmd+Opt+I` / `Ctrl+Shift+I`) → **Console** tab.
3. Paste the entire contents of [`egain-article-id-fetch.js`](./egain-article-id-fetch.js) and press Enter. You'll see a "Ready" message with the available commands.
4. Run one of:

   ```js
   egainFetch.fetchCurrentFolder()
   ```
   Grabs only the articles in whichever single folder is currently open (auto-paginates through that folder's own pages).

   ```js
   await egainFetch.fetchFolderTree("Exact Folder Name")
   ```
   Give it the exact name of a folder as it appears in the tree (e.g. `"BankAI"`, `"[02] Releases 2026"`). It expands and visits every subfolder underneath automatically, collecting articles from each one. Use this when a folder has other folders nested inside it and you want everything in that branch. **Use `await`** so the console waits for the whole walk to finish before you run the next command.

5. Repeat step 4 for as many folders/branches as you want — results accumulate in the browser tab's `sessionStorage` across runs, and duplicates (same folder + same article ID) are automatically skipped.
6. When done, run:

   ```js
   egainFetch.exportCSV()
   ```
   Downloads a CSV of everything collected so far.

### Other commands

| Command | What it does |
|---|---|
| `egainFetch.showCollected()` | Prints a table preview of everything collected so far |
| `egainFetch.clearCollected()` | Wipes collected data so you can start fresh |

Data lives in the browser tab's `sessionStorage`, so it survives navigating between folders but is cleared if you close the tab.

## Output columns

`Article ID, Title, Author, Last Modified, Folder, Folder ID`

`Folder` is the display name the article was found under (with a `(#1)` / `(#2)` suffix if that name is genuinely reused by more than one distinct folder in the tree — see Gotchas below). `Folder ID` is eGain's internal numeric folder ID, useful for disambiguating folders that share a display name.

## Known gotchas (already handled by this script)

- **Parent folders don't aggregate subfolder content.** A folder with subfolders typically shows zero articles of its own — the real content lives in the leaf folders. `fetchFolderTree` visits every node in the subtree, not just the root, so this is handled automatically.
- **Same folder name can appear twice for different reasons.** eGain sometimes organizes releases into "Newly Created" / "Updated" batch folders, and the same physical folder can be linked from both (same folder ID both times — genuinely the same content). Separately, generic names like `"01 Product in scope"` or `"ZYN"` can be reused as template subfolder names under many different, genuinely distinct batches (different folder IDs, different content). The script visits every occurrence independently by tree position — not by re-searching for "a folder named X" — so both cases are handled correctly and each occurrence is labeled `(#1)`, `(#2)`, etc. when a name repeats.
- **Pagination timing.** Reading the "total pages" count or advancing to the next page too quickly (before eGain's UI finishes updating) can cause a page to be read too early, or the same page to be read twice. The script polls for the pagination UI to actually stabilize/advance before extracting, instead of trusting a fixed delay.

## Limitations

- This is DOM scraping, not an API integration — if eGain changes its UI structure (CSS classes, DOM layout), the selectors in this script may need updating.
- No eGain REST API path was found that works from outside the app itself (the internal API requires session/CSRF tokens that the SPA manages and rotates internally).
- Run time scales with the number of folders and articles — walking a branch with 70+ folders and 500+ articles can take a few minutes, since each folder visit and page turn has a short settle delay to stay reliable.
