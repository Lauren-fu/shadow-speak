// Faithfully model Chrome's JSON messages and asynchronous port delivery.
export function portPair() {
  let connected = true;
  const event = () => {
    const listeners = new Set();
    return {
      addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); },
      emit(value) { [...listeners].forEach(fn => fn(value)); }
    };
  };
  const left = { onMessage: event(), onDisconnect: event() };
  const right = { onMessage: event(), onDisconnect: event() };
  for (const [port, other] of [[left, right], [right, left]]) {
    port.postMessage = message => {
      if (!connected) throw new Error("Port disconnected");
      const json = JSON.stringify(message);
      queueMicrotask(() => { if (connected) other.onMessage.emit(JSON.parse(json)); });
    };
    port.disconnect = () => {
      if (!connected) return;
      connected = false;
      left.onDisconnect.emit(); right.onDisconnect.emit();
    };
  }
  return { panel: left, page: right };
}
