(function () {
  if (typeof window === "undefined") return;
  const w = window;
  try {
    sessionStorage.setItem("vercel-live-feedback-optout", "1");
    sessionStorage.setItem("vercel-live-feedback-hidden", "1");
  } catch (e) {
    // ignore storage errors
  }
  if (!w.chrome) w.chrome = {};
  if (!w.chrome.runtime) w.chrome.runtime = {};
  if (typeof w.chrome.runtime.sendMessage !== "function") {
    w.chrome.runtime.sendMessage = function () {
      const callback = arguments[arguments.length - 1];
      if (typeof callback === "function") {
        try {
          callback(null);
        } catch (e) {
          // noop
        }
      }
      return Promise.resolve(null);
    };
  }
})();
