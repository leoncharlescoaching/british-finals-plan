import http from 'node:http';
import {createHash, createHmac, timingSafeEqual, randomUUID} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const pdf = path.join(root, 'private/british-finals-plan.pdf');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf'};
export function createApp(env = process.env, fetcher = fetch) {
  const base = (env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const secret = env.DOWNLOAD_SECRET || '';
  const origin = new URL(base).origin;
  const buckets = new Map();
  function token() {
    const payload = Buffer.from(JSON.stringify({exp:Date.now()+7*86400000,nonce:randomUUID()})).toString('base64url');
    return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
  }
  function validToken(value) {
    if(secret.length < 32 || !value || value.length>512) return false;
    try {
      const [p,s,...extra] = value.split('.');
      if(extra.length || !p || !s) return false;
      const expected = createHmac('sha256',secret).update(p).digest();
      const provided = Buffer.from(s,'base64url');
      return provided.length===expected.length && timingSafeEqual(provided,expected) && JSON.parse(Buffer.from(p,'base64url')).exp>Date.now();
    } catch {return false;}
  }
  function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
  function limited(key) {
    const now = Date.now();
    for(const [k,b] of buckets) if(b.until<now)buckets.delete(k);
    if(buckets.size>10000) return true;
    const b = buckets.get(key)||{count:0,until:now+600000};
    b.count++; buckets.set(key,b); return b.count>10;
  }
  async function provider(url,body,method='POST',headers={}) {
    const response = await fetcher(url,{method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('Provider rejected request');
    return response.json();
  }
  return async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const url = new URL(req.url, origin);
    try {
      if(url.pathname==='/api/subscribe') {
        if(req.method!=='POST')return json(res,405,{error:'Use the email form to request your plan.'});
        if(req.headers.origin!==origin)return json(res,403,{error:'Please submit from the plan page.'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Invalid request.'});
        // Socket address is deliberately used, never an untrusted forwarded header.
        // Add an edge rate limit when deploying behind a reverse proxy (see README).
        if(limited(req.socket.remoteAddress))return json(res,429,{error:'Too many requests. Please try again in 10 minutes.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return json(res,413,{error:'Request too large.'});}
        let input;try{input=JSON.parse(raw);}catch{return json(res,400,{error:'Invalid request.'});}
        const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
        if(input.website || email.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))return json(res,400,{error:'Enter a valid email address.'});
        const optedIn = input.marketingConsent === true;
        if(optedIn && input.consentVersion !== '2026-09-16-v1')return json(res,400,{error:'Please refresh the page and confirm your email preference.'});
        if(limited(createHash('sha256').update(email).digest('hex')))return json(res,429,{error:'Please wait 10 minutes before requesting again.'});
        if(secret.length<32 || !env.MAILCHIMP_API_KEY || !env.MAILCHIMP_AUDIENCE_ID || !/^us\d+$/.test(env.MAILCHIMP_SERVER_PREFIX||''))return json(res,503,{error:'The plan delivery service isn’t ready yet. Please try again later.'});
        const hash=createHash('md5').update(email).digest('hex');
        const memberUrl=`https://${env.MAILCHIMP_SERVER_PREFIX}.api.mailchimp.com/3.0/lists/${encodeURIComponent(env.MAILCHIMP_AUDIENCE_ID)}/members/${hash}`;
        const auth={Authorization:'Basic '+Buffer.from('lgf:'+env.MAILCHIMP_API_KEY).toString('base64')};
        // transactional = non-subscribed contact. Omit status so existing consent is never overwritten.
        try {
          await provider(memberUrl,{email_address:email,status_if_new:'transactional'},'PUT',auth);
        } catch {return json(res,502,{error:'We couldn’t save your request. Please try again shortly.'});}
        if(optedIn) {
          try {
            // Persist evidence BEFORE changing marketing status. Never infer consent from the source tag.
            await provider(memberUrl+'/notes',{note:JSON.stringify({
              event:'email_marketing_opt_in',consent:true,version:'2026-09-16-v1',
              recorded_at:new Date().toISOString(),source:base+'/',
              wording:'Yes, email me training tips and coaching offers from Leon Charles / Look Good Fitness. I can unsubscribe anytime.'
            })},'POST',auth);
            const member = await provider(memberUrl,{status:'subscribed'},'PATCH',auth);
            if(member.status !== 'subscribed')throw new Error('Subscription not confirmed');
          } catch {return json(res,502,{error:'We couldn’t confirm your email subscription. Please try again, or untick the optional box to download without subscribing.'});}
        }
        // A tag is attribution, not marketing permission. Tag failure never loses the download.
        try {await provider(memberUrl+'/tags',{tags:[{name:'British Finals Lead Magnet – Bio',status:'active'}]},'POST',auth);}catch{}
        return json(res,200,{downloadPageUrl:'/download?token='+token()});
      }
      if(url.pathname==='/download') {
        if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
        if(!validToken(url.searchParams.get('token'))) {
          res.writeHead(303,{'Location':'/?expired=1','Cache-Control':'no-store'});return res.end();
        }
        const page=await readFile(path.join(root,'public/download.html'));
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'});
        return res.end(req.method==='HEAD'?undefined:page);
      }
      if(url.pathname==='/api/download') {
        if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
        if(!validToken(url.searchParams.get('token')))return json(res,403,{error:'This download link is missing or has expired. Request your plan again from the home page.'});
        const info=await stat(pdf);
        res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="Leon-Charles-British-Finals-Plan.pdf"','Content-Length':info.size,'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'});
        if(req.method==='HEAD')return res.end();
        const stream=createReadStream(pdf);stream.on('error',()=>res.destroy());stream.pipe(res);return;
      }
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
      // Explicit allowlist ensures private PDF, environment and source files are never public.
      const files={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js','/download.js':'download.js','/assets/leon.webp':'assets/leon.webp','/assets/logo.png':'assets/logo.png','/assets/guide-cover.webp':'assets/guide-cover.webp','/assets/favicon.svg':'assets/favicon.svg','/assets/anton.ttf':'assets/anton.ttf'};
      if(!files[url.pathname])return json(res,404,{error:'Page not found.'});
      const filename=files[url.pathname];const data=await readFile(path.join(root,'public',filename));
      res.writeHead(200,{'Content-Type':types[path.extname(filename)],'Cache-Control':filename.endsWith('.html')?'no-cache':'public, max-age=3600'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch {if(!res.headersSent)json(res,500,{error:'Something went wrong. Please try again.'});else res.destroy();}
  };
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const port=Number(process.env.PORT)||3000;
 http.createServer(createApp()).listen(port,'0.0.0.0',()=>console.log(`Look Good Fitness: http://localhost:${port}`));
}
