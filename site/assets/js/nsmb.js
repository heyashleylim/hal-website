/* /nsmb page behaviour: progress-bar reveal, lite YouTube, waitlist form. */
(function(){
  /* 95% / 5% bars fill when the card scrolls into view */
  var cards=document.querySelectorAll('[data-reveal]');
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.3});
    cards.forEach(function(c){io.observe(c)});
  }else{cards.forEach(function(c){c.classList.add('in')})}

  /* Lite YouTube: thumbnail until clicked, then a privacy-enhanced embed */
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

  /* Waitlist form: inline validation; posts to data-endpoint when set */
  var form=document.getElementById('waitlist-form');
  if(!form)return;
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
    .finally(function(){btn.disabled=false;btn.textContent='지금 등록하기'});
  });
})();
