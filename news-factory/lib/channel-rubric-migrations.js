function normUrl(value) {
  try {
    const x = new URL(String(value || ""));
    return (x.hostname.replace(/^www\./i, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
  } catch {
    return "";
  }
}

export function normalizeShoppingFindSources(state, curatedSources, validRubrics, nowIso) {
  const now = nowIso || new Date().toISOString();
  const valid = validRubrics instanceof Set ? validRubrics : new Set(validRubrics || []);
  const desired = Array.isArray(curatedSources) ? curatedSources : [];
  const approved = new Map(desired.map(function(source){ return [normUrl(source.url), source]; }));
  const existing = new Map((state.sources || []).filter(Boolean).map(function(source){ return [normUrl(source.url), source]; }));
  const added = [], assigned = [], paused = [];

  for (const wanted of desired) {
    let source = existing.get(normUrl(wanted.url));
    if (!source) {
      source = structuredClone(wanted);
      source.autoAdded = { at: now, from: "dna", why: "утверждённый источник товарных находок", reason: "shopping-v0.53.0" };
      state.sources.push(source);
      added.push(source.name);
    } else {
      source.enabled = true;
      source.group = wanted.group;
      source.priority = wanted.priority;
      source.mediaLicense = wanted.mediaLicense || source.mediaLicense || "unknown";
      source.copyrightMode = wanted.copyrightMode || source.copyrightMode || "facts_only";
    }
    source.rubric = wanted.rubric;
    source.rubrics = [wanted.rubric];
    source.rubricAssignedAt = now;
    assigned.push(source.name || source.url || source.id);
  }

  for (const source of (state.sources || [])) {
    if (!source || !source.enabled || source.group === "custom") continue;
    if (approved.has(normUrl(source.url))) continue;
    const known = [String(source.rubric || "")].concat(Array.isArray(source.rubrics) ? source.rubrics.map(String) : []);
    if (known.some(function(id){ return valid.has(id); })) continue;
    source.enabled = false;
    source.autoPaused = {
      reason: "старый источник ритейл/маркетплейс-новостей; канал пересобран под товарные находки (v0.53.0)",
      at: now
    };
    paused.push(source.name || source.url || source.id);
  }

  state.sourceReplenish = Object.assign({}, state.sourceReplenish || {}, { lastAt: "" });
  if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;
  return { added, assigned, paused };
}

export function normalizeAutoRubricSources(state, approvedBloggers, oldBloggerSlots, nowIso) {
  const now = nowIso || new Date().toISOString();
  const bloggers = Array.isArray(approvedBloggers) ? approvedBloggers : [];
  const approvedIds = new Set(bloggers.map(function(source){ return String(source.id); }));
  const existingIds = new Set((state.sources || []).map(function(source){ return String(source && source.id || ""); }));
  const added = [], paused = [], assigned = [];

  for (const blogger of bloggers) {
    if (!existingIds.has(String(blogger.id))) {
      state.sources.push(structuredClone(blogger));
      added.push(blogger.name);
    }
  }

  const chinese = new Set(["cars-byd","cars-geely","cars-chery","cars-nio","cars-xpeng","cars-zeekr","cars-gwm","cars-carnewschina","cars-cnevpost","cars-gasgoo"]);
  const electric = new Set(["cars-tesla","cars-byd","cars-nio","cars-xpeng","cars-zeekr","cars-electrek","cars-insideevs","cars-cnevpost"]);
  const russian = new Set(["cars-autonews-ru","cars-motor-ru","cars-drom","cars-quto","cars-zr","cars-autostat","cars-kolesa","cars-autoreview"]);
  const tech = new Set(["cars-tesla","cars-byd","cars-nio","cars-xpeng","cars-zeekr","cars-vw","cars-bmw","cars-mercedes","cars-electrek","cars-insideevs"]);

  for (const source of (state.sources || [])) {
    if (!source) continue;
    const id = String(source.id || "");
    const hay = String(source.name || "") + " " + String(source.url || "");

    if (/давыд|davyd/i.test(hay)) {
      source.enabled = false;
      source.autoPaused = { reason: "исключён редакцией канала «Что там у тачек?»", at: now };
      paused.push(source.name || source.url || id);
      continue;
    }

    if (source.group === "blogger") {
      if (!approvedIds.has(id)) {
        source.enabled = false;
        source.autoPaused = { reason: "не входит в утверждённый список автоблогеров", at: now };
        paused.push(source.name || source.url || id);
        continue;
      }
      source.enabled = true;
      source.rubric = "bloggers_tests";
      source.rubrics = ["bloggers_tests"];
      source.rubricAssignedAt = now;
      assigned.push(source.name || id);
      continue;
    }

    if (!id.startsWith("cars-")) continue;
    const many = [];
    if (russian.has(id)) many.push("russia_market", "driver_important");
    if (chinese.has(id)) many.push("china_cars");
    if (electric.has(id)) many.push("electric_hybrid");
    if (tech.has(id)) many.push("auto_tech");
    if (!many.includes("premieres")) many.push("premieres");
    if (!russian.has(id)) many.push("viral_unusual");
    source.rubric = many[0];
    source.rubrics = Array.from(new Set(many));
    source.rubricAssignedAt = now;
    assigned.push(source.name || id);
  }

  if (state.publicationSchedule && Array.isArray(state.publicationSchedule.slots)) {
    const old = new Set((oldBloggerSlots || []).map(String));
    state.publicationSchedule.slots = state.publicationSchedule.slots.filter(function(slot){
      return !(slot && slot.kind === "blogger" && old.has(String(slot.time || "")));
    });
  }
  state.sourceReplenish = Object.assign({}, state.sourceReplenish || {}, { lastAt: "" });
  if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;
  return { added, paused, assigned };
}


export function resetApprovedAutoBloggers(state, approvedBloggers, nowIso) {
  const now = nowIso || new Date().toISOString();
  const approvedIds = new Set((Array.isArray(approvedBloggers) ? approvedBloggers : []).map(function(source){ return String(source && source.id || ""); }).filter(Boolean));
  state.sourceStats = state.sourceStats && typeof state.sourceStats === "object" && !Array.isArray(state.sourceStats) ? state.sourceStats : {};
  const reset = [];
  for (const source of (state.sources || [])) {
    if (!source || !approvedIds.has(String(source.id || ""))) continue;
    source.enabled = true;
    delete source.autoPaused;
    source.editorEnabledAt = now;
    source.rubric = "bloggers_tests";
    source.rubrics = ["bloggers_tests"];
    source.rubricAssignedAt = now;
    if (Object.prototype.hasOwnProperty.call(state.sourceStats, source.id)) delete state.sourceStats[source.id];
    reset.push(source.name || source.id);
  }
  return { reset: reset };
}
