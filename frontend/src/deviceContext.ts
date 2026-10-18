import type { User } from './types'

// A decrypted profile identifies device records; only a matching live session may submit them.
export function sameDeviceIdentity(cached: User, live: User): boolean {
  return cached.id === live.id && cached.organization_id === live.organization_id && cached.site_id === live.site_id
}
