// Caps how many calls of an async function run at the same time; the rest wait in FIFO order.
// v0.55.0: with ~13 channels the helper-model calls (scoring, headline filter, translation ...) used to start all at once
// at the top of the hour; now at most `max` are in flight and the load is spread over time.
export function limitConcurrency(fn, max) {
  const limit = Math.max(1, Math.floor(Number(max) || 1));
  let active = 0;
  const waiting = [];
  function release() {
    active -= 1;
    const next = waiting.shift();
    if (next) { active += 1; next(); }
  }
  function limited(...args) {
    return new Promise(function(resolve, reject) {
      function run() {
        let result;
        try { result = Promise.resolve(fn.apply(this, args)); } catch (error) { release(); return reject(error); }
        result.then(function(v){ release(); resolve(v); }, function(e){ release(); reject(e); });
      }
      if (active < limit) { active += 1; run(); } else waiting.push(run);
    });
  }
  limited.stats = function() { return { active: active, waiting: waiting.length, limit: limit }; };
  return limited;
}
