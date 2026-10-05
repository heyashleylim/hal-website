/* Shared page behaviour: enrollment state + countdown, reveal, sticky buy bar,
   lite YouTube, story expand, waitlist form. Written for the NSMB sales-page markup. */
(function(){
  document.documentElement.classList.add('js');
  var page=document.getElementById('page');

  /* Enrollment state: auto-closes after the deadline; ?enroll=open|closed overrides for previews */
  var end=new Date(page.dataset.deadline);
  var q=new URLSearchParams(location.search).get('enroll');
  if(q==='open'||q==='closed')page.dataset.state=q;
  else page.dataset.state=(end-new Date()>0)?'open':'closed';
  if(q==='open'&&end-new Date()<=0)end=new Date(Date.now()+7*864e5); // preview countdown

  /* Countdown */
  var nums={};document.querySelectorAll('[data-u]').forEach(function(n){nums[n.dataset.u]=n});
  function pad(n){return String(n).padStart(2,'0')}
  function tick(){
    var s=Math.max(0,Math.floor((end-new Date())/1000));
    nums.d.textContent=pad(Math.floor(s/86400));nums.h.textContent=pad(Math.floor(s%86400/3600));
    nums.m.textContent=pad(Math.floor(s%3600/60));nums.s.textContent=pad(s%60);
    if(s<=0&&q!=='open'){page.dataset.state='closed';clearInterval(timer)}
  }
  var timer=setInterval(tick,1000);tick();

  /* Reveal on scroll */
  var els=document.querySelectorAll('.reveal');
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -6% 0px',threshold:.08});
    els.forEach(function(el){io.observe(el)});
  }else{els.forEach(function(el){el.classList.add('in')})}

  /* Sticky buy bar: after the hero, hidden around the enrollment section */
  var bar=document.getElementById('buybar'),hero=document.querySelector('.hero'),price=document.getElementById('price'),foot=document.querySelector('.footer');
  if('IntersectionObserver' in window){
    var past=false,nearPrice=false,nearFoot=false;
    function upd(){var on=past&&!nearPrice&&!nearFoot;bar.classList.toggle('show',on);bar.setAttribute('aria-hidden',on?'false':'true');bar.querySelector('a').tabIndex=on?0:-1}
    new IntersectionObserver(function(e){past=!e[0].isIntersecting&&e[0].boundingClientRect.top<0;upd()}).observe(hero);
    new IntersectionObserver(function(e){nearPrice=e[0].isIntersecting;upd()}).observe(price);
    new IntersectionObserver(function(e){nearFoot=e[0].isIntersecting;upd()}).observe(foot);
  }

  /* Lite YouTube */
  document.querySelectorAll('.yt').forEach(function(b){
    b.addEventListener('click',function(){
      var w=document.createElement('div');
      w.className='yt-wrap '+(b.classList.contains('yt--tall')?'yt-wrap--tall':'yt-wrap--wide');
      var f=document.createElement('iframe');
      f.src='https://www.youtube-nocookie.com/embed/'+b.dataset.yt+'?autoplay=1&rel=0&playsinline=1';
      f.title=b.getAttribute('aria-label').replace(' 재생','');
      f.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen=true;
      w.appendChild(f);b.replaceWith(w);f.focus();
    });
  });

  /* Long stories: clamp + expand */
  document.querySelectorAll('.story').forEach(function(s){
    var body=s.querySelector('.body'),btn=s.querySelector('.more');
    if(body.scrollHeight>380){
      s.classList.add('clamp','can-clamp');
      btn.addEventListener('click',function(){
        var open=!s.classList.toggle('clamp');
        btn.setAttribute('aria-expanded',open);
        btn.textContent=open?'접기 −':'전체 읽기 +';
      });
    }
  });

  /* Waitlist form: inline validation; posts to data-endpoint when set */
  var form=document.getElementById('waitlist-form');
  function setErr(input,id,msg){input.setAttribute('aria-invalid',msg?'true':'false');document.getElementById(id).textContent=msg||''}
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var f=form.elements,n=f.namedItem('name'),em=f.namedItem('email'),c=f.namedItem('consent'),first=null;
    if(!n.value.trim()){setErr(n,'wl-name-err','이름을 입력해 주세요.');first=first||n}else setErr(n,'wl-name-err','');
    if(!/^\S+@\S+\.\S+$/.test(em.value.trim())){setErr(em,'wl-email-err','올바른 이메일 주소를 입력해 주세요. 예: name@example.com');first=first||em}else setErr(em,'wl-email-err','');
    if(!c.checked){setErr(c,'wl-consent-err','안내 수신에 동의해 주셔야 등록할 수 있어요.');first=first||c}else setErr(c,'wl-consent-err','');
    if(first){first.focus();return}
    var msg=document.getElementById('wl-msg'),btn=form.querySelector('button[type=submit]');
    if(!form.dataset.endpoint){msg.textContent='폼이 아직 연결되지 않았어요. (data-endpoint 설정 필요)';return}
    btn.disabled=true;btn.textContent='등록 중…';
    fetch(form.dataset.endpoint,{method:'POST',body:new FormData(form)}).then(function(r){
      if(!r.ok)throw 0;
      form.reset();msg.textContent='등록되었어요! 다음 기수 오픈 소식을 가장 먼저 보내드릴게요 💌';
    }).catch(function(){msg.textContent='등록에 실패했어요. 잠시 후 다시 시도하거나 hello@ashleylim.com 으로 문의해 주세요.'})
    .finally(function(){btn.disabled=false;btn.innerHTML='지금 등록하기 <span class="arrow" aria-hidden="true">→</span>'});
  });
})();
