(function () {
  "use strict";
  const C = window.A2HCore;
  const STORAGE_KEY = "aion2-helper-v1";
  const isTauri = Boolean(window.__TAURI__?.core?.invoke);
  const navItems = [
    ["dashboard", "全", "ダッシュボード"],
    ["shared", "共", "アカウント共有"],
    ["characters", "人", "キャラクター"],
    ["notes", "メ", "メモ"],
    ["world-bosses", "ボ", "ワールドボス"],
    ["settings", "設", "設定・データ"],
  ];
  let state = C.initialState();
  let selectedCharacter = state.characters[0].id;
  let selectedBossCategory = "asmodian";
  let nativeSaveTimer = null;
  let startupError = "";
  let memoSelection = null;
  let selectedSummary = null;
  let prioritySettingsOpen = false;
  let showAllNextActions = false;
  let selectedPriorityCharacter = state.characters[0].id;

  async function loadState() {
    try {
      const raw = isTauri
        ? await window.__TAURI__.core.invoke("load_state")
        : localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (Number(saved?.version) >= 1) return C.catchUp(saved);
    } catch (error) { startupError = `保存データを読み込めません: ${error}`; }
    return C.initialState();
  }

  function saveState(message) {
    const json = JSON.stringify(state);
    if (isTauri) {
      clearTimeout(nativeSaveTimer);
      nativeSaveTimer = setTimeout(() => {
        window.__TAURI__.core.invoke("save_state", { json }).catch((error) => toast(`保存失敗: ${error}`));
      }, 80);
    } else {
      localStorage.setItem(STORAGE_KEY, json);
    }
    if (message) toast(message);
  }

  const NOTE_COLOR_VALUES = new Set(C.NOTE_COLORS.map((color) => color.value));

  function canonicalMemoColor(value) {
    if (!value) return null;
    const probe = document.createElement("span");
    probe.style.color = value;
    if (!probe.style.color) return null;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    for (const color of C.NOTE_COLORS) {
      const sample = document.createElement("span");
      sample.style.color = color.value;
      document.body.appendChild(sample);
      const matches = getComputedStyle(sample).color === computed;
      sample.remove();
      if (matches) return color.value;
    }
    return null;
  }

  function sanitizeMemoHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    function clean(node) {
      if (node.nodeType === Node.TEXT_NODE) return esc(node.nodeValue || "");
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName.toLowerCase();
      if (tag === "br") return "<br>";
      const content = Array.from(node.childNodes, clean).join("");
      if (tag === "div" || tag === "p") return `${content}<br>`;
      const color = canonicalMemoColor(node.getAttribute("color") || node.style?.color);
      return color ? `<span style="color:${color}">${content}</span>` : content;
    }
    return Array.from(template.content.childNodes, clean).join("").replace(/(?:<br>)+$/, "");
  }

  function memoPlainText(html) {
    const container = document.createElement("div");
    container.innerHTML = sanitizeMemoHtml(html);
    container.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    return container.textContent || "";
  }

  function saveMemoEditor(editor, character) {
    character.memoHtml = sanitizeMemoHtml(editor.innerHTML);
    const count = document.getElementById("memo-character-count");
    if (count) count.textContent = `${Array.from(memoPlainText(character.memoHtml)).length.toLocaleString()}文字`;
    saveState();
  }

  function applyMemoColor(characterId, color) {
    const editor = document.querySelector(`.memo-editor[data-id="${CSS.escape(characterId)}"]`);
    const character = characterById(characterId);
    if (!editor || !character || !NOTE_COLOR_VALUES.has(color) || !memoSelection) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(memoSelection);
    if (selection.isCollapsed || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return false;
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("foreColor", false, color);
    saveMemoEditor(editor, character);
    memoSelection = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    editor.focus();
    return true;
  }

  async function notify(title, body) {
    if (isTauri) {
      return await window.__TAURI__.core.invoke("send_notification", { title, body });
    }
    if (!("Notification" in window)) throw new Error("このブラウザは通知非対応です");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("通知が許可されませんでした");
    new Notification(title, { body });
    return "ブラウザ通知を送信しました";
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  function formatJst(epochMs, withSeconds = false) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", month: "short", day: "numeric", weekday: "short",
      hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined,
    }).format(new Date(epochMs));
  }

  function duration(target) {
    const ms = Math.max(0, target - Date.now());
    const minutes = Math.floor(ms / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    return days ? `${days}日 ${hours}時間` : hours ? `${hours}時間 ${mins}分` : `${mins}分`;
  }

  function toast(message) {
    const node = document.getElementById("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
  }

  function enabledCharacters() { return state.characters.filter((character) => character.enabled); }
  function characterById(id) { return state.characters.find((character) => character.id === id); }

  function summaryMetric(id, label, value, note, accent, items) {
    const previews = items.slice(0, 2).map((item) => `<span>${esc(item.preview || item.label)}</span>`).join("");
    const remainder = Math.max(0, items.length - 2);
    return `<button type="button" class="card metric summary-card ${selectedSummary === id ? "active" : ""}" style="--accent:${accent}" data-action="toggle-summary" data-summary="${id}" aria-expanded="${selectedSummary === id}">
      <span class="metric-label">${label}</span><span class="metric-value">${value}</span><span class="metric-note">${note}</span>
      <span class="metric-preview">${previews || `<span>${id === "corridor" ? "未使用権利なし" : id === "ode" ? "警告対象なし" : "すべて完了"}</span>`}${remainder ? `<span>ほか${remainder}件</span>` : ""}</span>
      <span class="metric-open">${selectedSummary === id ? "内訳を閉じる" : "内訳を見る"}<span aria-hidden="true">${selectedSummary === id ? "▲" : "▼"}</span></span>
    </button>`;
  }

  function pill(text, type = "") { return `<span class="pill ${type}">${text}</span>`; }
  function progress(value, max) { return `<div class="progress"><span style="width:${Math.min(100, max ? value / max * 100 : 0)}%"></span></div>`; }

  function alertSummary(alerts) {
    if (!alerts.length) return pill("正常", "good");
    const label = alerts.map((alert) => alert.label).join("、");
    return `<ul class="alert-summary" aria-label="${esc(label)}">${alerts.map((alert) => `<li data-alert="${esc(alert.id)}">${esc(alert.label)}</li>`).join("")}</ul>`;
  }

  function counter(label, value, max, path, step = 1, hint = "", disabled = false) {
    const disabledAttribute = disabled ? "disabled" : "";
    const display = `<label class="counter-value"><input class="counter-input" type="number" inputmode="numeric" min="0" max="${max}" step="1" value="${Number(value)}" data-action="number" data-path="${path}" aria-label="${label}を直接入力" ${disabledAttribute}><span>/ ${Number(max).toLocaleString()}</span></label>`;
    return `<div class="counter-row" data-max="${max}"><div><strong>${label}</strong>${hint ? `<div class="subtext">${hint}</div>` : ""}</div><div class="counter-control"><button class="step" data-action="step" data-path="${path}" data-delta="-${step}" aria-label="${label}を減らす" ${disabledAttribute}>−</button>${display}<button class="step" data-action="step" data-path="${path}" data-delta="${step}" aria-label="${label}を増やす" ${disabledAttribute}>＋</button></div></div>`;
  }

  function managedToggle(label, path, managed) {
    return `<button type="button" class="managed-toggle ${managed ? "active" : ""}" data-action="toggle-managed" data-path="${path}" aria-pressed="${managed}" aria-label="${label}を${managed ? "管理対象から外す" : "管理対象に追加する"}" title="${managed ? "管理対象から外す" : "管理対象に追加する"}">${managed ? "★" : "☆"}</button>`;
  }

  function managedCounter(label, value, max, path, managedPath, step = 1, hint = "") {
    const managed = getPath(managedPath) !== false;
    const display = `<label class="counter-value"><input class="counter-input" type="number" inputmode="numeric" min="0" max="${max}" step="1" value="${Number(value)}" data-action="number" data-path="${path}" aria-label="${label}を直接入力" ${managed ? "" : "disabled"}><span>/ ${Number(max).toLocaleString()}</span></label>`;
    return `<div class="counter-row managed-task ${managed ? "" : "is-unmanaged"}" data-max="${max}"><div class="managed-task-label">${managedToggle(label, managedPath, managed)}<div><strong>${label}</strong>${hint ? `<div class="subtext">${hint}</div>` : ""}${managed ? "" : `<div class="subtext">管理対象外</div>`}</div></div><div class="counter-control"><button class="step" data-action="step" data-path="${path}" data-delta="-${step}" aria-label="${label}を減らす" ${managed ? "" : "disabled"}>−</button>${display}<button class="step" data-action="step" data-path="${path}" data-delta="${step}" aria-label="${label}を増やす" ${managed ? "" : "disabled"}>＋</button></div></div>`;
  }

  function checkRow(label, checked, path, hint = "", actionLabel = "内容確認") {
    return `<div class="counter-row"><div><strong>${label}</strong>${hint ? `<div class="subtext">${hint}</div>` : ""}</div><label class="check-control"><span>${actionLabel}</span><input class="check" type="checkbox" data-action="check" data-path="${path}" ${checked ? "checked" : ""} aria-label="${label}の${actionLabel}"></label></div>`;
  }

  function managedCheckRow(label, checked, path, managedPath, hint = "", actionLabel = "内容確認") {
    const managed = getPath(managedPath) !== false;
    const actionText = actionLabel ? `<span>${actionLabel}</span>` : "";
    const ariaLabel = actionLabel ? `${label}の${actionLabel}` : `${label}を切り替える`;
    return `<div class="counter-row managed-task ${managed ? "" : "is-unmanaged"}"><div class="managed-task-label">${managedToggle(label, managedPath, managed)}<div><strong>${label}</strong>${hint ? `<div class="subtext">${hint}</div>` : ""}${managed ? "" : `<div class="subtext">管理対象外</div>`}</div></div><label class="check-control">${actionText}<input class="check" type="checkbox" data-action="check" data-path="${path}" ${checked ? "checked" : ""} ${managed ? "" : "disabled"} aria-label="${ariaLabel}"></label></div>`;
  }

  function renderNav() {
    document.getElementById("nav").innerHTML = navItems.map(([id, icon, label]) =>
      `<button class="nav-button ${state.activeView === id ? "active" : ""}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}</button>`
    ).join("");
  }

  function renderClocks() {
    const daily = C.nextDailyReset(Date.now());
    const weekly = C.nextWeeklyReset(Date.now());
    document.getElementById("reset-clocks").innerHTML = `
      <div class="clock"><span>デイリー更新</span><strong>${formatJst(daily)} · ${duration(daily)}</strong></div>
      <div class="clock"><span>ウィークリー更新</span><strong>${formatJst(weekly)} · ${duration(weekly)}</strong></div>`;
  }

  function dashboardSummary(chars) {
    const daily = [];
    const weekly = [];
    const ode = [];
    const corridor = [];
    const sharedTracked = state.shared.tracked || {};
    if (sharedTracked.dailyQuests !== false && state.shared.dailyQuests < 5) daily.push({ group: "アカウント共有", label: "デイリークエスト", status: `${state.shared.dailyQuests} / 5`, preview: `デイリークエスト ${state.shared.dailyQuests}/5`, view: "shared" });
    if (sharedTracked.shugo !== false && state.shared.shugo > 0) daily.push({ group: "アカウント共有", label: "シューゴフェスタ", status: `残り${state.shared.shugo}回`, view: "shared" });
    if (sharedTracked.invasionKeys !== false && state.shared.invasionKeys > 0) daily.push({ group: "アカウント共有", label: "次元侵攻の鍵", status: `残り${state.shared.invasionKeys}個`, view: "shared" });
    if (sharedTracked.dailyDungeon !== false && state.shared.dailyDungeon > 0) weekly.push({ group: "アカウント共有", label: "デイリーダンジョン", status: `残り${state.shared.dailyDungeon}回`, view: "shared" });
    if (sharedTracked.weeklyDemonic !== false && state.shared.weeklyDemonic < 12) weekly.push({ group: "アカウント共有", label: "魔族大陸の任務", status: `${state.shared.weeklyDemonic} / 12`, view: "shared" });
    if (sharedTracked.weeklyAbyss !== false && state.shared.weeklyAbyss < 20) weekly.push({ group: "アカウント共有", label: "アビスの任務", status: `${state.shared.weeklyAbyss} / 20`, view: "shared" });
    if (sharedTracked.serverOdeCrafted !== false && state.shared.serverOdeCrafted < 16) weekly.push({ group: "アカウント共有", label: "オード物質変換（サーバー）", status: `${state.shared.serverOdeCrafted} / 16`, view: "shared" });
    if (sharedTracked.afResult !== false && state.shared.afResultPending) weekly.push({ group: "アカウント共有", label: "AF結果", status: "未入力", view: "shared" });
    for (const character of chars) {
      const tracked = character.tracked || {};
      if (tracked.farmGiena !== false && character.farmGiena < 1000000) daily.push({ group: "キャラクター", label: "フィールドファーム", status: `${character.farmGiena.toLocaleString()} / 1,000,000`, preview: `${character.name}：フィールドファーム`, view: "characters", id: character.id, character: character.name });
      if (tracked.supplyDaily !== false && !character.supplyDaily) daily.push({ group: "キャラクター", label: "補給依頼（日）", status: "内容未確認", preview: `${character.name}：補給依頼（日）`, view: "characters", id: character.id, character: character.name });
      if (tracked.sanctuary !== false && character.sanctuary !== 0) weekly.push({ group: "キャラクター", label: "ルドラ", status: `残り${character.sanctuary}回`, preview: `${character.name}：ルドラ`, view: "characters", id: character.id, character: character.name });
      if (tracked.awakening !== false && character.awakening !== 0) weekly.push({ group: "キャラクター", label: "覚醒戦", status: `残り${character.awakening}回`, preview: `${character.name}：覚醒戦`, view: "characters", id: character.id, character: character.name });
      if (tracked.battleground !== false && character.battleground < 3) weekly.push({ group: "キャラクター", label: "戦場", status: `${character.battleground} / 3`, preview: `${character.name}：戦場`, view: "characters", id: character.id, character: character.name });
      if (tracked.supplyWeekly !== false && !character.supplyWeekly) weekly.push({ group: "キャラクター", label: "補給依頼（週）", status: "内容未確認", preview: `${character.name}：補給依頼（週）`, view: "characters", id: character.id, character: character.name });
      if (tracked.seasonWeekly !== false && !character.seasonWeekly) weekly.push({ group: "キャラクター", label: "シーズンミッション（週）", status: "未購入", preview: `${character.name}：シーズンミッション`, view: "characters", id: character.id, character: character.name });
      if (tracked.odePurchased !== false && character.odePurchased < 20) weekly.push({ group: "キャラクター", label: "オードショップ購入", status: `${character.odePurchased} / 20`, preview: `${character.name}：オードショップ購入`, view: "characters", id: character.id, character: character.name });
      if (tracked.odeCrafted !== false && character.odeCrafted < 4) weekly.push({ group: "キャラクター", label: "オード物質変換（キャラ）", status: `${character.odeCrafted} / 4`, preview: `${character.name}：オード物質変換`, view: "characters", id: character.id, character: character.name });
      if (tracked.odeState !== false && character.odeNatural >= C.ODE_ALERT_THRESHOLD) ode.push({ group: "警告対象", label: character.name, status: `${character.odeNatural} / 840`, preview: `${character.name} ${character.odeNatural}/840`, view: "characters", id: character.id });
      const remaining = Math.max(0, character.abyssGranted - character.abyssUsed);
      if (tracked.corridorState !== false && remaining > 0) corridor.push({ group: "未使用権利", label: character.name, status: `残り${remaining}回`, preview: `${character.name} 残り${remaining}回`, view: "characters", id: character.id });
    }
    return { daily, weekly, ode, corridor };
  }

  function renderSummaryDetail(kind, items) {
    const titles = { daily: "今日の未完了", weekly: "今週の未完了", ode: "オード警告の対象", corridor: "回廊権利の内訳" };
    if (!items.length) return `<article class="card summary-detail" data-summary-detail="${kind}"><div class="summary-detail-head"><div><h3>${titles[kind]}</h3><p>現在、確認が必要な項目はありません。</p></div><button class="btn small" data-action="toggle-summary" data-summary="${kind}">閉じる</button></div><div class="summary-empty">✓ すべて確認済みです</div></article>`;
    const groups = [...new Set(items.map((item) => item.group))];
    return `<article class="card summary-detail" data-summary-detail="${kind}">
      <div class="summary-detail-head"><div><h3>${titles[kind]} <span>${items.length}件</span></h3><p>項目を押すと入力画面へ移動します。</p></div><button class="btn small" data-action="toggle-summary" data-summary="${kind}">閉じる</button></div>
      ${groups.map((group) => `<section class="summary-detail-group"><h4>${group}</h4><div class="summary-detail-list">${items.filter((item) => item.group === group).map((item) => `<button type="button" class="summary-detail-row" data-action="summary-target" data-view-target="${item.view}" ${item.id ? `data-id="${item.id}"` : ""}><span>${item.character ? `<small>${esc(item.character)}</small>` : ""}<strong>${esc(item.label)}</strong></span><span>${esc(item.status)}<b aria-hidden="true">›</b></span></button>`).join("")}</div></section>`).join("")}
    </article>`;
  }

  function priorityBadge(priority) {
    return `<span class="priority-badge priority-${priority}">${esc(C.PRIORITY_LABELS[priority] || priority)}</span>`;
  }

  function nextActionRow(item, index) {
    const timing = item.period === "daily" ? "今日" : item.period === "weekly" ? "今週" : item.kind === "warning" ? "警告" : "状態";
    return `<button type="button" class="next-action-row ${item.kind === "warning" ? "is-warning" : ""}" data-action="priority-target" data-view-target="${item.view}" ${item.characterId ? `data-id="${item.characterId}"` : ""}>
      <span class="next-action-rank">${index + 1}</span>
      <span class="next-action-main"><span class="next-action-meta">${priorityBadge(item.priority)}<span class="period-badge">${timing}</span><span>${esc(item.scope === "shared" ? "アカウント共有" : item.characterName)}</span></span><strong>${esc(item.label)}</strong></span>
      <span class="next-action-status">${esc(item.status)}<b aria-hidden="true">›</b></span>
    </button>`;
  }

  function prioritySelector(path, current, label) {
    return `<div class="priority-selector" role="group" aria-label="${esc(label)}の優先度">${C.PRIORITY_LEVELS.map((level) => `<button type="button" class="priority-choice priority-${level} ${current === level ? "active" : ""}" data-action="set-priority" data-path="${path}" data-priority="${level}" aria-pressed="${current === level}">${esc(C.PRIORITY_LABELS[level])}</button>`).join("")}</div>`;
  }

  function prioritySettingRow(label, path, current, type = "task") {
    return `<div class="priority-setting-row"><div><strong>${esc(label)}</strong><span>${type === "task" ? "タスク" : type === "warning" ? "警告" : "状態"}</span></div>${prioritySelector(path, current, label)}</div>`;
  }

  function renderPrioritySettings(chars) {
    let character = characterById(selectedPriorityCharacter);
    if (!character?.enabled) character = chars[0];
    selectedPriorityCharacter = character?.id;
    const sharedRows = [
      ["dailyQuests", "デイリークエスト"], ["shugo", "シューゴフェスタ"], ["invasionKeys", "次元侵攻の鍵"],
      ["dailyDungeon", "デイリーダンジョン"], ["weeklyDemonic", "魔族大陸の任務"],
      ["weeklyAbyss", "アビスの任務"], ["serverOdeCrafted", "オード物質変換（サーバー）"], ["afResult", "AF結果入力"],
    ].filter(([key]) => state.shared.tracked?.[key] !== false);
    const characterRows = character ? [
      ["farmGiena", "フィールドファーム"], ["supplyDaily", "補給依頼（日）"], ["sanctuary", "ルドラ"],
      ["awakening", "覚醒戦"], ["battleground", "戦場"], ["supplyWeekly", "補給依頼（週）"], ["seasonWeekly", "シーズンミッション（週）"],
      ["odePurchased", "オードショップ購入"], ["odeCrafted", "オード物質変換（キャラ）"],
    ].filter(([key]) => character.tracked?.[key] !== false) : [];
    const characterIndex = character ? state.characters.indexOf(character) : -1;
    const stateRows = character ? [
      ...(character.tracked?.odeState !== false ? [
        [`オード ${C.ODE_ALERT_THRESHOLD}未満`, "odeLow", "state"],
        [`オード ${C.ODE_ALERT_THRESHOLD}以上`, "odeHigh", "warning"],
      ] : []),
      ...(character.tracked?.nightmareState !== false ? [
        ["悪夢 10未満", "nightmareLow", "state"],
        ["悪夢 10以上", "nightmareHigh", "warning"],
      ] : []),
      ...(character.tracked?.corridorState !== false ? [["回廊権利あり", "corridor", "warning"]] : []),
    ] : [];
    return `<div class="priority-modal-backdrop"><article class="card priority-settings priority-modal" role="dialog" aria-modal="true" aria-labelledby="priority-settings-title" tabindex="-1">
      <div class="priority-settings-head"><div><h3 id="priority-settings-title">優先順位設定</h3><p>★付きタスクと、キャラクターの状態に優先度を設定します。</p></div><button type="button" class="btn small" data-action="close-priority-settings" aria-label="優先順位設定を閉じる">閉じる</button></div>
      <section class="priority-settings-section"><h4>アカウント共有 <span>★付きのみ</span></h4><div class="priority-setting-list">${sharedRows.length ? sharedRows.map(([key, label]) => prioritySettingRow(label, `shared.priorities.${key}`, state.shared.priorities[key])).join("") : `<div class="summary-empty">★付き項目はありません</div>`}</div></section>
      <section class="priority-settings-section"><div class="priority-character-head"><h4>キャラクター別 <span>★付きのみ</span></h4><div class="priority-character-tabs">${chars.map((entry) => `<button type="button" class="char-tab ${entry.id === character?.id ? "active" : ""}" data-action="select-priority-character" data-id="${entry.id}">${esc(entry.name)}</button>`).join("")}</div></div>
        ${character ? `<div class="priority-settings-columns"><div><h5>通常タスク</h5><div class="priority-setting-list">${characterRows.length ? characterRows.map(([key, label]) => prioritySettingRow(label, `characters.${characterIndex}.priorities.${key}`, character.priorities[key])).join("") : `<div class="summary-empty">★付き項目はありません</div>`}</div></div>
        <div><h5>状態</h5><div class="priority-setting-list">${stateRows.length ? stateRows.map(([label, key, type]) => prioritySettingRow(label, `characters.${characterIndex}.priorities.${key}`, character.priorities[key], type)).join("") : `<div class="summary-empty">★付き状態はありません</div>`}</div></div></div>` : `<div class="summary-empty">有効なキャラクターがありません</div>`}
      </section>
    </article></div>`;
  }

  function renderNextActions(chars) {
    const candidates = C.priorityCandidates(state, Date.now());
    const items = showAllNextActions ? candidates.all : candidates.top;
    const hidden = Math.max(0, candidates.all.length - candidates.top.length);
    return `<div class="section-head next-actions-head"><div><h2>次にやること</h2><p>優先度と更新期限をもとに、未完了タスクと現在の状態を並べています。</p></div><button type="button" class="btn small" data-action="open-priority-settings" aria-haspopup="dialog">優先順位設定</button></div>
      <article class="card next-actions-card">
        ${items.length ? `<div class="next-action-list">${items.map(nextActionRow).join("")}</div>` : `<div class="summary-empty">✓ 現在表示する項目はありません</div>`}
        ${candidates.all.length > 5 ? `<button type="button" class="next-actions-more" data-action="toggle-all-next-actions">${showAllNextActions ? "上位5件に戻す" : `残り${hidden}件を表示`}</button>` : ""}
        <p class="next-actions-rule">状態項目の「通常／低」は、上位5件に空きがある場合だけ表示されます。</p>
      </article>`;
  }

  function renderDashboard() {
    const chars = enabledCharacters();
    const summaries = dashboardSummary(chars);
    const sharedTracked = state.shared.tracked || {};
    const completions = chars.map((character) => C.completion(character));
    const dailyTotal = completions.reduce((sum, value) => sum + value.dailyTotal, 0)
      + ["dailyQuests", "shugo", "invasionKeys"].filter((key) => sharedTracked[key] !== false).length;
    const dailyDone = dailyTotal - summaries.daily.length;
    const weeklyTotal = completions.reduce((sum, value) => sum + value.weeklyTotal, 0)
      + ["dailyDungeon", "weeklyDemonic", "weeklyAbyss", "serverOdeCrafted", "afResult"].filter((key) => sharedTracked[key] !== false).length;
    const weeklyDone = weeklyTotal - summaries.weekly.length;
    const highOde = summaries.ode.length;
    const managedOdeCount = chars.filter((c) => c.tracked?.odeState !== false).length;
    const managedCorridorCount = chars.filter((c) => c.tracked?.corridorState !== false).length;
    const highNightmare = chars.filter((c) => c.tracked?.nightmareState !== false && c.nightmare >= 10).length;
    const corridorLeft = chars.reduce((sum, c) => c.tracked?.corridorState === false ? sum : sum + Math.max(0, c.abyssGranted - c.abyssUsed), 0);
    const alerts = [];
    if (state.shared.shugo >= 19) alerts.push(`シューゴフェスタ ${state.shared.shugo}/21：次回+3が一部失われる可能性`);
    if (sharedTracked.afResult !== false && state.shared.afResultPending) alerts.push("AF結果が未入力です");
    if (highOde) alerts.push(`自然回復オード ${C.ODE_ALERT_THRESHOLD}以上：${highOde}キャラ`);
    if (highNightmare) alerts.push(`悪夢 10以上：${highNightmare}キャラ`);

    return `
      ${alerts.length ? `<div class="warning-strip"><span>${alerts.map(esc).join("　/　")}</span><span>要確認 ${alerts.length}件</span></div>` : ""}
      <div class="section-head"><div><h2>全体サマリー</h2><p>登録済み${chars.length}キャラクターの現在状況</p><p class="dashboard-managed-note">個々の項目で★を付けたものだけ、ダッシュボードで管理します。</p></div></div>
      <div class="summary-grid">
        ${summaryMetric("daily", "今日", dailyTotal ? `${dailyDone} / ${dailyTotal}` : "対象なし", dailyTotal ? (summaries.daily.length ? `残り ${summaries.daily.length}項目` : "すべて完了") : "★付き項目なし", "var(--blue)", summaries.daily)}
        ${summaryMetric("weekly", "今週", weeklyTotal ? `${weeklyDone} / ${weeklyTotal}` : "対象なし", weeklyTotal ? (summaries.weekly.length ? `残り ${summaries.weekly.length}項目` : "すべて完了") : "★付き項目なし", "var(--mint)", summaries.weekly)}
        ${summaryMetric("ode", "オード警告", managedOdeCount ? `${highOde}人` : "対象なし", managedOdeCount ? (highOde ? `自然回復が${C.ODE_ALERT_THRESHOLD}以上` : `★付きキャラは${C.ODE_ALERT_THRESHOLD}未満`) : "★付きキャラなし", highOde ? "var(--yellow)" : "var(--green)", summaries.ode)}
        ${summaryMetric("corridor", "回廊権利", managedCorridorCount ? `${corridorLeft}回` : "対象なし", managedCorridorCount ? `次回失効 ${formatJst(C.nextAfReset(Date.now()))}` : "★付きキャラなし", corridorLeft ? "var(--yellow)" : "var(--muted)", summaries.corridor)}
      </div>
      ${selectedSummary ? renderSummaryDetail(selectedSummary, summaries[selectedSummary]) : ""}
      ${renderNextActions(chars)}
      <div class="section-head"><div><h2>キャラクター横断一覧</h2><p>セルを押すとキャラクター詳細へ移動</p></div><button class="btn small" data-view="characters">詳細を開く</button></div>
      <div class="card table-wrap"><table><thead><tr><th>キャラクター</th><th>オード</th><th>今日</th><th>今週</th><th>ルドラ</th><th>回廊</th><th>購入</th><th>警告</th></tr></thead><tbody>
        ${chars.map((c) => {
          const cp = C.completion(c);
          const corridor = Math.max(0, c.abyssGranted - c.abyssUsed);
          const warnings = C.characterAlerts(c);
          const dailyStatus = cp.dailyTotal ? `${cp.dailyDone}/${cp.dailyTotal}${progress(cp.dailyDone, cp.dailyTotal)}` : `<span class="subtext">対象なし</span>`;
          const weeklyStatus = cp.weeklyTotal ? `${cp.weeklyDone}/${cp.weeklyTotal}${progress(cp.weeklyDone, cp.weeklyTotal)}` : `<span class="subtext">対象なし</span>`;
          return `<tr data-action="select-character" data-id="${c.id}"><td><div class="character-name">${esc(c.name)}</div><div class="subtext">${c.id}</div></td><td><strong>${c.odeNatural + c.odeBonus}</strong><div class="subtext">自然 ${c.odeNatural}/840</div></td><td>${dailyStatus}</td><td>${weeklyStatus}</td><td>${c.sanctuary}/2</td><td>${corridor ? pill(`${corridor}回`, "warn") : pill("0回", "good")}</td><td>${c.odePurchased}/20</td><td>${alertSummary(warnings)}</td></tr>`;
        }).join("")}
      </tbody></table></div>
      ${prioritySettingsOpen ? renderPrioritySettings(chars) : ""}`;
  }

  function renderShared() {
    const weeklyTotal = state.shared.weeklyDemonic + state.shared.weeklyAbyss;
    const tracked = state.shared.tracked || {};
    return `
      <div class="cards-2">
        <article class="card panel"><h3>デイリー・共有</h3><p class="panel-description">毎日16:00更新。保有数は上限まで自動加算。</p>
          ${managedCounter("デイリークエスト", state.shared.dailyQuests, 5, "shared.dailyQuests", "shared.tracked.dailyQuests")}
          ${managedCounter("シューゴフェスタ", state.shared.shugo, 21, "shared.shugo", "shared.tracked.shugo", 1, "16:00に+3")}
          ${managedCounter("次元侵攻の鍵", state.shared.invasionKeys, 7, "shared.invasionKeys", "shared.tracked.invasionKeys", 1, "16:00に+1")}
        </article>
        <article class="card panel"><h3>ウィークリー・共有</h3><p class="panel-description">毎週水曜16:00更新。</p>
          ${managedCounter("デイリーダンジョン残数", state.shared.dailyDungeon, 14, "shared.dailyDungeon", "shared.tracked.dailyDungeon")}
          ${managedCounter("魔族大陸の任務", state.shared.weeklyDemonic, 12, "shared.weeklyDemonic", "shared.tracked.weeklyDemonic")}
          ${managedCounter("アビスの任務", state.shared.weeklyAbyss, 20, "shared.weeklyAbyss", "shared.tracked.weeklyAbyss", 1, `合計 ${weeklyTotal}/32`)}
          ${managedCounter("オード物質変換（サーバー）", state.shared.serverOdeCrafted, 16, "shared.serverOdeCrafted", "shared.tracked.serverOdeCrafted")}
        </article>
      </div>
      <div class="section-head"><div><h2>AF戦結果</h2><p>月・木・土21:00。入力値を全キャラクターへ一括付与</p></div></div>
      <article class="card panel managed-panel ${tracked.afResult !== false ? "" : "is-unmanaged"}"><div class="managed-panel-head">${managedToggle("AF戦結果", "shared.tracked.afResult", tracked.afResult !== false)}<span>${tracked.afResult !== false ? "ダッシュボードで管理" : "管理対象外"}</span></div><div class="toolbar"><select class="input" id="af-grant" ${tracked.afResult !== false ? "" : "disabled"}><option value="0">0個取得</option><option value="1">1個取得</option><option value="2">2個取得</option><option value="3">3個取得</option></select><button class="btn primary" data-action="grant-af" ${tracked.afResult !== false ? "" : "disabled"}>全キャラへ付与</button>${state.shared.afResultPending ? pill("結果未入力", "warn") : pill("入力済み", "good")}</div><p class="panel-description">次のAF戦 ${formatJst(C.nextAfReset(Date.now()))} に未使用権利が失効します。</p></article>
      <div class="section-head"><div><h2>定期イベント通知</h2><p>定期開催。通知時刻はイベントごとに複数選択できます。</p></div>${pill("JST固定", "good")}</div>
      <div class="cards-2 recurring-event-grid">
        ${state.recurringEvents.map(renderRecurringEventCard).join("")}
      </div>`;
  }

  function renderRecurringEventCard(event) {
    const next = C.recurringEventOccurrences(event, Date.now(), 1)[0];
    const scheduleLabel = Number.isInteger(Number(event.minuteOfHour))
      ? `毎時${String(event.minuteOfHour).padStart(2, "0")}分`
      : `${event.intervalHours}時間周期`;
    return `<article class="card panel recurring-event-card" data-event-id="${event.id}">
      <div class="recurring-event-head"><div><p class="boss-region">定期イベント</p><h3>${esc(event.name)}</h3></div>${pill(scheduleLabel, "")}</div>
      <div class="recurring-event-next"><span>次回開催</span><strong>${formatJst(next)}</strong><small>あと ${duration(next)}</small></div>
      <div class="boss-notification-setting"><div><strong>Windows通知</strong><span>アプリ起動中（トレイ格納中を含む）</span></div><div class="toggle-group">${recurringEventNotificationChips(event)}</div></div>
    </article>`;
  }

  function recurringEventNotificationChips(event) {
    const values = [[10,"10分"],[5,"5分"],[3,"3分"],[1,"1分"]];
    const selected = Array.isArray(event.notifyMinutes) ? event.notifyMinutes : [];
    return values.map(([minutes, label]) => {
      const active = selected.includes(minutes);
      return `<button type="button" class="notification-chip ${active ? "active" : ""}" data-action="toggle-recurring-event-notification" data-id="${event.id}" data-minutes="${minutes}" aria-pressed="${active}">${label}</button>`;
    }).join("");
  }

  function renderCharacters() {
    const chars = enabledCharacters();
    let current = characterById(selectedCharacter);
    if (!current?.enabled) { current = chars[0]; selectedCharacter = current?.id; }
    if (!current) return `<div class="card empty">設定画面でキャラクターを有効にしてください。</div>`;
    const prefix = `characters.${state.characters.indexOf(current)}`;
    const corridor = Math.max(0, current.abyssGranted - current.abyssUsed);
    const corridorManaged = current.tracked?.corridorState !== false;
    const odeTotal = current.odeNatural + current.odeBonus;
    return `
      <div class="character-tabs">${chars.map((c) => `<button class="char-tab ${c.id === current.id ? "active" : ""}" data-action="select-character" data-id="${c.id}">${esc(c.name)}</button>`).join("")}</div>
      <div class="cards-3">
        <article class="card panel"><h3>デイリー</h3><p class="panel-description">キャラクター個別</p>
          ${managedCounter("悪夢 残数", current.nightmare, 14, `${prefix}.nightmare`, `${prefix}.tracked.nightmareState`, 1, "16:00に+2")}
          <div class="counter-row managed-task ${current.tracked.farmGiena ? "" : "is-unmanaged"}"><div class="managed-task-label">${managedToggle("フィールドファーム", `${prefix}.tracked.farmGiena`, current.tracked.farmGiena)}<div><strong>フィールドファーム</strong><div class="subtext">${current.tracked.farmGiena ? "デイリー上限 1,000,000ギーナ" : "管理対象外"}</div></div></div><input class="input" type="number" min="0" max="1000000" step="10000" value="${current.farmGiena}" data-action="number" data-path="${prefix}.farmGiena" ${current.tracked.farmGiena ? "" : "disabled"}></div>
          ${managedCheckRow("補給依頼（日）", current.supplyDaily, `${prefix}.supplyDaily`, `${prefix}.tracked.supplyDaily`)}
        </article>
        <article class="card panel"><h3>ウィークリー</h3><p class="panel-description">水曜16:00更新</p>
          ${managedCounter("ルドラ 残数", current.sanctuary, 2, `${prefix}.sanctuary`, `${prefix}.tracked.sanctuary`)}
          ${managedCounter("覚醒戦 残数", current.awakening, 3, `${prefix}.awakening`, `${prefix}.tracked.awakening`)}
          ${managedCounter("戦場 参加", current.battleground, 3, `${prefix}.battleground`, `${prefix}.tracked.battleground`)}
          ${managedCheckRow("補給依頼（週）", current.supplyWeekly, `${prefix}.supplyWeekly`, `${prefix}.tracked.supplyWeekly`)}
          ${managedCheckRow("シーズンミッション（週）", current.seasonWeekly, `${prefix}.seasonWeekly`, `${prefix}.tracked.seasonWeekly`, "", "")}
        </article>
        <article class="card panel managed-panel ${corridorManaged ? "" : "is-unmanaged"}"><div class="managed-panel-head">${managedToggle("アビス回廊", `${prefix}.tracked.corridorState`, corridorManaged)}<span>${corridorManaged ? "ダッシュボードで管理" : "管理対象外"}</span></div><h3>アビス回廊</h3><p class="panel-description">次のAF戦まで有効</p>
          <div class="metric-value">残り ${corridor}回</div>
          <div class="subtext">獲得 ${current.abyssGranted} / 消化 ${current.abyssUsed}</div>
          <div class="toolbar" style="margin-top:12px"><button class="btn" data-action="corridor-use" data-id="${current.id}" ${!corridorManaged || corridor <= 0 ? "disabled" : ""}>1回消化</button><button class="btn" data-action="corridor-undo" data-id="${current.id}" ${!corridorManaged || current.abyssUsed <= 0 ? "disabled" : ""}>取り消し</button></div>
        </article>
      </div>
      <div class="section-head"><div><h2>オードエネルギー</h2><p>自然回復と追加分を分離。消費は自然回復分から。</p></div></div>
      <div class="cards-2">
        <article class="card panel"><h3>残高</h3>
          ${managedCounter("自然回復分", current.odeNatural, 840, `${prefix}.odeNatural`, `${prefix}.tracked.odeState`, 15, "3時間ごとに+15")}
          ${counter("アイテム追加分", current.odeBonus, 2000, `${prefix}.odeBonus`, 15)}
          <div class="counter-row"><div><strong>消費</strong><div class="subtext">自然回復分→追加分の順</div></div><div class="counter-control"><button class="btn small" data-action="spend-ode" data-id="${current.id}" data-amount="40" ${odeTotal < 40 ? "disabled" : ""}>40消費</button><button class="btn small" data-action="spend-ode" data-id="${current.id}" data-amount="80" ${odeTotal < 80 ? "disabled" : ""}>80消費</button></div></div>
        </article>
        <article class="card panel"><h3>週次入手枠</h3>
          ${managedCounter("オードショップ購入", current.odePurchased, 20, `${prefix}.odePurchased`, `${prefix}.tracked.odePurchased`)}
          ${managedCounter("オード物質変換（キャラ）", current.odeCrafted, 4, `${prefix}.odeCrafted`, `${prefix}.tracked.odeCrafted`)}
          <div class="counter-row"><div><strong>合計エネルギー</strong></div><strong>${(current.odeNatural + current.odeBonus).toLocaleString()}</strong></div>
        </article>
      </div>`;
  }

  function renderNotes() {
    const chars = enabledCharacters();
    let current = characterById(selectedCharacter);
    if (!current?.enabled) { current = chars[0]; selectedCharacter = current?.id; }
    if (!current) return `<div class="card empty">設定画面でキャラクターを有効にしてください。</div>`;
    const safeMemoHtml = sanitizeMemoHtml(current.memoHtml);
    if (safeMemoHtml !== current.memoHtml) {
      current.memoHtml = safeMemoHtml;
      saveState();
    }
    const memoLength = Array.from(memoPlainText(safeMemoHtml)).length;
    return `
      <div class="character-tabs memo-character-tabs" role="tablist" aria-label="メモを編集するキャラクター">
        ${chars.map((character) => `<button type="button" class="char-tab ${character.id === current.id ? "active" : ""}" data-action="select-note-character" data-id="${character.id}" role="tab" aria-selected="${character.id === current.id}">${esc(character.name)}</button>`).join("")}
      </div>
      <article class="card memo-panel">
        <div class="memo-head">
          <div><p class="eyebrow">キャラクターメモ</p><h2>${esc(current.name)}のメモ</h2><p>文字を選択して、パレットから部分的に色を付けられます。</p></div>
          <div class="memo-save-state"><span class="status-dot"></span>自動保存</div>
        </div>
        <div class="memo-color-setting">
          <div><strong>選択文字のカラー</strong><span>先に本文の文字を選択してください</span></div>
          <div class="memo-palette" role="toolbar" aria-label="選択文字のフォントカラー">
            ${C.NOTE_COLORS.map((color) => `<button type="button" class="memo-color" style="--memo-color:${color.value}" data-action="note-color" data-id="${current.id}" data-color="${color.value}" aria-label="選択文字を${esc(color.label)}にする" title="${esc(color.label)}"><span></span></button>`).join("")}
          </div>
        </div>
        <label class="memo-editor-label" for="character-memo">自由記述メモ</label>
        <div id="character-memo" class="memo-editor" data-action="note-text" data-id="${current.id}" data-placeholder="装備目標、育成方針、やることなどを自由に記入できます。" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true">${safeMemoHtml}</div>
        <div class="memo-foot"><span>文字選択→色をクリック。本文と色は自動保存されます</span><span id="memo-character-count">${memoLength.toLocaleString()}文字</span></div>
      </article>`;
  }

  function bossById(id) {
    for (const category of state.worldBosses) {
      const boss = category.bosses.find((entry) => entry.id === id);
      if (boss) return boss;
    }
    return null;
  }

  function recurringEventById(id) {
    return state.recurringEvents.find((event) => event.id === id) || null;
  }

  function renderWorldBosses() {
    const now = Date.now();
    const categories = state.worldBosses;
    let current = categories.find((category) => category.id === selectedBossCategory);
    if (!current) { current = categories[0]; selectedBossCategory = current.id; }
    return `
      <div class="section-head"><div><h2>ワールドボスタイマー</h2><p>周期または曜日指定から、次回以降のPOPをJSTで計算します。</p></div>${pill("JST固定", "good")}</div>
      <div class="world-boss-tabs" role="tablist" aria-label="地域カテゴリ">
        ${categories.map((category) => `<button type="button" class="world-boss-tab ${category.id === current.id ? "active" : ""}" data-action="boss-category" data-id="${category.id}" role="tab" aria-selected="${category.id === current.id}">${esc(category.name)}<span>${category.bosses.length}</span></button>`).join("")}
      </div>
      <div class="world-boss-grid">
        ${current.bosses.length ? current.bosses.map((boss) => {
          const isWeekly = Array.isArray(boss.weekdays);
          const occurrences = C.worldBossOccurrences(boss, now, 4);
          const next = occurrences[0];
          const scheduleLabel = isWeekly ? "毎週 金・日" : `${boss.intervalHours}時間周期`;
          const scheduleEditor = isWeekly
            ? `<div class="boss-time-setting boss-fixed-schedule"><span>開催曜日</span><strong>金曜・日曜</strong><label for="boss-time-${boss.id}">出現時刻</label><input id="boss-time-${boss.id}" class="input boss-time-input" type="time" step="60" value="${boss.time}" data-action="world-boss-time" data-id="${boss.id}" aria-label="${esc(boss.name)}の出現時刻"></div>`
            : `<div class="boss-time-setting"><label for="boss-time-${boss.id}">基準時刻</label><input id="boss-time-${boss.id}" class="input boss-time-input" type="time" step="60" value="${boss.baseTime}" data-action="world-boss-time" data-id="${boss.id}" aria-label="${esc(boss.name)}の基準時刻"><span>から${boss.intervalHours}時間ごと</span></div>`;
          return `<article class="card boss-card" data-boss-id="${boss.id}">
            <div class="boss-card-head"><div><p class="boss-region">${esc(current.name)}</p><h3>${esc(boss.name)}</h3></div>${pill(scheduleLabel, "")}</div>
            <div class="boss-next-label">次回出現</div>
            <div class="boss-next-time">${formatJst(next)}</div>
            <div class="boss-countdown">あと ${duration(next)}</div>
            ${scheduleEditor}
            <div class="boss-notification-setting"><div><strong>Windows通知</strong><span>アプリ起動中（トレイ格納中を含む）</span></div><div class="toggle-group">${bossNotificationChips(boss)}</div></div>
            <div class="boss-upcoming"><span>今後のPOP</span><ol>${occurrences.map((time, index) => `<li><b>${index + 1}</b><time>${formatJst(time)}</time></li>`).join("")}</ol></div>
          </article>`;
        }).join("") : `<div class="card empty boss-empty"><div><strong>登録済みボスはありません</strong><p>天族大陸のボスは、次の段階で追加できます。</p></div></div>`}
      </div>
      <div class="card panel boss-note"><strong>POP時刻と通知について</strong><p>周期ボスは24時間形式で1回分の基準時刻を登録します。曜日指定ボスは固定曜日と編集可能な出現時刻から計算します。通知はボスごとに複数選択できます。</p></div>`;
  }

  function bossNotificationChips(boss) {
    const values = [[60,"1時間"],[50,"50分"],[40,"40分"],[30,"30分"],[10,"10分"],[5,"5分"]];
    const selected = Array.isArray(boss.notifyMinutes) ? boss.notifyMinutes : [];
    return values.map(([minutes, label]) => {
      const active = selected.includes(minutes);
      return `<button type="button" class="notification-chip ${active ? "active" : ""}" data-action="toggle-boss-notification" data-id="${boss.id}" data-minutes="${minutes}" aria-pressed="${active}">${label}</button>`;
    }).join("");
  }

  function notificationChips(kind, values) {
    return values.map(([minutes, label]) => {
      const active = state.notifications[kind].includes(minutes);
      return `<button type="button" class="notification-chip ${active ? "active" : ""}" data-action="toggle-notification" data-kind="${kind}" data-minutes="${minutes}" aria-pressed="${active}">${label}</button>`;
    }).join("");
  }

  function renderSettings() {
    return `
      <div class="cards-2">
        <article class="card panel"><h3>キャラクター設定</h3><p class="panel-description">既定4枠、最大8枠</p>
          <div class="setting-row"><div><label>利用枠数</label><p>追加課金に合わせて変更</p></div><select class="input" data-action="slot-count">${[4,5,6,7,8].map((n) => `<option value="${n}" ${state.slotCount === n ? "selected" : ""}>${n}キャラ</option>`).join("")}</select></div>
          ${state.characters.map((c, index) => `<div class="setting-row"><div><label>スロット ${index + 1}</label><p>${c.enabled ? "一覧へ表示" : "無効"}</p></div><div class="toolbar"><input class="input" value="${esc(c.name)}" data-action="rename" data-id="${c.id}"><label class="toggle-chip"><input type="checkbox" data-action="enable-character" data-id="${c.id}" ${c.enabled ? "checked" : ""}><span>有効</span></label></div></div>`).join("")}
        </article>
        <article class="card panel"><h3>通知</h3><p class="panel-description">アプリがタスクトレイで動作中もWindows通知を送信</p>
          <div class="setting-row"><div><label>デイリー未完了</label><p>毎日16:00より前</p></div><div class="toggle-group">${notificationChips("daily", [[180,"3時間"],[60,"1時間"],[30,"30分"],[10,"10分"]])}</div></div>
          <div class="setting-row"><div><label>ウィークリー未完了</label><p>水曜16:00より前</p></div><div class="toggle-group">${notificationChips("weekly", [[1440,"24時間"],[720,"12時間"],[360,"6時間"],[180,"3時間"],[60,"1時間"],[30,"30分"],[10,"10分"]])}</div></div>
          <div class="setting-row"><div><label>アビス回廊</label><p>次のAF戦21:00より前</p></div><div class="toggle-group">${notificationChips("corridor", [[1440,"24時間"],[720,"12時間"],[360,"6時間"],[180,"3時間"],[60,"1時間"],[30,"30分"],[10,"10分"]])}</div></div>
          <div class="toolbar"><button class="btn" data-action="notification-test">Windows通知をテスト</button></div>
        </article>
      </div>
      <div class="section-head"><div><h2>データ管理</h2><p>Windowsユーザーデータ領域へ自動保存。バックアップはダウンロードフォルダーへ出力。</p></div></div>
      <div class="card panel"><div class="toolbar"><button class="btn" data-action="export">JSONバックアップ</button><button class="btn" data-action="import">JSON復元</button><button class="btn danger" data-action="reset-demo">初期状態へ戻す</button></div></div>
      <div class="section-head"><div><h2>最近の履歴</h2><p>自動更新と主要操作</p></div></div>
      <div class="card panel">${state.history.length ? `<ul class="history">${state.history.slice(0,12).map((item) => `<li><time>${formatJst(item.at, true)}</time><span>${esc(item.message)}</span></li>`).join("")}</ul>` : `<div class="empty">履歴はまだありません。</div>`}</div>`;
  }

  function render() {
    state = C.catchUp(state);
    saveState();
    renderNav();
    renderClocks();
    const titles = { dashboard: "ダッシュボード", shared: "アカウント共有", characters: "キャラクター管理", notes: "メモ", "world-bosses": "ワールドボス", settings: "設定・データ" };
    document.getElementById("page-title").textContent = titles[state.activeView];
    const views = { dashboard: renderDashboard, shared: renderShared, characters: renderCharacters, notes: renderNotes, "world-bosses": renderWorldBosses, settings: renderSettings };
    document.getElementById("view").innerHTML = views[state.activeView]();
    document.body.classList.toggle("modal-open", prioritySettingsOpen && state.activeView === "dashboard");
  }

  function getPath(path) {
    return path.split(".").reduce((value, key) => value[key], state);
  }
  function setPath(path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce((value, key) => value[key], state);
    target[last] = value;
  }

  function normalizedNumber(path, rawValue, min, max) {
    let limit = max;
    return C.clamp(Number(rawValue), min, Math.max(min, limit));
  }

  function commitNumberInput(node) {
    setPath(node.dataset.path, normalizedNumber(
      node.dataset.path,
      node.value,
      Number(node.min || 0),
      Number(node.max || 999999999),
    ));
    saveState();
    render();
  }

  function addCharacterSlots(target) {
    while (state.characters.length < target) {
      const index = state.characters.length;
      state.characters.push(C.makeCharacter(`char-${index + 1}`, index));
    }
    state.characters.forEach((character, index) => { character.enabled = index < target; });
    state.slotCount = target;
  }

  document.addEventListener("click", async (event) => {
    if (event.target.classList.contains("priority-modal-backdrop")) {
      prioritySettingsOpen = false;
      render();
      return;
    }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) { state.activeView = viewButton.dataset.view; saveState(); render(); return; }
    const node = event.target.closest("[data-action]");
    if (!node) return;
    const action = node.dataset.action;
    // Form controls commit through change/input/keydown below. Re-rendering them
    // on the initial click destroys native WebView controls (notably type=time)
    // before their picker can open.
    if (["check", "number", "rename", "note-text", "world-boss-time", "slot-count", "enable-character"].includes(action)) return;
    if (action === "toggle-summary") {
      selectedSummary = selectedSummary === node.dataset.summary ? null : node.dataset.summary;
      render();
      return;
    } else if (action === "summary-target") {
      state.activeView = node.dataset.viewTarget;
      if (node.dataset.id) selectedCharacter = node.dataset.id;
    } else if (action === "open-priority-settings") {
      prioritySettingsOpen = true;
    } else if (action === "close-priority-settings") {
      prioritySettingsOpen = false;
    } else if (action === "toggle-all-next-actions") {
      showAllNextActions = !showAllNextActions;
    } else if (action === "select-priority-character") {
      selectedPriorityCharacter = node.dataset.id;
    } else if (action === "set-priority") {
      setPath(node.dataset.path, node.dataset.priority);
    } else if (action === "priority-target") {
      state.activeView = node.dataset.viewTarget;
      if (node.dataset.id) selectedCharacter = node.dataset.id;
    } else if (action === "toggle-managed") {
      setPath(node.dataset.path, getPath(node.dataset.path) === false);
    } else if (action === "step") {
      const old = getPath(node.dataset.path);
      const max = Number(node.closest(".counter-row")?.dataset.max) || 999;
      let next = C.clamp(old + Number(node.dataset.delta), 0, max);
      setPath(node.dataset.path, next);
    } else if (action === "select-character") {
      selectedCharacter = node.dataset.id; state.activeView = "characters";
    } else if (action === "select-note-character") {
      selectedCharacter = node.dataset.id;
      memoSelection = null;
    } else if (action === "note-color") {
      if (applyMemoColor(node.dataset.id, node.dataset.color)) toast("選択文字の色を保存しました");
      else toast("先に色を変える文字を選択してください");
      return;
    } else if (action === "boss-category") {
      selectedBossCategory = node.dataset.id;
    } else if (action === "toggle-boss-notification") {
      const boss = bossById(node.dataset.id);
      boss.notifyMinutes = C.toggleNotification(boss.notifyMinutes || [], node.dataset.minutes);
    } else if (action === "toggle-recurring-event-notification") {
      const recurringEvent = recurringEventById(node.dataset.id);
      if (recurringEvent) recurringEvent.notifyMinutes = C.toggleNotification(recurringEvent.notifyMinutes || [], node.dataset.minutes);
    } else if (action === "grant-af") {
      const value = Number(document.getElementById("af-grant").value);
      state.characters.forEach((c) => { c.abyssGranted = Math.max(value, c.abyssUsed); });
      state.shared.afResultPending = false; toast(`全キャラへ${value}回付与しました`);
    } else if (action === "corridor-use") {
      const c = characterById(node.dataset.id); if (c.abyssUsed < c.abyssGranted) c.abyssUsed += 1;
    } else if (action === "corridor-undo") {
      const c = characterById(node.dataset.id); c.abyssUsed = Math.max(0, c.abyssUsed - 1);
    } else if (action === "spend-ode") {
      const c = characterById(node.dataset.id);
      C.spendOde(c, Number(node.dataset.amount));
    } else if (action === "toggle-notification") {
      const kind = node.dataset.kind;
      state.notifications[kind] = C.toggleNotification(state.notifications[kind], node.dataset.minutes);
    } else if (action === "notification-test") {
      try {
        const result = await notify("A2 ルーティン&ボストラッカー", "通知テスト：Windows通知は正常です");
        toast(result || "テスト通知を送りました");
      } catch (error) { toast(String(error)); }
    } else if (action === "export") {
      if (isTauri) {
        try {
          const path = await window.__TAURI__.core.invoke("export_backup", { json: JSON.stringify(state, null, 2) });
          toast(`バックアップを保存しました: ${path}`);
        } catch (error) { toast(`出力失敗: ${error}`); }
      } else {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `aion2-helper-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
      }
    } else if (action === "import") {
      document.getElementById("import-file").click(); return;
    } else if (action === "reset-demo") {
      if (confirm("保存データを初期化しますか？")) { state = C.initialState(); selectedCharacter = state.characters[0].id; toast("初期化しました"); }
    }
    saveState(); render();
  });

  document.addEventListener("change", (event) => {
    const node = event.target;
    const action = node.dataset.action;
    if (!action) return;
    if (action === "check") setPath(node.dataset.path, node.checked);
    if (action === "number") { commitNumberInput(node); return; }
    if (action === "world-boss-time") {
      const boss = bossById(node.dataset.id);
      if (boss && C.validTimeOfDay(node.value)) {
        const field = Array.isArray(boss.weekdays) ? "time" : "baseTime";
        boss[field] = node.value;
        state.history.unshift({ at: Date.now(), message: `${boss.name}の${field === "time" ? "出現" : "基準"}時刻を${node.value}へ変更` });
        state.history = state.history.slice(0, 80);
        saveState("ワールドボス時刻を保存しました");
      }
      render();
      return;
    }
    if (action === "slot-count") addCharacterSlots(Number(node.value));
    if (action === "enable-character") characterById(node.dataset.id).enabled = node.checked;
    saveState(); render();
  });

  document.addEventListener("input", (event) => {
    const node = event.target;
    if (node.dataset.action === "rename") { characterById(node.dataset.id).name = node.value; saveState(); }
    if (node.dataset.action === "note-text") {
      const character = characterById(node.dataset.id);
      if (!character) return;
      saveMemoEditor(node, character);
    }
  });

  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const editor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer.closest?.(".memo-editor")
      : range.commonAncestorContainer.parentElement?.closest(".memo-editor");
    if (editor) memoSelection = range.cloneRange();
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest('[data-action="note-color"]')) event.preventDefault();
  });

  document.addEventListener("paste", (event) => {
    const editor = event.target.closest?.(".memo-editor");
    if (!editor) return;
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
    const character = characterById(editor.dataset.id);
    if (character) saveMemoEditor(editor, character);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && prioritySettingsOpen) {
      event.preventDefault();
      prioritySettingsOpen = false;
      render();
      return;
    }
    const node = event.target;
    if (node.dataset.action !== "number") return;
    if (event.key === "Enter") { event.preventDefault(); commitNumberInput(node); }
    if (event.key === "Escape") render();
  });

  document.getElementById("import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Number.isInteger(imported.version) || imported.version < 1 || imported.version > C.STATE_VERSION || !Array.isArray(imported.characters)) throw new Error("形式が一致しません");
      state = C.catchUp(imported); selectedCharacter = state.characters.find((c) => c.enabled)?.id; saveState("復元しました"); render();
    } catch (error) { toast(`復元失敗: ${error.message}`); }
    event.target.value = "";
  });

  function notificationKey(kind, target, minutes) { return `${kind}:${target}:${minutes}`; }

  async function checkNotifications() {
    const now = Date.now();
    state.sentNotifications ||= [];
    state.sentNotifications = state.sentNotifications.filter((entry) => Number(entry.split(":")[1]) > now - 8 * C.DAY_MS);
    const chars = enabledCharacters();
    const summaries = dashboardSummary(chars);
    const dailyRemaining = summaries.daily.length > 0;
    const weeklyRemaining = summaries.weekly.length > 0;
    const corridorRemaining = chars.reduce((sum, c) => c.tracked?.corridorState === false ? sum : sum + Math.max(0, c.abyssGranted - c.abyssUsed), 0);
    const candidates = [
      ["daily", C.nextDailyReset(now), dailyRemaining, "デイリー更新が近づいています", "未完了のデイリーがあります。"],
      ["weekly", C.nextWeeklyReset(now), weeklyRemaining, "ウィークリー更新が近づいています", "未完了の週課または未使用枠があります。"],
      ["corridor", C.nextAfReset(now), corridorRemaining > 0, "アビス回廊の権利が失効します", `未使用の挑戦権が合計${corridorRemaining}回あります。`],
    ];
    for (const [kind, target, hasRemaining, title, body] of candidates) {
      if (!hasRemaining) continue;
      for (const minutes of state.notifications[kind]) {
        const key = notificationKey(kind, target, minutes);
        if (!state.sentNotifications.includes(key) && C.notificationDue(now, target, minutes)) {
          try {
            await notify(title, body);
            state.sentNotifications.push(key);
            saveState();
          } catch (_) {}
        }
      }
    }
    for (const category of state.worldBosses) {
      for (const boss of category.bosses) {
        const target = C.worldBossOccurrences(boss, now, 1)[0];
        if (!target) continue;
        for (const minutes of boss.notifyMinutes || []) {
          const key = notificationKey(`boss-${boss.id}`, target, minutes);
          if (!state.sentNotifications.includes(key) && C.notificationDue(now, target, minutes)) {
            try {
              await notify(`ワールドボス：${boss.name}`, `${formatJst(target)}に出現予定です（${minutes}分前）。`);
              state.sentNotifications.push(key);
              saveState();
            } catch (_) {}
          }
        }
      }
    }
    for (const recurringEvent of state.recurringEvents) {
      const target = C.recurringEventOccurrences(recurringEvent, now, 1)[0];
      if (!target) continue;
      for (const minutes of recurringEvent.notifyMinutes || []) {
        const key = notificationKey(`event-${recurringEvent.id}`, target, minutes);
        if (!state.sentNotifications.includes(key) && C.notificationDue(now, target, minutes)) {
          try {
            await notify(`定期イベント：${recurringEvent.name}`, `${formatJst(target)}に開催予定です（${minutes}分前）。`);
            state.sentNotifications.push(key);
            saveState();
          } catch (_) {}
        }
      }
    }
  }

  async function bootstrap() {
    state = await loadState();
    const requestedView = new URLSearchParams(location.search).get("view");
    if (navItems.some(([id]) => id === requestedView)) state.activeView = requestedView;
    selectedCharacter = state.characters.find((c) => c.enabled)?.id || state.characters[0].id;
    selectedPriorityCharacter = selectedCharacter;
    render();
    if (startupError) toast(startupError);
    await checkNotifications();
    setInterval(() => {
      if (state.activeView === "world-bosses" && document.activeElement?.tagName !== "INPUT") render();
      else renderClocks();
      checkNotifications();
    }, 30000);
  }

  bootstrap();
})();
