(function () {
  var root = document.querySelector('[data-code][data-target]');
  if (!root) return;
  var code = root.getAttribute('data-code') || '';
  var target = root.getAttribute('data-target') || '';
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
  if (root.getAttribute('data-navigation') !== 'internal') return;
  if (!target.startsWith('/') || target.startsWith('//') || target.indexOf('\\') !== -1) return;
  try {
    var destination = new URL(target, location.origin);
    // Only the parsed same-origin HTTP(S) URL reaches the navigation sink, never raw DOM text.
    if ((destination.protocol === 'https:' || destination.protocol === 'http:') && destination.origin === location.origin) {
      location.replace(destination.href);
    }
  } catch (error) { /* Keep the ordinary server-rendered link when the destination is invalid. */ }
}());
