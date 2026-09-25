const LS_KEY = "quiz_bank_stats_v1";
const LS_API = "quiz_deepseek_cfg_v1";
const LS_ANALYSIS = "quiz_ai_analysis_v1";
const LS_SEEN = "quiz_question_seen_v1";

/** 从未提交过答案的题目在热图中使用的中性灰 */
const HEAT_UNSEEN = "rgb(74, 84, 96)";

const $ = (id) => document.getElementById(id);

function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStats(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

function loadApiCfg() {
  try {
    return JSON.parse(localStorage.getItem(LS_API) || "{}");
  } catch {
    return {};
  }
}

function saveApiCfg(cfg) {
  localStorage.setItem(LS_API, JSON.stringify(cfg));
}

function loadAnalysisStore() {
  try {
    return JSON.parse(localStorage.getItem(LS_ANALYSIS) || "{}");
  } catch {
    return {};
  }
}

function getAnalysis(bankId, qid) {
  const id = String(qid);
  return loadAnalysisStore()[bankId]?.[id] || "";
}

function setAnalysis(bankId, qid, text) {
  const all = loadAnalysisStore();
  if (!all[bankId]) all[bankId] = {};
  all[bankId][String(qid)] = text;
  localStorage.setItem(LS_ANALYSIS, JSON.stringify(all));
}

function clearAnalysis(bankId, qid) {
  const all = loadAnalysisStore();
  if (!all[bankId]?.[String(qid)]) return;
  delete all[bankId][String(qid)];
  if (Object.keys(all[bankId]).length === 0) delete all[bankId];
  localStorage.setItem(LS_ANALYSIS, JSON.stringify(all));
}

/** 将 AI 返回的 Markdown 安全渲染为 HTML（依赖 index 中的 marked + DOMPurify） */
function renderMarkdownToElement(el, markdown) {
  const raw = String(markdown ?? "");
  el.className = "ai-text ai-md";
  if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
    try {
      const html = marked.parse(raw, { async: false });
      el.innerHTML = DOMPurify.sanitize(html);
      return;
    } catch (e) {
      console.warn("markdown render failed", e);
    }
  }
  el.textContent = raw;
}

function loadSeenStore() {
  try {
    return JSON.parse(localStorage.getItem(LS_SEEN) || "{}");
  } catch {
    return {};
  }
}

function isQuestionSeen(bankId, qid) {
  return !!loadSeenStore()[bankId]?.[String(qid)];
}

function markQuestionSeen(bankId, qid) {
  const all = loadSeenStore();
  if (!all[bankId]) all[bankId] = {};
  all[bankId][String(qid)] = 1;
  localStorage.setItem(LS_SEEN, JSON.stringify(all));
}

function maxWrongForBank(bankId) {
  const map = loadStats()[bankId] || {};
  const vals = Object.values(map).map((r) => r.wrong || 0);
  return Math.max(1, ...vals, 0);
}

/** 错题越多越偏红；0 错题为蓝。同一 maxWrong 下归一化。 */
function heatColor(wrongCount, maxWrong) {
  const w = wrongCount || 0;
  const t = Math.min(1, w / maxWrong);
  const r = Math.round(32 + t * 210);
  const g = Math.round(105 - t * 55);
  const b = Math.round(215 - t * 175);
  return `rgb(${r},${g},${b})`;
}

let banks = [];
let questions = [];
let queue = [];
let idx = 0;
let pickOne = null;
let pickMulti = new Set();
let mode = "all";
let currentNavPage = "home";
let activeCategory = "";

function bumpWrong(bankId, qid) {
  const s = loadStats();
  if (!s[bankId]) s[bankId] = {};
  const cur = s[bankId][qid] || { wrong: 0, lastAt: 0 };
  cur.wrong += 1;
  cur.lastAt = Date.now();
  s[bankId][qid] = cur;
  saveStats(s);
}

function clearWrong(bankId, qid) {
  clearAnalysis(bankId, qid);
  const s = loadStats();
  if (s[bankId] && s[bankId][qid]) {
    delete s[bankId][qid];
    if (Object.keys(s[bankId]).length === 0) delete s[bankId];
    saveStats(s);
  }
}

function userAnswerString(q) {
  if (q.kind === "multi") {
    return [...pickMulti].sort().join("");
  }
  return pickOne || "";
}

function canSubmit(q) {
  if (q.kind === "multi") return pickMulti.size > 0;
  return !!pickOne;
}

function isCorrect(q) {
  const u = userAnswerString(q);
  if (q.kind === "multi") return u === q.answer;
  return u === q.answer;
}

function formatAnswerForUi(q) {
  if (q.kind === "judge") return q.answer === "A" ? "对" : "错";
  if (q.kind === "multi") return [...q.answer].join("、");
  return q.answer;
}

function buildMemoryTip(q) {
  const stem = q.stem || "";
  const optionCount = Object.keys(q.options || {}).length;
  const answerCount = (q.answer || "").length;
  const inclusiveWords = [
    "包括",
    "包含",
    "属于",
    "体现",
    "表现",
    "内容",
    "特征",
    "原则",
    "要求",
    "途径",
    "措施",
    "任务",
    "职责",
    "权利",
    "义务",
    "条件",
    "因素",
    "作用",
  ];
  const negativeWords = ["不包括", "不属于", "不是", "不正确", "错误", "无关", "除外"];
  const hasInclusive = inclusiveWords.some((w) => stem.includes(w));
  const hasNegative = negativeWords.some((w) => stem.includes(w));

  if (q.kind === "multi") {
    if (optionCount > 0 && answerCount === optionCount) {
      const lead = hasInclusive
        ? "这题是“包容型问法”：看到“包括/属于/体现/内容/原则/措施/职责/权利义务”等词，且选项都在同一正向范畴里，本题可按全选记。"
        : "这题正确答案是全选，可以把四个选项合成一组概念背，不要拆成孤立答案。";
      return `${lead} 做同类多选时先找“明显异类、绝对化、否定项”，找不到再大胆考虑全选。`;
    }
    if (hasNegative) {
      return "这题干带否定词，先圈出“不/错误/除外”等关键词，再反向排除；这类题最容易把正向知识当成答案。";
    }
    if (answerCount === optionCount - 1) {
      return "这题属于“排除一项”型多选：多数选项同属一个知识簇，重点记那个不入群的干扰项。";
    }
    if (hasInclusive) {
      return "这题是开放列举式问法，先按分类回忆一整组，再用选项查漏；不要只凭最熟的一个词就停手。";
    }
    return "多选题先判断题干是“列举同类”还是“辨析差异”：同类题防漏选，辨析题防把相近概念混进来。";
  }
  if (q.kind === "judge") {
    return hasNegative
      ? "判断题遇到否定表达要慢半拍：先把句子改写成正向命题，再判断它是否成立。"
      : "判断题重点抓绝对化词和因果关系；理论题里“都、必然、完全、只要”通常要格外谨慎。";
  }
  if (hasNegative) {
    return "单选否定题先找题干里的“不/错误/除外”，再从三个正确表述里反衬出那个异类项。";
  }
  return q.category
    ? `这题归在「${q.category}」，复习时建议和同分类题连做，优先记概念边界和常见关键词。`
    : "";
}

async function fetchBanks() {
  const r = await fetch("/api/banks");
  if (!r.ok) throw new Error("无法加载题库列表");
  banks = await r.json();
  const fill = (sel) => {
    sel.innerHTML = "";
    for (const b of banks) {
      const o = document.createElement("option");
      o.value = b.id;
      o.textContent = `${b.name}（${b.count} 题）`;
      sel.appendChild(o);
    }
  };
  fill($("bankSelect"));
  fill($("overviewBankSelect"));
  fill($("wrongBankSelect"));
}

async function loadQuestions(bankId) {
  const r = await fetch(`/api/banks/${encodeURIComponent(bankId)}/questions`);
  if (!r.ok) throw new Error("无法加载题目");
  questions = await r.json();
  if ($("bankSelect") && bankId === $("bankSelect").value) {
    renderCategoryControls();
  }
}

function qById(id) {
  return questions.find((q) => String(q.id) === String(id));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function readSessionLimit() {
  const raw = $("sessionLimit").value.trim();
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function categoryCounts() {
  const counts = new Map();
  for (const q of questions) {
    const c = q.category || "其他综合题";
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return counts;
}

function renderCategoryControls() {
  const sel = $("categorySelect");
  const summary = $("categorySummary");
  if (!sel || !summary) return;
  const previous = sel.value;
  const counts = [...categoryCounts().entries()].sort((a, b) => b[1] - a[1]);
  sel.innerHTML = "";
  for (const [name, count] of counts) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = `${name}（${count} 题）`;
    sel.appendChild(o);
  }
  if (previous && counts.some(([name]) => name === previous)) {
    sel.value = previous;
  }
  summary.innerHTML = "";
  for (const [name, count] of counts) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "category-chip";
    chip.textContent = `${name} ${count}`;
    chip.addEventListener("click", () => {
      sel.value = name;
    });
    summary.appendChild(chip);
  }
}

function buildQueue(bankId) {
  const s = loadStats();
  const wrongIds = new Set(Object.keys(s[bankId] || {}));
  if (mode === "wrong") {
    queue = questions.filter((q) => wrongIds.has(String(q.id)));
    if (queue.length === 0) {
      alert("该题库暂无错题记录。");
      return false;
    }
  } else if (mode === "category") {
    activeCategory = $("categorySelect").value;
    queue = questions.filter((q) => (q.category || "其他综合题") === activeCategory);
    if (queue.length === 0) {
      alert("该分类下暂无题目。");
      return false;
    }
  } else {
    queue = [...questions];
  }
  shuffleInPlace(queue);
  const cap = readSessionLimit();
  if (cap > 0 && queue.length > cap) {
    queue = queue.slice(0, cap);
  }
  idx = 0;
  return true;
}

function applyPageVisibility() {
  const quizOn = !$("quiz").classList.contains("hidden");
  $("mainNav").classList.toggle("hidden", quizOn);
  document.querySelectorAll(".page").forEach((el) => el.classList.add("hidden"));
  if (!quizOn) {
    const page = $(`page-${currentNavPage}`);
    if (page) page.classList.remove("hidden");
  }
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === currentNavPage);
  });
}

function setNavPage(name) {
  currentNavPage = name;
  applyPageVisibility();
  if (name === "wrongbook") {
    $("wrongBankSelect").value = $("bankSelect").value;
    loadQuestions($("wrongBankSelect").value)
      .then(() => {
        renderWrongList();
        renderWrongHeatStrip();
      })
      .catch(console.error);
  }
  if (name === "home") {
    $("overviewBankSelect").value = $("bankSelect").value;
    loadQuestions($("overviewBankSelect").value)
      .then(() => renderHeatMatrix())
      .catch(console.error);
  }
}

function showSetup() {
  $("quiz").classList.add("hidden");
  applyPageVisibility();
  refreshHeatAfterStatsChange();
}

function showQuiz() {
  document.querySelectorAll(".page").forEach((el) => el.classList.add("hidden"));
  $("mainNav").classList.add("hidden");
  $("quiz").classList.remove("hidden");
}

function refreshHeatAfterStatsChange() {
  const ob = $("overviewBankSelect").value;
  const wb = $("wrongBankSelect").value;
  if (currentNavPage === "home" && ob) {
    loadQuestions(ob).then(() => renderHeatMatrix()).catch(console.error);
  }
  if (currentNavPage === "wrongbook" && wb) {
    loadQuestions(wb)
      .then(() => {
        renderWrongList();
        renderWrongHeatStrip();
      })
      .catch(console.error);
  }
}

function renderHeatMatrix() {
  const bankId = $("overviewBankSelect").value;
  const host = $("heatMatrix");
  if (!bankId || !questions.length) {
    host.innerHTML = "";
    return;
  }
  const map = loadStats()[bankId] || {};
  const maxW = maxWrongForBank(bankId);
  host.innerHTML = "";
  for (const q of questions) {
    const w = map[String(q.id)]?.wrong || 0;
    const seen = isQuestionSeen(bankId, q.id);
    const cell = document.createElement("div");
    cell.className = "heat-cell" + (seen ? "" : " heat-cell-unseen");
    cell.style.backgroundColor = seen ? heatColor(w, maxW) : HEAT_UNSEEN;
    const status = seen ? `已做过 · 错题 ${w} 次` : "尚未在本应用提交过答案";
    cell.title = `题号 ${q.id} · ${status} · ${q.type || ""}`;
    host.appendChild(cell);
  }
}

function renderWrongHeatStrip() {
  const bankId = $("wrongBankSelect").value;
  const strip = $("wrongHeatStrip");
  strip.innerHTML = "";
  const s = loadStats()[bankId] || {};
  const ids = Object.keys(s).sort((a, b) => (s[b].wrong || 0) - (s[a].wrong || 0));
  if (ids.length === 0) {
    strip.innerHTML = "";
    return;
  }
  const maxW = maxWrongForBank(bankId);
  for (const qid of ids) {
    const w = s[qid].wrong || 0;
    const cell = document.createElement("div");
    cell.className = "heat-strip-cell";
    cell.style.backgroundColor = heatColor(w, maxW);
    cell.title = `题号 ${qid} · 错题 ${w} 次`;
    strip.appendChild(cell);
  }
}

function syncSubmitState(q) {
  $("btnSubmit").disabled = !canSubmit(q);
}

function renderQuestion() {
  const bankId = $("bankSelect").value;
  const total = queue.length;
  const q = queue[idx];
  pickOne = null;
  pickMulti = new Set();
  syncSubmitState(q);
  $("btnNext").classList.add("hidden");
  $("feedback").classList.add("hidden");
  $("feedback").textContent = "";
  $("feedback").classList.remove("ok", "bad");
  const quizAi = $("quizAiShell");
  if (quizAi) {
    quizAi.classList.add("hidden");
    quizAi.innerHTML = "";
  }

  const pct = total ? Math.round((idx / total) * 100) : 0;
  $("progressBar").style.width = `${pct}%`;
  $("quizMeta").textContent = `${banks.find((b) => b.id === bankId)?.name || bankId} · ${
    idx + 1
  } / ${total}`;

  const category = q.category ? ` · ${q.category}` : "";
  $("qType").textContent = `${q.type || "题目"}${category}`;
  $("qStem").textContent = q.stem;
  const opts = $("qOpts");
  opts.innerHTML = "";
  const letters = Object.keys(q.options).sort();
  const multi = q.kind === "multi";
  for (const L of letters) {
    const text = q.options[L];
    if (!text) continue;
    const lab = document.createElement("label");
    lab.className = "opt";
    const inp = document.createElement("input");
    inp.type = multi ? "checkbox" : "radio";
    inp.name = multi ? `opt-${L}` : "opt";
    inp.value = L;
    inp.addEventListener("change", () => {
      if (multi) {
        if (inp.checked) pickMulti.add(L);
        else pickMulti.delete(L);
      } else {
        pickOne = L;
        opts.querySelectorAll(".opt").forEach((el) => el.classList.remove("selected"));
        lab.classList.add("selected");
      }
      syncSubmitState(q);
    });
    const span = document.createElement("span");
    span.textContent = `${L}. ${text}`;
    lab.appendChild(inp);
    lab.appendChild(span);
    opts.appendChild(lab);
  }
}

function afterSubmit() {
  $("btnSubmit").classList.add("hidden");
  $("btnNext").classList.remove("hidden");
}

function finishSession() {
  showSetup();
  $("btnSubmit").classList.remove("hidden");
  $("progressBar").style.width = "0%";
  $("wrongBankSelect").value = $("bankSelect").value;
  refreshHeatAfterStatsChange();
}

function renderWrongList() {
  const bankId = $("wrongBankSelect").value;
  const s = loadStats();
  const map = s[bankId] || {};
  const host = $("wrongList");
  host.innerHTML = "";
  const maxW = maxWrongForBank(bankId);
  const ids = Object.keys(map).sort((a, b) => (map[b].wrong || 0) - (map[a].wrong || 0));
  if (ids.length === 0) {
    host.textContent = "该题库暂无错题。";
    return;
  }
  for (const qid of ids) {
    const rec = map[qid];
    const w = rec.wrong || 0;
    const item = document.createElement("div");
    item.className = "wrong-item";
    item.style.setProperty("--heat", heatColor(w, maxW));
    const q = questions.length && qById(qid) ? qById(qid) : null;
    const stem = q ? q.stem : `题目 ID：${qid}（请重新打开该题库以显示全文）`;
    item.innerHTML = `
      <div class="meta">错题 ${w} 次 · 最近 ${new Date(rec.lastAt).toLocaleString()}</div>
      <div class="stem"></div>
      <div class="actions row">
        <button type="button" class="ghost sm" data-act="forget" data-qid="${qid}">移除记录</button>
      </div>
    `;
    item.querySelector(".stem").textContent = stem;
    mountAnalysisDetails(item, bankId, qid);
    host.appendChild(item);
  }
  host.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const qid = btn.getAttribute("data-qid");
      const act = btn.getAttribute("data-act");
      if (act === "forget") {
        clearWrong(bankId, qid);
        await loadQuestions(bankId);
        renderWrongList();
        renderWrongHeatStrip();
      }
    });
  });
}

/** 与错题本共用 `quiz_ai_analysis_v1`（同一题库 + 题号） */
function createAnalysisDetails(bankId, qid) {
  const details = document.createElement("details");
  details.className = "ai-details";
  const summary = document.createElement("summary");
  summary.className = "ai-summary";
  const panel = document.createElement("div");
  panel.className = "ai-panel";
  details.appendChild(summary);
  details.appendChild(panel);
  fillAnalysisPanel(bankId, qid, panel, summary, details);
  return details;
}

function mountAnalysisDetails(item, bankId, qid) {
  item.appendChild(createAnalysisDetails(bankId, qid));
}

function mountQuizAnalysisShell(bankId, qid) {
  const shell = $("quizAiShell");
  if (!shell) return;
  shell.innerHTML = "";
  const hint = document.createElement("p");
  hint.className = "hint sm quiz-ai-sync-hint";
  hint.textContent =
    "与「错题本」中该题为同一份解析（同一题库 + 题号），任一处生成、编辑、保存后另一处一致。";
  shell.appendChild(hint);
  shell.appendChild(createAnalysisDetails(bankId, String(qid)));
  shell.classList.remove("hidden");
}

function fillAnalysisPanel(bankId, qid, panel, summary, detailsEl) {
  const cached = getAnalysis(bankId, qid);
  panel.innerHTML = "";
  summary.textContent = cached
    ? "AI 解析（已保存 · 点击展开查看）"
    : "AI 解析（默认折叠 · 展开后可请求生成）";

  if (cached) {
    const wrap = document.createElement("div");
    wrap.className = "ai-analysis-wrap";

    const viewSlot = document.createElement("div");
    viewSlot.className = "ai-view-slot";
    const body = document.createElement("div");
    renderMarkdownToElement(body, cached);
    viewSlot.appendChild(body);

    const toolbar = document.createElement("div");
    toolbar.className = "row ai-toolbar";

    const mkRegen = () => {
      const regen = document.createElement("button");
      regen.type = "button";
      regen.className = "ghost sm";
      regen.textContent = "重新生成（会再次请求 API）";
      regen.addEventListener("click", async (e) => {
        e.preventDefault();
        await fetchAndSaveAnalysis(bankId, qid, panel, summary, detailsEl);
      });
      return regen;
    };

    const enterEdit = () => {
      const raw = getAnalysis(bankId, qid);
      viewSlot.innerHTML = "";
      const ta = document.createElement("textarea");
      ta.className = "ai-edit-textarea";
      ta.value = raw;
      const lines = raw.split("\n").length;
      ta.rows = Math.min(22, Math.max(6, lines + 2));
      viewSlot.appendChild(ta);

      toolbar.innerHTML = "";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "primary sm";
      save.textContent = "保存";
      save.addEventListener("click", (e) => {
        e.preventDefault();
        const v = ta.value;
        if (!v.trim()) {
          clearAnalysis(bankId, qid);
        } else {
          setAnalysis(bankId, qid, v);
        }
        fillAnalysisPanel(bankId, qid, panel, summary, detailsEl);
      });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ghost sm";
      cancel.textContent = "取消";
      cancel.addEventListener("click", (e) => {
        e.preventDefault();
        fillAnalysisPanel(bankId, qid, panel, summary, detailsEl);
      });
      toolbar.appendChild(save);
      toolbar.appendChild(cancel);
    };

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "ghost sm";
    btnEdit.textContent = "编辑";
    btnEdit.addEventListener("click", (e) => {
      e.preventDefault();
      enterEdit();
    });

    toolbar.appendChild(btnEdit);
    toolbar.appendChild(mkRegen());

    wrap.appendChild(viewSlot);
    wrap.appendChild(toolbar);
    panel.appendChild(wrap);
    return;
  }

  const hint = document.createElement("p");
  hint.className = "hint sm";
  hint.textContent = "首次生成会调用 DeepSeek；成功后写入本机，之后不会重复请求。";
  const gen = document.createElement("button");
  gen.type = "button";
  gen.className = "ghost sm";
  gen.textContent = "请求 DeepSeek 解析";
  gen.addEventListener("click", async (e) => {
    e.preventDefault();
    await fetchAndSaveAnalysis(bankId, qid, panel, summary, detailsEl);
  });
  panel.appendChild(hint);
  panel.appendChild(gen);
}

async function fetchAndSaveAnalysis(bankId, qid, panel, summary, detailsEl) {
  panel.innerHTML = "";
  const loading = document.createElement("p");
  loading.className = "hint";
  loading.textContent = "正在请求 DeepSeek…";
  panel.appendChild(loading);
  const r = await fetchAnalysisText(bankId, qid);
  if (r.ok) {
    setAnalysis(bankId, qid, r.text);
    fillAnalysisPanel(bankId, qid, panel, summary, detailsEl);
    detailsEl.open = true;
    return;
  }
  panel.innerHTML = "";
  const err = document.createElement("div");
  err.className = "ai-text ai-err";
  err.textContent = r.text;
  panel.appendChild(err);
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "ghost sm";
  retry.style.marginTop = "8px";
  retry.textContent = "重试";
  retry.addEventListener("click", async (e) => {
    e.preventDefault();
    await fetchAndSaveAnalysis(bankId, qid, panel, summary, detailsEl);
  });
  panel.appendChild(retry);
  detailsEl.open = true;
}

async function fetchAnalysisText(bankId, qid) {
  const cfg = loadApiCfg();
  if (!cfg.key) {
    return { ok: false, text: "请先在「API 设置」中填写并保存 API Key。" };
  }
  await loadQuestions(bankId);
  const q = qById(qid);
  if (!q) {
    return { ok: false, text: "找不到题目内容，请确认已加载该题库。" };
  }
  const base = (cfg.base || "https://api.deepseek.com").replace(/\/$/, "");
  const model = cfg.model || "deepseek-chat";
  const userPrompt = buildAiPrompt(q);
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是一名严谨的教师资格考试辅导老师。" },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, text: `请求失败（${res.status}）：${JSON.stringify(data)}` };
    }
    const txt = data.choices?.[0]?.message?.content || JSON.stringify(data);
    return { ok: true, text: txt };
  } catch (e) {
    return { ok: false, text: String(e) };
  }
}

function buildAiPrompt(q) {
  const letters = Object.keys(q.options).sort();
  const optsText = letters.map((L) => `${L}. ${q.options[L]}`).join("\n");
  const correctText = formatAnswerForUi(q);
  const categoryText = q.category ? `\n知识分类：${q.category}` : "";
  const hint =
    q.kind === "judge"
      ? "说明判断依据、绝对化/否定词等常见陷阱。"
      : q.kind === "multi"
        ? "逐项说明应选或不选的理由，并重点总结多选题套路：是否属于全选、排除一项、同类列举、否定反选；如果能从题干关键词判断，例如“包括、体现、原则、措施、职责、权利义务”等，请明确写出。"
        : "说明正确选项为什么对、其它选项错在哪里，并总结题干关键词与干扰项套路。";
  return `请用中文简要分析下面这道${q.type || "题目"}：${hint}控制在 450 字以内，最后给出1-2条tricky记忆/速判方法，但不要编造不可靠规律。${categoryText}\n\n题干：\n${q.stem}\n\n选项：\n${optsText}\n\n正确答案：${correctText}`;
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setNavPage(btn.dataset.nav));
});

$("bankSelect").addEventListener("change", () => {
  $("overviewBankSelect").value = $("bankSelect").value;
  loadQuestions($("bankSelect").value)
    .then(() => {
      $("overviewBankSelect").value = $("bankSelect").value;
      renderHeatMatrix();
    })
    .catch(console.error);
});

$("overviewBankSelect").addEventListener("change", async () => {
  $("bankSelect").value = $("overviewBankSelect").value;
  await loadQuestions($("overviewBankSelect").value);
  renderHeatMatrix();
});

$("btnStart").addEventListener("click", async () => {
  const bankId = $("bankSelect").value;
  mode = "all";
  await loadQuestions(bankId);
  if (!buildQueue(bankId)) return;
  showQuiz();
  renderQuestion();
});

$("btnCategory").addEventListener("click", async () => {
  const bankId = $("bankSelect").value;
  mode = "category";
  await loadQuestions(bankId);
  if (!buildQueue(bankId)) return;
  showQuiz();
  renderQuestion();
});

$("btnWrong").addEventListener("click", async () => {
  const bankId = $("bankSelect").value;
  mode = "wrong";
  await loadQuestions(bankId);
  if (!buildQueue(bankId)) return;
  showQuiz();
  renderQuestion();
});

$("btnExit").addEventListener("click", () => {
  finishSession();
});

$("btnSubmit").addEventListener("click", () => {
  const bankId = $("bankSelect").value;
  const q = queue[idx];
  const ok = isCorrect(q);
  const fb = $("feedback");
  fb.classList.remove("hidden", "ok", "bad");
  fb.classList.add(ok ? "ok" : "bad");
  const tip = buildMemoryTip(q);
  fb.textContent = ok ? "回答正确。" : `回答错误。正确答案是：${formatAnswerForUi(q)}。`;
  if (tip) {
    const tipEl = document.createElement("div");
    tipEl.className = "memory-tip";
    tipEl.textContent = `记忆提示：${tip}`;
    fb.appendChild(tipEl);
  }
  markQuestionSeen(bankId, String(q.id));
  if (!ok) bumpWrong(bankId, String(q.id));

  $("qOpts").querySelectorAll(".opt").forEach((lab) => {
    const inp = lab.querySelector("input");
    const val = inp?.value;
    lab.classList.remove("correct", "wrongpick", "missed");
    inp.disabled = true;
    if (q.kind === "multi") {
      const inAns = q.answer.includes(val);
      const picked = pickMulti.has(val);
      if (ok && inAns) lab.classList.add("correct");
      if (!ok) {
        if (inAns && picked) lab.classList.add("correct");
        if (inAns && !picked) lab.classList.add("missed");
        if (!inAns && picked) lab.classList.add("wrongpick");
      }
    } else {
      if (val === q.answer) lab.classList.add("correct");
      if (!ok && val === pickOne) lab.classList.add("wrongpick");
    }
  });
  afterSubmit();
  if (!ok) {
    mountQuizAnalysisShell(bankId, String(q.id));
  }
});

$("btnNext").addEventListener("click", () => {
  idx += 1;
  if (idx >= queue.length) {
    alert("本轮已完成。");
    $("btnSubmit").classList.remove("hidden");
    finishSession();
    return;
  }
  $("btnSubmit").classList.remove("hidden");
  $("btnNext").classList.add("hidden");
  renderQuestion();
});

$("wrongBankSelect").addEventListener("change", async () => {
  const bankId = $("wrongBankSelect").value;
  await loadQuestions(bankId);
  renderWrongList();
  renderWrongHeatStrip();
});

$("btnSaveKey").addEventListener("click", () => {
  const key = $("apiKey").value.trim();
  const base = $("apiBase").value.trim() || "https://api.deepseek.com";
  const model = $("apiModel").value.trim() || "deepseek-chat";
  saveApiCfg({ key, base, model });
  $("keyStatus").textContent = key ? "已保存到本机浏览器。" : "已清除密钥。";
});

async function init() {
  const cfg = loadApiCfg();
  if (cfg.key) $("apiKey").value = cfg.key;
  if (cfg.base) $("apiBase").value = cfg.base;
  if (cfg.model) $("apiModel").value = cfg.model;
  await fetchBanks();
  applyPageVisibility();
  const first = $("bankSelect").value;
  if (first) {
    await loadQuestions(first);
    renderHeatMatrix();
  }
}

init().catch((e) => {
  console.error(e);
  alert(`初始化失败：${e.message || e}`);
});
