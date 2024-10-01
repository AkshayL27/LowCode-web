import * as vscode from "vscode";
import * as path from "path";
import { flashWithWebSerial, monitorWithWebserial, eraseflash } from './webserial';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "LowCode-web.flash",
    async () => {
      let workspaceFolder = await vscode.window.showWorkspaceFolderPick({
        placeHolder: `Pick Workspace Folder to load binaries to flash`,
      });
      if (workspaceFolder) {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage("No workspace folders found.");
			return;
		}

		const folderNames = workspaceFolders.map(folder => path.basename(folder.uri.fsPath));
		const selectedFolder = await vscode.window.showQuickPick(folderNames, {
			placeHolder: 'Select a folder from the workspace',
		});

		if (selectedFolder) {
			const selectedFolderUri = workspaceFolders.find(folder => path.basename(folder.uri.path) === selectedFolder)?.uri;
			if (selectedFolderUri) {
				flashWithWebSerial(selectedFolderUri);
			}
		}
      }
    }
  );

  context.subscriptions.push(disposable);

  const monitorDisposable = vscode.commands.registerCommand(
    "LowCode-web.monitor",
    async () => {
      await monitorWithWebserial();
    }
  );
  context.subscriptions.push(monitorDisposable);

  const eraseFlashDisposable = vscode.commands.registerCommand(
	"LowCode-web.eraseflash",
	async () => {
		await eraseflash();
	}
  );
  context.subscriptions.push(eraseFlashDisposable);

  let statusBarItemFlash = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
	statusBarItemFlash.command = 'LowCode-web.flash';
	statusBarItemFlash.text = "$(lightbulb)Flash";
	statusBarItemFlash.show();
	statusBarItemFlash.tooltip = "Flash ESP Device";
	context.subscriptions.push(statusBarItemFlash);

	let statusBarItemMonitor = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 70);
	statusBarItemMonitor.command = 'LowCode-web.monitor';
	statusBarItemMonitor.text = "$(arrow-swap)Monitor";
	statusBarItemMonitor.show();
	statusBarItemMonitor.tooltip = "Monitor ESP Device";
	context.subscriptions.push(statusBarItemMonitor);
}

// This method is called when your extension is deactivated
export function deactivate() {}
