/* Private podcast pages: shows the "copy" button next to the feed address (the address stays selectable without JS). */
(function () {
  document.querySelectorAll('[data-copy]').forEach(function (button) {
    var input = document.querySelector(button.getAttribute('data-copy'));
    if (!input) return;
    var label = button.textContent;
    button.hidden = false;
    button.addEventListener('click', function () {
      function done(ok) {
        button.textContent = ok ? '복사됨' : '길게 눌러 복사';
        setTimeout(function () { button.textContent = label; }, 2000);
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(input.value).then(function () { done(true); }, function () { done(false); });
      } else {
        input.select();
        try { done(document.execCommand('copy')); } catch (e) { done(false); }
      }
    });
    input.addEventListener('focus', function () { input.select(); });
  });
})();
