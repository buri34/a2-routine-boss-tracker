import assert from "node:assert/strict";

const debugPort = process.env.CHROME_DEBUG_PORT || "9333";
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((entry) => entry.type === "page");
assert.ok(target?.webSocketDebuggerUrl, "Chrome page target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function evaluateAfterNavigation(expression) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { return await evaluate(expression); }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw lastError;
}

await command("Page.enable");
await command("Runtime.enable");
await command("Storage.clearDataForOrigin", {
  origin: "http://127.0.0.1:8772",
  storageTypes: "local_storage",
});
await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=settings" });
await new Promise((resolve) => setTimeout(resolve, 700));

const selector = '.notification-chip[data-kind="daily"][data-minutes="30"]';
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute("aria-pressed")`), "false");

await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute("aria-pressed")`), "true");
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).notifications.daily.includes(30)`), true);

await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute("aria-pressed")`), "false");
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).notifications.daily.includes(30)`), false);

await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=characters" });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(await evaluate(`document.querySelectorAll('.check-control').length`), 3);
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('.check-control span'), (node) => node.textContent)`),
  ["内容確認", "内容確認"],
);
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('.check-control .check'), (node) => node.getAttribute("aria-label"))`),
  ["補給依頼（日）の内容確認", "補給依頼（週）の内容確認", "シーズンミッション（週）を切り替える"],
);
assert.equal(await evaluate(`Array.from(document.querySelectorAll('.check-control span'), (node) => node.textContent).includes("購入")`), false);
assert.equal(await evaluate(`document.body.textContent.includes("聖域")`), false);
assert.ok(await evaluate(`document.body.textContent.includes("ルドラ 残数")`));
assert.equal(await evaluate(`document.querySelectorAll('.managed-toggle').length`), 12);
const farmManagedSelector = '.managed-toggle[data-path="characters.0.tracked.farmGiena"]';
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(farmManagedSelector)}).getAttribute("aria-pressed")`), "true");
await evaluate(`document.querySelector(${JSON.stringify(farmManagedSelector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).characters[0].tracked.farmGiena`), false);
assert.equal(await evaluate(`document.querySelector('.input[data-path="characters.0.farmGiena"]').disabled`), true);
assert.ok(await evaluate(`document.body.textContent.includes("管理対象外")`));
const naturalSelector = '.counter-input[data-path="characters.0.odeNatural"]';
const bonusSelector = '.counter-input[data-path="characters.0.odeBonus"]';
const nightmareManagedSelector = '.managed-toggle[data-path="characters.0.tracked.nightmareState"]';
const odeStateManagedSelector = '.managed-toggle[data-path="characters.0.tracked.odeState"]';
const corridorManagedSelector = '.managed-toggle[data-path="characters.0.tracked.corridorState"]';
for (const [toggleSelector, inputSelector, trackedKey] of [
  [nightmareManagedSelector, '.counter-input[data-path="characters.0.nightmare"]', "nightmareState"],
  [odeStateManagedSelector, naturalSelector, "odeState"],
]) {
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(toggleSelector)}).getAttribute("aria-pressed")`), "true");
  await evaluate(`document.querySelector(${JSON.stringify(toggleSelector)}).click()`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).characters[0].tracked[${JSON.stringify(trackedKey)}]`), false);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).disabled`), true);
  await evaluate(`document.querySelector(${JSON.stringify(toggleSelector)}).click()`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).disabled`), false);
}
await evaluate(`document.querySelector(${JSON.stringify(corridorManagedSelector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).characters[0].tracked.corridorState`), false);
assert.ok(await evaluate(`document.querySelector(${JSON.stringify(corridorManagedSelector)}).closest('.managed-panel').classList.contains('is-unmanaged')`));
await evaluate(`document.querySelector(${JSON.stringify(corridorManagedSelector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(naturalSelector)}).max`), "840");
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(bonusSelector)}).max`), "2000");
assert.ok(await evaluate(`document.querySelector('.managed-toggle[data-path="characters.0.tracked.odePurchased"]') !== null`));
assert.ok(await evaluate(`document.querySelector('.managed-toggle[data-path="characters.0.tracked.odeCrafted"]') !== null`));
assert.ok(await evaluate(`document.body.textContent.includes("オードショップ購入")`));
assert.ok(await evaluate(`document.body.textContent.includes("オード物質変換（キャラ）")`));

await evaluate(`document.querySelector('.char-tab[data-id="char-2"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
for (const key of ["farmGiena", "supplyDaily", "sanctuary", "battleground", "supplyWeekly", "seasonWeekly"]) {
  assert.equal(
    await evaluate(`document.querySelector('.managed-toggle[data-path="characters.1.tracked.${key}"]').getAttribute("aria-pressed")`),
    "false",
  );
}
assert.equal(await evaluate(`document.querySelector('.managed-toggle[data-path="characters.1.tracked.awakening"]').getAttribute("aria-pressed")`), "true");
await evaluate(`document.querySelector('.char-tab[data-id="char-1"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));

await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(naturalSelector)}); input.focus(); input.value = "750"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).characters[0].odeNatural`), 750);

await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(bonusSelector)}); input.value = "2500"; input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).characters[0].odeBonus`), 2000);

await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=shared" });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(await evaluate(`document.querySelector('.brand strong').textContent`), "A2 ルーティン&ボストラッカー");
assert.ok(await evaluate(`document.body.textContent.includes("オード物質変換（サーバー）")`));
assert.equal(await evaluate(`document.body.textContent.includes("オード物質変換（共有）")`), false);
assert.ok(await evaluate(`document.body.textContent.includes("次元侵攻の鍵")`));
assert.ok(await evaluate(`document.body.textContent.includes("16:00に+1")`));
assert.equal(await evaluate(`document.body.textContent.includes("暫定仕様：")`), false);
assert.equal(
  await evaluate(`document.querySelectorAll('.counter-row .step').length / 2`),
  await evaluate(`document.querySelectorAll('.counter-row .counter-input').length`),
  "every plus/minus counter must also have a direct input",
);
assert.equal(await evaluate(`document.body.textContent.includes("報酬減衰")`), false);
assert.equal(await evaluate(`document.body.textContent.includes("探検")`), false);
assert.equal(await evaluate(`document.body.textContent.includes("征服")`), false);
assert.equal(await evaluate(`document.body.textContent.includes("超越")`), false);
assert.equal(await evaluate(`document.querySelectorAll('.managed-toggle').length`), 8);
const demonicSelector = '.counter-input[data-path="shared.weeklyDemonic"]';
const abyssSelector = '.counter-input[data-path="shared.weeklyAbyss"]';
const demonicManagedSelector = '.managed-toggle[data-path="shared.tracked.weeklyDemonic"]';
await evaluate(`document.querySelector(${JSON.stringify(demonicManagedSelector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).shared.tracked.weeklyDemonic`), false);
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demonicSelector)}).disabled`), true);
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(abyssSelector)}).disabled`), false);
await evaluate(`document.querySelector(${JSON.stringify(demonicManagedSelector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demonicSelector)}).disabled`), false);
assert.ok(await evaluate(`document.querySelector('.managed-toggle[data-path="shared.tracked.shugo"]') !== null`));
assert.ok(await evaluate(`document.querySelector('.managed-toggle[data-path="shared.tracked.invasionKeys"]') !== null`));
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demonicSelector)}).max`), "12");
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(abyssSelector)}).max`), "20");
await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(demonicSelector)}); input.value = "12"; input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await new Promise((resolve) => setTimeout(resolve, 100));
await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(abyssSelector)}); input.value = "20"; input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.deepEqual(
  await evaluate(`(() => { const saved = JSON.parse(localStorage.getItem("aion2-helper-v1")); return [saved.shared.weeklyDemonic, saved.shared.weeklyAbyss]; })()`),
  [12, 20],
);
assert.ok(await evaluate(`document.body.textContent.includes("合計 32/32")`));
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('.recurring-event-card h3'), (node) => node.textContent)`),
  ["シューゴフェスタ", "次元侵攻", "時空の裂け目"],
);
assert.ok(await evaluate(`document.body.textContent.includes("毎時00分")`));
assert.ok(await evaluate(`document.body.textContent.includes("毎時30分")`));
assert.ok(await evaluate(`document.body.textContent.includes("3時間周期")`));
const shugoFiveSelector = '.recurring-event-card[data-event-id="shugo-festa"] [data-minutes="5"]';
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(shugoFiveSelector)}).getAttribute("aria-pressed")`), "false");
await evaluate(`document.querySelector(${JSON.stringify(shugoFiveSelector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(shugoFiveSelector)}).getAttribute("aria-pressed")`), "true");
assert.deepEqual(
  await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).recurringEvents[0].notifyMinutes`),
  [5],
);
assert.equal(
  await evaluate(`document.querySelectorAll('.recurring-event-card[data-event-id="dimension-invasion"] .notification-chip').length`),
  4,
);
const timeRiftTenSelector = '.recurring-event-card[data-event-id="time-rift"] [data-minutes="10"]';
assert.equal(await evaluate(`document.querySelectorAll('.recurring-event-card[data-event-id="time-rift"] .notification-chip').length`), 4);
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(timeRiftTenSelector)}).getAttribute("aria-pressed")`), "false");
await evaluate(`document.querySelector(${JSON.stringify(timeRiftTenSelector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.deepEqual(
  await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).recurringEvents.find((event) => event.id === "time-rift").notifyMinutes`),
  [10],
);

await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=dashboard" });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(await evaluate(`document.body.textContent.includes("報酬減衰")`), false);
assert.equal(await evaluate(`document.body.textContent.includes("聖域")`), false);
assert.ok(await evaluate(`Array.from(document.querySelectorAll("th"), (node) => node.textContent).includes("ルドラ")`));
assert.ok(await evaluate(`document.body.textContent.includes("個々の項目で★を付けたものだけ、ダッシュボードで管理します。")`));
assert.equal(
  await evaluate(`getComputedStyle(document.querySelector('.dashboard-managed-note')).fontSize`),
  await evaluate(`getComputedStyle(document.querySelector('.section-head h2')).fontSize`),
);
assert.equal(await evaluate(`document.body.textContent.includes("補給要請")`), false);
assert.equal(await evaluate(`document.body.textContent.includes("シーズン任務")`), false);
assert.equal(await evaluate(`document.querySelector('.summary-card[data-summary="daily"] .metric-value').textContent`), "0 / 4");
assert.equal(await evaluate(`document.querySelector('.summary-card[data-summary="weekly"] .metric-value').textContent`), "2 / 21");
assert.equal(await evaluate(`document.body.textContent.includes("未購入")`), false);
assert.equal(await evaluate(`document.querySelectorAll('[data-path="shared.exploration"], [data-path="shared.conquest"], [data-path="shared.transcendence"]').length`), 0);
assert.equal(await evaluate(`document.querySelectorAll('.next-action-row').length`), 5);
assert.equal(await evaluate(`document.querySelector('.next-action-row .next-action-main strong').textContent`), "デイリークエスト");
assert.equal(await evaluate(`document.querySelector('.priority-modal') === null`), true);
await evaluate(`document.querySelector('[data-action="open-priority-settings"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.ok(await evaluate(`document.querySelector('.priority-settings') !== null`));
assert.equal(await evaluate(`document.querySelector('.priority-modal').getAttribute('role')`), "dialog");
assert.equal(await evaluate(`document.querySelector('.priority-modal').getAttribute('aria-modal')`), "true");
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.priority-modal-backdrop')).position`), "fixed");
assert.equal(await evaluate(`document.querySelector('[data-action="export-priorities"]') === null`), true);
assert.ok(await evaluate(`document.querySelector('.priority-modal').textContent.includes("オードショップ購入")`));
assert.ok(await evaluate(`document.querySelector('.priority-modal').textContent.includes("オード物質変換（キャラ）")`));
assert.ok(await evaluate(`document.querySelector('.priority-modal').textContent.includes("オード物質変換（サーバー）")`));
assert.equal(await evaluate(`document.querySelector('.priority-modal').textContent.includes("オード物質変換（共有）")`), false);
assert.equal(await evaluate(`document.querySelectorAll('.priority-settings-section:first-of-type .priority-setting-row').length`), 8);
assert.equal(await evaluate(`document.querySelectorAll('.priority-settings-columns > div:first-child .priority-setting-row').length`), 8);
assert.equal(await evaluate(`document.querySelectorAll('.priority-settings-columns > div:last-child .priority-setting-row').length`), 5);
assert.equal(await evaluate(`document.querySelector('.priority-settings [data-path="shared.priorities.weeklyMissions"]') === null`), true);
assert.equal(await evaluate(`document.querySelector('.priority-settings [data-path="characters.0.priorities.farmGiena"]') === null`), true);
const dailyQuestUrgentSelector = '.priority-choice[data-path="shared.priorities.dailyQuests"][data-priority="urgent"]';
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(dailyQuestUrgentSelector)}).getAttribute("aria-pressed")`), "true");
assert.equal(await evaluate(`document.querySelector('.priority-choice[data-path="shared.priorities.dailyDungeon"][data-priority="high"]').getAttribute("aria-pressed")`), "true");
assert.equal(await evaluate(`document.querySelector('.priority-choice[data-path="shared.priorities.afResult"][data-priority="urgent"]').getAttribute("aria-pressed")`), "true");
assert.equal(await evaluate(`document.querySelector('.priority-choice[data-path="characters.0.priorities.awakening"][data-priority="high"]').getAttribute("aria-pressed")`), "true");
assert.equal(await evaluate(`document.querySelector('.priority-choice[data-path="characters.0.priorities.odePurchased"][data-priority="high"]').getAttribute("aria-pressed")`), "true");
await evaluate(`document.querySelector(${JSON.stringify(dailyQuestUrgentSelector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).shared.priorities.dailyQuests`), "urgent");
assert.equal(await evaluate(`document.querySelector(${JSON.stringify(dailyQuestUrgentSelector)}).getAttribute("aria-pressed")`), "true");
await evaluate(`document.querySelector('.priority-character-tabs [data-id="char-2"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`document.querySelector('.priority-character-tabs .char-tab.active').textContent`), "キャラクター2");
const secondCharacterOdeSelector = '.priority-choice[data-path="characters.1.priorities.odeLow"][data-priority="high"]';
await evaluate(`document.querySelector(${JSON.stringify(secondCharacterOdeSelector)}).click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).characters[1].priorities.odeLow`), "high");
await evaluate(`document.querySelector('[data-action="close-priority-settings"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`document.querySelector('.priority-modal') === null`), true);
assert.equal(await evaluate(`document.body.classList.contains('modal-open')`), false);
await evaluate(`document.querySelector('[data-action="open-priority-settings"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(await evaluate(`document.querySelector('.priority-modal') === null`), true);
await evaluate(`document.querySelector('[data-action="open-priority-settings"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
await evaluate(`document.querySelector('.priority-modal-backdrop').click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(await evaluate(`document.querySelector('.priority-modal') === null`), true);

await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=world-bosses" });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(await evaluate(`document.querySelectorAll('.world-boss-tab').length`), 2);
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('.world-boss-tab'), (node) => node.childNodes[0].textContent)`),
  ["魔族/天族", "アビス"],
);
assert.equal(await evaluate(`document.querySelectorAll('.boss-card').length`), 4);
assert.equal(await evaluate(`document.querySelector('.sidebar-foot') === null`), true);
assert.equal(await evaluate(`document.body.textContent.includes('ローカル保存')`), false);
assert.equal(await evaluate(`document.body.textContent.includes('外部通信なし')`), false);
assert.equal(await evaluate(`document.querySelector('.boss-card h3').textContent`), "不滅のガルトゥア");
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('.boss-card h3'), (node) => node.textContent)`),
  ["不滅のガルトゥア", "軍団長ラグタ", "沈黙のタルタン", "魂の支配者カシャパ"],
);
assert.equal(await evaluate(`document.querySelector('.boss-time-input[data-id="silent-tartan"]').value`), "21:13");
assert.equal(await evaluate(`document.querySelector('[data-boss-id="silent-tartan"] .boss-time-setting span').textContent`), "から6時間ごと");
assert.equal(await evaluate(`document.querySelector('.boss-time-input[data-id="soul-ruler-kashapa"]').value`), "21:14");
assert.equal(await evaluate(`document.querySelector('[data-boss-id="soul-ruler-kashapa"] .boss-time-setting span').textContent`), "から6時間ごと");
assert.equal(await evaluate(`document.querySelector('[data-boss-id="silent-tartan"] [data-minutes="10"]').getAttribute("aria-pressed")`), "true");
await evaluate(`document.querySelector('[data-boss-id="silent-tartan"] [data-minutes="10"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.deepEqual(
  await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).worldBosses[0].bosses[2].notifyMinutes`),
  [5],
);
const gartuaTimeSelector = '.boss-time-input[data-id="immortal-gartua"]';
const gartuaInputIdentity = await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(gartuaTimeSelector)}); window.__bossTimeInput = input; input.click(); return input === document.querySelector(${JSON.stringify(gartuaTimeSelector)}); })()`);
assert.equal(gartuaInputIdentity, true, "clicking a boss time input must not replace it before the native picker opens");
await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(gartuaTimeSelector)}); input.value = "10:15"; input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(
  await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).worldBosses[0].bosses[0].baseTime`),
  "10:15",
);
assert.equal(await evaluate(`document.querySelector('[data-boss-id="immortal-gartua"] [data-minutes="30"]').getAttribute("aria-pressed")`), "true");
assert.equal(await evaluate(`document.querySelector('[data-boss-id="immortal-gartua"] [data-minutes="10"]').getAttribute("aria-pressed")`), "true");
assert.equal(await evaluate(`document.querySelector('[data-boss-id="immortal-gartua"] [data-minutes="5"]').getAttribute("aria-pressed")`), "true");
assert.equal(await evaluate(`document.querySelector('[data-boss-id="immortal-gartua"] [data-minutes="5"]').textContent`), "5分");
await evaluate(`document.querySelector('[data-boss-id="immortal-gartua"] [data-minutes="10"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.deepEqual(
  await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).worldBosses[0].bosses[0].notifyMinutes`),
  [30, 5],
);
await evaluate(`document.querySelector('.world-boss-tab[data-id="abyss"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`document.querySelectorAll('.boss-card').length`), 3);
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('.boss-card h3'), (node) => node.textContent)`),
  ["監視者カイラ", "守護神将ナフマ", "精霊王アグロ"],
);
assert.equal(await evaluate(`document.querySelector('.boss-time-input[data-id="kaira"]').value`), "01:00");
assert.equal(await evaluate(`document.querySelector('[data-boss-id="guardian-general-nahma"] .boss-fixed-schedule strong').textContent`), "金曜・日曜");
assert.match(await evaluate(`document.querySelector('[data-boss-id="guardian-general-nahma"] .boss-next-time').textContent`), /21:00$/);
const nahmaTimeSelector = '.boss-time-input[data-id="guardian-general-nahma"]';
await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(nahmaTimeSelector)}); input.value = "22:15"; input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(
  await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).worldBosses[1].bosses[1].time`),
  "22:15",
);
assert.deepEqual(
  await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).worldBosses[1].bosses[1].notifyMinutes`),
  [60, 50, 40, 30],
);
assert.equal(await evaluate(`document.querySelector('.boss-time-input[data-id="spirit-king-agro"]').value`), "09:32");
assert.equal(await evaluate(`document.querySelector('[data-boss-id="spirit-king-agro"] [data-minutes="30"]').getAttribute("aria-pressed")`), "true");
await evaluate(`document.querySelector('[data-boss-id="spirit-king-agro"] [data-minutes="5"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.deepEqual(
  await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).worldBosses[1].bosses[2].notifyMinutes`),
  [30, 5],
);

await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=notes" });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(await evaluate(`document.querySelector('.nav-button.active').textContent.includes("メモ")`), true);
assert.equal(await evaluate(`document.querySelectorAll('.memo-character-tabs .char-tab').length`), 4);
assert.equal(await evaluate(`(() => { const memo = document.querySelector('.memo-editor'); window.__memoEditor = memo; memo.click(); return memo === document.querySelector('.memo-editor'); })()`), true);
await evaluate(`(() => { const memo = document.querySelector('.memo-editor'); memo.innerHTML = "装備目標<br>クリ率を調整"; memo.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`window.__memoEditor === document.querySelector('.memo-editor')`), true);
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).characters[0].memoHtml`), "装備目標<br>クリ率を調整");
await evaluate(`(() => {
  const memo = document.querySelector('.memo-editor');
  const text = memo.childNodes[2];
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 3);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
})()`);
await new Promise((resolve) => setTimeout(resolve, 100));
await evaluate(`document.querySelector('.memo-color[data-color="#65ffca"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.match(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).characters[0].memoHtml`), /color:#65ffca[^>]*>クリ率/);
assert.equal(await evaluate(`document.querySelector('.memo-editor').textContent.includes("を調整")`), true);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.memo-editor span')).color`), "rgb(101, 255, 202)");
await evaluate(`(() => { const saved = JSON.parse(localStorage.getItem("aion2-helper-v1")); saved.characters[0].memoHtml = '<img src=x onerror="window.__memoXss=1"><b>安全</b><span style="color:#65ffca">色付き</span>'; localStorage.setItem("aion2-helper-v1", JSON.stringify(saved)); })()`);
await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=notes" });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(await evaluate(`document.querySelector('.memo-editor img') === null`), true);
assert.equal(await evaluate(`document.querySelector('.memo-editor b') === null`), true);
assert.equal(await evaluate(`document.querySelector('.memo-editor').textContent.includes("安全色付き")`), true);
assert.equal(await evaluate(`window.__memoXss === undefined`), true);
assert.equal(await evaluate(`JSON.parse(localStorage.getItem("aion2-helper-v1")).characters[0].memoHtml.includes("img")`), false);
await evaluate(`document.querySelectorAll('.memo-character-tabs .char-tab')[1].click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(await evaluate(`document.querySelector('.memo-editor').innerHTML`), "");

await evaluate(`(() => {
  const saved = JSON.parse(localStorage.getItem("aion2-helper-v1"));
  saved.characters[0].odeNatural = 0;
  saved.characters[0].nightmare = 9;
  saved.characters[0].abyssGranted = 0;
  saved.characters[0].abyssUsed = 0;
  saved.characters[1].odeNatural = 0;
  saved.characters[1].nightmare = 10;
  saved.characters[1].abyssGranted = 3;
  saved.characters[1].abyssUsed = 0;
  saved.characters[3].odeNatural = 720;
  saved.characters[3].nightmare = 14;
  saved.characters[3].abyssGranted = 3;
  saved.characters[3].abyssUsed = 1;
  localStorage.setItem("aion2-helper-v1", JSON.stringify(saved));
})()`);
await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=dashboard" });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('.summary-card .metric-label'), (node) => node.textContent)`),
  ["今日", "今週", "オード警告", "回廊権利"],
);
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('th'), (node) => node.textContent)`),
  ["キャラクター", "オード", "今日", "今週", "ルドラ", "回廊", "購入", "警告"],
);
assert.equal(await evaluate(`document.querySelector('.summary-card[data-summary="daily"] .metric-open').textContent.includes("内訳を見る")`), true);
await evaluate(`document.querySelector('.summary-card[data-summary="daily"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.ok(await evaluate(`document.querySelector('[data-summary-detail="daily"]') !== null`));
assert.ok(await evaluate(`document.querySelector('[data-summary-detail="daily"]').textContent.includes("今日の未完了")`));
assert.ok(await evaluate(`document.querySelector('[data-summary-detail="daily"]').textContent.includes("デイリークエスト")`));
assert.equal(await evaluate(`document.querySelectorAll('[data-summary-detail="daily"] .summary-detail-row').length`), 4);
await evaluate(`document.querySelector('[data-summary-detail="daily"] .summary-detail-row[data-view-target="shared"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(await evaluate(`document.querySelector('.nav-button.active').textContent.includes("アカウント共有")`), true);

await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=dashboard" });
await new Promise((resolve) => setTimeout(resolve, 200));
await evaluate(`document.querySelector('.summary-card[data-summary="daily"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.ok(await evaluate(`document.querySelector('[data-summary-detail="daily"] .summary-detail-row[data-id="char-1"]') !== null`));
await evaluate(`document.querySelector('[data-summary-detail="daily"] .summary-detail-row[data-id="char-1"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(await evaluate(`document.querySelector('.nav-button.active').textContent.includes("キャラクター")`), true);
assert.equal(await evaluate(`document.querySelector('.char-tab.active').textContent`), "キャラクター1");

await command("Page.navigate", { url: "http://127.0.0.1:8772/?view=dashboard" });
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(await evaluate(`document.querySelector('tr[data-id="char-1"] td:last-child').textContent.trim()`), "正常");
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('tr[data-id="char-2"] .alert-summary li'), (node) => node.textContent)`),
  ["悪夢 10以上", "回廊 残り3回"],
);
assert.deepEqual(
  await evaluate(`Array.from(document.querySelectorAll('tr[data-id="char-4"] .alert-summary li'), (node) => node.textContent)`),
  ["オード 720以上", "悪夢 10以上", "回廊 残り2回"],
);
await evaluate(`document.querySelector('tr[data-id="char-2"] .alert-summary li').click()`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`document.querySelector('.nav-button.active').textContent.includes("キャラクター")`), true);
assert.equal(await evaluate(`document.querySelector('.char-tab.active').textContent`), "キャラクター2");

socket.close();
console.log("UI_SMOKE_OK");
