import CoreServices
import Foundation

/// 盯着「我的笔记」：别的程序（VS Code、Finder、git）改了文件，马上告诉 App，不用等切回 App 才重新读。
/// 报来的是变了的文件的绝对路径；是不是 App 自己写的，由 AppModel.filesChanged 判断。
/// 一连串变化（git 切分支、iCloud 第一次下载）攒一下再报：停 0.5 秒报一次，一直在变也最多 2 秒报一次。
/// 系统来不及一个个报（丢了事件）时，mustRescan 为 true，App 直接整个重新读。
@MainActor
final class LibraryWatcher {
    private nonisolated(unsafe) var stream: FSEventStreamRef?
    private let changed: (_ paths: [String], _ mustRescan: Bool) -> Void
    private var pending: [String] = []
    private var pendingRescan = false
    private var firstPending: Date?
    private var flushTask: Task<Void, Never>?

    init(root: URL, changed: @escaping (_ paths: [String], _ mustRescan: Bool) -> Void) {
        self.changed = changed
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
                                           retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, count, paths, flags, _ in
            guard let info else { return }
            let watcher = Unmanaged<LibraryWatcher>.fromOpaque(info).takeUnretainedValue()
            let list = (unsafeBitCast(paths, to: NSArray.self) as? [String]) ?? []
            let dropped = FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagUserDropped
                                                  | kFSEventStreamEventFlagKernelDropped)
            let rescan = (0..<count).contains { flags[$0] & dropped != 0 }
            MainActor.assumeIsolated { watcher.collect(list, rescan: rescan) } // 回调放在主线程上（见下面的 SetDispatchQueue）
        }
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents)
        guard let stream = FSEventStreamCreate(nil, callback, &context, [root.path] as CFArray,
                                               FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3, flags) else { return }
        FSEventStreamSetDispatchQueue(stream, .main)
        FSEventStreamStart(stream)
        self.stream = stream
    }

    private func collect(_ paths: [String], rescan: Bool) {
        pending += paths
        pendingRescan = pendingRescan || rescan
        if firstPending == nil { firstPending = .now }
        flushTask?.cancel()
        // 停 0.5 秒报一次；从第一个变化算起已经过了 2 秒就马上报
        let waited = Date.now.timeIntervalSince(firstPending ?? .now)
        let delay = waited >= 2 ? 0 : 0.5
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self else { return }
            let (paths, rescan) = (self.pending, self.pendingRescan)
            self.pending = []
            self.pendingRescan = false
            self.firstPending = nil
            self.changed(paths, rescan)
        }
    }

    /// 不再盯了（换笔记库时）。
    func stop() {
        flushTask?.cancel()
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    deinit {
        if let stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
        }
    }
}
