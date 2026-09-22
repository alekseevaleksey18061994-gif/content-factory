const BUILD='content-factory-v14';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.map(k=>caches.delete(k)));
  await self.clients.claim();
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  await Promise.all(clients.map(async client=>{
    try{
      const u=new URL(client.url);
      u.searchParams.set('build','14');
      await client.navigate(u.toString());
    }catch{}
  }));
  await self.registration.unregister();
})()));
self.addEventListener('fetch',()=>{});