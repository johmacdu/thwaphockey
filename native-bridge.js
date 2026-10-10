/*
 * Thwap native bridge (Capacitor).
 *
 * Loaded by index.html on EVERY page load, web and native alike. It is a no-op
 * in a plain browser: everything is gated on window.Capacitor?.isNativePlatform()
 * so the responsive website is completely unaffected. Inside the Capacitor iOS/
 * Android shell it:
 *   1. registers for push notifications and POSTs the device token to the backend
 *      (/api/coach?action=push-register), keyed to the signed-in player;
 *   2. exposes window.thwapHaptic(kind) for real native haptics, with a
 *      navigator.vibrate fallback on Android web (iOS web has no vibration API).
 *
 * The source site calls window.thwapHaptic('done'|'streak'|'select') at reward
 * moments; those calls are harmless no-ops on the web.
 */
(function () {
  'use strict';
  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());

  // ---- Haptics -------------------------------------------------------------
  // Always define window.thwapHaptic so site code can call it unconditionally.
  function webVibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }
  window.thwapHaptic = function (kind) {
    if (!isNative) { // Android web gets a basic buzz; iOS web no-ops.
      webVibrate(kind === 'streak' ? [12, 40, 12] : 12);
      return;
    }
    try {
      var H = Cap.Plugins && Cap.Plugins.Haptics;
      if (!H) return;
      if (kind === 'streak') { H.notification({ type: 'SUCCESS' }); }
      else if (kind === 'done') { H.impact({ style: 'MEDIUM' }); }
      else { H.impact({ style: 'LIGHT' }); } // 'select' and default
    } catch (e) {}
  };

  if (!isNative) return; // everything below is native-only

  // ---- Push notifications --------------------------------------------------
  function currentPlayerSlug() {
    try {
      var p = localStorage.getItem('bfPlayer');
      if (!p) return '';
      return p.trim().split(/\s+/)[0].toLowerCase();
    } catch (e) { return ''; }
  }

  function registerPush() {
    var P = Cap.Plugins && Cap.Plugins.PushNotifications;
    if (!P) return;
    P.checkPermissions().then(function (res) {
      if (res.receive === 'prompt' || res.receive === 'prompt-with-rationale') {
        return P.requestPermissions();
      }
      return res;
    }).then(function (res) {
      if (res && res.receive === 'granted') { P.register(); }
    }).catch(function () {});

    P.addListener('registration', function (token) {
      try {
        fetch('https://thwaphockey.com/api/coach?action=push-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            token: token.value,
            platform: (Cap.getPlatform && Cap.getPlatform()) || 'unknown',
            player: currentPlayerSlug()
          })
        }).catch(function () {});
      } catch (e) {}
    });

    P.addListener('registrationError', function () {});
    // Tapping a notification could deep-link later; for now just focus the app.
    P.addListener('pushNotificationActionPerformed', function () {});
  }

  document.addEventListener('DOMContentLoaded', registerPush);
  if (document.readyState !== 'loading') registerPush();

  // ---- Native splash hide --------------------------------------------------
  // capacitor.config.json sets SplashScreen launchAutoHide:false, so the native
  // splash stays up over the webview until we hide it once the web app has
  // painted. Feature-detected (no bundler); a no-op if the plugin is absent.
  // The fade honours prefers-reduced-motion.
  function hideSplash() {
    try {
      var SP = Cap.Plugins && Cap.Plugins.SplashScreen;
      if (!SP || !SP.hide) return;
      var reduce = false;
      try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        try { SP.hide({ fadeOutDuration: reduce ? 0 : 200 }); } catch (e) {}
      }); });
    } catch (e) {}
  }
  if (document.readyState !== 'loading') hideSplash();
  else window.addEventListener('load', hideSplash);
})();
