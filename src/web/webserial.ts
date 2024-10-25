import {
  CancellationToken,
  FileType,
  Progress,
  ProgressLocation,
  Uri,
  commands,
  window,
  workspace,
} from "vscode";
import {
  ESPLoader,
  FlashOptions,
  IEspLoaderTerminal,
  LoaderOptions,
  Transport,
} from "esptool-js";
import { uInt8ArrayToString } from "./utils";
import { SerialTerminal } from "./serialPseudoTerminal";
import { enc, MD5 } from 'crypto-js';


var isFlashing: boolean = false;
export interface PartitionInfo {
  name: string;
  data: string;
  address: number;
}

async function getPort(): Promise<SerialPort | null> {
  const portInfo = (await commands.executeCommand(
    "workbench.experimental.requestSerialPort"
  )) as SerialPortInfo;
  if (!portInfo) {
    return null;
  }
  const portsFound = await navigator.serial.getPorts();
  let port = portsFound.find((item) => {
    const info = item.getInfo();
    return (
      info.usbVendorId === portInfo.usbVendorId &&
      info.usbProductId === portInfo.usbProductId
    );
  });
  if (!port) {
    return null;
  }
  return port;
}

export async function monitorWithWebserial() {
  const port = await getPort();
  if (!port) {
    return;
  }
  const monitorBaudRate = await window.showQuickPick(
    [
      { description: "74880", label: "74880", target: 74880 },
      { description: "115200", label: "115200", target: 115200 },
    ],
    { placeHolder: "Select baud rate" }
  );
  if (!monitorBaudRate) {
    return;
  }
  const transport = new Transport(port);
  await transport.connect();

  const serialTerminal = new SerialTerminal(transport, {
    baudRate: monitorBaudRate.target,
  });

  let lowCodeTerminal = window.createTerminal({
    name: "ESP LowCode Web Monitor",
    pty: serialTerminal,
  });

  serialTerminal.onDidClose((e) => {
    if (lowCodeTerminal && lowCodeTerminal.exitStatus === undefined) {
      lowCodeTerminal.dispose();
    }
  });

  window.onDidCloseTerminal(async (t) => {
    if (t.name === "ESP LowCode Web Monitor" && t.exitStatus) {
      await transport.disconnect();
    }
  });
  lowCodeTerminal.show();
}


export async function flashWithWebSerial(workspaceUri: Uri) {
  if (isFlashing) {
    window.showInformationMessage("Please wait until previous flashing is finished");
    return;
  }

  const outputChnl = window.createOutputChannel("LowCode Web");
  outputChnl.show();
  
  try {
    // Use the original workspace URI without scheme conversion
    outputChnl.appendLine(`Working with workspace: ${workspaceUri.toString()}`);

    await window.withProgress(
      {
        cancellable: true,
        location: ProgressLocation.Notification,
        title: "Flashing with WebSerial...",
      },
      async (progress, cancelToken) => {
        const port = await getPort();
        if (!port) {
          return;
        }
        
        isFlashing = true;
        
        // Setup transport and terminal
        const transport = new Transport(port);
        const loaderTerminal: IEspLoaderTerminal = {
          clean: () => outputChnl.clear(),
          write: (data: string) => outputChnl.append(data),
          writeLine: (data: string) => outputChnl.appendLine(data),
        };

        // Get baud rate
        const flashBaudRate = await window.showQuickPick(
          [
            { description: "115200", label: "115200", target: 115200 },
            { description: "230400", label: "230400", target: 230400 },
            { description: "460800", label: "460800", target: 460800 },
            { description: "921600", label: "921600", target: 921600 },
          ],
          { placeHolder: "Select baud rate" }
        );
        
        if (!flashBaudRate) {
          return;
        }

        const loaderOptions = {
          transport,
          baudrate: flashBaudRate.target,
          terminal: loaderTerminal,
        } as LoaderOptions;
        
        progress.report({
          message: `ESP LowCode Web Flashing using baud rate ${flashBaudRate.target}`,
        });

        // Initialize ESP loader
        const esploader = new ESPLoader(loaderOptions);
        const chip = await esploader.main();
        if (chip) {
          outputChnl.appendLine(`Found chip: ${chip}`);
        }

        // Access build folder with original URI
        const buildFolderUri = Uri.joinPath(workspaceUri, 'build');
        outputChnl.appendLine(`Scanning build folder: ${buildFolderUri.toString()}`);
        
        try {
          // Use workspace API to check build directory
          const buildDirStat = await workspace.fs.stat(buildFolderUri);
          
          if (!(buildDirStat.type & FileType.Directory)) {
            throw new Error('Build path is not a directory');
          }
          
          // Read directory contents
          const files = await workspace.fs.readDirectory(buildFolderUri);
          outputChnl.appendLine(`Found ${files.length} files in build directory`);
          
          const binaryFiles = files
            .filter(([fileName, fileType]) => fileType === FileType.File && fileName.endsWith('.bin'))
            .map(entry => entry[0]);

          if (binaryFiles.length === 0) {
            window.showInformationMessage('No binary files found in the build directory.');
            return;
          }

          const selectedFile = await window.showQuickPick(binaryFiles, {
            placeHolder: 'Select a binary file',
          });
          
          if (selectedFile) {
            const binaryFileUri = Uri.joinPath(buildFolderUri, selectedFile);
            outputChnl.appendLine(`Selected file: ${binaryFileUri.toString()}`);
            
            // Read binary file using workspace fs API
            const binaryContent = await workspace.fs.readFile(binaryFileUri);
            outputChnl.appendLine(`Successfully read binary file, size: ${binaryContent.length} bytes`);
            
            // Create partition info
            const partitionInfo: PartitionInfo = {
              data: uInt8ArrayToString(binaryContent),
              address: 0x20C000,
              name: "MainProgram"
            };

            const flashOptions: FlashOptions = {
              fileArray: [partitionInfo],
              flashSize: '4MB',
              flashFreq: '80m',
              flashMode: 'dio',
              eraseAll: false,
              compress: true,
              reportProgress: async (fileIndex, written, total) => {
                progress.report({
                  message: `${partitionInfo.name} (${written}/${total})`,
                });
              },
              calculateMD5Hash: (image: string) => MD5(enc.Latin1.parse(image)).toString(),
            };

            await esploader.writeFlash(flashOptions);
            progress.report({ message: `ESP LowCode Web Flashing done` });
            outputChnl.appendLine(`ESP LowCode Web Flashing done`);
          }
        } catch (error: any) {
          outputChnl.appendLine(`Error accessing build directory or files: ${error.message}`);
          throw error;
        }
      }
    );
  } catch (error: any) {
    const errMsg = error && error.message ? error.message : error;
    outputChnl.appendLine(`Error: ${errMsg}`);
    window.showErrorMessage(`Flashing failed: ${errMsg}`);
  } finally {
    
    isFlashing = false;
  }
}

export async function eraseflash() {
  if (isFlashing) {
    window.showInformationMessage("Waiting for flash to complete...\nTry again later");
    return;
  }
  const port = await getPort();
  if (!port) {
    return;
  }
  isFlashing = true;
  const transport = new Transport(port);
  await transport.connect();
  const outputChnl = window.createOutputChannel("LowCode Web");
  const clean = () => {
    outputChnl.clear();
  };
  const writeLine = (data: string) => {
    outputChnl.appendLine(data);
  };
  const write = (data: string) => {
    outputChnl.append(data);
  };

  const loaderTerminal: IEspLoaderTerminal = {
    clean,
    write,
    writeLine,
  };
  const loaderOptions = {
    transport,
    baudrate: 115200,
    terminal: loaderTerminal,
  } as LoaderOptions;

  const esploader = new ESPLoader(loaderOptions);
  await esploader.eraseFlash();
  isFlashing = false;
  if (transport) {
    transport.disconnect();
  }
}
