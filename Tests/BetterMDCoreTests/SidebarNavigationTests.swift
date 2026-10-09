import Foundation
import Testing
@testable import BetterMDCore

/// 侧栏的键盘操作：↑↓ 按看得见的顺序走，← → 收起展开、回上级、去列表。
struct SidebarNavigationTests {
    let folders = LibraryIndex.folderTree(["工作", "工作/客户", "工作/客户/甲方", "生活"])
    let tags = [TagNode(path: "会议", name: "会议", children: [TagNode(path: "会议/周会", name: "周会", children: nil)]),
                TagNode(path: "想法", name: "想法", children: nil)]

    func nav(_ expanded: Set<String> = [], tagsOpen: Bool = true) -> SidebarNavigation {
        SidebarNavigation(folders: folders, tags: tags, expanded: expanded, tagsOpen: tagsOpen)
    }

    @Test func rowsFollowWhatIsVisible() {
        #expect(nav().rows == [.all, .folder("工作"), .folder("生活"), .unfiled, .todo, .tag("会议"), .tag("想法"), .trash])
        #expect(nav(["folder:工作", "folder:工作/客户", "tag:会议"]).rows == [
            .all, .folder("工作"), .folder("工作/客户"), .folder("工作/客户/甲方"), .folder("生活"), .unfiled, .todo,
            .tag("会议"), .tag("会议/周会"), .tag("想法"), .trash,
        ])
        // 标签组收起了：标签都不在里面
        #expect(nav(tagsOpen: false).rows == [.all, .folder("工作"), .folder("生活"), .unfiled, .todo, .trash])
    }

    @Test func upAndDownStopAtTheEnds() {
        #expect(nav().step(from: .all, by: -1) == .all)
        #expect(nav().step(from: .all, by: 1) == .folder("工作"))
        #expect(nav().step(from: .todo, by: 1) == .tag("会议"))
        #expect(nav().step(from: .trash, by: 1) == .trash)
        // 当前这一项被收起来看不见了：从第一项开始
        #expect(nav().step(from: .folder("工作/客户"), by: 1) == .all)
    }

    @Test func rightExpandsThenLeavesForTheList() {
        #expect(nav().right(from: .folder("工作")) == .expand("folder:工作"))
        #expect(nav(["folder:工作"]).right(from: .folder("工作")) == .toList)
        #expect(nav().right(from: .folder("生活")) == .toList, "没有子文件夹")
        #expect(nav().right(from: .tag("会议")) == .expand("tag:会议"))
        #expect(nav().right(from: .todo) == .toList)
    }

    @Test func leftCollapsesThenGoesUp() {
        #expect(nav(["folder:工作"]).left(from: .folder("工作")) == .collapse("folder:工作"))
        #expect(nav().left(from: .folder("工作")) == .select(.all))
        #expect(nav(["folder:工作"]).left(from: .folder("工作/客户")) == .select(.folder("工作")))
        #expect(nav().left(from: .tag("会议/周会")) == .select(.tag("会议")))
        #expect(nav().left(from: .tag("想法")) == nil)
        #expect(nav().left(from: .unfiled) == .select(.all))
        #expect(nav().left(from: .trash) == nil)
    }
}
