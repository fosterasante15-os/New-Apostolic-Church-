/* Install App: registers the service worker and powers the "Install app" button in the profile menu. */
(function () {
  'use strict';
  var deferred = null;
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /android/i.test(ua);
  var standalone = function () { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; };
  var $ = function (id) { return document.getElementById(id); };

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', function () {
    deferred = null; var b = $('install-app'); if (b) b.hidden = true;
    if (window.notify) window.notify('The app was installed on this device.', 'success', 'App installed');
  });
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });

  function closeProfileMenu() {
    var menu = $('profile-menu'), trigger = $('profile-trigger');
    if (menu) menu.hidden = true; if (trigger) trigger.setAttribute('aria-expanded', 'false');
    var top = document.querySelector('.topbar'); if (top) top.classList.remove('menu-open');
  }
  function help() {
    var steps, intro = 'Add this app to your home screen so it opens like a normal app.';
    if (isIOS) steps = ['Tap the Share button (the square with an arrow) at the bottom or top of Safari.', 'Scroll down and tap “Add to Home Screen”.', 'Tap “Add”. The church icon appears on your home screen.'];
    else if (isAndroid) steps = ['Tap the ⋮ menu at the top right of Chrome.', 'Tap “Install app” (or “Add to Home screen”).', 'Tap “Install”.'];
    else steps = ['In Chrome or Edge, click the install icon at the right end of the address bar (or open the ⋮ menu and choose “Install…”).', 'In Safari on a Mac: File → Add to Dock.', 'Click “Install”.'];
    if (!window.isSecureContext) intro = 'Installing needs a secure (https) address.';
    $('install-intro').textContent = intro;
    var list = $('install-steps'); list.replaceChildren();
    steps.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; list.append(li); });
    var dlg = $('install-dialog'); if (dlg && dlg.showModal) dlg.showModal();
  }
  function onClick() {
    closeProfileMenu();
    if (deferred) {
      var ev = deferred; deferred = null;
      ev.prompt();
      if (ev.userChoice && ev.userChoice.then) ev.userChoice.then(function (r) { if (r && r.outcome === 'accepted' && window.notify) window.notify('Installing the app…', 'success', 'Install app'); });
      return;
    }
    help();
  }
  document.addEventListener('DOMContentLoaded', function () {
    var btn = $('install-app'); if (!btn) return;
    if (standalone()) { btn.hidden = true; return; }              /* already running as an installed app */
    btn.addEventListener('click', onClick);
    var ok = $('install-ok'); if (ok) ok.addEventListener('click', function () { $('install-dialog').close(); });
  });
})();
