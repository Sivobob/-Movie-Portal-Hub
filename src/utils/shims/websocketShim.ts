export const w3cwebsocket = typeof globalThis !== 'undefined' ? globalThis.WebSocket : undefined;

export default {
  w3cwebsocket,
};
