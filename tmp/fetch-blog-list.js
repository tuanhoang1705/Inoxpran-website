const fs=require('fs');
function env(k){for(const p of ['.env','backend/.env','frontend/.env']) if(fs.existsSync(p)){for(const line of fs.readFileSync(p,'utf8').split(/\r?\n/)){const m=line.match(/^([^#=]+)=(.*)$/); if(m&&m[1].trim()===k) return m[2].trim().replace(/^[ '\"]|[ '\"]$/g,'');}}}
const candidates=[env('API_BASE_URL')||'http://localhost:3056/v1/api','http://localhost:3056/v1/api'];
const key=env('API_KEY');
(async()=>{for(const base of [...new Set(candidates)]){const url=`${base.replace(/\/$/,'')}/blog?limit=200&page=1`;try{const r=await fetch(url,{headers:key?{'x-api-key':key}:{}}); console.log('URL',url,'status',r.status); const j=await r.json().catch(()=>null); const items=j?.metadata?.items||[]; console.log(JSON.stringify(items.slice(0,80).map(x=>({title:x.blog_title||x.title,slug:x.blog_slug||x.slug,category:x.blog_category_key||x.category,excerpt:x.blog_excerpt||x.excerpt})),null,2)); if(r.ok) break;}catch(e){console.log('ERR',url,e.message)}}})();
