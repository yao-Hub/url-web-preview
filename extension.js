const vscode = require('vscode');
const { NovelReaderSidebarProvider, VIEW_ID } = require('./lib/sidebar-provider');

let sidebarProvider;

function activate(context) {
  sidebarProvider = new NovelReaderSidebarProvider(context.extensionUri, context.globalState);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, sidebarProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.commands.registerCommand('urlWebPreview.open', async () => {
      await sidebarProvider.openPrompt();
    })
  );
}

function deactivate() {
  sidebarProvider = undefined;
}

module.exports = {
  activate,
  deactivate
};
