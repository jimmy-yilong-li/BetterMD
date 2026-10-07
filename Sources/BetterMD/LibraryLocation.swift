import Foundation

/// 「我的笔记」放在哪。默认在用户目录下（不放进「文稿」，免得开了 iCloud 文稿同步时被传到 iCloud）。
/// 开发时可以用启动参数临时指定：`open -n build/BetterMD.app --args -libraryPath /某个/目录`。
enum LibraryLocation {
    private static let key = "libraryPath"

    static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("我的笔记", isDirectory: true)
    }

    static var current: URL {
        get {
            guard let path = UserDefaults.standard.string(forKey: key), !path.isEmpty else { return defaultURL }
            return URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
        }
        set {
            UserDefaults.standard.set(newValue.path, forKey: key)
        }
    }
}
