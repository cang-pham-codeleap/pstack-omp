// Evidence overlay for browser recordings: oversized cursor, click ripple, step caption.
// Inject before recording: await tab.addInitScript(src); await tab.reload(). Mounts once per document.
// Caption a step from any JS world (tab.evaluate and Puppeteer page.evaluate run in different worlds):
//   document.dispatchEvent(new CustomEvent("evidence:step", { detail: "3. Pay with test card" }))
// The caption shows detail verbatim and survives same-origin page loads; the harness numbers steps. detail: "" hides it.
(() => {
  if (document.getElementById("__ev_root")) return;
  const mount = () => {
    const root = document.createElement("div");
    root.id = "__ev_root";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    root.innerHTML = `
      <svg id="__ev_cursor" width="44" height="44" viewBox="0 0 24 24" style="position:absolute;left:-60px;top:-60px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));transform-origin:21% 14%;transition:transform .1s">
        <path d="M5 3l14 8-6.5 1.5L16 20l-3 1.5-3.5-7.5L5 18z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
      <div id="__ev_caption" style="position:absolute;left:50%;bottom:16px;transform:translateX(-50%);max-width:90%;padding:8px 14px;border-radius:8px;background:rgba(17,17,17,.85);color:#fff;font:600 16px/1.3 system-ui,sans-serif;display:none"></div>`;
    document.documentElement.append(root);
    const cursor = root.querySelector("#__ev_cursor");
    const caption = root.querySelector("#__ev_caption");
    const move = (e) => { cursor.style.left = `${e.clientX - 9}px`; cursor.style.top = `${e.clientY - 6}px`; };
    for (const type of ["mousemove", "pointermove", "dragover", "drag"]) addEventListener(type, move, true);
    addEventListener("mousedown", (e) => {
      cursor.style.transform = "scale(.84)";
      const ring = document.createElement("div");
      ring.style.cssText = `position:absolute;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border:3px solid #f43;border-radius:50%;transition:transform .45s,opacity .45s`;
      root.append(ring);
      requestAnimationFrame(() => { ring.style.transform = "scale(1.8)"; ring.style.opacity = "0"; });
      setTimeout(() => ring.remove(), 500);
    }, true);
    addEventListener("mouseup", () => { cursor.style.transform = ""; }, true);
    addEventListener("drop", () => { cursor.style.transform = ""; }, true);
    let store = null;
    try { store = sessionStorage; } catch {}
    const FILE_INPUT_CLICK_COUNT_KEY = "__ev_file_input_click_count";
    let fileInputClickCount = Number(store?.getItem(FILE_INPUT_CLICK_COUNT_KEY) ?? "0") || 0;
    const publishFileInputClickCount = () => {
      document.documentElement.dataset.evFileInputClickCount = String(fileInputClickCount);
      store?.setItem(FILE_INPUT_CLICK_COUNT_KEY, String(fileInputClickCount));
    };
    publishFileInputClickCount();
    const clickPrototype = HTMLInputElement.prototype;
    const clickDescriptor = Object.getOwnPropertyDescriptor(clickPrototype, "click");
    const originalClick = clickPrototype.__ev_original_click__ ?? clickPrototype.click;
    if (!clickPrototype.__ev_original_click__) {
      Object.defineProperty(clickPrototype, "__ev_original_click__", { value: originalClick });
    }
    if (!clickPrototype.__ev_wrapped__) {
      const wrappedClick = function (...args) {
        if (this?.type === "file" && !this.disabled) {
          const root = this.ownerDocument?.documentElement;
          let nextCount = Number(root?.dataset.evFileInputClickCount ?? "0") + 1;
          try {
            this.ownerDocument?.defaultView?.sessionStorage?.setItem(FILE_INPUT_CLICK_COUNT_KEY, String(nextCount));
          } catch {
            nextCount = Number(root?.dataset.evFileInputClickCount ?? "0") + 1;
          }
          if (root) root.dataset.evFileInputClickCount = String(nextCount);
        }
        return originalClick.apply(this, args);
      };
      Object.defineProperty(wrappedClick, "__ev_wrapped__", { value: true });
      Object.defineProperty(clickPrototype, "click", { ...(clickDescriptor ?? { configurable: true, writable: true }), value: wrappedClick });
      Object.defineProperty(clickPrototype, "__ev_wrapped__", { value: true });
    }
    const show = (text) => {
      caption.textContent = text;
      caption.style.display = text ? "block" : "none";
      store?.setItem("__ev_caption", text);
    };
    show(store?.getItem("__ev_caption") ?? "");
    document.addEventListener("evidence:step", (e) => show(e.detail));
  };
  document.documentElement ? mount() : addEventListener("DOMContentLoaded", mount, { once: true });
})();
