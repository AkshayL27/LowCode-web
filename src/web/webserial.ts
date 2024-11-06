import {
  FileType,
  Progress,
  ProgressLocation,
  Uri,
  window,
  workspace,
  Terminal,
  OutputChannel,
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
import { serialPortManager } from './portManager';

// Constants and configurations
const TERMINAL_NAME = "ESP LowCode Web Monitor";

const FLASH_CONFIG = {
  programAddress: 0x20C000,
  flashSize: '4MB',
  flashFreq: '80m',
  flashMode: 'dio',
  defaultBaudRate: 115200,
} as const;

const MONITOR_CONFIG = {
  defaultBaudRate: 74880,
} as const;

const BAUD_RATES = {
  monitor: [
    { description: "74880", label: "74880", target: 74880 },
    { description: "115200", label: "115200", target: 115200 },
  ] as const,
  flash: [
    { description: "115200", label: "115200", target: 115200 },
    { description: "230400", label: "230400", target: 230400 },
    { description: "460800", label: "460800", target: 460800 },
    { description: "921600", label: "921600", target: 921600 },
  ] as const,
} as const;

// Interfaces
export interface PartitionInfo {
  name: string;
  data: string;
  address: number;
}

interface BaudRateOption {
  readonly description: string;
  readonly label: string;
  readonly target: number;
}

// State management
let isFlashing = false;

// Helper Functions
async function setupFlashLoader(
  transport: Transport,
  baudRate: number,
  outputChannel: OutputChannel
): Promise<ESPLoader> {
  const terminal: IEspLoaderTerminal = {
    clean: () => outputChannel.clear(),
    write: (data: string) => outputChannel.append(data),
    writeLine: (data: string) => outputChannel.appendLine(data),
  };

  const loaderOptions: LoaderOptions = {
    transport,
    baudrate: baudRate,
    romBaudrate: baudRate,
    terminal,
  };

  const loader = new ESPLoader(loaderOptions);
  return loader;
}

async function readBinaryFile(fileUri: Uri): Promise<Uint8Array> {
  try {
    return await workspace.fs.readFile(fileUri);
  } catch (error) {
    throw new Error(`Failed to read binary file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function createFlashOptions(
  partitionInfo: PartitionInfo,
  progress: Progress<{ message?: string; increment?: number }>
): Promise<FlashOptions> {
  return {
    fileArray: [partitionInfo],
    flashSize: FLASH_CONFIG.flashSize,
    flashFreq: FLASH_CONFIG.flashFreq,
    flashMode: FLASH_CONFIG.flashMode,
    eraseAll: false,
    compress: true,
    reportProgress: async (fileIndex, written, total) => {
      progress.report({
        message: `Flashing ${partitionInfo.name} (${written}/${total} bytes)`,
        increment: (written / total) * 100,
      });
    },
    calculateMD5Hash: (image: string) => MD5(enc.Latin1.parse(image)).toString(),
  };
}

async function setupMonitorTerminal(transport: Transport, baudRate: number): Promise<Terminal> {
  const serialTerminal = new SerialTerminal(transport, { baudRate });
  const terminal = window.createTerminal({
    name: TERMINAL_NAME,
    pty: serialTerminal,
  });

  serialTerminal.onDidWrite(async (s: string) => {
    if (s === String.fromCharCode(29)) { // CTRL + ]
      await serialTerminal.close();
      await serialPortManager.disconnect();
      terminal.dispose();
    }
  });

  window.onDidCloseTerminal(async (t) => {
    if (t.name === TERMINAL_NAME && t.exitStatus) {
      await serialTerminal.close();
      await serialPortManager.disconnect();
    }
  });

  return terminal;
}

async function selectBaudRate(rates: readonly BaudRateOption[]): Promise<BaudRateOption | undefined> {
  return window.showQuickPick(rates, {
    placeHolder: "Select baud rate",
  });
}

// Main Functions
export async function monitorWithWebserial(): Promise<void> {
  
  let transport: Transport | undefined = undefined;

  try {
    if (isFlashing) {
      throw new Error("Wait until flashing is completed");
    }
    // Get baud rate selection
    const baudRate = await selectBaudRate(BAUD_RATES.monitor);
    if (!baudRate) {
      return;
    }

    // Connect to device
    transport = await serialPortManager.connect();
    if (!transport) {
      throw new Error("Could not connect to the transport");
    }
    await transport.connect();

    // Setup and show terminal
    const terminal = await setupMonitorTerminal(transport, baudRate.target);
    terminal.show();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    window.showErrorMessage(`Monitor failed: ${errorMessage}`);
    
    if (transport) {
      await serialPortManager.disconnect();
    }
  }
}

export async function flashWithWebSerial(workspaceUri: Uri): Promise<void> {
  if (isFlashing) {
    window.showInformationMessage("Please wait until previous flashing is finished");
    return;
  }

  const outputChannel = window.createOutputChannel("ESP Flash");
  outputChannel.show();

  let transport: Transport | undefined = undefined;
  
  try {
    isFlashing = true;

    await window.withProgress({
      location: ProgressLocation.Notification,
      title: "ESP Flashing",
      cancellable: false
    }, async (progress) => {
      // Step 1: Connect to port
      progress.report({ message: "Connecting to device..." });
      transport = await serialPortManager.connect();

      // Step 2: Get baud rate
      const baudRate = await selectBaudRate(BAUD_RATES.flash);
      if (!baudRate) {
        throw new Error("Baud rate not selected");
      }

      // Step 3: Setup ESP loader
      progress.report({ message: "Initializing ESP loader..." });
      const espLoader = await setupFlashLoader(transport, baudRate.target, outputChannel);
      outputChannel.appendLine("Just before the main function is being called");
      const chip = await espLoader.main();
      if (chip) {
        outputChannel.appendLine("Main function is now successfully called");
      }

      // Step 4: Check build directory
      const buildFolderUri = Uri.joinPath(workspaceUri, 'build');
      const buildDirStat = await workspace.fs.stat(buildFolderUri);
      
      if (!(buildDirStat.type & FileType.Directory)) {
        throw new Error('Build directory not found');
      }

      // Step 5: Find binary files
      const files = await workspace.fs.readDirectory(buildFolderUri);
      const binaryFiles = files
        .filter(([name, type]) => type === FileType.File && name.endsWith('.bin'))
        .map(([name]) => name);

      if (binaryFiles.length === 0) {
        throw new Error('No binary files found in build directory');
      }

      // Step 6: Select binary file
      const selectedFile = await window.showQuickPick(binaryFiles, {
        placeHolder: 'Select binary file to flash'
      });

      if (!selectedFile) {
        throw new Error('No binary file selected');
      }

      // Step 7: Read binary file
      progress.report({ message: "Reading binary file..." });
      const binaryFileUri = Uri.joinPath(buildFolderUri, selectedFile);
      const binaryContent = await readBinaryFile(binaryFileUri);
      
      outputChannel.appendLine(`Binary file size: ${binaryContent.length} bytes`);

      // Step 8: Create partition info
      const partitionInfo: PartitionInfo = {
        data: uInt8ArrayToString(binaryContent),
        address: FLASH_CONFIG.programAddress,
        name: selectedFile
      };

      // Step 9: Flash the device
      progress.report({ message: "Starting flash process..." });
      const flashOptions = await createFlashOptions(partitionInfo, progress);
      
      await espLoader.writeFlash(flashOptions);

      window.showInformationMessage("ESP Flash completed successfully!");
      outputChannel.appendLine("Flash process completed successfully");
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    outputChannel.appendLine(`Error: ${errorMessage}`);
    window.showErrorMessage(`Flash failed: ${errorMessage}`);
    throw error;
  } finally {
    if (transport) {
      await serialPortManager.disconnect();
    }
    isFlashing = false;
  }
}

export async function eraseFlash(): Promise<void> {
  if (isFlashing) {
    window.showInformationMessage(
      "Waiting for flash to complete...\nTry again later"
    );
    return;
  }

  let transport: Transport | undefined;
  const outputChannel = window.createOutputChannel("ESP Erase");
  outputChannel.show();
  
  try {
    isFlashing = true;
    
    await window.withProgress({
      location: ProgressLocation.Notification,
      title: "Erasing Flash",
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Connecting to device..." });
      transport = await serialPortManager.connect();
      
      progress.report({ message: "Initializing ESP loader..." });
      const loader = await setupFlashLoader(
        transport,
        FLASH_CONFIG.defaultBaudRate,
        outputChannel
      );
      const chip = await loader.main();

      progress.report({ message: "Erasing flash memory..." });
      await loader.eraseFlash();
      
      outputChannel.appendLine("Flash erase completed successfully");
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    outputChannel.appendLine(`Error: ${errorMessage}`);
    window.showErrorMessage(`Flash erase failed: ${errorMessage}`);
    throw error;
  } finally {
    if (transport) {
      await serialPortManager.disconnect();
    }
    isFlashing = false;
  }
}