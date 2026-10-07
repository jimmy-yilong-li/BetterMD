// 和 Swift 那边说话。App 里通过 WKWebView 的 messageHandlers.bettermd；在普通浏览器里调试时只打日志。

const handler = () => window.webkit?.messageHandlers?.bettermd;

/** 发一条消息给 App；返回 App 的答复（Promise）。不在 App 里时返回 null。 */
export function post(message) {
  const h = handler();
  if (!h) {
    if (message.type !== 'change') console.debug('[bettermd]', message);
    return Promise.resolve(null);
  }
  return h.postMessage(message);
}

export const inApp = () => !!handler();
