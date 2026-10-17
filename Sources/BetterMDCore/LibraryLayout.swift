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
        // 文件名最长 255 个字节：80 个汉字是 240 字节，正好；全是 emoji 的长标题 80 个字会超过。留出“ 2.md”这类后缀的位置
        while name.utf8.count > 240 { name.removeLast() }
        return name.isEmpty ? "无标题" : name
    }

    /// 标题加一个后缀（比如“（别处的版本）”）的文件名：标题太长时截标题，后缀保留。
    public static func fileName(forTitle title: String, suffix: String) -> String {
        var base = fileName(forTitle: title)
        let room = 240 - fileName(forTitle: suffix).utf8.count
        while base.utf8.count > room, !base.isEmpty { base.removeLast() }
        return base.trimmingCharacters(in: .whitespaces) + suffix
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
