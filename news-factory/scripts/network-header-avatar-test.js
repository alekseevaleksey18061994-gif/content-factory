import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Exercise the actual header helper in isolation, not a duplicated implementation.
const html=fs.readFileSync(new URL("../public/admin.html",import.meta.url),"utf8");
const start=html.indexOf("function updateHeaderAvatar(pageId){");
const end=html.indexOf("\nfunction renderWorkspaceChrome(){",start);
assert.ok(start>=0 && end>start,"header helper must precede workspace chrome");
assert.ok(html.includes("updateHeaderAvatar(id);"),"navigation refreshes header avatar");
assert.match(html,/function renderWorkspaceChrome\(\)\{[\s\S]*?updateHeaderAvatar\(\);/,"workspace refreshes header avatar");
const nodes={
  networkPage:{classList:{contains:()=>true}},
  accountAvatar:{classList:{add(){this.photo=true},remove(){this.photo=false}},innerHTML:""},
  accountButtonName:{textContent:""},
  accountButtonHandle:{textContent:""},
  accountButton:{setAttribute(name,value){this[name]=value}}
};
const workspace={name:"Что там у ИИ?",avatarUrl:"/channel-avatar.png",initials:"AI",telegramPublicUsername:"chtotamai"};
const context={
  currentWorkspaceMeta:workspace,
  el:id=>nodes[id]||null,
  workspaceHandle:ws=>"@"+ws.telegramPublicUsername,
  applyWorkspaceAvatar:(id,ws)=>{
    nodes[id].innerHTML='<img src="'+ws.avatarUrl+'" alt="">';
    nodes[id].classList.remove("has-photo");
  }
};
vm.createContext(context);
vm.runInContext(html.slice(start,end),context,{filename:"header-avatar.js"});
context.updateHeaderAvatar("networkPage");
assert.match(nodes.accountAvatar.innerHTML,/\/icon-192\.png\?v=0741/);
assert.equal(nodes.accountButtonName.textContent,"News Factory");
assert.equal(nodes.accountButtonHandle.textContent,"Все каналы");
assert.equal(nodes.accountButton["aria-label"],"Открыть список каналов");
context.updateHeaderAvatar("homePage");
assert.match(nodes.accountAvatar.innerHTML,/channel-avatar\.png/);
assert.equal(nodes.accountButtonName.textContent,workspace.name);
assert.equal(nodes.accountButtonHandle.textContent,"@chtotamai");
assert.equal(nodes.accountButton["aria-label"],"Открыть личный кабинет");
context.updateHeaderAvatar();
assert.match(nodes.accountAvatar.innerHTML,/\/icon-192\.png\?v=0741/);
console.log("network-header-avatar-test: PASS");
