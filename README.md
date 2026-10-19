# 小说地址阅读器

这是一个本地 VS Code 插件。输入小说地址后，插件会自动判断当前页面是正文页还是列表页，并在 VS Code 里直接阅读。

## 使用方式

1. 用 VS Code 打开这个项目。
2. 按 `F5` 启动 Extension Development Host。
3. 点击左侧 Activity Bar 里的“小说阅读”图标。
4. 在侧边栏上方输入小说地址，点击“读取”。
5. 点击工具栏里的“历史”可以查看最近打开过的小说地址，点击记录即可重新打开。

也可以通过命令面板运行 `小说地址阅读器 打开地址`，命令会自动打开左侧侧边栏并弹出地址输入框。

## 已适配站点

- `kadokado.com.tw`
- `qidian.com`
- `alicesw.com`
- `books.l3zc.com`

其中 `alicesw.com` 已按你给出的规则处理：

- `https://www.alicesw.com/lists/73.html` 是列表页
- `https://www.alicesw.com/novel/52488.html` 是列表页
- `https://www.alicesw.com/book/53907/a78112fe83b05.html` 是正文页

`books.l3zc.com` 的 `/read/{id}/epub` 页面会自动读取页面里的 EPUB 文件，解析目录和章节正文，并支持目录点击、上一章、下一章。

## 模块说明

- `extension.js`：扩展入口，注册左侧 Webview View 和命令。
- `lib/sidebar-provider.js`：左侧侧边栏承载逻辑。
- `lib/page-loader.js`：根据站点路由到对应解析器。
- `lib/sources/`：各站点解析模块。
- `lib/epub.js`：EPUB 解包、目录、章节解析。
- `lib/renderer.js`：Webview 页面渲染。

如果后续要加新站点，优先在 `lib/sources/` 下新增独立模块，再在 `lib/page-loader.js` 里注册路由。
