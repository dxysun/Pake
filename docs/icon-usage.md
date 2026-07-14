# 图标使用指南

## macOS Dock 图标

### 问题说明

之前版本中，`--icon` 参数只能设置系统托盘图标，macOS Dock 图标需要在构建时固定为 `.icns` 格式。

### 新功能

现在 `--icon` 参数支持任意常见图片格式（PNG、JPG、WebP、SVG 等），会自动转换为平台所需的格式：

- **macOS**: 自动转换为 `.icns` 格式（包含 16px 到 1024px 多分辨率）
- **Windows**: 自动转换为 `.ico` 格式（包含所有标准尺寸）
- **Linux**: 自动转换为 512x512 PNG 格式

### 使用方法

```bash
# 使用 PNG 图标（推荐）
pakex https://example.com --icon ./app-icon.png --name MyApp

# 使用 JPG 图标
pakex https://example.com --icon ./app-icon.jpg --name MyApp

# 使用远程图标 URL
pakex https://example.com --icon https://example.com/logo.png --name MyApp

# 单独设置系统托盘图标（可选）
pakex https://example.com --icon ./app-icon.png --system-tray-icon ./tray-icon.png --name MyApp
```

### 图标建议

- **推荐格式**: PNG（支持透明背景）
- **推荐尺寸**: 至少 512x512 像素
- **macOS**: 会自动应用圆角遮罩和适当的内边距
- **透明背景**: 会自动保留 alpha 通道

### 注意事项

1. 图标转换在构建时进行，转换后的图标会复制到 `src-tauri/icons/` 或 `src-tauri/png/` 目录
2. macOS 应用图标（Dock）和系统托盘图标默认使用同一个图标
3. 如需不同的托盘图标，使用 `--system-tray-icon` 参数单独指定
