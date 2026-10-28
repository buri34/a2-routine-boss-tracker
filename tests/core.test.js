const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../dist/core.js");

function jst(y, m, d, h, min = 0, second = 0) { return C.fromJst(y, m - 1, d, h, min, second); }

test("daily reset is fixed to 16:00 JST", () => {
  assert.equal(C.dailyResetAtOrBefore(jst(2026, 10, 21, 15, 59)), jst(2026, 10, 20, 16));
  assert.equal(C.dailyResetAtOrBefore(jst(2026, 10, 21, 16)), jst(2026, 10, 21, 16));
  assert.equal(C.nextDailyReset(jst(2026, 10, 21, 16)), jst(2026, 10, 22, 16));
});

test("weekly reset is Wednesday 16:00 JST", () => {
  assert.equal(C.weeklyResetAtOrBefore(jst(2026, 10, 21, 15, 59)), jst(2026, 10, 14, 16));
  assert.equal(C.weeklyResetAtOrBefore(jst(2026, 10, 21, 16)), jst(2026, 10, 21, 16));
});

test("next AF is Monday, Thursday or Saturday at 21:00", () => {
  assert.equal(C.nextAfReset(jst(2026, 10, 21, 20)), jst(2026, 10, 22, 21));
  assert.equal(C.nextAfReset(jst(2026, 10, 22, 21)), jst(2026, 10, 24, 21));
  assert.equal(C.nextAfReset(jst(2026, 10, 24, 21)), jst(2026, 10, 26, 21));
});

test("ode recovers at each fixed three-hour tick", () => {
  assert.equal(C.odeTicksBetween(jst(2026, 10, 21, 15, 59), jst(2026, 10, 21, 16)), 1);
  assert.equal(C.odeTicksBetween(jst(2026, 10, 21, 16), jst(2026, 10, 21, 22)), 2);
  assert.equal(C.odeTicksBetween(jst(2026, 10, 21, 15), jst(2026, 10, 22, 15)), 8);
});

test("catch-up applies daily recovery without exceeding caps", () => {
  const start = jst(2026, 10, 20, 16);
  const state = C.initialState(start);
  state.shared.shugo = 20;
  state.shared.invasionKeys = 7;
  state.characters[0].nightmare = 13;
  const result = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.equal(result.shared.shugo, 21);
  assert.equal(result.shared.invasionKeys, 7);
  assert.equal(result.characters[0].nightmare, 14);
});

test("weekly reset replenishes charge-based content", () => {
  const start = jst(2026, 10, 14, 16);
  const state = C.initialState(start);
  state.shared.dailyDungeon = 3;
  state.characters[0].sanctuary = 0;
  state.characters[0].awakening = 1;
  const result = C.catchUp(state, jst(2026, 10, 21, 16));
  assert.equal(result.shared.dailyDungeon, 14);
  assert.equal(result.characters[0].sanctuary, 2);
  assert.equal(result.characters[0].awakening, 3);
});

test("weekly mission counts are independently capped at 12 for Asmodian and 20 for Abyss", () => {
  const state = C.initialState(jst(2026, 10, 21, 16));
  state.shared.weeklyDemonic = 20;
  state.shared.weeklyAbyss = 30;
  const result = C.catchUp(state, jst(2026, 10, 21, 16));
  assert.equal(result.shared.weeklyDemonic, 12);
  assert.equal(result.shared.weeklyAbyss, 20);
  assert.equal(result.shared.weeklyDemonic + result.shared.weeklyAbyss, 32);
});

test("known v1 Abyss value clipped to 8 is restored to 20 once", () => {
  const state = C.initialState(jst(2026, 10, 21, 16));
  state.version = 1;
  state.shared.weeklyDemonic = 12;
  state.shared.weeklyAbyss = 8;
  const result = C.catchUp(state, jst(2026, 10, 21, 16));
  assert.equal(result.version, 11);
  assert.equal(result.shared.weeklyDemonic, 12);
  assert.equal(result.shared.weeklyAbyss, 20);
});

test("legacy reward-decay counters are removed during state migration", () => {
  const state = C.initialState(jst(2026, 10, 21, 16));
  state.version = 2;
  state.shared.exploration = 100;
  state.shared.conquest = 80;
  state.shared.transcendence = 60;
  const result = C.catchUp(state, jst(2026, 10, 21, 16));
  assert.equal(result.version, 11);
  assert.equal("exploration" in result.shared, false);
  assert.equal("conquest" in result.shared, false);
  assert.equal("transcendence" in result.shared, false);
});

test("AF reset expires all character rights", () => {
  const start = jst(2026, 10, 19, 21);
  const state = C.initialState(start);
  state.characters[0].abyssGranted = 3;
  state.characters[0].abyssUsed = 1;
  const result = C.catchUp(state, jst(2026, 10, 22, 21));
  assert.equal(result.characters[0].abyssGranted, 0);
  assert.equal(result.characters[0].abyssUsed, 0);
  assert.equal(result.shared.afResultPending, true);
});

test("ode spending uses natural energy before bonus energy", () => {
  const character = C.makeCharacter("char-1", 0);
  character.odeNatural = 60;
  character.odeBonus = 100;
  assert.equal(C.spendOde(character, 80), true);
  assert.equal(character.odeNatural, 0);
  assert.equal(character.odeBonus, 80);
});

test("ode spending rejects unsupported units and insufficient balance", () => {
  const character = C.makeCharacter("char-1", 0);
  character.odeNatural = 20;
  character.odeBonus = 10;
  assert.equal(C.spendOde(character, 15), false);
  assert.equal(C.spendOde(character, 40), false);
  assert.equal(character.odeNatural, 20);
  assert.equal(character.odeBonus, 10);
});

test("notification choices toggle on and off and remain sorted", () => {
  assert.deepEqual(C.toggleNotification([180, 60], 30), [180, 60, 30]);
  assert.deepEqual(C.toggleNotification([180, 60, 30], 60), [180, 30]);
});

test("recurring event defaults include hourly events and the three-hour time rift with notifications off", () => {
  const events = C.recurringEventDefaults();
  assert.deepEqual(events, [
    { id: "shugo-festa", name: "シューゴフェスタ", minuteOfHour: 0, notifyMinutes: [] },
    { id: "dimension-invasion", name: "次元侵攻", minuteOfHour: 30, notifyMinutes: [] },
    { id: "time-rift", name: "時空の裂け目", baseTime: "17:00", intervalHours: 3, notifyMinutes: [] },
  ]);
});

test("time rift recurs every three hours from the 17:00 JST anchor", () => {
  const event = C.recurringEventDefaults().find((entry) => entry.id === "time-rift");
  assert.deepEqual(
    C.recurringEventOccurrences(event, jst(2026, 10, 27, 15), 4),
    [jst(2026, 10, 27, 17), jst(2026, 10, 27, 20), jst(2026, 10, 27, 23), jst(2026, 10, 28, 2)],
  );
  assert.deepEqual(
    C.recurringEventOccurrences(event, jst(2026, 10, 27, 17), 1),
    [jst(2026, 10, 27, 20)],
  );
});

test("hourly recurring events calculate the next occurrences in JST", () => {
  assert.deepEqual(
    C.nextHourlyOccurrences(0, jst(2026, 10, 26, 7, 8), 3),
    [jst(2026, 10, 26, 8), jst(2026, 10, 26, 9), jst(2026, 10, 26, 10)],
  );
  assert.deepEqual(
    C.nextHourlyOccurrences(30, jst(2026, 10, 26, 7, 8), 2),
    [jst(2026, 10, 26, 7, 30), jst(2026, 10, 26, 8, 30)],
  );
  assert.deepEqual(
    C.nextHourlyOccurrences(0, jst(2026, 10, 26, 8), 1),
    [jst(2026, 10, 26, 9)],
  );
});

test("legacy state receives recurring event defaults without changing valid progress", () => {
  const state = C.initialState(jst(2026, 10, 26, 7));
  state.version = 3;
  state.shared.weeklyAbyss = 8;
  delete state.recurringEvents;
  const migrated = C.catchUp(state, jst(2026, 10, 26, 7));
  assert.equal(migrated.version, 11);
  assert.equal(migrated.shared.weeklyAbyss, 8, "v3 progress must not repeat the old 8-to-20 repair");
  assert.deepEqual(migrated.recurringEvents.map((event) => event.name), ["シューゴフェスタ", "次元侵攻", "時空の裂け目"]);
});

test("saved recurring event notification choices survive migration and reject unsupported leads", () => {
  const state = C.initialState(jst(2026, 10, 26, 7));
  state.recurringEvents[0].notifyMinutes = [10, 5, 3, 1, 30];
  state.recurringEvents = state.recurringEvents.filter((event) => event.id !== "time-rift");
  const migrated = C.catchUp(state, jst(2026, 10, 26, 7));
  assert.deepEqual(migrated.recurringEvents[0].notifyMinutes, [10, 5, 3, 1]);
  assert.deepEqual(migrated.recurringEvents.find((event) => event.id === "time-rift")?.notifyMinutes, []);
});

test("character alert summary identifies the exact warning sources", () => {
  const character = C.makeCharacter("char-1", 0);
  character.nightmare = 9;
  assert.deepEqual(C.characterAlerts(character), []);

  character.odeNatural = 719;
  assert.deepEqual(C.characterAlerts(character), []);

  character.odeNatural = 720;
  assert.deepEqual(C.characterAlerts(character), [
    { id: "ode-high", label: "オード 720以上" },
  ]);

  character.nightmare = 10;
  assert.deepEqual(C.characterAlerts(character), [
    { id: "ode-high", label: "オード 720以上" },
    { id: "nightmare-high", label: "悪夢 10以上" },
  ]);

  character.abyssGranted = 3;
  character.abyssUsed = 1;
  assert.deepEqual(C.characterAlerts(character), [
    { id: "ode-high", label: "オード 720以上" },
    { id: "nightmare-high", label: "悪夢 10以上" },
    { id: "abyss-corridor", label: "回廊 残り2回" },
  ]);

  character.tracked.odeState = false;
  character.tracked.nightmareState = false;
  character.tracked.corridorState = false;
  assert.deepEqual(C.characterAlerts(character), []);

  character.tracked.odeState = true;
  character.tracked.nightmareState = true;
  character.tracked.corridorState = true;

  character.odeNatural = 719;
  character.nightmare = 9;
  character.abyssUsed = 3;
  assert.deepEqual(C.characterAlerts(character), []);
});

test("world boss defaults combine faction regions and contain required bosses", () => {
  const categories = C.worldBossDefaults();
  assert.deepEqual(categories.map((category) => category.id), ["faction", "abyss"]);
  assert.deepEqual(categories.map((category) => category.name), ["魔族/天族", "アビス"]);
  assert.deepEqual(categories[0].bosses.map((boss) => boss.name), [
    "不滅のガルトゥア",
    "軍団長ラグタ",
    "沈黙のタルタン",
    "魂の支配者カシャパ",
  ]);
  assert.equal(categories[0].bosses[0].intervalHours, 12);
  assert.deepEqual(categories[0].bosses[0].notifyMinutes, [30, 10, 5]);
  assert.deepEqual(categories[0].bosses[1].notifyMinutes, [30, 10, 5]);
  assert.equal(categories[0].bosses[2].baseTime, "21:13");
  assert.equal(categories[0].bosses[2].intervalHours, 6);
  assert.deepEqual(categories[0].bosses[2].notifyMinutes, [10, 5]);
  assert.equal(categories[0].bosses[3].baseTime, "21:14");
  assert.equal(categories[0].bosses[3].intervalHours, 6);
  assert.deepEqual(categories[0].bosses[3].notifyMinutes, [10, 5]);
  assert.equal(categories[1].bosses[0].name, "監視者カイラ");
  assert.equal(categories[1].bosses[0].intervalHours, 3);
  assert.deepEqual(categories[1].bosses[0].notifyMinutes, []);
  assert.equal(categories[1].bosses[1].name, "守護神将ナフマ");
  assert.deepEqual(categories[1].bosses[1].weekdays, [5, 0]);
  assert.equal(categories[1].bosses[1].time, "21:00");
  assert.deepEqual(categories[1].bosses[1].notifyMinutes, [60, 50, 40, 30]);
  assert.equal(categories[1].bosses[2].name, "精霊王アグロ");
  assert.equal(categories[1].bosses[2].baseTime, "09:32");
  assert.equal(categories[1].bosses[2].intervalHours, 12);
  assert.deepEqual(categories[1].bosses[2].notifyMinutes, [30]);
});

test("weekly world boss occurrences use selected JST weekdays", () => {
  assert.deepEqual(
    C.nextWeeklyOccurrences([5, 0], "21:00", jst(2026, 10, 23, 20, 54), 4),
    [
      jst(2026, 10, 23, 21),
      jst(2026, 10, 25, 21),
      jst(2026, 10, 30, 21),
      jst(2026, 11, 1, 21),
    ],
  );
  assert.deepEqual(
    C.nextWeeklyOccurrences([5, 0], "21:00", jst(2026, 10, 23, 21), 2),
    [jst(2026, 10, 25, 21), jst(2026, 10, 30, 21)],
  );
});

test("periodic world boss occurrences use one JST base time", () => {
  assert.deepEqual(
    C.nextPeriodicOccurrences("09:02", 12, jst(2026, 10, 22, 8), 3),
    [jst(2026, 10, 22, 9, 2), jst(2026, 10, 22, 21, 2), jst(2026, 10, 23, 9, 2)],
  );
  assert.deepEqual(
    C.nextPeriodicOccurrences("01:00", 3, jst(2026, 10, 22, 22, 10), 2),
    [jst(2026, 10, 23, 1), jst(2026, 10, 23, 4)],
  );
  assert.deepEqual(
    C.nextPeriodicOccurrences("21:13", 6, jst(2026, 10, 22, 22), 3),
    [jst(2026, 10, 23, 3, 13), jst(2026, 10, 23, 9, 13), jst(2026, 10, 23, 15, 13)],
  );
});

test("old saved state is migrated with world boss defaults", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  delete state.worldBosses;
  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.equal(migrated.worldBosses.length, 2);
  assert.equal(migrated.worldBosses[0].name, "魔族/天族");
  assert.equal(migrated.worldBosses[0].bosses[0].baseTime, "09:02");
  assert.deepEqual(migrated.worldBosses[0].bosses.map((boss) => boss.name), [
    "不滅のガルトゥア",
    "軍団長ラグタ",
    "沈黙のタルタン",
    "魂の支配者カシャパ",
  ]);
  assert.deepEqual(migrated.worldBosses[1].bosses.map((boss) => boss.name), ["監視者カイラ", "守護神将ナフマ", "精霊王アグロ"]);
});

test("legacy faction categories merge without losing saved boss settings", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  state.version = 10;
  state.worldBosses = [
    {
      id: "asmodian",
      name: "魔族大陸",
      bosses: [{ ...state.worldBosses[0].bosses[0], baseTime: "10:15", notifyMinutes: [60, 10] }],
    },
    { id: "elyos", name: "天族大陸", bosses: [] },
    state.worldBosses[1],
  ];

  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.equal(migrated.version, 11);
  assert.deepEqual(migrated.worldBosses.map((category) => category.name), ["魔族/天族", "アビス"]);
  assert.equal(migrated.worldBosses[0].bosses[0].baseTime, "10:15");
  assert.deepEqual(migrated.worldBosses[0].bosses[0].notifyMinutes, [60, 10]);
});

test("old character data is migrated with independent memo defaults", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  delete state.characters[0].memoHtml;
  delete state.characters[0].memoText;
  delete state.characters[0].memoColor;
  delete state.characters[1].memoHtml;
  state.characters[1].memoText = "育成メモ";
  state.characters[1].memoColor = "#65ffca";
  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.equal(migrated.characters[0].memoHtml, "");
  assert.equal(migrated.characters[1].memoHtml, '<span style="color:#65ffca">育成メモ</span>');
  assert.equal("memoText" in migrated.characters[1], false);
  assert.equal("memoColor" in migrated.characters[1], false);
});

test("unsupported legacy memo colors migrate to safe unstyled text", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  delete state.characters[0].memoHtml;
  state.characters[0].memoColor = "#000000";
  state.characters[0].memoText = "危険色";
  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.equal(migrated.characters[0].memoHtml, "危険色");
});

test("legacy memo text is escaped while preserving newlines", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  delete state.characters[0].memoHtml;
  state.characters[0].memoText = '<script>alert("x")</script>\n次の行';
  state.characters[0].memoColor = "#ff8fa3";
  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.equal(migrated.characters[0].memoHtml, '<span style="color:#ff8fa3">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br>次の行</span>');
});

test("existing Kaira time survives rename and Nahma is added during migration", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  state.worldBosses[1].bosses = [{ id: "kaira", name: "カイラ", baseTime: "02:30", intervalHours: 3 }];
  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.equal(migrated.worldBosses[1].bosses[0].name, "監視者カイラ");
  assert.equal(migrated.worldBosses[1].bosses[0].baseTime, "02:30");
  assert.equal(migrated.worldBosses[1].bosses[1].name, "守護神将ナフマ");
  assert.equal(migrated.worldBosses[1].bosses[2].name, "精霊王アグロ");
});

test("saved world boss base time survives migration", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  state.worldBosses[0].bosses[0].baseTime = "10:15";
  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.equal(migrated.worldBosses[0].bosses[0].baseTime, "10:15");
});

test("existing world boss settings survive while new bosses are added", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  state.worldBosses[0].bosses = state.worldBosses[0].bosses.slice(0, 2);
  state.worldBosses[0].bosses[0].baseTime = "10:15";
  state.worldBosses[0].bosses[0].notifyMinutes = [60, 10];
  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));

  assert.equal(migrated.worldBosses[0].bosses[0].baseTime, "10:15");
  assert.deepEqual(migrated.worldBosses[0].bosses[0].notifyMinutes, [60, 10]);
  assert.equal(migrated.worldBosses[0].bosses[2].name, "沈黙のタルタン");
  assert.deepEqual(migrated.worldBosses[0].bosses[2].notifyMinutes, [10, 5]);
  assert.equal(migrated.worldBosses[0].bosses[3].name, "魂の支配者カシャパ");
  assert.deepEqual(migrated.worldBosses[0].bosses[3].notifyMinutes, [10, 5]);
});

test("saved boss notification choices and weekly time survive migration", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  state.worldBosses[0].bosses[0].notifyMinutes = [60, 10];
  state.worldBosses[0].bosses[2].notifyMinutes = [];
  state.worldBosses[1].bosses[1].time = "22:15";
  state.worldBosses[1].bosses[1].notifyMinutes = [50];
  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.deepEqual(migrated.worldBosses[0].bosses[0].notifyMinutes, [60, 10]);
  assert.deepEqual(migrated.worldBosses[0].bosses[2].notifyMinutes, []);
  assert.equal(migrated.worldBosses[1].bosses[1].time, "22:15");
  assert.deepEqual(migrated.worldBosses[1].bosses[1].notifyMinutes, [50]);
});

test("saved five-minute notification survives migration", () => {
  const state = C.initialState(jst(2026, 10, 22, 16));
  state.worldBosses[0].bosses[0].notifyMinutes = [30, 5];
  const migrated = C.catchUp(state, jst(2026, 10, 22, 16));
  assert.deepEqual(migrated.worldBosses[0].bosses[0].notifyMinutes, [30, 5]);
});

test("world boss occurrence dispatcher supports periodic and weekly schedules", () => {
  const defaults = C.worldBossDefaults();
  assert.deepEqual(
    C.worldBossOccurrences(defaults[0].bosses[0], jst(2026, 10, 22, 8), 2),
    [jst(2026, 10, 22, 9, 2), jst(2026, 10, 22, 21, 2)],
  );
  assert.deepEqual(
    C.worldBossOccurrences(defaults[1].bosses[1], jst(2026, 10, 23, 20, 54), 2),
    [jst(2026, 10, 23, 21), jst(2026, 10, 25, 21)],
  );
});

test("notification due window fires once around the selected lead time", () => {
  const target = jst(2026, 10, 23, 21);
  assert.equal(C.notificationDue(jst(2026, 10, 23, 20, 30), target, 30), true);
  assert.equal(C.notificationDue(jst(2026, 10, 23, 20, 29), target, 30), false);
  assert.equal(C.notificationDue(jst(2026, 10, 23, 20, 31), target, 30), true);
  assert.equal(C.notificationDue(jst(2026, 10, 23, 20, 31, 31), target, 30), false);
  assert.equal(C.notificationDue(jst(2026, 10, 23, 20, 55), target, 5), true);
});

test("displayed app version matches package and Tauri metadata", () => {
  const root = path.resolve(__dirname, "..");
  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const tauri = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const html = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
  assert.equal(tauri.version, packageVersion);
  assert.match(tauri.app.windows[0].title, new RegExp(`v${packageVersion.replaceAll(".", "\\.")}$`));
  assert.match(html, new RegExp(`v${packageVersion.replaceAll(".", "\\.")}`));
  assert.equal(C.STATE_VERSION, 11);
});

test("new states track all tasks for character 1 and the reduced defaults for later characters", () => {
  const state = C.initialState(jst(2026, 10, 26, 16));
  assert.deepEqual(state.shared.tracked, {
    dailyQuests: true,
    shugo: true,
    invasionKeys: true,
    dailyDungeon: true,
    weeklyDemonic: true,
    weeklyAbyss: true,
    serverOdeCrafted: true,
    afResult: true,
  });
  assert.deepEqual(state.characters[0].tracked, {
    farmGiena: true,
    supplyDaily: true,
    sanctuary: true,
    awakening: true,
    battleground: true,
    supplyWeekly: true,
    seasonWeekly: true,
    odePurchased: true,
    odeCrafted: true,
    odeState: true,
    nightmareState: true,
    corridorState: true,
  });
  for (const character of state.characters.slice(1)) {
    assert.deepEqual(character.tracked, {
      farmGiena: false,
      supplyDaily: false,
      sanctuary: false,
      awakening: true,
      battleground: false,
      supplyWeekly: false,
      seasonWeekly: false,
      odePurchased: true,
      odeCrafted: true,
      odeState: true,
      nightmareState: true,
      corridorState: true,
    });
  }
  assert.deepEqual(C.makeCharacter("char-5", 4).tracked, state.characters[1].tracked);
});

test("saved character tracking choices survive the new character defaults", () => {
  const state = C.initialState(jst(2026, 10, 28, 12));
  for (const key of Object.keys(state.characters[1].tracked)) state.characters[1].tracked[key] = true;
  state.characters[1].tracked.awakening = false;

  const migrated = C.catchUp(state, jst(2026, 10, 28, 12));
  assert.ok(Object.entries(migrated.characters[1].tracked).every(([key, value]) => key === "awakening" ? value === false : value === true));
});

test("legacy states receive enabled tracking settings without changing progress", () => {
  const state = C.initialState(jst(2026, 10, 26, 16));
  state.version = 4;
  state.characters[0].farmGiena = 450000;
  delete state.shared.tracked;
  delete state.characters[0].tracked;
  const migrated = C.catchUp(state, jst(2026, 10, 26, 16));
  assert.equal(migrated.version, 11);
  assert.equal(migrated.characters[0].farmGiena, 450000);
  assert.ok(Object.values(migrated.shared.tracked).every(Boolean));
  assert.ok(Object.values(migrated.characters[0].tracked).every(Boolean));
});

test("legacy combined weekly mission settings migrate to both independent regions", () => {
  const state = C.initialState(jst(2026, 10, 26, 16));
  state.version = 6;
  state.shared.tracked = { ...state.shared.tracked, weeklyMissions: false };
  delete state.shared.tracked.weeklyDemonic;
  delete state.shared.tracked.weeklyAbyss;
  state.shared.priorities = { ...state.shared.priorities, weeklyMissions: "high" };
  delete state.shared.priorities.weeklyDemonic;
  delete state.shared.priorities.weeklyAbyss;
  const migrated = C.catchUp(state, jst(2026, 10, 26, 16));
  assert.equal(migrated.shared.tracked.weeklyDemonic, false);
  assert.equal(migrated.shared.tracked.weeklyAbyss, false);
  assert.equal(migrated.shared.priorities.weeklyDemonic, "high");
  assert.equal(migrated.shared.priorities.weeklyAbyss, "high");
  assert.equal("weeklyMissions" in migrated.shared.tracked, false);
  assert.equal("weeklyMissions" in migrated.shared.priorities, false);
});

test("character completion excludes unmanaged tasks while preserving their values", () => {
  const character = C.makeCharacter("char-1", 0);
  character.farmGiena = 500000;
  character.supplyDaily = true;
  character.sanctuary = 2;
  character.awakening = 0;
  character.tracked.farmGiena = false;
  character.tracked.sanctuary = false;
  assert.deepEqual(C.completion(character), {
    dailyDone: 1,
    dailyTotal: 1,
    weeklyDone: 1,
    weeklyTotal: 6,
  });
  assert.equal(character.farmGiena, 500000);
  assert.equal(character.sanctuary, 2);
});

test("all six previously missing task rows are independent priority candidates", () => {
  const now = jst(2026, 10, 26, 12);
  const state = C.initialState(now);
  state.characters.slice(1).forEach((character) => { character.enabled = false; });
  const ids = C.priorityCandidates(state, now).all.map((item) => item.id);
  assert.ok(ids.includes("shared-shugo"));
  assert.ok(ids.includes("shared-invasionKeys"));
  assert.ok(ids.includes("shared-weeklyDemonic"));
  assert.ok(ids.includes("shared-weeklyAbyss"));
  assert.ok(ids.includes("char-1-odePurchased"));
  assert.ok(ids.includes("char-1-odeCrafted"));

  state.shared.tracked.shugo = false;
  state.shared.tracked.weeklyDemonic = false;
  state.characters[0].tracked.odePurchased = false;
  const filtered = C.priorityCandidates(state, now).all.map((item) => item.id);
  assert.equal(filtered.includes("shared-shugo"), false);
  assert.equal(filtered.includes("shared-weeklyDemonic"), false);
  assert.equal(filtered.includes("char-1-odePurchased"), false);
  assert.ok(filtered.includes("shared-invasionKeys"));
  assert.ok(filtered.includes("shared-weeklyAbyss"));
  assert.ok(filtered.includes("char-1-odeCrafted"));
});

test("priority settings migrate with defaults and preserve valid saved choices", () => {
  const state = C.initialState(jst(2026, 10, 26, 16));
  state.version = 5;
  delete state.shared.priorities;
  delete state.characters[0].priorities;
  state.characters[1].priorities.farmGiena = "urgent";
  state.characters[1].priorities.odeHigh = "invalid";
  const migrated = C.catchUp(state, jst(2026, 10, 26, 16));
  assert.equal(migrated.version, 11);
  assert.deepEqual(migrated.shared.priorities, C.SHARED_PRIORITY_DEFAULTS);
  assert.deepEqual(migrated.characters[0].priorities, C.CHARACTER_PRIORITY_DEFAULTS);
  assert.equal(migrated.characters[1].priorities.farmGiena, "urgent");
  assert.equal(migrated.characters[1].priorities.odeHigh, "urgent");
});

test("new users receive the curated priority defaults", () => {
  const state = C.initialState(jst(2026, 10, 28, 2));
  assert.deepEqual(state.shared.priorities, {
    dailyQuests: "urgent",
    shugo: "normal",
    invasionKeys: "normal",
    dailyDungeon: "high",
    weeklyDemonic: "high",
    weeklyAbyss: "high",
    serverOdeCrafted: "high",
    afResult: "urgent",
  });
  assert.deepEqual(state.characters[0].priorities, {
    farmGiena: "normal",
    supplyDaily: "normal",
    sanctuary: "normal",
    awakening: "high",
    battleground: "normal",
    supplyWeekly: "normal",
    seasonWeekly: "normal",
    odePurchased: "high",
    odeCrafted: "high",
    odeLow: "low",
    odeHigh: "urgent",
    nightmareLow: "normal",
    nightmareHigh: "high",
    corridor: "urgent",
  });
});

test("saved priorities from existing users are not replaced by curated defaults", () => {
  const state = C.initialState(jst(2026, 10, 28, 2));
  state.version = 9;
  state.shared.priorities.dailyQuests = "normal";
  state.shared.priorities.dailyDungeon = "low";
  state.shared.priorities.afResult = "high";
  state.characters[0].priorities.awakening = "normal";
  state.characters[0].priorities.odePurchased = "low";
  state.characters[0].priorities.odeCrafted = "urgent";

  const migrated = C.catchUp(state, jst(2026, 10, 28, 2));
  assert.equal(migrated.shared.priorities.dailyQuests, "normal");
  assert.equal(migrated.shared.priorities.dailyDungeon, "low");
  assert.equal(migrated.shared.priorities.afResult, "high");
  assert.equal(migrated.characters[0].priorities.awakening, "normal");
  assert.equal(migrated.characters[0].priorities.odePurchased, "low");
  assert.equal(migrated.characters[0].priorities.odeCrafted, "urgent");
});

test("priority candidates exclude completed and star-disabled tasks", () => {
  const now = jst(2026, 10, 26, 12);
  const state = C.initialState(now);
  state.characters.slice(1).forEach((character) => { character.enabled = false; });
  state.shared.dailyQuests = 5;
  state.shared.tracked.dailyDungeon = false;
  state.characters[0].tracked.farmGiena = false;
  state.characters[0].supplyDaily = true;
  const all = C.priorityCandidates(state, now).all;
  assert.equal(all.some((item) => item.id === "shared-dailyQuests"), false);
  assert.equal(all.some((item) => item.id === "shared-dailyDungeon"), false);
  assert.equal(all.some((item) => item.id === "char-1-farmGiena"), false);
  assert.equal(all.some((item) => item.id === "char-1-supplyDaily"), false);
  assert.equal(all.some((item) => item.id === "char-1-sanctuary"), true);
});

test("season mission uses the generic incomplete status", () => {
  const state = C.initialState(jst(2026, 10, 28, 1));
  const item = C.priorityCandidates(state, jst(2026, 10, 28, 1)).all
    .find((candidate) => candidate.key === "seasonWeekly");
  assert.equal(item.status, "未完了");
});

test("ode and nightmare use exactly one threshold-specific priority at a time", () => {
  const now = jst(2026, 10, 26, 12);
  const state = C.initialState(now);
  state.characters.slice(1).forEach((character) => { character.enabled = false; });
  state.characters[0].odeNatural = 719;
  state.characters[0].nightmare = 9;
  let ids = C.priorityCandidates(state, now).all.map((item) => item.id);
  assert.ok(ids.includes("char-1-odeLow"));
  assert.ok(ids.includes("char-1-nightmareLow"));
  assert.equal(ids.includes("char-1-odeHigh"), false);
  assert.equal(ids.includes("char-1-nightmareHigh"), false);

  state.characters[0].odeNatural = 720;
  state.characters[0].nightmare = 10;
  ids = C.priorityCandidates(state, now).all.map((item) => item.id);
  assert.ok(ids.includes("char-1-odeHigh"));
  assert.ok(ids.includes("char-1-nightmareHigh"));
  assert.equal(ids.includes("char-1-odeLow"), false);
  assert.equal(ids.includes("char-1-nightmareLow"), false);
});

test("state priorities and warnings disappear when their character stars are disabled", () => {
  const now = jst(2026, 10, 26, 12);
  const state = C.initialState(now);
  state.characters.slice(1).forEach((character) => { character.enabled = false; });
  const character = state.characters[0];
  character.odeNatural = 720;
  character.nightmare = 10;
  character.abyssGranted = 2;
  let ids = C.priorityCandidates(state, now).all.map((item) => item.id);
  assert.ok(ids.includes("char-1-odeHigh"));
  assert.ok(ids.includes("char-1-nightmareHigh"));
  assert.ok(ids.includes("char-1-corridor"));

  character.tracked.odeState = false;
  character.tracked.nightmareState = false;
  character.tracked.corridorState = false;
  ids = C.priorityCandidates(state, now).all.map((item) => item.id);
  assert.equal(ids.includes("char-1-odeHigh"), false);
  assert.equal(ids.includes("char-1-nightmareHigh"), false);
  assert.equal(ids.includes("char-1-corridor"), false);
  assert.deepEqual(C.characterAlerts(character), []);
});

test("top five prioritizes urgent and high states while normal and low states only backfill", () => {
  const now = jst(2026, 10, 26, 12);
  const state = C.initialState(now);
  state.characters.slice(1).forEach((character) => { character.enabled = false; });
  state.characters[0].odeNatural = 720;
  state.characters[0].nightmare = 9;
  state.characters[0].abyssGranted = 1;
  state.characters[0].priorities.sanctuary = "urgent";
  state.shared.afResultPending = false;
  state.shared.priorities.dailyQuests = "high";
  const result = C.priorityCandidates(state, now);
  assert.equal(result.top.length, 5);
  assert.deepEqual(result.top.slice(0, 3).map((item) => item.id), [
    "char-1-odeHigh",
    "char-1-corridor",
    "char-1-sanctuary",
  ]);
  assert.equal(result.top.some((item) => item.id === "char-1-nightmareLow"), false);

  for (const key of Object.keys(state.shared.tracked)) state.shared.tracked[key] = false;
  for (const key of Object.keys(state.characters[0].tracked)) {
    if (!key.endsWith("State")) state.characters[0].tracked[key] = false;
  }
  state.characters[0].odeNatural = 0;
  state.characters[0].abyssGranted = 0;
  const backfilled = C.priorityCandidates(state, now).top.map((item) => item.id);
  assert.deepEqual(backfilled, ["char-1-nightmareLow", "char-1-odeLow"]);
});
