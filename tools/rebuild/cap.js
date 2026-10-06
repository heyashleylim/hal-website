/* Page capture: serializes the live Elementor DOM (structure + computed styles) for rebuilding. */
window.__C = (function(){
const INH=['font-family','font-size','font-weight','font-style','line-height','color','text-align','letter-spacing','text-transform','white-space','word-break','text-decoration-line','text-decoration-color','text-underline-offset','list-style-type','visibility'];
const NON=['display','position','top','right','bottom','left','z-index','flex-direction','flex-wrap','justify-content','align-items','align-self','align-content','flex-grow','flex-shrink','flex-basis','order','row-gap','column-gap','grid-template-columns','grid-column','grid-row',
'margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left',
'background-color','background-image','background-size','background-position','background-repeat','background-attachment',
'border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-right-style','border-bottom-style','border-left-style','border-top-color','border-right-color','border-bottom-color','border-left-color',
'border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius','box-shadow','overflow-x','overflow-y','opacity','object-fit','object-position','aspect-ratio','vertical-align','transform','filter','text-shadow','float','clear','fill','stroke'];
const SKIP=new Set(['SCRIPT','STYLE','NOSCRIPT','LINK','META','TEMPLATE']);
const INLINE=new Set(['A','SPAN','STRONG','B','EM','I','U','S','SMALL','SUP','SUB','MARK','BR','IMG','CODE','LABEL']);
let frame=document.getElementById('__capframe');
if(!frame){frame=document.createElement('iframe');frame.id='__capframe';frame.style.cssText='position:absolute;width:10px;height:10px;left:-9999px;top:0;border:0';document.body.appendChild(frame);}
const fdoc=frame.contentDocument;const defs={};
function dflt(tag){tag=tag.toLowerCase();if(defs[tag])return defs[tag];let e;try{e=fdoc.createElement(tag)}catch(_){e=fdoc.createElement('div')}fdoc.body.appendChild(e);const cs=fdoc.defaultView.getComputedStyle(e);const o={};NON.forEach(p=>o[p]=cs.getPropertyValue(p));e.remove();return defs[tag]=o}
const rendered=el=>{const r=el.getBoundingClientRect();return !(r.width===0&&r.height===0)};
function styles(el,pcs){
  const cs=getComputedStyle(el),o={},d=dflt(el.tagName);
  INH.forEach(p=>{const v=cs.getPropertyValue(p);if(!pcs||pcs.getPropertyValue(p)!==v)o[p]=v});
  NON.forEach(p=>{const v=cs.getPropertyValue(p);if(v!==d[p])o[p]=v});
  if(el instanceof SVGElement){['width','height'].forEach(p=>o[p]=cs.getPropertyValue(p))}
  if(cs.display!=='none'&&rendered(el)){
    const r=el.getBoundingClientRect();o.__w=Math.round(r.width*10)/10;o.__h=Math.round(r.height*10)/10;
    const p=el.parentElement;if(p){const pc=getComputedStyle(p),pr=p.getBoundingClientRect();
      o.__pw=Math.round((pr.width-parseFloat(pc.paddingLeft)-parseFloat(pc.paddingRight)-parseFloat(pc.borderLeftWidth)-parseFloat(pc.borderRightWidth))*10)/10;
      o.__pdisp=pc.display;o.__pdir=pc.flexDirection;
      o.__ml=Math.round(r.left-pr.left-parseFloat(pc.paddingLeft)-parseFloat(pc.borderLeftWidth));o.__mr=Math.round(pr.right-r.right-parseFloat(pc.paddingRight)-parseFloat(pc.borderRightWidth));}
    o.__cw=cs.width;o.__maxw=cs.maxWidth;o.__minh=cs.minHeight;o.__hcss=cs.height;
  }
  o.__hidden=cs.display==='none'||cs.visibility==='hidden';
  return o;
}
const PKEEP=['content','display','position','top','right','bottom','left','width','height','background-color','background-image','background-size','background-position','border-top-width','border-top-style','border-top-color','border-bottom-width','border-bottom-style','border-bottom-color','border-left-width','border-left-style','border-left-color','border-top-left-radius','opacity','z-index','transform','font-family','font-size','font-weight','color','margin-left','margin-right','margin-top','line-height','vertical-align'];
function pseudo(el){const out={};['::before','::after'].forEach(ps=>{const c=getComputedStyle(el,ps);const ct=c.content;if(!ct||ct==='none'||ct==='normal')return;const o={};PKEEP.forEach(p=>o[p]=c.getPropertyValue(p));if(ct==='""'&&o['background-color']==='rgba(0, 0, 0, 0)'&&o['background-image']==='none'&&o['border-top-width']==='0px'&&o['border-bottom-width']==='0px'&&o['border-left-width']==='0px')return;out[ps]=o});return Object.keys(out).length?out:null}
let nextId=0;
const anchorIds=new Set([...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href').slice(1)).filter(Boolean));
function attrs(el){const a={};const t=el.tagName;
  if(t==='A'){const raw=el.getAttribute('href');if(raw)a.href=raw.startsWith('#')?raw:el.href;['target','rel'].forEach(k=>{if(el.getAttribute(k))a[k]=el.getAttribute(k)})}
  if(t==='IMG'){a.src=el.currentSrc&&!el.currentSrc.startsWith('data:')?el.currentSrc:(el.dataset.src||el.dataset.lazySrc||(el.getAttribute('srcset')||'').split(' ')[0]||el.src);a.alt=el.alt||'';if(el.naturalWidth){a.nw=el.naturalWidth;a.nh=el.naturalHeight}}
  if(t==='IFRAME'){a.src=el.src||el.dataset.src||el.dataset.lazyLoad||'';a.title=el.title||''}
  if(t==='VIDEO'){a.src=el.currentSrc||el.src;['poster','autoplay','muted','loop','playsinline','controls'].forEach(k=>{if(el.hasAttribute(k))a[k]=el.getAttribute(k)||''})}
  if(t==='SOURCE'){a.src=el.src}
  if(['INPUT','TEXTAREA','SELECT','BUTTON','FORM','LABEL','OPTION'].includes(t)){['type','name','placeholder','value','for','action','method','required','checked','selected'].forEach(k=>{if(el.hasAttribute(k))a[k]=el.getAttribute(k)})}
  if(t==='DETAILS'&&el.open)a.open='';
  const role=el.getAttribute&&el.getAttribute('role');
  if(role&&/^(tab|tabpanel|tablist)$/.test(role)){a.role=role;['aria-controls','aria-selected','aria-labelledby'].forEach(k=>{if(el.hasAttribute(k))a[k]=el.getAttribute(k)});if(el.id)a.id=el.id}
  if(el.id&&anchorIds.has(el.id))a.id=el.id;
  if(el.dataset&&el.dataset.settings&&/youtube_url|vimeo_url/.test(el.dataset.settings)){try{const s=JSON.parse(el.dataset.settings);a.video=s.youtube_url||s.vimeo_url}catch(_){}}
  if(el.dataset&&el.dataset.widget_type)a.wt=el.dataset.widget_type;
  if(el.classList){const c=[...el.classList].filter(x=>/^e-(opened|closed)$|^elementor-icon-list-icon$|^e-n-accordion-item-title-icon$|^swiper-slide$|^elementor-countdown/.test(x));if(c.length)a.cls=c.join(' ')}
  if(el.dataset&&el.dataset.date)a.date=el.dataset.date;
  return a}
function walk(el,pcs){
  if(SKIP.has(el.tagName)||el.id==='__capframe')return null;
  const cl=el.classList;
  if(cl&&(cl.contains('swiper-slide-duplicate')||cl.contains('screen-reader-text')||cl.contains('elementor-screen-only')||cl.contains('swiper-pagination')||cl.contains('swiper-button-next')||cl.contains('swiper-button-prev')))return null;
  if(el.tagName==='INPUT'&&el.type==='hidden')return null;
  const id=nextId++;el.setAttribute('data-cap',id);
  const cs=getComputedStyle(el);
  const node={i:id,t:el.tagName.toLowerCase(),a:attrs(el),s:styles(el,pcs)};
  const ps=pseudo(el);if(ps)node.p=ps;
  if(el instanceof SVGElement&&el.tagName.toLowerCase()==='svg'){node.svg=el.outerHTML.replace(/ (class|data-[\w-]+|aria-[\w-]+)="[^"]*"/g,'');return node}
  if(el.tagName==='IFRAME'||el.tagName==='IMG')return node;
  const kids=[];
  el.childNodes.forEach(n=>{
    if(n.nodeType===3){let tx=n.textContent.replace(/[\t\n\r ]+/g,' ');if(!tx.trim()){if(INLINE.has(el.tagName)||/^(P|H[1-6]|LI|TD|TH|LABEL|SUMMARY|BUTTON|FIGCAPTION|BLOCKQUOTE)$/.test(el.tagName))kids.push(' ');return}kids.push(tx)}
    else if(n.nodeType===1){const c=walk(n,cs);if(c)kids.push(c)}
  });
  node.c=kids;return node;
}
function prep(){document.querySelectorAll('.elementor-invisible').forEach(e=>e.classList.remove('elementor-invisible'));document.querySelectorAll('.animated').forEach(e=>{e.style.animation='none'})}
function restyle(){const out={};document.querySelectorAll('[data-cap]').forEach(el=>{const id=+el.dataset.cap;const p=el.parentElement;out[id]=styles(el,p?getComputedStyle(p):null);const ps=pseudo(el);if(ps)out[id].__p=ps});return out}
async function post(name,obj){const r=await fetch('http://127.0.0.1:8799/save?name='+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});return r.text()}
async function scrollAll(){const H=document.body.scrollHeight;for(let y=0;y<H;y+=500){scrollTo(0,y);await new Promise(r=>setTimeout(r,80))}scrollTo(0,0);await new Promise(r=>setTimeout(r,400))}
async function capture(name){
  await scrollAll();prep();
  const roots=[].concat([...document.querySelectorAll('.elementor[data-elementor-type=header]')],[...document.querySelectorAll('.elementor[data-elementor-type=wp-page],.elementor[data-elementor-type=wp-post]')],[...document.querySelectorAll('.elementor[data-elementor-type=footer]')]);
  if(roots.length&&!roots.some(r=>!/header|footer/.test(r.dataset.elementorType))){const m=document.querySelector('main, .site-main, article, .page-content');if(m)roots.splice(1,0,m)}
  nextId=0;const bcs=getComputedStyle(document.body);
  const tree=roots.map(r=>({role:r.dataset.elementorType||'main',node:walk(r,bcs)}));
  const meta={title:document.title,description:(document.querySelector('meta[name=description]')||{}).content||'',og:(document.querySelector('meta[property="og:image"]')||{}).content||'',path:location.pathname,vw:innerWidth,bodyBg:bcs.backgroundColor,bodyFont:bcs.fontFamily,bodyColor:bcs.color,bodySize:bcs.fontSize,bodyLH:bcs.lineHeight,docH:document.body.scrollHeight,n:nextId,headCss:[...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.href).filter(h=>/fonts\.googleapis/.test(h))};
  return post(name,{meta,tree});
}
async function capturePass(name){await scrollAll();prep();return post(name,{vw:innerWidth,styles:restyle()})}
return {capture,capturePass};
})();
