# 绘世光辉写真馆

Windows Electron 本地应用，用于管理可视化提示词卡片、随机卡组，并通过 Forge API 生成图片。

## 运行

1. 安装依赖：`pnpm install`
2. 启动：`pnpm start`

如果系统没有 `pnpm`，可先安装 Node.js，再使用项目内的启动脚本或自行安装 pnpm。

## 默认设置

程序启动时会读取 `000.json` 作为默认设置。可在程序内使用“设置当前为默认设置”更新该文件。

## 本地配置

`config/app-config.json` 会保存本机 Forge 路径，已被 `.gitignore` 排除。需要参考时可复制 `config/app-config.example.json`。
