import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createApp} from '../server.mjs';
const env={PUBLIC_BASE_URL:'http://localhost:3000',DOWNLOAD_SECRET:'a'.repeat(64),MAILCHIMP_API_KEY:'test-us1',MAILCHIMP_AUDIENCE_ID:'test',MAILCHIMP_SERVER_PREFIX:'us1'};
async function withServer(config,provider,fn){const s=http.createServer(createApp(config,provider));await new Promise(r=>s.listen(0,'127.0.0.1',r));try{await fn('http://127.0.0.1:'+s.address().port);}finally{await new Promise(r=>s.close(r));}}
const post=(url,body)=>fetch(url+'/api/subscribe',{method:'POST',headers:{origin:env.PUBLIC_BASE_URL,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('capture first, no implicit subscription, download page and protected PDF',async()=>{
 const calls=[];await withServer(env,async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>url.includes('mandrill')?[{status:'queued'}]:{}};},async url=>{
  assert.equal((await fetch(url+'/private/british-finals-plan.pdf')).status,404);
  assert.equal((await fetch(url+'/api/download')).status,403);
  assert.equal((await fetch(url+'/.env')).status,404);
  const res=await post(url,{email:'LEON@example.com'});assert.equal(res.status,200);const data=await res.json();assert.equal(calls.length,2);assert.equal(data.emailQueued,undefined);
  assert.equal(calls[0].body.status_if_new,'transactional');assert.equal('status' in calls[0].body,false);assert.equal(calls[0].body.email_address,'leon@example.com');
  const page=await fetch(url+data.downloadPageUrl);assert.equal(page.status,200);assert.match(await page.text(),/Your plan is ready/);
  const download=await fetch(url+data.downloadPageUrl.replace('/download?','/api/download?'),{method:'HEAD'});assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),'application/pdf');
  assert.equal((await fetch(url+data.downloadPageUrl.replace('/download?','/api/download?')+'tamper')).status,403);
 });
});
test('invalid email, honeypot, provider failure and missing configuration fail closed',async()=>{
 await withServer(env,async()=>{throw Error('offline');},async url=>{
  assert.equal((await post(url,{email:'bad'})).status,400);
  assert.equal((await post(url,{email:'a@example.com',website:'bot'})).status,400);
  const response=await post(url,{email:'a@example.com'});assert.equal(response.status,502);assert.equal((await response.json()).downloadPageUrl,undefined);
 });await withServer({},async()=>{throw Error('should not call');},async url=>{assert.equal((await post(url,{email:'a@example.com'})).status,503);});
});
test('download page without valid access returns to signup',async()=>{
 await withServer(env,async()=>{throw Error('not called');},async url=>{
   const res=await fetch(url+'/download',{redirect:'manual'});assert.equal(res.status,303);assert.equal(res.headers.get('location'),'/?expired=1');
   assert.equal((await fetch(url+'/download.html')).status,404);
 });
});
test('explicit opt-in records evidence before subscribing, then unlocks the plan',async()=>{
 const calls=[];
 await withServer(env,async(url,options)=>{calls.push({url,method:options.method,body:JSON.parse(options.body)});return {ok:true,json:async()=>options.method==='PATCH'?{status:'subscribed'}:{}};},async url=>{
  const res=await post(url,{email:'new@example.com',marketingConsent:true,consentVersion:'2026-09-16-v1'});
  assert.equal(res.status,200);assert.ok((await res.json()).downloadPageUrl);
  assert.equal(calls[0].body.status_if_new,'transactional');
  assert.ok(calls[1].url.endsWith('/notes'));
  const record=JSON.parse(calls[1].body.note);assert.equal(record.consent,true);assert.match(record.wording,/coaching offers/);assert.ok(Date.parse(record.recorded_at));
  assert.equal(calls[2].method,'PATCH');assert.equal(calls[2].body.status,'subscribed');
 });
});
test('missing checkbox and string true never subscribe; stale consent is rejected',async()=>{
 const calls=[];await withServer(env,async(url,options)=>{calls.push(options.method);return {ok:true,json:async()=>({})};},async url=>{
  assert.equal((await post(url,{email:'a@example.com',marketingConsent:'true',consentVersion:'2026-09-16-v1'})).status,200);
  assert.equal(calls.includes('PATCH'),false);
  assert.equal((await post(url,{email:'b@example.com',marketingConsent:true,consentVersion:'old'})).status,400);
 });
});
test('consent record failure prevents subscription and reports failure',async()=>{
 const calls=[];await withServer(env,async(url,options)=>{calls.push(options.method);return {ok:!url.endsWith('/notes'),json:async()=>({})};},async url=>{
 const response=await post(url,{email:'a@example.com',marketingConsent:true,consentVersion:'2026-09-16-v1'});
 assert.equal(response.status,502);assert.equal(calls.includes('PATCH'),false);assert.equal((await response.json()).downloadPageUrl,undefined);
 });
});
