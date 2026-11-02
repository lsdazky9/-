/** 生成 v4 UUID；用于提交幂等键与人工恢复幂等键（§4.8.1）。 */
export function uuid(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    return `id-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`
  }
  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
