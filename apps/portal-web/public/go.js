(function () {
  var root = document.querySelector('[data-code][data-target]');
  if (!root) return;
  var code = root.getAttribute('data-code') || '';
  var target = root.getAttribute('data-target') || '';
  function internal(value) {
    if (!value || value.indexOf('\\') !== -1 || value.charAt(0) !== '/' || value.charAt(1) === '/') return false;
    try { return new URL(value, location.origin).origin === location.origin; } catch (error) { return false; }
  }
  // This same-origin document makes Strict session cookies available for self-exclusion.
  // Keep the original link-visit metric; neither an outbound click nor adoption is recorded here.
  // keepalive lets this request finish after navigation. Counting never gates the visible link.
  try {
    fetch('/api/v1/promotion/clicks', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: code }),
    }).catch(function () {});
  } catch (error) { /* A disabled or unavailable fetch must not block reading. */ }
  if (root.getAttribute('data-navigation') === 'internal' && internal(target)) location.replace(target);
}());
