// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "BetterMD",
    platforms: [.macOS("26.0")],
    products: [
        .executable(name: "BetterMD", targets: ["BetterMD"]),
    ],
    targets: [
        .target(name: "BetterMDCore"),
        .executableTarget(name: "BetterMD", dependencies: ["BetterMDCore"]),
        .testTarget(name: "BetterMDCoreTests", dependencies: ["BetterMDCore"]),
    ]
)
