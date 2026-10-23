# VS Code 扩展发布说明

## 直接安装使用

生成 VSIX：

```powershell
npm run package:vsix
```

在 VS Code 扩展面板右上角选择 `...` -> `从 VSIX 安装...`，选择生成的 `.vsix` 文件。也可以在 PowerShell 中安装：

```powershell
code --install-extension .\url-web-preview-0.0.24.vsix
```

安装后重新打开 VS Code，不需要再按 `F5`。

## 发布到 VS Code Marketplace

1. 登录 <https://marketplace.visualstudio.com/manage>。
2. 创建 Publisher，记下 Publisher ID。
3. 将 `package.json` 中的 `"publisher": "local"` 改成你的 Publisher ID。
4. 在 Azure DevOps 创建 Personal Access Token，授予 Marketplace 的 `Manage` 权限。
5. 在 PowerShell 中设置令牌，不要将令牌写入仓库：

```powershell
$env:VSCE_PAT = "你的 Personal Access Token"
```

6. 检查打包内容并发布：

```powershell
npx @vscode/vsce ls
npm run package:vsix
npm run publish:marketplace
```

以后每次发布都要先修改 `package.json` 中的 `version`，否则 Marketplace 会拒绝覆盖已有版本。
