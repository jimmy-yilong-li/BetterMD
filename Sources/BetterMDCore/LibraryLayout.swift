import Foundation

/// 「我的笔记」目录里的固定位置和命名规则。
public enum LibraryLayout {
    public static let attachments = "附件"
    public static let trash = "废纸篓"
    public static let meta = ".bettermd"
    public static let stateFile = ".bettermd/state.json"
    /// 根目录下这些名字不算用户的文件夹。
    public static let reserved: Set<String> = [attachments, trash, meta]

    /// 把标题变成文件名（不含扩展名）：`/` `:` 换成全角，换行变空格，去掉开头的点，
    /// 最长 80 个字符，空的叫“无标题”。
    public static func fileName(forTitle title: String) -> String {
        var name = title
            .replacingOccurrences(of: "/", with: "／")
            .replacingOccurrences(of: ":", with: "：")
            .components(separatedBy: .newlines)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
        while name.hasPrefix(".") { name.removeFirst() }
        if name.count > 80 {
            name = String(name.prefix(80)).trimmingCharacters(in: .whitespaces)
        }
        return name.isEmpty ? "无标题" : name
    }

    /// `dir` 里第一个没被占用的名字：`base.ext`、`base 2.ext`、`base 3.ext`……
    /// `ext` 为 nil 时用于文件夹。`current` 是正在改名的那个文件自己，不算占用（大小写不同也算同一个）。
    public static func uniqueURL(in dir: URL, base: String, ext: String? = "md", excluding current: URL? = nil) -> URL {
        let fm = FileManager.default
        var n = 1
        while true {
            let name = n == 1 ? base : "\(base) \(n)"
            var url = dir.appendingPathComponent(name)
            if let ext { url.appendPathExtension(ext) }
            if let current, url.path.lowercased() == current.path.lowercased() { return url }
            if !fm.fileExists(atPath: url.path) { return url }
            n += 1
        }
    }
}
