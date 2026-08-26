import { describe, expect, it } from 'vitest';
import { FOREGROUND_PORT_NAME, ForegroundTracker } from '../../src/runtime/foreground-tracker';

function fakePort(name: string) {
  let disconnectCallback: (() => void) | undefined;
  return {
    port: {
      name,
      onDisconnect: {
        addListener: (cb: () => void) => {
          disconnectCallback = cb;
        },
      },
    },
    disconnect: () => disconnectCallback?.(),
  };
}

describe('ForegroundTracker', () => {
  it('is inactive with no connections', () => {
    expect(new ForegroundTracker().isActive).toBe(false);
  });

  it('becomes active when a foreground port connects', () => {
    const tracker = new ForegroundTracker();
    const { port } = fakePort(FOREGROUND_PORT_NAME);
    tracker.handleConnect(port);
    expect(tracker.isActive).toBe(true);
  });

  it('ignores connections with a different port name', () => {
    const tracker = new ForegroundTracker();
    const { port } = fakePort('some-other-port');
    tracker.handleConnect(port);
    expect(tracker.isActive).toBe(false);
  });

  it('becomes inactive again once the port disconnects', () => {
    const tracker = new ForegroundTracker();
    const { port, disconnect } = fakePort(FOREGROUND_PORT_NAME);
    tracker.handleConnect(port);
    disconnect();
    expect(tracker.isActive).toBe(false);
  });

  it('stays active while at least one of several connections remains', () => {
    const tracker = new ForegroundTracker();
    const a = fakePort(FOREGROUND_PORT_NAME);
    const b = fakePort(FOREGROUND_PORT_NAME);
    tracker.handleConnect(a.port);
    tracker.handleConnect(b.port);

    a.disconnect();
    expect(tracker.isActive).toBe(true);

    b.disconnect();
    expect(tracker.isActive).toBe(false);
  });

  it('does not go negative if a port disconnects twice', () => {
    const tracker = new ForegroundTracker();
    const { port, disconnect } = fakePort(FOREGROUND_PORT_NAME);
    tracker.handleConnect(port);
    disconnect();
    disconnect();
    expect(tracker.isActive).toBe(false);
  });
});
