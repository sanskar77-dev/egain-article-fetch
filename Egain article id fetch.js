/**
 * eGain Knowledge Hub — Article ID Fetcher
 * ------------------------------------------------------------
 * Pulls Article ID, Title, Author, and Last-Modified date for articles
 * in the eGain AI Knowledge Hub, auto-paginating through all pages.
 *
 * IMPORTANT: clicking a folder in eGain only shows articles placed
 * DIRECTLY inside that folder — it does NOT automatically include
 * articles from its subfolders. So there are two ways to use this:
 *
 *   egainFetch.fetchCurrentFolder()
 *     Grabs only the articles in whichever single folder is currently
 *     open (auto-paginates through that folder's own pages).
 *
 *   egainFetch.fetchFolderTree("Exact Folder Name")
 *     Give it the exact name of a folder as it appears in the tree
 *     (e.g. "BankAI", "UK Concierge"), and it will automatically expand
 *     and visit every subfolder underneath it, collecting articles from
 *     all of them — this is the one to use when a folder has other
 *     folders nested inside it and you want everything in that branch.
 *     Each row is tagged with the specific subfolder it came from.
 *
 * HOW TO USE
 * 1. Open the eGain AI Knowledge Hub (any folder — doesn't matter which,
 *    as long as the folder tree on the left is visible).
 * 2. Open Chrome DevTools (F12 or Cmd+Opt+I / Ctrl+Shift+I) → Console tab.
 * 3. Paste this entire script and press Enter. You'll see a ready message.
 * 4. Run ONE of:
 *      egainFetch.fetchCurrentFolder()
 *      egainFetch.fetchFolderTree("Exact Folder Name")
 *    Wait for it to finish (it pages/expands automatically; a whole tree
 *    with many subfolders can take a little while — it visits each one).
 * 5. Repeat step 4 for as many other folders/branches as you want —
 *    results accumulate across runs (duplicates are skipped automatically).
 * 6. When done, run:   egainFetch.exportCSV()
 *    This downloads a CSV with everything you've collected so far.
 *
 * Other commands:
 *   egainFetch.showCollected()  -> preview what's collected so far (table)
 *   egainFetch.clearCollected() -> wipe collected data and start fresh
 *
 * Data is kept in this browser tab's sessionStorage, so it survives
 * clicking between folders but is cleared if you close the tab.
 */
(function () {
  const STORAGE_KEY = 'egain_article_export_v1';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- article list (right-hand panel) helpers ----------

  function extractArticlePage() {
    const rows = document.querySelectorAll('.article_list_css table tbody tr');
    return Array.from(rows).map((row) => ({
      id: row.querySelector('.list-states-row .list-id-name-cell span')?.textContent.trim() || '',
      title: row.querySelector('.article-name')?.textContent.trim() || '',
      author: row.querySelector('.list-description-row .list-id-name-cell span')?.textContent.trim() || '',
      date: row.querySelector('.list-time-cell')?.textContent.trim() || '',
    }));
  }

  function getTotalPages() {
    const wrap = document.querySelector('.pagination-input-wrap');
    if (!wrap) return 1;
    const m = wrap.textContent.match(/of\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  }

  function getSelectedFolderName() {
    const el = document.querySelector('.selected-folder');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : (document.title || 'Unknown Folder');
  }

  function getCurrentFolderId() {
    const m = location.href.match(/folder\/(\d+)/);
    return m ? m[1] : '';
  }

  // Reads "total pages" repeatedly until it stops changing, instead of trusting
  // a single read right after navigating into a folder. Without this, a folder
  // visited mid tree-walk can get read before eGain finishes updating the
  // pagination UI for real (Circular Programme lost 21 articles this way —
  // getTotalPages() returned 1 instead of 2 because it was read too early).
  async function getStableTotalPages(maxWaitMs = 3000, intervalMs = 250) {
    let prev = null;
    let stableCount = 0;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const current = getTotalPages();
      if (current === prev) {
        stableCount++;
        if (stableCount >= 2) return current;
      } else {
        stableCount = 0;
      }
      prev = current;
      await sleep(intervalMs);
    }
    return prev;
  }

  // Waits until the pagination box actually shows `expected` as the current
  // page, instead of trusting a fixed sleep after clicking "next". Without
  // this, if eGain takes longer than the fixed wait to swap in the new
  // page's rows, the script re-extracts the SAME page a second time (the
  // page number never having advanced yet) — which shows up later as
  // "found" rows that get silently dropped as duplicates when merged into
  // storage, while the genuinely next page's articles are skipped entirely
  // since the loop still only runs a fixed number of times.
  async function waitForPageNumber(expected, maxWaitMs = 3000, intervalMs = 150) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const pageInput = document.querySelector('.pagination-input-wrap input');
      if (pageInput && pageInput.value === String(expected)) return true;
      await sleep(intervalMs);
    }
    return false;
  }

  // Extracts every article on the CURRENTLY OPEN folder, paging through all pages.
  async function extractAllPagesForCurrentFolder(folderLabel) {
    if (!document.querySelector('.article_list_css')) return [];

    const firstPageBtn = document.querySelectorAll('.pagination.position-relative a.page-item')[0];
    const pageInput = document.querySelector('.pagination-input-wrap input');
    if (firstPageBtn && pageInput && pageInput.value !== '1') {
      firstPageBtn.click();
      await waitForPageNumber(1);
      await sleep(400);
    }

    const folderId = getCurrentFolderId();
    let all = [];
    const total = await getStableTotalPages();
    for (let p = 1; p <= total; p++) {
      await sleep(350);
      extractArticlePage().forEach((a) => all.push(Object.assign({}, a, { folder: folderLabel, folderId })));
      if (p < total) {
        const buttons = document.querySelectorAll('.pagination.position-relative a.page-item');
        const nextBtn = buttons[2]; // 0:first 1:prev 2:next 3:last
        if (nextBtn) nextBtn.click();
        const advanced = await waitForPageNumber(p + 1);
        if (!advanced) {
          console.warn(`[eGain fetch] Page indicator never reached ${p + 1} for "${folderLabel}" — extracting anyway, but double-check this folder's count.`);
        }
        await sleep(400);
      }
    }
    return all;
  }

  function mergeIntoStorage(all) {
    const dedupeKey = (a) => (a.folderId || a.folder) + '::' + a.id;
    const existing = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    const seen = new Set(existing.map(dedupeKey));
    const merged = existing.slice();
    let added = 0;
    all.forEach((a) => {
      const key = dedupeKey(a);
      if (!seen.has(key)) {
        merged.push(a);
        seen.add(key);
        added++;
      }
    });
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return { added, totalCollected: merged.length };
  }

  // ---------- single-folder fetch ----------

  async function fetchCurrentFolder() {
    const folderName = getSelectedFolderName();
    if (!document.querySelector('.article_list_css')) {
      console.warn('[eGain fetch] No article list found on this page. Make sure a KB folder is open.');
      return null;
    }
    const all = await extractAllPagesForCurrentFolder(folderName);
    const { added, totalCollected } = mergeIntoStorage(all);
    console.log(
      `[eGain fetch] Folder "${folderName}": found ${all.length} article(s), ${added} new. ` +
        `Total collected so far: ${totalCollected}. Run exportCSV() when done.`
    );
    return { folder: folderName, found: all.length, added, totalCollected };
  }

  // ---------- folder-tree walk (root + every subfolder) ----------

  function getTreeRows() {
    return Array.from(document.querySelectorAll('tbody tr'));
  }
  function getRowLevel(row) {
    const m = (row.className || '').match(/level-(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function getRowNameEl(row) {
    return row.querySelector('.selected-folder, .content');
  }
  function getRowName(row) {
    const el = getRowNameEl(row);
    return el ? el.textContent.trim() : '';
  }
  function getExpandIcon(row) {
    return row.querySelector('.expand-icon');
  }

  // Expands every collapsed subfolder under the root folder's row, in place.
  async function expandWholeSubtree(rootName) {
    let changed = true;
    let guard = 0;
    while (changed && guard < 100) {
      changed = false;
      guard++;
      let rows = getTreeRows();
      let rootIdx = rows.findIndex((r) => getRowName(r) === rootName);
      if (rootIdx === -1) return false;
      const rootLevel = getRowLevel(rows[rootIdx]);
      let i = rootIdx;
      while (i < rows.length) {
        const lvl = getRowLevel(rows[i]);
        if (i > rootIdx && lvl <= rootLevel) break;
        const icon = getExpandIcon(rows[i]);
        if (icon) {
          const next = rows[i + 1];
          const isExpanded = next && getRowLevel(next) > lvl;
          if (!isExpanded) {
            icon.click();
            await sleep(500);
            changed = true;
            rows = getTreeRows();
            rootIdx = rows.findIndex((r) => getRowName(r) === rootName);
            if (rootIdx === -1) return false;
          }
        }
        i++;
      }
    }
    return true;
  }

  // Returns one entry per ROW in the subtree, not one entry per unique name.
  // Each entry records which occurrence (0-based) of that name it is, in
  // document order. This matters because two DIFFERENT folders (different
  // folder IDs, different articles) can share the exact same display name
  // in different branches of the tree (e.g. "ZYN 3.0" under both a
  // "Newly Created" batch and an "Updated" batch). If we only tracked names,
  // visiting "ZYN 3.0" a second time would re-find and re-click the FIRST
  // row named "ZYN 3.0" again — silently skipping the real second folder
  // and undercounting. Tracking occurrence index lets us visit each row once.
  function collectSubtreeFolderEntries(rootName) {
    const rows = getTreeRows();
    const rootIdx = rows.findIndex((r) => getRowName(r) === rootName);
    if (rootIdx === -1) return [];
    const rootLevel = getRowLevel(rows[rootIdx]);
    const entries = [];
    const nameCounts = {};
    let i = rootIdx;
    while (i < rows.length) {
      const lvl = getRowLevel(rows[i]);
      if (i > rootIdx && lvl <= rootLevel) break;
      const name = getRowName(rows[i]);
      const occurrence = nameCounts[name] || 0;
      nameCounts[name] = occurrence + 1;
      entries.push({ name, occurrence });
      i++;
    }
    return entries;
  }

  /**
   * Expands and visits every subfolder under `rootFolderName` (exact text
   * as shown in the tree), extracting articles from each one (including
   * the root folder itself, in case it also has articles placed directly
   * in it). Slower than fetchCurrentFolder since it opens each subfolder
   * in turn — expect roughly 1-2 seconds per folder visited.
   */
  async function fetchFolderTree(rootFolderName) {
    const expanded = await expandWholeSubtree(rootFolderName);
    if (!expanded) {
      console.warn(`[eGain fetch] Couldn't find a folder named "${rootFolderName}" in the visible tree. ` +
        `Make sure it's scrolled into view and spelled exactly as shown.`);
      return null;
    }
    const folderEntries = collectSubtreeFolderEntries(rootFolderName);
    // How many times each name occurs in this subtree, so we can tell the
    // user which names are genuinely repeated (worth double-checking).
    const nameTotals = {};
    folderEntries.forEach((e) => { nameTotals[e.name] = (nameTotals[e.name] || 0) + 1; });
    console.log(`[eGain fetch] "${rootFolderName}" subtree has ${folderEntries.length} folder position(s): ${folderEntries.map((e) => e.name).join(', ')}`);
    const repeatedNames = Object.keys(nameTotals).filter((n) => nameTotals[n] > 1);
    if (repeatedNames.length) {
      console.log(`[eGain fetch] NOTE: these names appear more than once in the subtree — each occurrence is visited and reported separately below: ${repeatedNames.join(', ')}`);
    }

    let allArticles = [];
    const perFolderCounts = {};
    const perFolderIds = {};
    for (const entry of folderEntries) {
      const rows = getTreeRows();
      const matches = rows.filter((r) => getRowName(r) === entry.name);
      const row = matches[entry.occurrence];
      if (!row) continue;
      const label = nameTotals[entry.name] > 1 ? `${entry.name} (#${entry.occurrence + 1})` : entry.name;
      const nameEl = getRowNameEl(row);
      (nameEl || row).click();
      await sleep(1500);
      const articles = await extractAllPagesForCurrentFolder(label);
      perFolderCounts[label] = articles.length;
      perFolderIds[label] = articles[0] ? articles[0].folderId : getCurrentFolderId();
      allArticles = allArticles.concat(articles);
    }

    const { added, totalCollected } = mergeIntoStorage(allArticles);
    console.log(
      `[eGain fetch] "${rootFolderName}" tree: found ${allArticles.length} article(s) across ${folderEntries.length} folder position(s), ${added} new.\n` +
        `Per-folder counts: ${JSON.stringify(perFolderCounts)}\n` +
        `Per-folder IDs: ${JSON.stringify(perFolderIds)}\n` +
        `Total collected so far: ${totalCollected}. Run exportCSV() when done.`
    );
    return { root: rootFolderName, folders: Object.keys(perFolderCounts), found: allArticles.length, perFolderCounts, perFolderIds, added, totalCollected };
  }

  // ---------- shared: view / export / reset ----------

  function showCollected() {
    const data = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    console.table(data);
    console.log(`[eGain fetch] ${data.length} article(s) collected so far.`);
    return data.length;
  }

  function clearCollected() {
    sessionStorage.removeItem(STORAGE_KEY);
    console.log('[eGain fetch] Cleared collected data.');
  }

  function exportCSV(filename) {
    const data = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    if (!data.length) {
      console.warn('[eGain fetch] Nothing collected yet. Run egainFetch.fetchCurrentFolder() or fetchFolderTree() first.');
      return;
    }
    const esc = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
    const header = ['Article ID', 'Title', 'Author', 'Last Modified', 'Folder', 'Folder ID'];
    const rows = data.map((a) => [a.id, a.title, a.author, a.date, a.folder, a.folderId].map(esc).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `egain_article_ids_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    console.log(`[eGain fetch] Exported ${data.length} row(s) to CSV.`);
  }

  window.egainFetch = { fetchCurrentFolder, fetchFolderTree, showCollected, exportCSV, clearCollected };

  console.log(
    '[eGain fetch] Ready. Commands:\n' +
      '  egainFetch.fetchCurrentFolder()            -> grab articles from the single folder currently open\n' +
      '  egainFetch.fetchFolderTree("Folder Name")  -> grab articles from a folder AND every subfolder inside it\n' +
      '  egainFetch.showCollected()                 -> preview everything collected so far\n' +
      '  egainFetch.exportCSV()                     -> download all collected data as CSV\n' +
      '  egainFetch.clearCollected()                -> reset and start fresh'
  );
})();
