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


//ToDO
//1. Management of PORT
//2. Managing isFlashing and isMonitoring


var isFlashing: boolean = false;
var isMonitoring: boolean = false;
var PORT: SerialPort | undefined;
var transport: Transport | undefined;
export interface PartitionInfo {
  name: string;
  data: string;
  address: number;
}

export interface FlashSectionMessage {
  sections: PartitionInfo[];
  flashSize: string;
  flashMode: string;
  flashFreq: string;
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
  PORT = port;
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
      PORT = undefined;
    }
  });
  lowCodeTerminal.show();
}

export async function flashWithWebSerial(workspace: Uri) {
  if (isFlashing) {
    window.showInformationMessage("Please wait until previous flashing is finished");
    return;
  }
  try {
    window.withProgress(
      {
        cancellable: true,
        location: ProgressLocation.Notification,
        title: "Flashing with WebSerial...",
      },
      async (
        progress: Progress<{
          message: string;
        }>,
        cancelToken: CancellationToken
      ) => {
        const port = await getPort();
        if (!port) {
          return;
        }
        const transport = new Transport(port);
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
        outputChnl.appendLine(
          `ESP LowCode Web Flashing with Webserial using baud rate ${flashBaudRate.target}`
        );
        outputChnl.show();
        const esploader = new ESPLoader(loaderOptions);
        const chip = await esploader.main();
        const flashSectionsMessage = await getFlashSectionsForCurrentWorkspace(
          workspace
        );
        const flashOptions: FlashOptions = {
          fileArray: flashSectionsMessage.sections,
          flashSize: flashSectionsMessage.flashSize,
          flashFreq: flashSectionsMessage.flashFreq,
          flashMode: flashSectionsMessage.flashMode,
          eraseAll: false,
          compress: true,
          reportProgress: (
            fileIndex: number,
            written: number,
            total: number
          ) => {
            progress.report({
              message: `${flashSectionsMessage.sections[fileIndex].name} (${written}/${total})`,
            });
          },
          calculateMD5Hash: (image: string) =>
            MD5(enc.Latin1.parse(image)).toString(),
        } as FlashOptions;

        await esploader.writeFlash(flashOptions);
        progress.report({ message: `ESP LowCode Web Flashing done` });
        outputChnl.appendLine(`ESP LowCode Web Flashing done`);
        if (transport) {
          await transport.disconnect();
        }
        if (PORT) {
          PORT = undefined;
        }
      }
    );
  } catch (error: any) {
    const outputChnl = window.createOutputChannel("LowCode Web");
    const errMsg = error && error.message ? error.message : error;
    outputChnl.appendLine(errMsg);
  }
}

async function getFlashSectionsForCurrentWorkspace(workspaceFolder: Uri) {
  const flashInfoFileName = Uri.joinPath(
    workspaceFolder,
    "flasher_args.json"
  );
  const flasherArgsStat = await workspace.fs.stat(flashInfoFileName);
  if (flasherArgsStat.type !== FileType.File) {
    throw new Error(`${flashInfoFileName} does not exists.`);
  }
  const flasherArgsContent = await workspace.fs.readFile(flashInfoFileName);
  if (!flasherArgsContent) {
    throw new Error("Build before flashing");
  }
  let flasherArgsContentStr = uInt8ArrayToString(flasherArgsContent);
  const flashFileJson = JSON.parse(flasherArgsContentStr);
  const binPromises: Promise<PartitionInfo>[] = [];
  Object.keys(flashFileJson["flash_files"]).forEach((offset) => {
    const fileName = flashFileJson["flash_files"][offset];
    const filePath = Uri.joinPath(
      workspaceFolder,
      "build",
      flashFileJson["flash_files"][offset]
    );
    binPromises.push(readFileIntoBuffer(filePath, fileName, offset));
  });
  const binaries = await Promise.all(binPromises);
  const message: FlashSectionMessage = {
    sections: binaries,
    flashFreq: flashFileJson["flash_settings"]["flash_freq"],
    flashMode: flashFileJson["flash_settings"]["flash_mode"],
    flashSize: flashFileJson["flash_settings"]["flash_size"],
  };
  return message;
}

async function readFileIntoBuffer(filePath: Uri, name: string, offset: string) {
  const fileBuffer = await workspace.fs.readFile(filePath);
  let fileBufferString = uInt8ArrayToString(fileBuffer);
  const fileBufferResult: PartitionInfo = {
    data: fileBufferString,
    name,
    address: parseInt(offset),
  };
  return fileBufferResult;
}

export async function eraseflash() {
  if (isFlashing) {
    window.showInformationMessage("Waiting for flash to complete...\nTry again later");
    return;
  }
  isFlashing = true;
  const port = await getPort();
  if (!port) {
    isFlashing = false;
    return;
  }
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
  if (port) {
    PORT = undefined;
  }
}
