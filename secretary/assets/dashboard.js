// Dashboard client. All user data is inserted with textContent / DOM nodes, never innerHTML.

const $ = (id) => document.getElementById(id);
const PRIORITIES = [["high", "最優先"], ["normal", "通常"], ["low", "余裕があれば"]];
let state = null;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `エラー (${response.status})`);
  return body;
}

function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, 3500);
}

function daysUntil(due) {
  const [y, m, d] = due.split("-").map(Number);
  const [ty, tm, td] = state.date.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
}

function dueBadge(due) {
  if (!due) return null;
  const left = daysUntil(due);
  const label = left < 0 ? `${-left}日超過` : left === 0 ? "今日まで" : left === 1 ? "明日まで" : `${due.slice(5).replace("-", "/")}まで`;
  return el("span", { class: `badge ${left < 0 ? "over" : left <= 3 ? "soon" : ""}` }, label);
}

function timeAgo(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

// ---------- render ----------

function renderTodos() {
  const items = state.todo.items;
  const done = items.filter((item) => item.status === "done").length;
  $("progress-bar").style.width = items.length ? `${Math.round((done / items.length) * 100)}%` : "0";
  $("progress-label").textContent = items.length ? `${items.length}件中 ${done}件完了` : "";
  const container = $("todos");
  container.replaceChildren();
  if (!items.length) {
    container.append(el("p", { class: "empty" }, "今日のTODOはまだありません。Claude Code で「TODOに〇〇を追加して」と話しかけてください。"));
    return;
  }
  for (const [key, heading] of PRIORITIES) {
    const group = items.filter((item) => item.priority === key);
    if (!group.length) continue;
    const list = el("div", { class: `group ${key}` }, el("h3", {}, heading));
    for (const item of group) {
      const id = `task-${item.line}`;
      const box = el("input", { type: "checkbox", id });
      box.checked = item.status === "done";
      box.addEventListener("change", () => toggle(item, box));
      list.append(el("div", { class: `task ${item.status === "done" ? "done" : ""}` }, box, el("label", { for: id }, item.text, dueBadge(item.due))));
    }
    container.append(list);
  }
}

async function toggle(item, box) {
  box.disabled = true;
  try {
    await api("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Secretary": "1" },
      body: JSON.stringify({ date: state.date, line: item.line, text: item.text, done: box.checked }),
    });
  } catch (error) {
    box.checked = !box.checked;
    toast(error.message);
  }
  await refresh();
}

function renderDeadlines() {
  const list = $("deadlines");
  list.replaceChildren();
  const items = [
    ...state.todo.items.filter((item) => item.status === "open" && item.due).map((item) => ({ text: item.text, due: item.due })),
    ...state.milestones.map((milestone) => ({ text: milestone.text, due: milestone.due, project: milestone.project, file: milestone.file })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  if (!items.length) {
    list.append(el("li", { class: "empty" }, "期限つきのTODO・マイルストーンはありません。"));
    return;
  }
  for (const item of items.slice(0, 10)) {
    const label = item.project ? el("button", { type: "button", class: "link", onclick: () => openFile(item.file) }, `${item.project}: `) : null;
    list.append(el("li", {}, label, item.text, dueBadge(item.due)));
  }
}

function renderWeek() {
  const max = Math.max(1, ...state.week.map((day) => day.done));
  const week = $("week");
  week.replaceChildren();
  for (const day of state.week) {
    const bar = el("div", { class: "bar", title: `${day.date}: ${day.done}件完了` });
    bar.style.height = `${Math.max(2, (day.done / max) * 80)}px`;
    week.append(el("div", { class: `day ${day.date === state.date ? "today" : ""}` }, el("span", {}, String(day.done)), bar, el("span", {}, day.weekday)));
  }
}

function renderMemos() {
  const list = $("memos");
  list.replaceChildren();
  if (!state.memos.length) {
    list.append(el("li", { class: "empty" }, "昨日と今日のメモはありません。"));
    return;
  }
  for (const memo of state.memos) {
    const when = memo.date === state.date ? memo.time : `昨日 ${memo.time}`;
    list.append(el("li", {}, el("span", { class: "meta" }, when), memo.text));
  }
}

function renderDecisions() {
  const list = $("decisions");
  list.replaceChildren();
  if (!state.decisions.length) {
    list.append(el("li", { class: "empty" }, "記録された判断はまだありません。"));
    return;
  }
  for (const decision of state.decisions) {
    list.append(el("li", {}, el("span", { class: "meta" }, decision.date.slice(5).replace("-", "/")), el("strong", {}, decision.title), decision.decision ? el("div", { class: "muted small" }, decision.decision) : null));
  }
}

function renderDepartments() {
  const box = $("departments");
  box.replaceChildren();
  if (!state.departments.length) {
    box.append(el("p", { class: "empty" }, "部署はまだありません。依頼が増えてきたら秘書が提案します。"));
    return;
  }
  for (const department of state.departments) {
    const info = `${department.role} ・ ${department.files}件${department.updated ? ` ・ ${timeAgo(department.updated)}` : ""}`;
    box.append(el("button", { class: "dept", type: "button", onclick: () => openDepartment(department.id) }, el("strong", {}, department.name), el("span", {}, info)));
  }
}

function formatMetric(value, unit) {
  if (value === null || value === undefined) return "—";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "yen") return `¥${Math.round(value).toLocaleString("ja-JP")}`;
  return Math.round(value).toLocaleString("ja-JP");
}

function deltaBadge(change) {
  if (!change) return null;
  const { type, value } = change;
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  const text = type === "pt" ? `${arrow}${Math.abs(value).toFixed(1)}pt` : `${arrow}${Math.abs(value).toFixed(1)}%`;
  return el("span", { class: `delta ${direction}`, title: "前週比" }, text);
}

function renderAnalytics() {
  const box = $("analytics");
  box.replaceChildren();
  if (!state.analytics.length) {
    box.append(el("p", { class: "empty" }, "まだ指標が定義されたアプリはありません。Claude Code で「バケツの設計図を作って」と頼むとここに表示されます。"));
    return;
  }
  for (const app of state.analytics) {
    const wrap = el("div", { class: "app-metrics" });
    const base = `departments/analytics/apps/${app.app}`;
    const title = el("h3", {}, app.name ?? app.app);
    const period = app.period ? `${app.period}（${app.range.start.slice(5).replace("-", "/")}〜${app.range.end.slice(5).replace("-", "/")}）・記録${app.weeks}週` : "";
    const links = el("div", { class: "app-links" },
      el("button", { type: "button", class: "link", onclick: () => openFile(`${base}/bucket.md`) }, "設計図"),
      el("button", { type: "button", class: "link", onclick: () => openFile(`${base}/experiments.md`) }, "改善ボード"));
    wrap.append(el("div", { class: "app-head" }, el("div", {}, title, el("span", { class: "muted small" }, period)), links));
    if (app.error) {
      wrap.append(el("p", { class: "empty" }, app.error));
      box.append(wrap);
      continue;
    }
    if (!app.period) {
      wrap.append(el("p", { class: "empty" }, `まだ数字がありません。Claude Code で「${app.name}のバケツ見て」と頼むと、数字を集めてここに表示します。`));
      if (app.experiments.length) wrap.append(el("p", { class: "insight" }, `実施中の改善: ${app.experiments.join(" ／ ")}`));
      box.append(wrap);
      continue;
    }

    const kpis = app.metrics.filter((metric) => metric.kpi && metric.value !== null);
    const tiles = el("div", { class: "tiles" });
    for (const metric of (kpis.length ? kpis : app.metrics.filter((m) => m.value !== null).slice(0, 6))) {
      tiles.append(el("div", { class: "tile" },
        el("div", { class: "label" }, metric.label),
        el("div", { class: "value" }, formatMetric(metric.value, metric.unit), deltaBadge(metric.change)),
        metric.belowTarget ? el("span", { class: "target-miss" }, `目標 ${formatMetric(metric.target, metric.unit)} に届いていない`) : null));
    }
    wrap.append(tiles);

    const leakKey = app.biggestLeak ? `${app.biggestLeak.funnel}:${app.biggestLeak.to}` : "";
    for (const funnel of app.funnels) {
      const top = funnel.steps.find((step) => step.value !== null)?.value || 0;
      const block = el("div", { class: "funnel" }, el("h4", {}, funnel.label));
      funnel.steps.forEach((step, index) => {
        const isLeak = leakKey === `${funnel.label}:${step.label}`;
        const fill = el("div", { class: "bar-fill" });
        fill.style.width = top && step.value !== null ? `${Math.max(2, (step.value / top) * 100)}%` : "0";
        const rate = index === 0 ? "" : step.conversion === null ? "—" : `通過 ${step.conversion.toFixed(1)}%${isLeak ? "（一番の穴）" : ""}`;
        block.append(el("div", { class: `step ${isLeak ? "leak" : ""}` },
          el("span", {}, `${step.label}  ${formatMetric(step.value, "count")}`),
          el("div", { class: "bar-track" }, fill),
          el("span", { class: "rate" }, rate)));
      });
      wrap.append(block);
    }
    if (app.biggestLeak) {
      wrap.append(el("p", { class: "insight" }, "一番の穴: ", el("strong", {}, `${app.biggestLeak.from} → ${app.biggestLeak.to}`), `（通過率 ${app.biggestLeak.conversion.toFixed(1)}%）`));
    }
    if (app.worsened.length) {
      wrap.append(el("p", { class: "insight" }, `先週より悪化: ${app.worsened.slice(0, 3).map((step) => `${step.from}→${step.to}（-${step.drop.toFixed(1)}pt）`).join("、")}`));
    }
    if (app.experiments.length) wrap.append(el("p", { class: "insight" }, `実施中の改善: ${app.experiments.join(" ／ ")}`));
    box.append(wrap);
  }
}

function renderRecent() {
  const list = $("recent");
  list.replaceChildren();
  for (const file of state.recent) {
    list.append(el("li", {}, el("button", { type: "button", onclick: () => openFile(file.path) }, file.title), el("span", { class: "meta" }, `${file.path} ・ ${timeAgo(file.mtime)}`)));
  }
}

function render() {
  $("today-label").textContent = `${state.date.replace(/-/g, "/")}（${state.weekday}）`;
  $("owner").textContent = `${state.owner.business} ／ 目標: ${state.owner.goals}`;
  $("brief-button").hidden = !state.brief;
  renderTodos();
  renderDeadlines();
  renderWeek();
  renderMemos();
  renderDecisions();
  renderDepartments();
  renderAnalytics();
  renderRecent();
}

async function refresh() {
  try {
    state = await api("/api/state");
    $("error").hidden = true;
    render();
  } catch (error) {
    $("error").textContent = `読み込めませんでした: ${error.message}`;
    $("error").hidden = false;
  }
}

// ---------- markdown viewer (small, safe subset) ----------

function inline(parent, text) {
  let last = 0;
  for (const match of text.matchAll(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    parent.append(text.slice(last, match.index));
    const token = match[0];
    parent.append(token.startsWith("**") ? el("strong", {}, token.slice(2, -2)) : el("code", {}, token.slice(1, -1)));
    last = match.index + token.length;
  }
  parent.append(text.slice(last));
}

function renderMarkdown(source, container) {
  container.replaceChildren();
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) lines.splice(0, end + 1);
  }
  let list = null;
  let paragraph = null;
  let block = null;
  let fenced = false;
  const reset = () => { list = null; paragraph = null; block = null; };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (fenced) { fenced = false; reset(); } else { reset(); fenced = true; block = el("pre"); container.append(block); }
      continue;
    }
    if (fenced) { block.append(`${line}\n`); continue; }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      reset();
      const node = el(`h${Math.min(heading[1].length + 1, 5)}`);
      inline(node, heading[2]);
      container.append(node);
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(?:\[( |x|X|>)\]\s+)?(.*)$/);
    if (item) {
      paragraph = null; block = null;
      if (!list) { list = el("ul"); container.append(list); }
      const node = el("li", { class: item[1] !== undefined ? "check" : "" });
      if (item[1] !== undefined) node.append(item[1] === " " ? "☐ " : item[1] === ">" ? "↪ " : "☑ ");
      inline(node, item[2]);
      list.append(node);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      list = null; paragraph = null;
      if (!block) { block = el("pre"); container.append(block); }
      block.append(`${line}\n`);
      continue;
    }
    if (!line.trim()) { reset(); continue; }
    if (/^-{3,}$/.test(line.trim())) { reset(); container.append(el("hr")); continue; }
    list = null; block = null;
    if (!paragraph) { paragraph = el("p"); container.append(paragraph); } else paragraph.append(el("br"));
    inline(paragraph, line);
  }
}

async function openFile(filePath) {
  try {
    const file = await api(`/api/file?path=${encodeURIComponent(filePath)}`);
    $("viewer-title").textContent = file.title;
    $("viewer-path").textContent = file.path;
    renderMarkdown(file.content, $("viewer-body"));
    $("search-results").hidden = true;
    if (!$("viewer").open) $("viewer").showModal();
  } catch (error) {
    toast(error.message);
  }
}

async function openDepartment(id) {
  try {
    const { department, files } = await api(`/api/department?id=${encodeURIComponent(id)}`);
    $("viewer-title").textContent = department.name;
    $("viewer-path").textContent = `${department.role}（departments/${department.id}）`;
    const body = $("viewer-body");
    body.replaceChildren();
    const list = el("ul", { class: "list files" });
    for (const file of files) {
      const label = file.rules ? "この部署のルール" : file.title;
      const meta = file.rules ? "RULES.md" : `${file.folder ? `${file.folder}/ ・ ` : ""}${timeAgo(file.mtime)}`;
      list.append(el("li", {}, el("button", { type: "button", onclick: () => openFile(file.path) }, label), el("span", { class: "meta" }, meta)));
    }
    if (files.length <= 1) body.append(el("p", { class: "empty" }, "まだ記録はありません。Claude Code で、この部署の仕事を頼むとここに増えていきます。"));
    body.append(list);
    if (!$("viewer").open) $("viewer").showModal();
  } catch (error) {
    toast(error.message);
  }
}

// ---------- search ----------

let searchTimer = null;
$("search").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  const query = event.target.value.trim();
  const box = $("search-results");
  if (!query) { box.hidden = true; return; }
  searchTimer = setTimeout(async () => {
    try {
      const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
      box.replaceChildren();
      if (!results.length) box.append(el("p", { class: "empty" }, "見つかりませんでした。"));
      for (const result of results) {
        box.append(el("button", { type: "button", onclick: () => openFile(result.path) }, el("strong", {}, result.title), el("span", { class: "hit" }, result.hits[0]?.text ?? result.path)));
      }
      box.hidden = false;
    } catch (error) {
      toast(error.message);
    }
  }, 250);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".search")) $("search-results").hidden = true;
});

$("viewer-close").addEventListener("click", () => $("viewer").close());
$("todo-open").addEventListener("click", () => state && openFile(state.todo.path));
$("brief-button").addEventListener("click", () => state?.brief && openFile(state.brief));

// ---------- live updates ----------

function connect() {
  const events = new EventSource("/api/events");
  events.addEventListener("open", () => { $("live").classList.add("on"); $("live").title = "接続中（自動更新）"; });
  events.addEventListener("error", () => { $("live").classList.remove("on"); $("live").title = "再接続しています"; });
  events.addEventListener("update", () => refresh());
}

refresh();
connect();
// Catch the date change at midnight even when no file changes.
setInterval(refresh, 5 * 60 * 1000);
