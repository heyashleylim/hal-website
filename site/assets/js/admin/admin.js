/* Shared helpers for the private podcast admin pages: calls to /api/podcast-admin. */
window.Admin = (function () {
  function handle(res) {
    if (res.status === 401) {
      location.href = '/admin/login?next=' + encodeURIComponent(location.pathname);
      return new Promise(function () {});
    }
    return res.json().catch(function () {
      throw new Error('The admin API did not answer (HTTP ' + res.status + '). It only runs on Vercel deployments, not on the local preview server.');
    }).then(function (body) {
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      return body;
    });
  }
  return {
    get: function (action, params) {
      var q = new URLSearchParams(Object.assign({ action: action }, params || {}));
      return fetch('/api/podcast-admin?' + q, { credentials: 'same-origin' }).then(handle);
    },
    post: function (action, data) {
      return fetch('/api/podcast-admin?action=' + encodeURIComponent(action), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}),
      }).then(handle);
    },
    esc: function (s) {
      return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    },
  };
})();
