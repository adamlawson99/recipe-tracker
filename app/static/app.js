"use strict";

const UNITS = ["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "fl oz", "oz", "lb", "clove", "pinch", "can", "slice", "piece"];
const app = document.getElementById("app");

// ---------- helpers ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = Array.isArray(j.detail)
        ? j.detail.map((d) => `${d.loc.slice(1).join(".")}: ${d.msg}`).join("; ")
        : j.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2800);
}

// 0.5 -> "½"-style text via plain "1/2"; falls back to up to 2 decimals.
function fmtQty(n) {
  if (n == null) return "";
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.01) return String(whole);
  const fracs = [[1 / 8, "1/8"], [1 / 4, "1/4"], [1 / 3, "1/3"], [3 / 8, "3/8"], [1 / 2, "1/2"],
                 [5 / 8, "5/8"], [2 / 3, "2/3"], [3 / 4, "3/4"], [7 / 8, "7/8"]];
  for (const [v, s] of fracs) {
    if (Math.abs(frac - v) < 0.01) return whole ? `${whole} ${s}` : s;
  }
  return String(Math.round(n * 100) / 100);
}

function chips(items, cls = "") {
  return items.map((i) => `<span class="chip ${cls}">${esc(i)}</span>`).join("");
}

function sourceLink(src) {
  if (!src) return "";
  return /^https?:\/\//i.test(src)
    ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(src)}</a>`
    : esc(src);
}

// ---------- list view ----------

const filters = { category: new Set(), tag: new Set(), q: "" };

async function listView() {
  app.innerHTML = `<div class="filters" id="filters"></div><div id="results"></div>`;
  const meta = await api("/api/meta");
  renderFilters(meta);
  await loadResults();
}

function renderFilters(meta) {
  const el = document.getElementById("filters");
  const catBtns = Object.keys(meta.categories).map((c) =>
    `<button class="chip ${filters.category.has(c) ? "active" : ""}" data-kind="category" data-v="${esc(c)}">${esc(c)}<small>${meta.categories[c] || 0}</small></button>`).join("");
  const tagBtns = Object.entries(meta.tags).map(([t, n]) =>
    `<button class="chip ${filters.tag.has(t) ? "active" : ""}" data-kind="tag" data-v="${esc(t)}">${esc(t)}<small>${n}</small></button>`).join("")
    || `<span class="muted">No tags yet</span>`;
  const any = filters.category.size || filters.tag.size || filters.q;
  el.innerHTML = `
    <div class="row"><input id="q" type="search" placeholder="Search title, ingredients, tags…" value="${esc(filters.q)}"></div>
    <div class="row"><b>Category</b><div class="chips">${catBtns}</div></div>
    <div class="row"><b>Tags</b><div class="chips">${tagBtns}</div></div>
    ${any ? `<div class="row"><button id="clear">Clear filters</button></div>` : ""}`;
  el.querySelectorAll("button.chip").forEach((b) => b.onclick = () => {
    const set = filters[b.dataset.kind];
    set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
    renderFilters(meta);
    loadResults();
  });
  const clear = el.querySelector("#clear");
  if (clear) clear.onclick = () => { filters.category.clear(); filters.tag.clear(); filters.q = ""; renderFilters(meta); loadResults(); };
  const q = el.querySelector("#q");
  let timer;
  q.oninput = () => { filters.q = q.value; clearTimeout(timer); timer = setTimeout(loadResults, 200); };
}

async function loadResults() {
  const p = new URLSearchParams();
  filters.category.forEach((c) => p.append("category", c));
  filters.tag.forEach((t) => p.append("tag", t));
  if (filters.q) p.set("q", filters.q);
  const recipes = await api("/api/recipes?" + p);
  const el = document.getElementById("results");
  if (!el) return;
  if (!recipes.length) {
    el.innerHTML = `<div class="empty">No recipes found. <a href="#/new">Create one</a> or <a href="#/import">import from JSON</a>.</div>`;
    return;
  }
  el.innerHTML = `<div class="grid">${recipes.map((r) => `
    <a class="card" href="#/recipe/${r.id}">
      <h3>${esc(r.title)}</h3>
      ${r.description ? `<p>${esc(r.description)}</p>` : ""}
      <div class="chips">${chips(r.categories, "active")}${chips(r.tags)}</div>
      <small class="muted">${r.servings ? `Serves ${fmtQty(r.servings)} · ` : ""}${r.ingredients.length} ingredients</small>
    </a>`).join("")}</div>`;
}

// ---------- detail view ----------

async function detailView(id) {
  const r = await api(`/api/recipes/${id}`);
  let servings = r.servings;

  const draw = () => {
    const factor = r.servings && servings ? servings / r.servings : 1;
    app.innerHTML = `
      <a href="#/">← All recipes</a>
      <h1>${esc(r.title)}</h1>
      <div class="chips">${chips(r.categories, "active")}${chips(r.tags)}</div>
      ${r.description ? `<p>${esc(r.description)}</p>` : ""}
      ${r.source ? `<p class="muted">Source: ${sourceLink(r.source)}</p>` : ""}
      <div class="toolbar">
        <a class="btn" href="#/edit/${r.id}">Edit</a>
        <button id="del" class="danger">Delete</button>
        <button id="print">Print</button>
      </div>
      <h2>Ingredients ${r.servings ? `<span class="servings">· Servings
        <button class="icon" id="dec">−</button>
        <input id="srv" type="number" min="0.25" step="any" value="${fmtQty(servings)}">
        <button class="icon" id="inc">+</button>
        ${servings !== r.servings ? `<button id="reset" class="icon">reset</button>` : ""}</span>` : ""}</h2>
      <ul class="ingredients">${r.ingredients.map((i) => `
        <li><span class="qty">${fmtQty(i.quantity != null ? i.quantity * factor : null)} ${esc(i.unit)}</span>
        ${esc(i.name)}${i.note ? `<span class="muted">, ${esc(i.note)}</span>` : ""}</li>`).join("")
        || `<li class="muted">None listed</li>`}</ul>
      <h2>Instructions</h2>
      <ol class="steps">${r.instructions.map((s) => `<li>${esc(s)}</li>`).join("") || `<li class="muted">None listed</li>`}</ol>`;

    app.querySelector("#del").onclick = async () => {
      if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
      await api(`/api/recipes/${r.id}`, { method: "DELETE" });
      toast("Recipe deleted");
      location.hash = "#/";
    };
    app.querySelector("#print").onclick = () => window.print();
    if (r.servings) {
      const set = (v) => { if (v > 0) { servings = v; draw(); } };
      app.querySelector("#dec").onclick = () => set(Math.max(1, servings - 1));
      app.querySelector("#inc").onclick = () => set(servings + 1);
      app.querySelector("#srv").onchange = (e) => set(parseFloat(e.target.value));
      const reset = app.querySelector("#reset");
      if (reset) reset.onclick = () => set(r.servings);
    }
  };
  draw();
}

// ---------- form view ----------

async function formView(id) {
  const [meta, existing] = await Promise.all([api("/api/meta"), id ? api(`/api/recipes/${id}`) : null]);
  const r = existing || { title: "", source: "", description: "", categories: [], tags: [], servings: 4,
                          instructions: [""], ingredients: [{ quantity: null, unit: "", name: "", note: "" }] };
  const allCats = [...new Set([...Object.keys(meta.categories), ...r.categories])].sort();
  const ings = r.ingredients.map((i) => ({ ...i }));
  if (!ings.length) ings.push({ quantity: null, unit: "", name: "", note: "" });
  const steps = r.instructions.length ? [...r.instructions] : [""];

  app.innerHTML = `
    <a href="${id ? `#/recipe/${id}` : "#/"}">← Back</a>
    <h1>${id ? "Edit recipe" : "New recipe"}</h1>
    <form id="f">
      <label for="title">Title *</label>
      <input id="title" required value="${esc(r.title)}">
      <div class="cols">
        <div><label for="source">Source (URL or book/person)</label><input id="source" value="${esc(r.source)}"></div>
        <div><label for="servings">Servings</label><input id="servings" type="number" min="0" step="any" value="${r.servings ?? ""}"></div>
      </div>
      <label for="description">Description</label>
      <textarea id="description" rows="2">${esc(r.description)}</textarea>
      <label>Categories</label>
      <div>${allCats.map((c) => `<label class="inline"><input type="checkbox" name="cat" value="${esc(c)}" ${r.categories.includes(c) ? "checked" : ""}>${esc(c)}</label>`).join("")}</div>
      <input id="newcats" placeholder="Add new categories (comma separated)" style="margin-top:6px">
      <label for="tags">Tags (comma separated)</label>
      <input id="tags" list="taglist" value="${esc(r.tags.join(", "))}" placeholder="high protein, pasta, fruit">
      <datalist id="taglist">${Object.keys(meta.tags).map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
      <label>Ingredients</label>
      <div id="ings"></div>
      <button type="button" id="add-ing">+ Add ingredient</button>
      <datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join("")}</datalist>
      <label>Instructions</label>
      <div id="steps"></div>
      <button type="button" id="add-step">+ Add step</button>
      <div class="form-actions">
        <button class="primary" type="submit">${id ? "Save changes" : "Create recipe"}</button>
        <a class="btn" href="${id ? `#/recipe/${id}` : "#/"}">Cancel</a>
      </div>
      <p class="warn" id="err"></p>
    </form>`;

  const ingsEl = app.querySelector("#ings");
  const stepsEl = app.querySelector("#steps");

  const drawIngs = () => {
    ingsEl.innerHTML = ings.map((i, n) => `
      <div class="ing-row">
        <input data-n="${n}" data-k="quantity" placeholder="Qty" inputmode="decimal" value="${i.quantity != null ? esc(fmtQty(i.quantity)) : ""}">
        <input data-n="${n}" data-k="unit" placeholder="Unit" list="units" value="${esc(i.unit)}">
        <input data-n="${n}" data-k="name" placeholder="Ingredient" value="${esc(i.name)}">
        <input class="note" data-n="${n}" data-k="note" placeholder="Note (chopped…)" value="${esc(i.note)}">
        <button type="button" class="icon danger" data-rm="${n}" title="Remove">✕</button>
      </div>`).join("");
    ingsEl.querySelectorAll("input").forEach((inp) => inp.oninput = () => { ings[inp.dataset.n][inp.dataset.k] = inp.value; });
    ingsEl.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { ings.splice(+b.dataset.rm, 1); drawIngs(); });
  };

  const drawSteps = () => {
    stepsEl.innerHTML = steps.map((s, n) => `
      <div class="step-row">
        <span class="n">${n + 1}.</span>
        <textarea rows="2" data-n="${n}">${esc(s)}</textarea>
        <div class="step-ctl">
          <button type="button" class="icon" data-up="${n}" title="Move up">↑</button>
          <button type="button" class="icon" data-down="${n}" title="Move down">↓</button>
          <button type="button" class="icon danger" data-rm="${n}" title="Remove">✕</button>
        </div>
      </div>`).join("");
    stepsEl.querySelectorAll("textarea").forEach((t) => t.oninput = () => { steps[t.dataset.n] = t.value; });
    const move = (n, d) => { const m = n + d; if (m < 0 || m >= steps.length) return; [steps[n], steps[m]] = [steps[m], steps[n]]; drawSteps(); };
    stepsEl.querySelectorAll("[data-up]").forEach((b) => b.onclick = () => move(+b.dataset.up, -1));
    stepsEl.querySelectorAll("[data-down]").forEach((b) => b.onclick = () => move(+b.dataset.down, 1));
    stepsEl.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { steps.splice(+b.dataset.rm, 1); drawSteps(); });
  };

  drawIngs();
  drawSteps();
  app.querySelector("#add-ing").onclick = () => { ings.push({ quantity: null, unit: "", name: "", note: "" }); drawIngs(); ingsEl.querySelector(".ing-row:last-child input").focus(); };
  app.querySelector("#add-step").onclick = () => { steps.push(""); drawSteps(); stepsEl.querySelector(".step-row:last-child textarea").focus(); };

  app.querySelector("#f").onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      title: app.querySelector("#title").value,
      source: app.querySelector("#source").value,
      description: app.querySelector("#description").value,
      servings: app.querySelector("#servings").value || null,
      categories: [...[...app.querySelectorAll("input[name=cat]:checked")].map((c) => c.value),
                   ...app.querySelector("#newcats").value.split(",")],
      tags: app.querySelector("#tags").value,
      instructions: steps.filter((s) => s.trim()),
      ingredients: ings.filter((i) => i.name.trim()).map((i) => ({ ...i, quantity: String(i.quantity ?? "").trim() || null })),
    };
    try {
      const saved = await api(id ? `/api/recipes/${id}` : "/api/recipes", { method: id ? "PUT" : "POST", body });
      toast(id ? "Saved" : "Recipe created");
      location.hash = `#/recipe/${saved.id}`;
    } catch (err) {
      app.querySelector("#err").textContent = err.message;
    }
  };
}

// ---------- import view ----------

async function importView() {
  const prompt = await fetch("/api/import-prompt").then((r) => r.text());
  app.innerHTML = `
    <a href="#/">← All recipes</a>
    <h1>Import from JSON</h1>
    <p class="muted">Paste JSON (one recipe, an array, or <code>{"recipes": [...]}</code>) or choose a .json file.
    Nothing is saved until you confirm the preview.</p>
    <input type="file" id="file" accept=".json,application/json">
    <label for="json">JSON</label>
    <textarea id="json" rows="12" spellcheck="false" placeholder='{"title": "Pancakes", "categories": ["breakfast"], ...}'></textarea>
    <div class="toolbar"><button class="primary" id="preview">Preview</button></div>
    <div id="out"></div>
    <h2>Using an AI agent?</h2>
    <p class="muted">Give your agent this prompt along with the recipe URL or video, then paste its output above.</p>
    <div class="toolbar"><button id="copy">Copy prompt</button></div>
    <pre class="code">${esc(prompt)}</pre>`;

  const ta = app.querySelector("#json");
  const out = app.querySelector("#out");
  app.querySelector("#file").onchange = async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); };
  app.querySelector("#copy").onclick = async () => { await navigator.clipboard.writeText(prompt); toast("Prompt copied"); };

  const parse = () => {
    let text = ta.value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); // tolerate code fences
    return JSON.parse(text);
  };

  app.querySelector("#preview").onclick = async () => {
    out.innerHTML = "";
    let data;
    try { data = parse(); } catch (err) { out.innerHTML = `<p class="warn">Invalid JSON: ${esc(err.message)}</p>`; return; }
    try {
      const res = await api("/api/import", { method: "POST", body: { data, dry_run: true } });
      out.innerHTML = `
        ${res.preview.map((p) => `<div class="card" style="margin-bottom:8px">
          <h3>${esc(p.title)}</h3>
          ${p.duplicate ? `<span class="warn">A recipe with this title already exists — importing will create a second copy.</span>` : ""}
          <div class="chips">${chips(p.recipe.categories, "active")}${chips(p.recipe.tags)}</div>
          <small class="muted">${p.recipe.ingredients.length} ingredients · ${p.recipe.instructions.length} steps${p.recipe.servings ? ` · serves ${fmtQty(p.recipe.servings)}` : ""}</small>
        </div>`).join("")}
        ${res.errors.map((e) => `<p class="warn">Recipe #${e.index + 1}${e.title ? ` (${esc(e.title)})` : ""} skipped: ${esc(e.error)}</p>`).join("")}
        ${res.preview.length ? `<button class="primary" id="confirm">Import ${res.preview.length} recipe${res.preview.length > 1 ? "s" : ""}</button>` : ""}`;
      const confirmBtn = out.querySelector("#confirm");
      if (confirmBtn) confirmBtn.onclick = async () => {
        const done = await api("/api/import", { method: "POST", body: { data, dry_run: false } });
        toast(`Imported ${done.created.length} recipe(s)`);
        location.hash = done.created.length === 1 ? `#/recipe/${done.created[0].id}` : "#/";
      };
    } catch (err) {
      out.innerHTML = `<p class="warn">${esc(err.message)}</p>`;
    }
  };
}

// ---------- router ----------

async function route() {
  const [, page, id] = location.hash.split("/");
  window.scrollTo(0, 0);
  try {
    if (page === "recipe") await detailView(id);
    else if (page === "new") await formView(null);
    else if (page === "edit") await formView(id);
    else if (page === "import") await importView();
    else await listView();
  } catch (err) {
    app.innerHTML = `<p class="warn">${esc(err.message)}</p><a href="#/">← Back</a>`;
  }
}

window.addEventListener("hashchange", route);
route();
