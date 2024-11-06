import { Transport } from "esptool-js";
import { commands, window } from "vscode";

class PortManager {
    private port: SerialPort | undefined;
    private transport: Transport | undefined;

    public async getPort(): Promise<SerialPort> {
        if (this.port) {
            return this.port;
        }
        try {
            const portInfo = await commands.executeCommand<SerialPortInfo>(
                "workbench.experimental.requestSerialPort"
            );
            if (!portInfo) {
                throw new Error("Could not request serial port");
            }

            const portsFound = await navigator.serial.getPorts();
            const port = portsFound.find((item) => {
                const info = item.getInfo();
                return (
                    info.usbVendorId === portInfo.usbVendorId &&
                    info.usbProductId === portInfo.usbProductId
                );
            });

            if (!port) {
                throw new Error("Could not find selected port");
            }
            this.port = port;
            return port;
        } catch (error) {
            const errorMessage = error instanceof Error 
                ? `Port initialization failed: ${error.message}`
                : "An unknown error occurred while initializing port";
            throw new Error(errorMessage);
        }
    }

    public async closePort(): Promise<void> {
        try {
            if (this.port) {
                await this.port.close();
                this.port = undefined;
            }
        } catch (error) {
            window.showErrorMessage(`Error closing port: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async changePort(): Promise<SerialPort> {
        await this.closePort();
        return this.getPort();
    }

    public async connect(): Promise<Transport> {
        try {
            if (!this.port) {
                this.port = await this.getPort();
            }

            if (!this.transport && this.port) {
                this.transport = new Transport(this.port);
                return this.transport;
            }

            if (this.transport && this.port) {
                this.transport.waitForUnlock(10000);
                return this.transport;
            }

            throw new Error("Failed to initialize transport");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            window.showErrorMessage(`Transport connection error: ${errorMessage}`);
            throw error;
        }
    }

    public async disconnect(): Promise<void> {
        try {
            if (this.transport) {
                await this.transport.disconnect();
                this.transport = undefined;
            }
        } catch (error) {
            window.showErrorMessage(`Error disconnecting transport: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }


    public async reset(): Promise<void> {
        await this.disconnect();
        await this.closePort();
        this.transport = undefined;
        this.port = undefined;
    }

    public isConnected(): boolean {
        return this.transport !== undefined;
    }
}

export const serialPortManager = new PortManager();