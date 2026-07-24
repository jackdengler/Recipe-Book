/* Recipe Book — a private recipe PWA.
 *
 * Data lives in the `recipes.json` file of the private
 * `jackdengler/private-data-storage` repo and is read/written through the
 * GitHub Contents API using a personal access token (PAT).
 *
 * The token is delivered two ways:
 *   1. Embedded in the Central Optimus launcher — the launcher posts
 *      { type: "co.pat", pat } to this iframe once it loads.
 *   2. Opened standalone — a small gate lets the owner paste a token,
 *      which is kept in sessionStorage for the tab's lifetime only.
 */

const STORE = {
  owner: "jackdengler",
  repo: "private-data-storage",
  path: "recipes.json",
};

const LAUNCHER_ORIGIN = "https://jackdengler.github.io";
const TOKEN_KEY = "rb.token"; // sessionStorage only
const CACHE_KEY = "rb.cache"; // localStorage read-cache
const PENDING_KEY = "rb.pending";

const state = {
  token: null,
  recipes: [],
  sha: null,
  pending: false,
  query: "",
  tag: null,
  loaded: false,
};

/* ------------------------------ DOM refs ------------------------------ */
const $ = (sel) => document.querySelector(sel);
const els = {
  list: $("#list"),
  state: $("#state"),
  search: $("#search"),
  tagbar: $("#tagbar"),
  sync: $("#sync"),
  addBtn: $("#add-btn"),
  detail: $("#detail"),
  detailBody: $("#detail-body"),
  detailBack: $("#detail-back"),
  detailEdit: $("#detail-edit"),
  detailDelete: $("#detail-delete"),
  editor: $("#editor"),
  editorForm: $("#editor-form"),
  editorTitle: $("#editor-title"),
  editorCancel: $("#editor-cancel"),
  editorSave: $("#editor-save"),
  gate: $("#gate"),
  gateInput: $("#gate-input"),
  gateSubmit: $("#gate-submit"),
  gateMsg: $("#gate-msg"),
  toast: $("#toast"),
};

let activeId = null; // recipe currently open in detail
let editingId = null; // recipe being edited (null = new)

/* ------------------------------ utils ------------------------------ */
function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowIso() {
  return new Date().toISOString();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function b64ToStr(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function strToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function toast(msg, isErr) {
  els.toast.textContent = msg;
  els.toast.className = "toast" + (isErr ? " err" : "");
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (els.toast.hidden = true), 2600);
}

function setSync(status) {
  // status: "" | "busy" | "ok" | "err"
  els.sync.className = "sync" + (status ? " is-" + status : "");
  if (status === "ok") setTimeout(() => setSync(""), 1500);
}

/* ------------------------------ token ------------------------------ */
function setToken(token) {
  if (!token) return;
  state.token = token;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch (_) {}
  els.gate.hidden = true;
  if (!state.loaded) init();
}

window.addEventListener("message", (e) => {
  if (e.origin !== LAUNCHER_ORIGIN) return;
  const d = e.data;
  if (d && d.type === "co.pat" && d.pat) setToken(d.pat);
});

/* ------------------------------ persistence cache ------------------------------ */
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      state.recipes = Array.isArray(c.recipes) ? c.recipes : [];
      state.sha = c.sha || null;
    }
    state.pending = localStorage.getItem(PENDING_KEY) === "1";
  } catch (_) {}
}

function saveCache() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ recipes: state.recipes, sha: state.sha })
    );
    localStorage.setItem(PENDING_KEY, state.pending ? "1" : "0");
  } catch (_) {}
}

/* ------------------------------ GitHub API ------------------------------ */
function apiUrl() {
  return `https://api.github.com/repos/${STORE.owner}/${STORE.repo}/contents/${STORE.path}`;
}

async function ghFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
}

/* Read recipes.json. Returns { recipes, sha } or throws.
 * A 404 means the file doesn't exist yet — treat as empty. */
async function fetchStore() {
  const res = await ghFetch(apiUrl() + "?ts=" + Date.now());
  if (res.status === 404) return { recipes: [], sha: null };
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("fetch failed: " + res.status);
  const json = await res.json();
  const text = b64ToStr(json.content || "");
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = {};
  }
  return { recipes: Array.isArray(data.recipes) ? data.recipes : [], sha: json.sha };
}

/* Write the full recipes array back to recipes.json. */
async function pushStore(message) {
  const body = JSON.stringify({ recipes: state.recipes }, null, 2) + "\n";
  const payload = {
    message: message || "Update recipes",
    content: strToB64(body),
  };
  if (state.sha) payload.sha = state.sha;

  let res = await ghFetch(apiUrl(), {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  // Stale sha (someone/something else wrote) — re-read and retry once.
  if (res.status === 409 || res.status === 422) {
    const fresh = await fetchStore();
    state.sha = fresh.sha;
    if (state.sha) payload.sha = state.sha;
    else delete payload.sha;
    res = await ghFetch(apiUrl(), { method: "PUT", body: JSON.stringify(payload) });
  }

  if (!res.ok) throw new Error("push failed: " + res.status);
  const json = await res.json();
  state.sha = json.content && json.content.sha ? json.content.sha : state.sha;
}

/* ------------------------------ mutations ------------------------------ */
/* Apply a change locally (never lose data), then try to sync. If the sync
 * fails we keep the change cached and mark it pending for a later retry. */
async function commit(message) {
  saveCache();
  render();
  if (!state.token) {
    state.pending = true;
    saveCache();
    return;
  }
  setSync("busy");
  try {
    await pushStore(message);
    state.pending = false;
    saveCache();
    setSync("ok");
  } catch (err) {
    state.pending = true;
    saveCache();
    setSync("err");
    toast("Saved on device — will sync when online", true);
  }
}

async function syncPending() {
  if (!state.pending || !state.token) return;
  setSync("busy");
  try {
    await pushStore("Sync recipes");
    state.pending = false;
    saveCache();
    setSync("ok");
  } catch (_) {
    setSync("err");
  }
}

/* ------------------------------ rendering ------------------------------ */
function allTags() {
  const set = new Set();
  state.recipes.forEach((r) => (r.tags || []).forEach((t) => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.recipes
    .filter((r) => {
      if (state.tag && !(r.tags || []).includes(state.tag)) return false;
      if (!q) return true;
      const hay = [
        r.title,
        r.description,
        (r.ingredients || []).join(" "),
        (r.tags || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function renderTags() {
  const tags = allTags();
  els.tagbar.innerHTML = "";
  if (!tags.length) {
    els.tagbar.hidden = true;
    return;
  }
  els.tagbar.hidden = false;
  const mk = (label, value) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.role = "tab";
    b.textContent = label;
    b.setAttribute("aria-selected", state.tag === value ? "true" : "false");
    b.addEventListener("click", () => {
      state.tag = state.tag === value ? null : value;
      render();
    });
    return b;
  };
  els.tagbar.appendChild(mk("All", null));
  tags.forEach((t) => els.tagbar.appendChild(mk(t, t)));
}

function render() {
  renderTags();
  const rows = filtered();
  els.list.innerHTML = "";

  if (!state.recipes.length) {
    showState("📖", "No recipes yet", "Tap + to add your first recipe.");
    return;
  }
  if (!rows.length) {
    showState("🔍", "No matches", "Try a different search or tag.");
    return;
  }
  els.state.hidden = true;

  for (const r of rows) {
    const card = document.createElement("button");
    card.className = "card";
    card.type = "button";
    const meta = [];
    if (r.servings) meta.push(`🍽 ${escapeHtml(r.servings)}`);
    if (r.prepTime) meta.push(`⏱ ${escapeHtml(r.prepTime)} prep`);
    if (r.cookTime) meta.push(`🔥 ${escapeHtml(r.cookTime)} cook`);
    card.innerHTML = `
      <h2 class="card__title">${escapeHtml(r.title || "Untitled")}</h2>
      ${r.description ? `<p class="card__desc">${escapeHtml(r.description)}</p>` : ""}
      ${meta.length ? `<div class="card__meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div>` : ""}
      ${
        (r.tags || []).length
          ? `<div class="card__tags">${r.tags
              .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
              .join("")}</div>`
          : ""
      }
    `;
    card.addEventListener("click", () => openDetail(r.id));
    els.list.appendChild(card);
  }
}

function showState(emoji, title, sub) {
  els.state.hidden = false;
  els.state.innerHTML = `
    <div class="state__emoji">${emoji}</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(sub)}</p>`;
}

/* ------------------------------ detail ------------------------------ */
function openDetail(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return;
  activeId = id;
  const meta = [];
  if (r.servings) meta.push(["Serves", r.servings]);
  if (r.prepTime) meta.push(["Prep", r.prepTime]);
  if (r.cookTime) meta.push(["Cook", r.cookTime]);
  els.detailBody.innerHTML = `
    <div class="detail">
      <h2>${escapeHtml(r.title || "Untitled")}</h2>
      ${r.description ? `<p class="detail__desc">${escapeHtml(r.description)}</p>` : ""}
      ${
        meta.length
          ? `<div class="detail__meta">${meta
              .map(([k, v]) => `<div class="pill"><b>${escapeHtml(v)}</b><span>${k}</span></div>`)
              .join("")}</div>`
          : ""
      }
      ${
        (r.ingredients || []).length
          ? `<h3>Ingredients</h3><ul class="ing-list">${r.ingredients
              .map((i) => `<li>${escapeHtml(i)}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${
        (r.steps || []).length
          ? `<h3>Method</h3><ol class="step-list">${r.steps
              .map((s) => `<li>${escapeHtml(s)}</li>`)
              .join("")}</ol>`
          : ""
      }
      ${
        (r.tags || []).length
          ? `<div class="card__tags" style="margin-top:24px">${r.tags
              .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
              .join("")}</div>`
          : ""
      }
    </div>`;
  els.detail.hidden = false;
  els.detailBody.scrollTop = 0;
}

function closeDetail() {
  els.detail.hidden = true;
  activeId = null;
}

/* ------------------------------ editor ------------------------------ */
function openEditor(id) {
  editingId = id || null;
  const r = id ? state.recipes.find((x) => x.id === id) : null;
  const f = els.editorForm;
  els.editorTitle.textContent = r ? "Edit recipe" : "New recipe";
  f.title.value = r ? r.title || "" : "";
  f.description.value = r ? r.description || "" : "";
  f.servings.value = r ? r.servings || "" : "";
  f.prepTime.value = r ? r.prepTime || "" : "";
  f.cookTime.value = r ? r.cookTime || "" : "";
  f.ingredients.value = r ? (r.ingredients || []).join("\n") : "";
  f.steps.value = r ? (r.steps || []).join("\n") : "";
  f.tags.value = r ? (r.tags || []).join(", ") : "";
  els.editor.hidden = false;
  els.editor.querySelector(".sheet__body").scrollTop = 0;
  setTimeout(() => f.title.focus(), 60);
}

function closeEditor() {
  els.editor.hidden = true;
  editingId = null;
}

function linesToList(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function saveEditor() {
  const f = els.editorForm;
  const title = f.title.value.trim();
  if (!title) {
    toast("Give the recipe a title", true);
    f.title.focus();
    return;
  }
  const data = {
    title,
    description: f.description.value.trim(),
    servings: f.servings.value.trim(),
    prepTime: f.prepTime.value.trim(),
    cookTime: f.cookTime.value.trim(),
    ingredients: linesToList(f.ingredients.value),
    steps: linesToList(f.steps.value),
    tags: f.tags.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    updatedAt: nowIso(),
  };

  if (editingId) {
    const i = state.recipes.findIndex((x) => x.id === editingId);
    if (i >= 0) state.recipes[i] = { ...state.recipes[i], ...data };
    commit(`Update recipe: ${title}`);
  } else {
    data.id = uid();
    data.createdAt = nowIso();
    state.recipes.push(data);
    commit(`Add recipe: ${title}`);
  }
  closeEditor();
  toast("Recipe saved");
}

function deleteActive() {
  const r = state.recipes.find((x) => x.id === activeId);
  if (!r) return;
  if (!confirm(`Delete “${r.title}”? This can't be undone.`)) return;
  state.recipes = state.recipes.filter((x) => x.id !== activeId);
  commit(`Delete recipe: ${r.title}`);
  closeDetail();
  toast("Recipe deleted");
}

/* ------------------------------ init ------------------------------ */
async function init() {
  if (state.loaded) return;
  state.loaded = true;

  // Paint whatever we have cached immediately.
  loadCache();
  render();

  if (!state.token) return;

  setSync("busy");
  try {
    const { recipes, sha } = await fetchStore();
    state.recipes = recipes;
    state.sha = sha;
    saveCache();
    render();
    setSync("");
    // Flush anything that was written while offline.
    if (state.pending) await syncPending();
  } catch (err) {
    if (String(err.message).includes("unauthorized")) {
      // Bad token — fall back to the gate.
      state.token = null;
      try {
        sessionStorage.removeItem(TOKEN_KEY);
      } catch (_) {}
      showGate("That token was rejected. Paste a valid GitHub token.");
    } else {
      // Network issue — cached data is already on screen.
      setSync("err");
    }
  }
}

function showGate(msg) {
  if (msg) els.gateMsg.textContent = msg;
  els.gate.hidden = false;
  state.loaded = false;
  setTimeout(() => els.gateInput.focus(), 60);
}

/* ------------------------------ wiring ------------------------------ */
els.addBtn.addEventListener("click", () => openEditor(null));
els.detailBack.addEventListener("click", closeDetail);
els.detailEdit.addEventListener("click", () => {
  const id = activeId;
  closeDetail();
  openEditor(id);
});
els.detailDelete.addEventListener("click", deleteActive);
els.editorCancel.addEventListener("click", closeEditor);
els.editorSave.addEventListener("click", saveEditor);
els.search.addEventListener("input", (e) => {
  state.query = e.target.value;
  render();
});
els.gateSubmit.addEventListener("click", () => {
  const t = els.gateInput.value.trim();
  if (t) setToken(t);
});
els.gateInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.gateSubmit.click();
});
window.addEventListener("online", syncPending);

// Hardware/gesture back closes the top-most sheet first.
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.editor.hidden) closeEditor();
  else if (!els.detail.hidden) closeDetail();
});

/* ------------------------------ boot ------------------------------ */
(function boot() {
  // Register the service worker for offline support.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  loadCache();
  render();

  const cached = (() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch (_) {
      return null;
    }
  })();

  if (cached) {
    state.token = cached;
    init();
    return;
  }

  const embedded = window.parent && window.parent !== window;
  if (embedded) {
    // Wait briefly for the launcher's PAT handshake; if it never arrives,
    // show the gate so the app is still usable when opened directly.
    setTimeout(() => {
      if (!state.token) showGate();
    }, 4000);
  } else {
    showGate();
  }
})();
