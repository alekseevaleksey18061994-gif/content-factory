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


// v0.54.0: every seeded car source belongs to its OWN group (one panel = one theme); only Drom is shared by two
// practical groups. Before this, almost every source sat in "premieres" and every foreign one in "viral_unusual".
export const CAR_RUBRIC_MAP = {
  premieres: ["cars-toyota","cars-vw","cars-bmw","cars-mercedes","cars-motor1","cars-autocar","cars-caranddriver"],
  russia_market: ["cars-autonews-ru","cars-quto","cars-autostat","cars-drom","cars-zr"],
  driver_important: ["cars-zr","cars-kolesa","cars-autoreview","cars-drom"],
  china_cars: ["cars-byd","cars-geely","cars-chery","cars-gwm","cars-zeekr","cars-carnewschina","cars-gasgoo"],
  electric_hybrid: ["cars-tesla","cars-nio","cars-xpeng","cars-cnevpost","cars-electrek","cars-insideevs"],
  auto_tech: ["cars-thedrive","cars-reuters","cars-motor-ru","cars-autoevolution"],
  viral_unusual: ["cars-jalopnik","cars-topgear","cars-carscoops","cars-autoevolution"]
};
function rubricsOf(id) { return Object.keys(CAR_RUBRIC_MAP).filter(function(r){ return CAR_RUBRIC_MAP[r].includes(id); }); }

// Re-split the seeded car sources into their own groups WITHOUT touching enabled/paused flags (safe to run once on prod).
export function reassignCarRubricGroups(state, nowIso) {
  const now = nowIso || new Date().toISOString();
  const changed = [];
  for (const source of (state.sources || [])) {
    const id = String(source && source.id || "");
    if (!id.startsWith("cars-")) continue;
    const many = rubricsOf(id);
    if (!many.length) many.push("premieres");
    source.rubric = many[0];
    source.rubrics = many;
    source.rubricAssignedAt = now;
    changed.push(id);
  }
  return changed;
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
    const many = rubricsOf(id);
    if (!many.length) many.push("premieres");
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
