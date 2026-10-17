import CoreServices
import Foundation

/// 盯着「我的笔记」：别的程序（VS Code、Finder、git）改了文件，马上告诉 App，不用等切回 App 才重新读。
/// 报来的是变了的文件的绝对路径；是不是 App 自己写的，由 AppModel.filesChanged 判断。
@MainActor
final class LibraryWatcher {
    private nonisolated(unsafe) var stream: FSEventStreamRef?
    private let changed: ([String]) -> Void

    init(root: URL, changed: @escaping ([String]) -> Void) {
        self.changed = changed
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
                                           retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, _, paths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<LibraryWatcher>.fromOpaque(info).takeUnretainedValue()
            let list = (unsafeBitCast(paths, to: NSArray.self) as? [String]) ?? []
            MainActor.assumeIsolated { watcher.changed(list) } // 回调放在主线程上（见下面的 SetDispatchQueue）
        }
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents)
        guard let stream = FSEventStreamCreate(nil, callback, &context, [root.path] as CFArray,
                                               FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3, flags) else { return }
        FSEventStreamSetDispatchQueue(stream, .main)
        FSEventStreamStart(stream)
        self.stream = stream
    }

    /// 不再盯了（换笔记库时）。
    func stop() {
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
