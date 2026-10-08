import Foundation

/// 一个文件在 iCloud 云盘里的同步状态。App 不写同步代码，上传由 iCloud 负责；这里只读系统记下的状态，用来显示云图标。
public enum CloudStatus: Equatable, Sendable {
    /// 不归 iCloud 管（笔记库没放在 iCloud 云盘里）
    case local
    /// 已经传到 iCloud
    case uploaded
    /// 正在上传，或者排着队等上传
    case uploading
    /// 上传出错（比如 iCloud 空间满了），附带系统给的原因
    case failed(String)

    /// 读一次状态。要问系统的 iCloud 服务，别放在主线程上频繁调用。
    public static func of(_ file: URL) -> CloudStatus {
        var url = file
        url.removeAllCachedResourceValues()
        let keys: Set<URLResourceKey> = [.isUbiquitousItemKey, .ubiquitousItemIsUploadedKey, .ubiquitousItemUploadingErrorKey]
        guard let values = try? url.resourceValues(forKeys: keys), values.isUbiquitousItem == true else { return .local }
        if let error = values.ubiquitousItemUploadingError { return .failed(error.localizedDescription) }
        return values.ubiquitousItemIsUploaded == true ? .uploaded : .uploading
    }
}
