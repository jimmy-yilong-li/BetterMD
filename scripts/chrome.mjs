// 测试和截图工具共用的 Chrome 路径；CHROME_BIN 可以指向自定义 Chromium。
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function chromePath() {
  const candidates = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ...(process.env.PATH ?? '').split(delimiter).flatMap(dir => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(name => join(dir, name)))];
  const found = candidates.find(p => p && existsSync(p));
  if (!found) throw new Error('未找到 Chrome / Chromium，请安装或设置 CHROME_BIN');
  return found;
}
