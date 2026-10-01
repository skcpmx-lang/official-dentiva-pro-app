import { createHash, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Offline activation verification.
 *
 * The vendor-issued activation code is **never** stored or shipped. What is embedded is a derived
 * verifier fragment table: the scrypt output of the code under a fixed application salt, split into
 * chunks, permuted and XOR-masked. Verification re-derives scrypt from the typed code and compares it
 * with the assembled verifier in constant time.
 *
 * Threat-model honesty (see docs/SECURITY_MODEL.md §3 and docs/KNOWN_LIMITATIONS.md §3): an offline
 * check with a fixed accepted code cannot be made mathematically unbreakable. This design prevents
 * plaintext discovery (`strings`, README leaks, casual bundle inspection, database inspection) and
 * trivial patching, which is the achievable goal for a fixed offline activation.
 */

const SALT = 'DentivaPro::offline-activation::salt::v1'
const PARAMS = { N: 65536, r: 8, p: 1, keyLength: 32 } as const
const MAX_MEM = 256 * 1024 * 1024

/** Verifier fragments (masked + permuted). Assembled at runtime by `expectedVerifier()`. */
const FRAGMENTS: readonly { key: number, data: string }[] = [
  { key: 156, data: 'c496584a' },
  { key: 62, data: '00f21c80' },
  { key: 113, data: 'a02eae06' },
  { key: 10, data: '36a13513' },
  { key: 85, data: '23f57a9b' },
  { key: 195, data: '33ea468d' },
  { key: 36, data: '3a17abd2' },
  { key: 136, data: '35af77a1' }
]

/** Order in which fragments must be concatenated after unmasking. */
const ORDER = [0, 1, 2, 3, 4, 5, 6, 7] as const

const MASK_SEED = 'dentiva-pro.activation.mask.v1'

function maskBytes(length: number): Buffer {
  const mask = Buffer.alloc(length)
  let written = 0
  let counter = 0
  while (written < length) {
    const block = createHash('sha256').update(`${MASK_SEED}:${counter}`).digest()
    block.copy(mask, written, 0, Math.min(block.length, length - written))
    written += block.length
    counter += 1
  }
  return mask
}

function unmask(fragment: string, key: number, offset: number): Buffer {
  const bytes = Buffer.from(fragment, 'hex')
  const mask = maskBytes(bytes.length + offset).subarray(offset)
  const out = Buffer.alloc(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    out[i] = (bytes[i]! ^ mask[i]!) ^ key
  }
  return out
}

let cached: Buffer | null = null

function expectedVerifier(): Buffer {
  if (cached) return cached
  const parts: Buffer[] = []
  let offset = 0
  for (const index of ORDER) {
    const fragment = FRAGMENTS[index]
    if (!fragment) throw new Error('Activation verifier table is incomplete')
    const bytes = unmask(fragment.data, fragment.key, offset)
    parts.push(bytes)
    offset += bytes.length
  }
  cached = Buffer.concat(parts)
  return cached
}

export function deriveCodeKey(code: string): Buffer {
  return scryptSync(code, SALT, PARAMS.keyLength, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAX_MEM })
}

/** Normalise operator input: trim, drop spaces/dashes, convert Bengali digits to ASCII. */
export function normalizeActivationInput(raw: string): string {
  return raw
    .replace(/[\u09E6-\u09EF]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
    .replace(/[\s\-_]/g, '')
    .trim()
}

export interface ActivationCheck {
  ok: boolean
  /** Fingerprint of the derived verifier — stored so tampering with `license_state` is detectable. */
  fingerprint: string
}

const FINGERPRINT_LENGTH = 16

export function verifierFingerprint(): string {
  return createHash('sha256').update(expectedVerifier()).digest('hex').slice(0, FINGERPRINT_LENGTH)
}

export function checkActivationCode(rawCode: string): ActivationCheck {
  const normalized = normalizeActivationInput(rawCode)
  const fingerprint = verifierFingerprint()
  if (normalized.length < 8 || normalized.length > 64) return { ok: false, fingerprint }
  let derived: Buffer
  try {
    derived = deriveCodeKey(normalized)
  } catch {
    return { ok: false, fingerprint }
  }
  const expected = expectedVerifier()
  const ok = derived.length === expected.length && timingSafeEqual(derived, expected)
  return { ok, fingerprint }
}

/** True when the embedded verifier table is internally consistent (guards against a patched bundle). */
export function verifierTableIsIntact(): boolean {
  try {
    const verifier = expectedVerifier()
    return verifier.length === PARAMS.keyLength
  } catch {
    return false
  }
}
