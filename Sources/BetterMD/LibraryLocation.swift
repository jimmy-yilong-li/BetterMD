import BetterMDCore
import Foundation

/// 「我的笔记」放在哪。默认放在 iCloud 云盘里：App 不写同步代码，由 iCloud 上传到云端；
/// 没开 iCloud 云盘时放在用户目录下。菜单「选择笔记库位置…」可以换到别处。
/// 开发时可以用启动参数临时指定：`open -n build/BetterMD.app --args -libraryPath /某个/目录`（这时不会搬家）。
enum LibraryLocation {
    private static let key = "libraryPath"
    /// 已经提醒过「两边都有笔记库」，不再每次启动都说
    private static let bothExistNoticeKey = "legacyLibraryNoticeShown"
    private static let name = "我的笔记"

    /// iCloud 云盘的根目录；没开 iCloud 云盘时是 nil（关掉 iCloud 云盘时系统会把这个目录拿走）。
    static var iCloudDrive: URL? {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// 改用 iCloud 云盘以前的默认位置：用户目录下。
    static var legacyURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(name, isDirectory: true)
    }

    /// 这个目录在不在 iCloud 里（iCloud 云盘，或者别的 App 在 iCloud 里的文件夹）。按路径判断：
    /// 刚搬进去的目录，iCloud 可能还没来得及接手，问系统会得到“不在”。
    static func isInICloud(_ url: URL) -> Bool {
        let mobile = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Mobile Documents", isDirectory: true).standardizedFileURL.path
        return url.standardizedFileURL.path.hasPrefix(mobile + "/")
    }

    static var defaultURL: URL {
        iCloudDrive?.appendingPathComponent(name, isDirectory: true) ?? legacyURL
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

    /// 改用 iCloud 云盘以后第一次启动：把用户目录下原来的「我的笔记」整个搬进 iCloud 云盘。
    /// 自己选过位置的不搬；要在读笔记库之前调用。返回要告诉用户的话，顺利搬完或者不用搬时返回 nil。
    static func moveLegacyLibraryToICloudIfNeeded() -> String? {
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: key) == nil, let drive = iCloudDrive else { return nil }
        switch LibraryMove.run(from: legacyURL, to: drive.appendingPathComponent(name, isDirectory: true)) {
        case .nothingToMove, .moved:
            return nil
        case .bothExist(let leftover):
            guard leftover > 0, !defaults.bool(forKey: bothExistNoticeKey) else { return nil }
            defaults.set(true, forKey: bothExistNoticeKey)
            return "iCloud 云盘里已经有「\(name)」，现在用的是它。用户目录下旧的「\(name)」里还有 \(leftover) 篇笔记，App 没有动它们，需要的话在 Finder 里自己合并。"
        case .failed(let reason):
            current = legacyURL // 搬不动就继续用旧位置，以后也不再试
            return "没能把「\(name)」搬进 iCloud 云盘（\(reason)），先继续用用户目录下的「\(name)」，不会同步。"
        }
    }
}
