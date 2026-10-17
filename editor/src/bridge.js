// 和外面的宿主说话。宿主有两种：
// - BetterMD App：通过 WKWebView 的 messageHandlers.bettermd，postMessage 直接返回 App 的答复；
// - VS Code 插件（vscode/）：通过 acquireVsCodeApi().postMessage。每条消息带一个编号，插件用 { type: 'reply', requestId, value }
//   答复；插件要调用编辑器时发 { type: 'call', fn, args }，相当于 App 里的 window.bettermd.fn(...args)。
// 在普通浏览器里调试时只打日志。

const handler = () => window.webkit?.messageHandlers?.bettermd;
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const waiting = new Map();
let nextRequest = 0;

if (vscode) {
  // 告诉插件焦点在不在编辑器里、在不在查找栏里：插件只在焦点真的在这里时才拦 VS Code 的快捷键
  const reportFocus = () => vscode.postMessage({
    type: 'focus', editor: document.hasFocus(), find: !!document.activeElement?.closest?.('.cm-panels'),
  });
  window.addEventListener('focus', reportFocus);
  window.addEventListener('blur', reportFocus);
  document.addEventListener('focusin', reportFocus);
  document.addEventListener('focusout', () => setTimeout(reportFocus));
  window.addEventListener('message', event => {
    const m = event.data;
    if (m?.type === 'reply') {
      waiting.get(m.requestId)?.(m.value ?? null);
      waiting.delete(m.requestId);
    } else if (m?.type === 'call') {
      window.bettermd?.[m.fn]?.(...(m.args ?? []));
    }
  });
}

/** 发一条消息给宿主；返回宿主的答复（Promise）。不在宿主里时返回 null。 */
export function post(message) {
  if (vscode) {
    const requestId = ++nextRequest;
    return new Promise(resolve => {
      waiting.set(requestId, resolve);
      vscode.postMessage({ ...message, requestId });
    });
  }
  const h = handler();
  if (!h) {
    if (message.type !== 'change') console.debug('[bettermd]', message);
    return Promise.resolve(null);
  }
  return h.postMessage(message);
}

/** 在哪个宿主里：'app'、'vscode'，或者 null（普通浏览器）。 */
export const host = () => (vscode ? 'vscode' : handler() ? 'app' : null);
