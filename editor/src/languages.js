// 代码块的语法高亮：```后面写的语言名 → 对应的 CodeMirror 语言。用到时才创建。
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { yaml } from '@codemirror/lang-yaml';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { kotlin, objectiveC, csharp, dart } from '@codemirror/legacy-modes/mode/clike';

const lang = (name, alias, make) => LanguageDescription.of({ name, alias, load: async () => make() });
const legacy = parser => () => new LanguageSupport(StreamLanguage.define(parser));

export const codeLanguages = [
  lang('JavaScript', ['js', 'javascript', 'mjs', 'cjs', 'node'], () => javascript()),
  lang('JSX', ['jsx'], () => javascript({ jsx: true })),
  lang('TypeScript', ['ts', 'typescript'], () => javascript({ typescript: true })),
  lang('TSX', ['tsx'], () => javascript({ jsx: true, typescript: true })),
  lang('Python', ['py', 'python', 'python3'], () => python()),
  lang('CSS', ['css'], () => css()),
  lang('HTML', ['html', 'htm', 'xml', 'svg', 'vue'], () => html()),
  lang('JSON', ['json', 'jsonc', 'json5'], () => json()),
  lang('SQL', ['sql', 'mysql', 'postgres', 'postgresql', 'sqlite'], () => sql()),
  lang('C++', ['c', 'h', 'cpp', 'c++', 'cc', 'hpp', 'cxx'], () => cpp()),
  lang('Java', ['java'], () => java()),
  lang('Rust', ['rs', 'rust'], () => rust()),
  lang('Go', ['go', 'golang'], () => go()),
  lang('YAML', ['yml', 'yaml'], () => yaml()),
  lang('Swift', ['swift'], legacy(swift)),
  lang('Shell', ['sh', 'shell', 'bash', 'zsh', 'console', 'shellsession'], legacy(shell)),
  lang('LaTeX', ['tex', 'latex'], legacy(stex)),
  lang('Diff', ['diff', 'patch'], legacy(diff)),
  lang('Ruby', ['rb', 'ruby'], legacy(ruby)),
  lang('Lua', ['lua'], legacy(lua)),
  lang('TOML', ['toml'], legacy(toml)),
  lang('Kotlin', ['kt', 'kotlin'], legacy(kotlin)),
  lang('Objective-C', ['objc', 'objective-c', 'm', 'mm'], legacy(objectiveC)),
  lang('C#', ['cs', 'csharp', 'c#'], legacy(csharp)),
  lang('Dart', ['dart'], legacy(dart)),
];
