(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.A2HCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const STATE_VERSION = 12;
  const ODE_ALERT_THRESHOLD = 720;
  const PRIORITY_LEVELS = ["urgent", "high", "normal", "low"];
  const PRIORITY_LABELS = { urgent: "最優先", high: "高", normal: "通常", low: "低" };
  const SHARED_PRIORITY_DEFAULTS = {
    dailyQuests: "urgent",
    shugo: "normal",
    invasionKeys: "normal",
    dailyDungeon: "high",
    weeklyDemonic: "high",
    weeklyAbyss: "high",
    serverOdePurchased: "high",
    serverOdeCrafted: "high",
    afResult: "urgent",
  };
  const CHARACTER_PRIORITY_DEFAULTS = {
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
  };
  const ODE_TICK_HOURS = [1, 4, 7, 10, 13, 16, 19, 22];
  const NOTE_COLORS = [
    { value: "#edf7f3", label: "ホワイト" },
    { value: "#65ffca", label: "ミント" },
    { value: "#8bbcff", label: "ブルー" },
    { value: "#f0bd55", label: "イエロー" },
    { value: "#ff9b73", label: "オレンジ" },
    { value: "#ff8fa3", label: "ピンク" },
    { value: "#c9a7ff", label: "パープル" },
    { value: "#9bd8d0", label: "アクア" },
  ];

  function escapeMemoText(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
      .replaceAll("\n", "<br>");
  }
  const WORLD_BOSS_DEFAULTS = [
    {
      id: "faction",
      name: "魔族/天族",
      bosses: [
        { id: "immortal-gartua", name: "不滅のガルトゥア", baseTime: "09:02", intervalHours: 12, notifyMinutes: [30, 10, 5] },
        { id: "legion-commander-ragta", name: "軍団長ラグタ", baseTime: "05:07", intervalHours: 12, notifyMinutes: [30, 10, 5] },
        { id: "silent-tartan", name: "沈黙のタルタン", baseTime: "21:13", intervalHours: 6, notifyMinutes: [10, 5] },
        { id: "soul-ruler-kashapa", name: "魂の支配者カシャパ", baseTime: "21:14", intervalHours: 6, notifyMinutes: [10, 5] },
      ],
    },
    {
      id: "abyss",
      name: "アビス",
      bosses: [
        { id: "kaira", name: "監視者カイラ", baseTime: "01:00", intervalHours: 3, notifyMinutes: [] },
        { id: "guardian-general-nahma", name: "守護神将ナフマ", weekdays: [5, 0], time: "21:00", notifyMinutes: [60, 50, 40, 30] },
        { id: "spirit-king-agro", name: "精霊王アグロ", baseTime: "09:32", intervalHours: 12, notifyMinutes: [30] },
      ],
    },
  ];
  const RECURRING_EVENT_DEFAULTS = [
    { id: "shugo-festa", name: "シューゴフェスタ", minuteOfHour: 0, notifyMinutes: [] },
    { id: "dimension-invasion", name: "次元侵攻", minuteOfHour: 30, notifyMinutes: [] },
    { id: "time-rift", name: "時空の裂け目", baseTime: "17:00", intervalHours: 3, notifyMinutes: [] },
  ];

  function clamp(value, min, max) {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : min;
    return Math.min(max, Math.max(min, numeric));
  }

  function jstParts(epochMs) {
    const d = new Date(epochMs + JST_OFFSET_MS);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      date: d.getUTCDate(),
      day: d.getUTCDay(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }

  function fromJst(year, month, date, hour, minute = 0, second = 0) {
    return Date.UTC(year, month, date, hour, minute, second) - JST_OFFSET_MS;
  }

  function validTimeOfDay(value) {
    if (!/^\d{2}:\d{2}$/.test(String(value))) return false;
    const [hour, minute] = String(value).split(":").map(Number);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
  }

  function worldBossDefaults() {
    return JSON.parse(JSON.stringify(WORLD_BOSS_DEFAULTS));
  }

  function recurringEventDefaults() {
    return JSON.parse(JSON.stringify(RECURRING_EVENT_DEFAULTS));
  }

  function ensureRecurringEvents(state) {
    const savedEvents = new Map(
      (Array.isArray(state.recurringEvents) ? state.recurringEvents : [])
        .filter((event) => event?.id)
        .map((event) => [event.id, event]),
    );
    state.recurringEvents = recurringEventDefaults().map((event) => {
      const saved = savedEvents.get(event.id);
      return {
        ...event,
        notifyMinutes: Array.isArray(saved?.notifyMinutes)
          ? saved.notifyMinutes.map(Number).filter((minutes) => [10, 5, 3, 1].includes(minutes))
          : event.notifyMinutes,
      };
    });
    return state;
  }

  function ensureWorldBosses(state) {
    const savedCategories = Array.isArray(state.worldBosses) ? state.worldBosses : [];
    const savedBosses = new Map();
    for (const category of savedCategories) {
      for (const boss of Array.isArray(category?.bosses) ? category.bosses : []) {
        savedBosses.set(boss.id, boss);
      }
    }
    state.worldBosses = worldBossDefaults().map((category) => ({
      ...category,
      bosses: category.bosses.map((boss) => {
        const saved = savedBosses.get(boss.id);
        return {
          ...boss,
          baseTime: validTimeOfDay(saved?.baseTime) ? saved.baseTime : boss.baseTime,
          time: validTimeOfDay(saved?.time) ? saved.time : boss.time,
          notifyMinutes: Array.isArray(saved?.notifyMinutes)
            ? saved.notifyMinutes.map(Number).filter((minutes) => [60, 50, 40, 30, 10, 5].includes(minutes))
            : boss.notifyMinutes,
        };
      }),
    }));
    return state;
  }

  function normalizeWeeklyMissionCounts(state) {
    if (!state.shared) return state;
    const priorVersion = Number(state.version) || 1;
    state.shared.weeklyDemonic = clamp(state.shared.weeklyDemonic, 0, 12);
    // v0.2.10-v0.2.16 incorrectly capped Abyss missions at 8. Restore the
    // known clipped value during the one-time schema migration.
    if (priorVersion < 3 && Number(state.shared.weeklyAbyss) === 8) {
      state.shared.weeklyAbyss = 20;
    }
    state.shared.weeklyAbyss = clamp(state.shared.weeklyAbyss, 0, 20);
    // v0.2.18 removed reward-decay tracking. Discard legacy counters while
    // keeping the rest of the saved state compatible.
    delete state.shared.exploration;
    delete state.shared.conquest;
    delete state.shared.transcendence;
    state.version = STATE_VERSION;
    return state;
  }

  function migrateOdePurchaseLimits(state) {
    state.shared ||= {};
    const characters = Array.isArray(state.characters) ? state.characters : [];
    const priorVersion = Number(state.version) || 1;
    if (priorVersion < 12) {
      const legacyValues = characters.map((character) => clamp(character.odePurchased, 0, 20));
      state.shared.serverOdePurchased = clamp(Math.max(0, ...legacyValues), 0, 16);
      characters.forEach((character, index) => {
        character.odePurchased = clamp(legacyValues[index] - 16, 0, 4);
      });
      return state;
    }
    state.shared.serverOdePurchased = clamp(state.shared.serverOdePurchased, 0, 16);
    for (const character of characters) character.odePurchased = clamp(character.odePurchased, 0, 4);
    return state;
  }

  function normalizeCharacterNotes(state) {
    const allowed = new Set(NOTE_COLORS.map((color) => color.value));
    for (const character of Array.isArray(state.characters) ? state.characters : []) {
      if (typeof character.memoHtml !== "string") {
        const text = typeof character.memoText === "string" ? character.memoText : "";
        const color = allowed.has(character.memoColor) ? character.memoColor : NOTE_COLORS[0].value;
        const content = escapeMemoText(text);
        character.memoHtml = content && color !== NOTE_COLORS[0].value
          ? `<span style="color:${color}">${content}</span>`
          : content;
      }
      delete character.memoText;
      delete character.memoColor;
    }
    return state;
  }

  function nextPeriodicOccurrences(baseTime, intervalHours, epochMs, count = 4) {
    if (!validTimeOfDay(baseTime) || intervalHours <= 0 || count <= 0) return [];
    const [hour, minute] = baseTime.split(":").map(Number);
    const p = jstParts(epochMs);
    const anchor = fromJst(p.year, p.month, p.date, hour, minute);
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const firstStep = Math.floor((epochMs - anchor) / intervalMs) + 1;
    const first = anchor + firstStep * intervalMs;
    return Array.from({ length: count }, (_, index) => first + index * intervalMs);
  }

  function nextHourlyOccurrences(minuteOfHour, epochMs, count = 4) {
    const minute = Number(minuteOfHour);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59 || count <= 0) return [];
    const p = jstParts(epochMs);
    let first = fromJst(p.year, p.month, p.date, p.hour, minute);
    if (first <= epochMs) first += 60 * 60 * 1000;
    return Array.from({ length: count }, (_, index) => first + index * 60 * 60 * 1000);
  }

  function nextWeeklyOccurrences(weekdays, time, epochMs, count = 4) {
    if (!Array.isArray(weekdays) || weekdays.length === 0 || !validTimeOfDay(time) || count <= 0) return [];
    const validDays = new Set(weekdays.map(Number).filter((day) => day >= 0 && day <= 6));
    if (validDays.size === 0) return [];
    const [hour, minute] = time.split(":").map(Number);
    const occurrences = [];
    const current = jstParts(epochMs);
    for (let offset = 0; offset <= 28 && occurrences.length < count; offset += 1) {
      const probe = new Date(Date.UTC(current.year, current.month, current.date + offset));
      if (!validDays.has(probe.getUTCDay())) continue;
      const candidate = fromJst(
        probe.getUTCFullYear(),
        probe.getUTCMonth(),
        probe.getUTCDate(),
        hour,
        minute,
      );
      if (candidate > epochMs) occurrences.push(candidate);
    }
    return occurrences;
  }

  function worldBossOccurrences(boss, epochMs, count = 4) {
    return Array.isArray(boss?.weekdays)
      ? nextWeeklyOccurrences(boss.weekdays, boss.time, epochMs, count)
      : nextPeriodicOccurrences(boss?.baseTime, boss?.intervalHours, epochMs, count);
  }

  function recurringEventOccurrences(event, epochMs, count = 4) {
    return Number.isInteger(Number(event?.minuteOfHour))
      ? nextHourlyOccurrences(event.minuteOfHour, epochMs, count)
      : nextPeriodicOccurrences(event?.baseTime, event?.intervalHours, epochMs, count);
  }

  function notificationDue(now, target, minutes, graceMs = 90000) {
    const remaining = target - now;
    return remaining <= minutes * 60000 && remaining > minutes * 60000 - graceMs;
  }

  function dailyResetAtOrBefore(epochMs) {
    const p = jstParts(epochMs);
    let candidate = fromJst(p.year, p.month, p.date, 16);
    if (candidate > epochMs) candidate -= DAY_MS;
    return candidate;
  }

  function nextDailyReset(epochMs) {
    return dailyResetAtOrBefore(epochMs) + DAY_MS;
  }

  function weeklyResetAtOrBefore(epochMs) {
    const daily = dailyResetAtOrBefore(epochMs);
    const p = jstParts(daily);
    const daysSinceWednesday = (p.day - 3 + 7) % 7;
    return daily - daysSinceWednesday * DAY_MS;
  }

  function nextWeeklyReset(epochMs) {
    return weeklyResetAtOrBefore(epochMs) + 7 * DAY_MS;
  }

  function afResetAtOrBefore(epochMs) {
    const p = jstParts(epochMs);
    const validDays = [1, 4, 6];
    let best = -Infinity;
    for (let back = 0; back <= 7; back += 1) {
      const probe = new Date(epochMs + JST_OFFSET_MS - back * DAY_MS);
      const day = probe.getUTCDay();
      if (!validDays.includes(day)) continue;
      const candidate = fromJst(
        probe.getUTCFullYear(),
        probe.getUTCMonth(),
        probe.getUTCDate(),
        21,
      );
      if (candidate <= epochMs && candidate > best) best = candidate;
    }
    return best;
  }

  function nextAfReset(epochMs) {
    const p = jstParts(epochMs);
    for (let forward = 0; forward <= 7; forward += 1) {
      const probe = new Date(epochMs + JST_OFFSET_MS + forward * DAY_MS);
      if (![1, 4, 6].includes(probe.getUTCDay())) continue;
      const candidate = fromJst(
        probe.getUTCFullYear(),
        probe.getUTCMonth(),
        probe.getUTCDate(),
        21,
      );
      if (candidate > epochMs) return candidate;
    }
    return epochMs + 7 * DAY_MS;
  }

  function odeTicksBetween(startExclusive, endInclusive) {
    if (endInclusive <= startExclusive) return 0;
    let cursor = dailyResetAtOrBefore(startExclusive) - DAY_MS;
    let count = 0;
    while (cursor <= endInclusive + DAY_MS) {
      const p = jstParts(cursor);
      for (const hour of ODE_TICK_HOURS) {
        const tick = fromJst(p.year, p.month, p.date, hour);
        if (tick > startExclusive && tick <= endInclusive) count += 1;
      }
      cursor += DAY_MS;
    }
    return count;
  }

  function makeCharacter(id, index) {
    const isPrimary = index === 0;
    return {
      id,
      name: `キャラクター${index + 1}`,
      enabled: true,
      nightmare: 14,
      sanctuary: 2,
      awakening: 3,
      battleground: 0,
      farmGiena: 0,
      supplyDaily: false,
      supplyWeekly: false,
      seasonWeekly: false,
      tracked: {
        farmGiena: isPrimary,
        supplyDaily: isPrimary,
        sanctuary: isPrimary,
        awakening: true,
        battleground: isPrimary,
        supplyWeekly: isPrimary,
        seasonWeekly: isPrimary,
        odePurchased: true,
        odeCrafted: true,
        odeState: true,
        nightmareState: true,
        corridorState: true,
      },
      priorities: { ...CHARACTER_PRIORITY_DEFAULTS },
      abyssGranted: 0,
      abyssUsed: 0,
      odeNatural: 0,
      odeBonus: 0,
      odePurchased: 0,
      odeCrafted: 0,
      memoHtml: "",
    };
  }

  function initialState(now = Date.now()) {
    return {
      version: STATE_VERSION,
      createdAt: now,
      lastDailyReset: dailyResetAtOrBefore(now),
      lastWeeklyReset: weeklyResetAtOrBefore(now),
      lastAfReset: afResetAtOrBefore(now),
      lastOdeTick: now,
      slotCount: 4,
      activeView: "dashboard",
      characters: Array.from({ length: 4 }, (_, index) => makeCharacter(`char-${index + 1}`, index)),
      shared: {
        dailyQuests: 0,
        shugo: 18,
        invasionKeys: 6,
        dailyDungeon: 14,
        weeklyDemonic: 0,
        weeklyAbyss: 0,
        serverOdePurchased: 0,
        serverOdeCrafted: 0,
        afResultPending: true,
        tracked: {
          dailyQuests: true,
          shugo: true,
          invasionKeys: true,
          dailyDungeon: true,
          weeklyDemonic: true,
          weeklyAbyss: true,
          serverOdePurchased: true,
          serverOdeCrafted: true,
          afResult: true,
        },
        priorities: { ...SHARED_PRIORITY_DEFAULTS },
      },
      notifications: {
        daily: [180, 60],
        weekly: [1440, 360],
        corridor: [60, 30],
      },
      recurringEvents: recurringEventDefaults(),
      worldBosses: worldBossDefaults(),
      history: [],
    };
  }

  function log(state, message, now) {
    state.history.unshift({ at: now, message });
    state.history = state.history.slice(0, 80);
  }

  function applyDailyReset(state, times, now) {
    if (times <= 0) return;
    state.shared.shugo = clamp(state.shared.shugo + times * 3, 0, 21);
    state.shared.invasionKeys = clamp(state.shared.invasionKeys + times, 0, 7);
    state.shared.dailyQuests = 0;
    for (const character of state.characters) {
      character.nightmare = clamp(character.nightmare + times * 2, 0, 14);
      character.farmGiena = 0;
      character.supplyDaily = false;
    }
    log(state, `デイリー更新を${times}回反映`, now);
  }

  function applyWeeklyReset(state, times, now) {
    if (times <= 0) return;
    state.shared.dailyDungeon = 14;
    state.shared.weeklyDemonic = 0;
    state.shared.weeklyAbyss = 0;
    state.shared.serverOdePurchased = 0;
    state.shared.serverOdeCrafted = 0;
    for (const character of state.characters) {
      character.sanctuary = 2;
      character.awakening = 3;
      character.battleground = 0;
      character.supplyWeekly = false;
      character.seasonWeekly = false;
      character.odePurchased = 0;
      character.odeCrafted = 0;
    }
    log(state, `ウィークリー更新を${times}回反映`, now);
  }

  function applyAfReset(state, times, now) {
    if (times <= 0) return;
    let expired = 0;
    for (const character of state.characters) {
      expired += Math.max(0, character.abyssGranted - character.abyssUsed);
      character.abyssGranted = 0;
      character.abyssUsed = 0;
    }
    state.shared.afResultPending = true;
    log(state, `AF戦更新を反映（未使用${expired}回失効）`, now);
  }

  function applyOdeRecovery(state, tickCount, now) {
    if (tickCount <= 0) return;
    for (const character of state.characters) {
      character.odeNatural = clamp(character.odeNatural + tickCount * 15, 0, 840);
    }
    log(state, `オード自然回復 +${tickCount * 15}`, now);
  }

  function spendOde(character, requestedAmount) {
    const amount = Number(requestedAmount);
    if (![40, 80].includes(amount)) return false;
    if (character.odeNatural + character.odeBonus < amount) return false;
    const naturalSpent = Math.min(character.odeNatural, amount);
    character.odeNatural -= naturalSpent;
    character.odeBonus -= amount - naturalSpent;
    return true;
  }

  function toggleNotification(values, requestedMinutes) {
    const minutes = Number(requestedMinutes);
    const selected = new Set(values.map(Number));
    if (selected.has(minutes)) selected.delete(minutes);
    else selected.add(minutes);
    return Array.from(selected).sort((a, b) => b - a);
  }

  function ensureTrackingSettings(state) {
    state.shared ||= {};
    const sharedDefaults = initialState(state.createdAt || Date.now()).shared.tracked;
    const savedShared = state.shared.tracked && typeof state.shared.tracked === "object" ? state.shared.tracked : {};
    state.shared.tracked = Object.fromEntries(Object.keys(sharedDefaults).map((key) => {
      if (typeof savedShared[key] === "boolean") return [key, savedShared[key]];
      if (["weeklyDemonic", "weeklyAbyss"].includes(key) && typeof savedShared.weeklyMissions === "boolean") {
        return [key, savedShared.weeklyMissions];
      }
      return [key, true];
    }));
    for (const character of Array.isArray(state.characters) ? state.characters : []) {
      const defaults = makeCharacter(character.id || "character", 0).tracked;
      const saved = character.tracked && typeof character.tracked === "object" ? character.tracked : {};
      character.tracked = Object.fromEntries(
        Object.keys(defaults).map((key) => [key, typeof saved[key] === "boolean" ? saved[key] : true]),
      );
    }
    return state;
  }

  function validPriority(value, fallback) {
    return PRIORITY_LEVELS.includes(value) ? value : fallback;
  }

  function ensurePrioritySettings(state) {
    state.shared ||= {};
    const savedShared = state.shared.priorities && typeof state.shared.priorities === "object"
      ? state.shared.priorities
      : {};
    state.shared.priorities = Object.fromEntries(
      Object.entries(SHARED_PRIORITY_DEFAULTS).map(([key, fallback]) => {
        const legacy = ["weeklyDemonic", "weeklyAbyss"].includes(key) ? savedShared.weeklyMissions : undefined;
        return [key, validPriority(savedShared[key] ?? legacy, fallback)];
      }),
    );
    for (const character of Array.isArray(state.characters) ? state.characters : []) {
      const saved = character.priorities && typeof character.priorities === "object" ? character.priorities : {};
      character.priorities = Object.fromEntries(
        Object.entries(CHARACTER_PRIORITY_DEFAULTS).map(([key, fallback]) => [key, validPriority(saved[key], fallback)]),
      );
    }
    return state;
  }

  function comparePriorityCandidates(a, b) {
    const priority = PRIORITY_LEVELS.indexOf(a.priority) - PRIORITY_LEVELS.indexOf(b.priority);
    if (priority) return priority;
    const periodRank = { daily: 0, state: 1, weekly: 2 };
    const period = (periodRank[a.period] ?? 3) - (periodRank[b.period] ?? 3);
    if (period) return period;
    const deadline = Number(a.deadline || Number.MAX_SAFE_INTEGER) - Number(b.deadline || Number.MAX_SAFE_INTEGER);
    if (deadline) return deadline;
    const scope = (a.scope === "shared" ? 0 : 1) - (b.scope === "shared" ? 0 : 1);
    if (scope) return scope;
    const character = Number(a.characterIndex ?? -1) - Number(b.characterIndex ?? -1);
    if (character) return character;
    return Number(a.order || 0) - Number(b.order || 0);
  }

  function priorityCandidates(state, now = Date.now()) {
    const dailyDeadline = nextDailyReset(now);
    const weeklyDeadline = nextWeeklyReset(now);
    const afDeadline = nextAfReset(now);
    const sharedTracked = state.shared?.tracked || {};
    const sharedPriorities = state.shared?.priorities || SHARED_PRIORITY_DEFAULTS;
    const tasks = [];
    const states = [];
    const addShared = (key, label, status, complete, period, deadline, order) => {
      if (sharedTracked[key] === false || complete) return;
      tasks.push({ id: `shared-${key}`, key, label, status, scope: "shared", view: "shared", period, deadline, order, priority: validPriority(sharedPriorities[key], "normal"), kind: "task" });
    };
    addShared("dailyQuests", "デイリークエスト", `${state.shared.dailyQuests} / 5`, state.shared.dailyQuests >= 5, "daily", dailyDeadline, 0);
    addShared("shugo", "シューゴフェスタ", `残り${state.shared.shugo}回`, state.shared.shugo <= 0, "daily", dailyDeadline, 1);
    addShared("invasionKeys", "次元侵攻の鍵", `残り${state.shared.invasionKeys}個`, state.shared.invasionKeys <= 0, "daily", dailyDeadline, 2);
    addShared("dailyDungeon", "デイリーダンジョン", `残り${state.shared.dailyDungeon}回`, state.shared.dailyDungeon <= 0, "weekly", weeklyDeadline, 3);
    addShared("weeklyDemonic", "魔族大陸の任務", `${state.shared.weeklyDemonic} / 12`, state.shared.weeklyDemonic >= 12, "weekly", weeklyDeadline, 4);
    addShared("weeklyAbyss", "アビスの任務", `${state.shared.weeklyAbyss} / 20`, state.shared.weeklyAbyss >= 20, "weekly", weeklyDeadline, 5);
    addShared("serverOdePurchased", "オードショップ購入（サーバー）", `${state.shared.serverOdePurchased} / 16`, state.shared.serverOdePurchased >= 16, "weekly", weeklyDeadline, 6);
    addShared("serverOdeCrafted", "オード物質変換（サーバー）", `${state.shared.serverOdeCrafted} / 16`, state.shared.serverOdeCrafted >= 16, "weekly", weeklyDeadline, 7);
    addShared("afResult", "AF結果入力", state.shared.afResultPending ? "未入力" : "入力済み", !state.shared.afResultPending, "weekly", afDeadline, 8);

    (Array.isArray(state.characters) ? state.characters : []).forEach((character, characterIndex) => {
      if (!character.enabled) return;
      const tracked = character.tracked || {};
      const priorities = character.priorities || CHARACTER_PRIORITY_DEFAULTS;
      const addTask = (key, label, status, complete, period, deadline, order) => {
        if (tracked[key] === false || complete) return;
        tasks.push({ id: `${character.id}-${key}`, key, label, status, scope: "character", view: "characters", characterId: character.id, characterName: character.name, characterIndex, period, deadline, order, priority: validPriority(priorities[key], "normal"), kind: "task" });
      };
      addTask("farmGiena", "フィールドファーム", `${Number(character.farmGiena).toLocaleString()} / 1,000,000`, character.farmGiena >= 1000000, "daily", dailyDeadline, 0);
      addTask("supplyDaily", "補給依頼（日）", "内容未確認", character.supplyDaily, "daily", dailyDeadline, 1);
      addTask("sanctuary", "ルドラ", `残り${character.sanctuary}回`, character.sanctuary <= 0, "weekly", weeklyDeadline, 2);
      addTask("awakening", "覚醒戦", `残り${character.awakening}回`, character.awakening <= 0, "weekly", weeklyDeadline, 3);
      addTask("battleground", "戦場", `${character.battleground} / 3`, character.battleground >= 3, "weekly", weeklyDeadline, 4);
      addTask("supplyWeekly", "補給依頼（週）", "内容未確認", character.supplyWeekly, "weekly", weeklyDeadline, 5);
      addTask("seasonWeekly", "シーズンミッション（週）", "未完了", character.seasonWeekly, "weekly", weeklyDeadline, 6);
      addTask("odePurchased", "オードショップ購入（キャラ）", `${character.odePurchased} / 4`, character.odePurchased >= 4, "weekly", weeklyDeadline, 7);
      addTask("odeCrafted", "オード物質変換（キャラ）", `${character.odeCrafted} / 4`, character.odeCrafted >= 4, "weekly", weeklyDeadline, 8);

      const odeKey = character.odeNatural >= ODE_ALERT_THRESHOLD ? "odeHigh" : "odeLow";
      if (tracked.odeState !== false) states.push({ id: `${character.id}-${odeKey}`, key: odeKey, label: odeKey === "odeHigh" ? `オード ${ODE_ALERT_THRESHOLD}以上` : `オード ${ODE_ALERT_THRESHOLD}未満`, status: `${character.odeNatural} / 840`, scope: "character", view: "characters", characterId: character.id, characterName: character.name, characterIndex, period: "state", deadline: odeKey === "odeHigh" ? now : Number.MAX_SAFE_INTEGER, order: 9, priority: validPriority(priorities[odeKey], CHARACTER_PRIORITY_DEFAULTS[odeKey]), kind: odeKey === "odeHigh" ? "warning" : "state" });
      const nightmareKey = character.nightmare >= 10 ? "nightmareHigh" : "nightmareLow";
      if (tracked.nightmareState !== false) states.push({ id: `${character.id}-${nightmareKey}`, key: nightmareKey, label: nightmareKey === "nightmareHigh" ? "悪夢 10以上" : "悪夢 10未満", status: `${character.nightmare} / 14`, scope: "character", view: "characters", characterId: character.id, characterName: character.name, characterIndex, period: "state", deadline: nightmareKey === "nightmareHigh" ? now : Number.MAX_SAFE_INTEGER, order: 10, priority: validPriority(priorities[nightmareKey], CHARACTER_PRIORITY_DEFAULTS[nightmareKey]), kind: nightmareKey === "nightmareHigh" ? "warning" : "state" });
      const corridor = Math.max(0, character.abyssGranted - character.abyssUsed);
      if (tracked.corridorState !== false && corridor > 0) states.push({ id: `${character.id}-corridor`, key: "corridor", label: "回廊権利あり", status: `残り${corridor}回`, scope: "character", view: "characters", characterId: character.id, characterName: character.name, characterIndex, period: "state", deadline: afDeadline, order: 11, priority: validPriority(priorities.corridor, "urgent"), kind: "warning" });
    });

    const prominentStates = states.filter((item) => ["urgent", "high"].includes(item.priority));
    const backfillStates = states.filter((item) => ["normal", "low"].includes(item.priority));
    const primary = [...tasks, ...prominentStates].sort(comparePriorityCandidates);
    const backfill = backfillStates.sort(comparePriorityCandidates);
    const top = primary.slice(0, 5);
    if (top.length < 5) top.push(...backfill.slice(0, 5 - top.length));
    return {
      top,
      all: [...tasks, ...states].sort(comparePriorityCandidates),
      primary,
      backfill,
    };
  }

  function catchUp(state, now = Date.now()) {
    const result = JSON.parse(JSON.stringify(state));
    migrateOdePurchaseLimits(result);
    ensureWorldBosses(result);
    ensureRecurringEvents(result);
    ensureTrackingSettings(result);
    ensurePrioritySettings(result);
    normalizeWeeklyMissionCounts(result);
    normalizeCharacterNotes(result);
    const dailyTimes = Math.max(0, Math.floor((dailyResetAtOrBefore(now) - result.lastDailyReset) / DAY_MS));
    const weeklyTimes = Math.max(0, Math.floor((weeklyResetAtOrBefore(now) - result.lastWeeklyReset) / (7 * DAY_MS)));
    const latestAf = afResetAtOrBefore(now);
    const afTimes = latestAf > result.lastAfReset ? 1 : 0;
    const odeTicks = odeTicksBetween(result.lastOdeTick, now);

    applyDailyReset(result, dailyTimes, now);
    applyWeeklyReset(result, weeklyTimes, now);
    applyAfReset(result, afTimes, now);
    applyOdeRecovery(result, odeTicks, now);

    result.lastDailyReset = dailyResetAtOrBefore(now);
    result.lastWeeklyReset = weeklyResetAtOrBefore(now);
    result.lastAfReset = latestAf;
    result.lastOdeTick = now;
    return result;
  }

  function completion(character) {
    const tracked = character.tracked || {};
    const dailyItems = [
      [tracked.farmGiena !== false, character.farmGiena >= 1000000],
      [tracked.supplyDaily !== false, character.supplyDaily],
    ];
    const weeklyItems = [
      [tracked.sanctuary !== false, character.sanctuary === 0],
      [tracked.awakening !== false, character.awakening === 0],
      [tracked.battleground !== false, character.battleground >= 3],
      [tracked.supplyWeekly !== false, character.supplyWeekly],
      [tracked.seasonWeekly !== false, character.seasonWeekly],
      [tracked.odePurchased !== false, character.odePurchased >= 4],
      [tracked.odeCrafted !== false, character.odeCrafted >= 4],
    ];
    const count = (items) => ({
      done: items.filter(([included, complete]) => included && complete).length,
      total: items.filter(([included]) => included).length,
    });
    const daily = count(dailyItems);
    const weekly = count(weeklyItems);
    return { dailyDone: daily.done, dailyTotal: daily.total, weeklyDone: weekly.done, weeklyTotal: weekly.total };
  }

  function characterAlerts(character) {
    const alerts = [];
    const tracked = character.tracked || {};
    if (tracked.odeState !== false && character.odeNatural >= ODE_ALERT_THRESHOLD) {
      alerts.push({ id: "ode-high", label: `オード ${ODE_ALERT_THRESHOLD}以上` });
    }
    if (tracked.nightmareState !== false && character.nightmare >= 10) {
      alerts.push({ id: "nightmare-high", label: "悪夢 10以上" });
    }
    const corridor = Math.max(0, character.abyssGranted - character.abyssUsed);
    if (tracked.corridorState !== false && corridor > 0) {
      alerts.push({ id: "abyss-corridor", label: `回廊 残り${corridor}回` });
    }
    return alerts;
  }

  return {
    STATE_VERSION,
    DAY_MS,
    ODE_ALERT_THRESHOLD,
    PRIORITY_LEVELS,
    PRIORITY_LABELS,
    SHARED_PRIORITY_DEFAULTS,
    CHARACTER_PRIORITY_DEFAULTS,
    NOTE_COLORS,
    escapeMemoText,
    clamp,
    jstParts,
    fromJst,
    dailyResetAtOrBefore,
    nextDailyReset,
    weeklyResetAtOrBefore,
    nextWeeklyReset,
    afResetAtOrBefore,
    nextAfReset,
    odeTicksBetween,
    makeCharacter,
    initialState,
    catchUp,
    completion,
    characterAlerts,
    spendOde,
    toggleNotification,
    validTimeOfDay,
    worldBossDefaults,
    recurringEventDefaults,
    ensureWorldBosses,
    ensureRecurringEvents,
    normalizeWeeklyMissionCounts,
    migrateOdePurchaseLimits,
    normalizeCharacterNotes,
    ensureTrackingSettings,
    ensurePrioritySettings,
    comparePriorityCandidates,
    priorityCandidates,
    nextPeriodicOccurrences,
    nextHourlyOccurrences,
    nextWeeklyOccurrences,
    worldBossOccurrences,
    recurringEventOccurrences,
    notificationDue,
  };
});
