import AppKit
import BetterMDCore
import SwiftUI

/// 窗口底下的提示条：出错了、另存了别处的版本、上次退出时有笔记没存下……
/// 不弹框、不抢键盘焦点（弹框会打断打字，打字时按的回车还会把它关掉）；一条条点 × 关掉，最多同时显示 3 条。
struct NoticeBar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let notices = Array(model.notices.enumerated())
        VStack(spacing: 6) {
            if notices.count > 3 {
                HStack(spacing: 8) {
                    Text("还有 \(notices.count - 3) 条更早的").foregroundStyle(Ink.text3)
                    LinkButton("全部关掉") { model.lastError = nil }
                }
                .font(.system(size: 11.5))
            }
            ForEach(notices.suffix(3), id: \.offset) { index, text in
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    Image(systemName: "exclamationmark.circle").foregroundStyle(Ink.accent)
                    Text(text)
                        .foregroundStyle(Ink.text)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    Button { model.dismissNotice(at: index) } label: {
                        Image(systemName: "xmark").font(.system(size: 9.5, weight: .semibold)).frame(width: 18, height: 18)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Ink.text3)
                    .focusable(false)
                    .help("知道了")
                }
                .font(.system(size: 12.5))
                .padding(EdgeInsets(top: 9, leading: 12, bottom: 9, trailing: 8))
                .frame(maxWidth: 560, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Ink.paper)
                        .shadow(color: Color(red: 40 / 255, green: 25 / 255, blue: 10 / 255).opacity(0.18), radius: 8, y: 3)
                )
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Ink.separator, lineWidth: 0.5))
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .animation(Motion.quick, value: model.notices)
    }
}

/// 退出和关窗口时存下所有改动。放在 App 的代理里，不放在界面里：只有一个窗口的 App，关窗口就退出，
/// 那时界面可能已经拆掉，界面里登记的“要退出了”收不到。
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    var model: AppModel?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { [weak self] note in
            let window = note.object as? NSWindow
            MainActor.assumeIsolated {
                // 只管主窗口；对话框、面板关掉时不用
                guard let window, !(window is NSPanel), window.sheetParent == nil else { return }
                self?.model?.finishAll()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        model?.finishAll()
        model?.rescueUnsaved(into: RescueFolder.url)
    }
}
