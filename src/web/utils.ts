
export function uInt8ArrayToString(array: Uint8Array): string {
  return Array.from(array)
    .map(byte => String.fromCharCode(byte))
    .join('');
}