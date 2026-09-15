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
