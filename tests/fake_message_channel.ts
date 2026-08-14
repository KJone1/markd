export class FakeMessageChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;

  constructor() {
    const first = new FakeMessagePort();
    const second = new FakeMessagePort();
    first.peer = second;
    second.peer = first;
    this.port1 = first as unknown as MessagePort;
    this.port2 = second as unknown as MessagePort;
  }
}

class FakeMessagePort {
  peer: FakeMessagePort | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private closed = false;

  postMessage(data: unknown): void {
    const receiver = this.peer;
    if (this.closed || receiver === null || receiver.closed) return;
    queueMicrotask(() => {
      if (receiver.closed) return;
      receiver.onmessage?.(new MessageEvent("message", { data }));
    });
  }

  start(): void {}

  close(): void {
    this.closed = true;
  }
}
