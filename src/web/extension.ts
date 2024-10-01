import * as vscode from "vscode";
import { flashWithWebSerial, monitorWithWebserial, eraseflash } from './webserial';

interface FolderQuickPickItem extends vscode.QuickPickItem {
    uri: vscode.Uri; // Custom property to store the URI
}

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

		const quickpick = vscode.window.createQuickPick<FolderQuickPickItem>();
		quickpick.canSelectMany = false;
		quickpick.items = workspaceFolders.map(folder => ({
			label: folder.name,
			description: folder.uri.fsPath,
			uri: folder.uri,
		}));
		quickpick.placeholder = "Select the folder to flash";

		quickpick.onDidChangeSelection(selection => {
            if (selection[0]) {
                const selectedFolderUri = selection[0].uri;

                // Call your function here
                if (selectedFolderUri) {
                    flashWithWebSerial(selectedFolderUri);
                }
                
                quickpick.hide();
            }
        });

		quickpick.onDidHide(() => {
			quickpick.dispose();
		});

		quickpick.show();
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
