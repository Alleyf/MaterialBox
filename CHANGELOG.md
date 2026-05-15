# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **高级筛选系统**：支持按日期范围、来源域名、图片尺寸等条件精确过滤素材
- **标签系统**：为素材打标签，支持自定义标签颜色，便于多维度组织和管理
- **智能分类 (Smart Collections)**：根据规则（分类/类型/来源域名）自动聚合素材
- **Material Studio 图片工作室**：裁剪预设（1:1/4:5/16:9/Free）、格式转换（WEBP/JPEG/PNG）、质量压缩、缩放调整
- **Material Studio 视频工作室**：时间范围截取、码率选择（1.5/3/6 Mbps）、实时预览裁剪效果
- **云端同步**：支持 S3 兼容存储（AWS S3/MinIO/COS）和 WebDAV（NextCloud/ownCloud）
- **命令面板**：支持模糊搜索命令，快捷键触达所有功能
- **键盘快捷键**：方向键导航、快捷选择、批量操作、撤销/重做
- **存储统计面板**：显示总大小、分类统计、文件排行、重复素材检测
- **批量操作**：批量选择、批量删除、批量添加到集合
- **界面截图文档**：README 增加 4 张功能界面截图及详细说明

### Changed
- Dashboard 界面优化：Hero Cards 数据展示、分类 Chips 标签云
- 筛选器交互改进：下拉筛选改为点击 Chips 快速筛选

### Fixed
- Release workflow 修复：处理 CHANGELOG.md 不存在或内容为空的情况
- 修复了若干 UI 交互细节和状态管理问题

## [v0.1.0] - 2024-01-01

### Added
- 初始版本发布
- 基础图片分类功能
- 支持 Chrome 和 Firefox 浏览器
- Material Design 图标识别
- AI 驱动的图片分类
