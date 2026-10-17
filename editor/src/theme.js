// 深色还是浅色：在 VS Code 里跟着 VS Code 的主题（它给 <body> 加 vscode-dark、vscode-light 这类 class），
// 在 App 和浏览器里跟着系统（prefers-color-scheme）。深色时给 <html> 加 theme-dark，颜色在 editor.css 里。

/** 只看 VS Code 给的 class：深色返回 true，浅色返回 false，不在 VS Code 里返回 null。 */
export function vscodeTheme(classList) {
  if (classList.contains('vscode-high-contrast-light') || classList.contains('vscode-light')) return false;
  if (classList.contains('vscode-high-contrast') || classList.contains('vscode-dark')) return true;
  return null;
}

export function watchTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const dark = vscodeTheme(document.body.classList) ?? media.matches;
    document.documentElement.classList.toggle('theme-dark', dark);
  };
  media.addEventListener('change', apply);
  new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  apply();
}
