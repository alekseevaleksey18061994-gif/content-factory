import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

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
} finally {
  child.kill("SIGTERM");
  fs.rmSync(dataDir,{recursive:true,force:true});
}
