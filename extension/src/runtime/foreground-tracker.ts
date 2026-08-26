export const FOREGROUND_PORT_NAME = 'hdna-popup-foreground';

interface MinimalPort {
  name: string;
  onDisconnect: { addListener(callback: () => void): void };
}

/**
 * Tracks whether any foreground surface (currently: the popup) is open, via
 * long-lived chrome.runtime.Port connections — the idiomatic MV3 way to
 * detect "is the popup currently open" without polling. Feeds the resource
 * governor's `foregroundActive` signal.
 */
export class ForegroundTracker {
  private connectedCount = 0;

  handleConnect(port: MinimalPort): void {
    if (port.name !== FOREGROUND_PORT_NAME) return;
    this.connectedCount += 1;
    port.onDisconnect.addListener(() => {
      this.connectedCount = Math.max(0, this.connectedCount - 1);
    });
  }

  get isActive(): boolean {
    return this.connectedCount > 0;
  }
}
