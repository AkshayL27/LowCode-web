import * as vscode from "vscode";
import { flashWithWebSerial, monitorWithWebserial, eraseflash } from './webserial';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand("LowCode-web.flash", async () => {
		const workspaceFolder = await vscode.window.showWorkspaceFolderPick({
		  placeHolder: `Pick Workspace Folder to load binaries to flash`,
		});
		
		if (!workspaceFolder) {
		  vscode.window.showInformationMessage("Please open a workspace folder first");
		  return;
		}
		
		try {
		  // Convert to web-compatible URI
		  const folderPath = workspaceFolder.uri;
		  await flashWithWebSerial(folderPath);
		} catch (error: any) {
		  vscode.window.showErrorMessage(`Failed to start flashing: ${error.message}`);
		}
	});

  context.subscriptions.push(disposable);

  const monitorDisposable = vscode.commands.registerCommand("LowCode-web.monitor", async () => {
      await monitorWithWebserial();
    }
  );
  context.subscriptions.push(monitorDisposable);

  const eraseFlashDisposable = vscode.commands.registerCommand("LowCode-web.eraseflash", async () => {
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
