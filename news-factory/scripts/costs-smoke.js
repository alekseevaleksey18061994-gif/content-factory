import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { normalizeBalanceInput, computeApiBalance } from "../lib/costs.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "news-factory-costs-"));
const port = 39321;
const password = "local-smoke-password";
const appDir = fileURLToPath(new URL("..", import.meta.url));
const child = spawn(process.execPath, ["server.js"], {
  cwd: appDir,
  env: Object.assign({}, process.env, {
    PORT: String(port),
    DATA_DIR: dataDir,
    DATABASE_URL: "",
    ADMIN_UI_PASSWORD: password,
    ADMIN_UI_PASSWORD_SHA256: "",
    COLLECTOR_ENABLED: "false",
    AUTO_PUBLISH_ENABLED: "false",
    TELEGRAM_BOT_TOKEN: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: ""
  }),
  stdio: ["ignore","pipe","pipe"]
});

let stderr="";
child.stderr.on("data",function(x){ stderr+=String(x); });

async function waitForHealth() {
  for (let i=0;i<60;i+=1) {
    try {
      const response=await fetch("http://127.0.0.1:"+port+"/health");
      if(response.ok)return response.json();
    } catch {}
    await new Promise(function(resolve){setTimeout(resolve,100);});
  }
  throw new Error("server did not become healthy: "+stderr.slice(-600));
}

// ---- API balance: pure helpers ------------------------------------------
{
  const now = new Date("2026-10-02T12:00:00Z");
  assert.equal(normalizeBalanceInput("google", {amountUsd:5}, null, now).ok, false, "unknown provider rejected");
  assert.equal(normalizeBalanceInput("openai", {amountUsd:-1}, null, now).ok, false, "negative rejected");
  assert.equal(normalizeBalanceInput("openai", {amountUsd:"abc"}, null, now).ok, false, "NaN rejected");
  assert.equal(normalizeBalanceInput("openai", {amountUsd:""}, null, now).ok, false, "empty rejected");
  assert.equal(normalizeBalanceInput("openai", {amountUsd:Infinity}, null, now).ok, false, "Infinity rejected");
  assert.equal(normalizeBalanceInput("openai", {amountUsd:5, asOf:"2026-12-01T00:00:00Z"}, null, now).ok, false, "future asOf rejected");
  assert.equal(normalizeBalanceInput("openai", {amountUsd:5, lowUsd:-2}, null, now).ok, false, "negative threshold rejected");
  const ok = normalizeBalanceInput("anthropic", {amountUsd:"12,50"}, null, now);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.amountUsd, 12.5, "comma decimal accepted");
  assert.equal(ok.value.lowUsd, 5, "default threshold");
  assert.equal(ok.value.asOf, now.toISOString(), "asOf defaults to now");
  const keep = normalizeBalanceInput("anthropic", {amountUsd:3}, {lowUsd:20}, now);
  assert.equal(keep.value.lowUsd, 20, "previous threshold kept");
  assert.equal(normalizeBalanceInput("openai", {clear:true}, null, now).clear, true);

  const cfg = { amountUsd: 50, asOf: "2026-09-30T12:00:00Z", lowUsd: 10 };
  const a = computeApiBalance(cfg, 14, 14, now, 400);
  assert.equal(a.remainingUsd, 36);
  assert.equal(a.status, "ok");
  assert.equal(Math.round(a.avgDailyUsd), 7, "2 days window -> 7/day");
  assert.equal(Math.round(a.daysLeft), 5);
  assert.equal(computeApiBalance(cfg, 45, 45, now, 400).status, "low");
  const empty = computeApiBalance(cfg, 60, 60, now, 400);
  assert.equal(empty.status, "empty");
  assert.equal(empty.daysLeft, null, "no days-left when balance is empty");
  assert.equal(computeApiBalance(cfg, 0, 0, now, 400).daysLeft, null, "no spend -> unknown pace");
  assert.equal(computeApiBalance({amountUsd:5, asOf:"2025-01-01T00:00:00Z", lowUsd:1}, 0, 0, now, 400).spendIncomplete, true);
  console.log("ok - api balance helpers");
}

try {
  const health=await waitForHealth();
  assert.equal(health.ok,true);
  const login=await fetch("http://127.0.0.1:"+port+"/api/login",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:password})
  });
  assert.equal(login.status,200);
  const cookie=String(login.headers.get("set-cookie")||"").split(";")[0];
  assert.ok(cookie.includes("nf_session="));
  const response=await fetch("http://127.0.0.1:"+port+"/api/costs?period=30&scope=network",{headers:{cookie:cookie}});
  assert.equal(response.status,200);
  const body=await response.json();
  for(const key of ["today","monthToDate","forecastMonth","costPerPublishedPost","wastedOnSkipped","daily","workspaces"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(body,key),"missing "+key);
  }
  console.log("ok - local health and /api/costs smoke");
  // balance endpoint: validation + persistence (no DB in this smoke, so spend is unavailable)
  const post=function(body){return fetch("http://127.0.0.1:"+port+"/api/costs/balance",{method:"POST",headers:{"content-type":"application/json",cookie:cookie},body:JSON.stringify(body)});};
  assert.equal((await post({provider:"openai",amountUsd:-5})).status,400);
  assert.equal((await post({provider:"nope",amountUsd:5})).status,400);
  const saved=await post({provider:"openai",amountUsd:25,lowUsd:3});
  assert.equal(saved.status,200);
  const savedBody=await saved.json();
  const oa=savedBody.balances.find(function(x){return x.provider==="openai";});
  const an=savedBody.balances.find(function(x){return x.provider==="anthropic";});
  assert.equal(oa.configured,true);
  assert.equal(an.configured,false);
  const again=await (await fetch("http://127.0.0.1:"+port+"/api/costs?period=30&scope=network",{headers:{cookie:cookie}})).json();
  assert.ok(Array.isArray(again.balances)&&again.balances.length===2,"balances in /api/costs");
  assert.equal(JSON.stringify(again).includes("sk-"),false,"no key-like strings in report");
  const unauth=await fetch("http://127.0.0.1:"+port+"/api/costs/balance",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  assert.equal(unauth.status,401,"balance endpoint requires auth");
  console.log("ok - balance endpoint smoke");

} finally {
  child.kill("SIGTERM");
  fs.rmSync(dataDir,{recursive:true,force:true});
}
