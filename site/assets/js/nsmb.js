/* /nsmb page behaviour: progress-bar reveal, lite YouTube. */
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
      var card=b.closest('.v-card');if(card)card.classList.add('is-playing');   /* phone frame stops tilting */
      w.appendChild(f);b.replaceWith(w);f.focus();
    });
  });

  /* The waitlist form lives in waitlist-flow.js (shared with /nsmb/waitlist). */
})();
