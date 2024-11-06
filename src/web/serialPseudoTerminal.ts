import { Transport } from "esptool-js";
import {
  Event,
  EventEmitter,
  Pseudoterminal,
} from "vscode";
import { uInt8ArrayToString } from './utils';

export class SerialTerminal implements Pseudoterminal {
  private writeEmitter = new EventEmitter<string>();
  public onDidWrite: Event<string> = this.writeEmitter.event;
  private closeEmitter = new EventEmitter<number>();
  public onDidClose: Event<number> = this.closeEmitter.event;
  public closed = false;

  public constructor(
    protected transport: Transport,
    protected options: SerialOptions
  ) {}

  public async open(): Promise<void> {
    await this.transport.sleep(500);
    await this.reset();
    while (!this.closed) {
      let val = await this.transport.rawRead();
      if (typeof val !== "undefined") {
        let valStr = uInt8ArrayToString(val);
        this.writeOutput(valStr);
      } else {
        break;
      }
    }

    this.transport.connect(this.options.baudRate, this.options);
    this.writeLine(`Opened with baud rate: ${this.options.baudRate}`);
  }

  public async reset() {
    if (this.transport) {
      await this.transport.setDTR(false);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await this.transport.setDTR(true);
    }
  }

  public async close() {
    await this.transport.waitForUnlock(1500);
    await this.transport.disconnect();
    if (!this.closed) {
      this.closed = true;
      this.closeEmitter.fire(0);
    }
  }

  public handleInput(data: string): void {
    this.writeLine("Input data is:");
    this.writeOutput(data);
  }

  protected writeLine(message: string): void {
    this.writeOutput(`${message}\n`);
  }

  protected writeOutput(message: string): void {
    const output = message.replace(/\r/g, "").replace(/\n/g, "\r\n");
    this.writeEmitter.fire(output);
  }
}
