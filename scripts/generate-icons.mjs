#!/usr/bin/env node
/**
 * Generates the application and installer icon.
 *
 * The mark is drawn from a vector definition and rasterised locally with sharp (libvips, which ships
 * with the project's own native dependency tree) so no artwork has to be fetched and no binary asset is
 * hand-edited. Two files come out of it:
 *
 *   build/icon.ico            Windows executable + NSIS installer icon, all frames in one file
 *   build/icons/icon-NN.png   the same mark as a plain PNG set (16–256 px) for documentation and the
 *                             taskbar-sized frames Windows picks up from the executable
 *
 * ICO is assembled here rather than by a helper package: the container is a small header followed by PNG
 * payloads, and writing it explicitly keeps the dependency list short (see THIRD_PARTY_NOTICES.md).
 *
 * Usage: node scripts/generate-icons.mjs [--check]
 *   --check  verify that the files on disk are exactly what this script produces (used in CI)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')

/* The mark: a tooth in a rounded teal tile with a gold arc, the same palette the installer and the
   About page use. Drawn on a 1024-unit grid and rendered at every frame size, so the small sizes stay
   legible. */
const mark = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect x="0" y="0" width="1024" height="1024" rx="208" fill="#0f4d4a"/>
  <path d="M512 214c-86 0-128-42-214-42-74 0-126 58-126 150 0 168 74 268 116 380 16 44 26 108 66 108 46 0 48-86 62-158 12-62 34-96 96-96s84 34 96 96c14 72 16 158 62 158 40 0 50-64 66-108 42-112 116-212 116-380 0-92-52-150-126-150-86 0-128 42-214 42z" fill="#f7fbfa"/>
  <path d="M300 470c40 96 112 150 212 150s172-54 212-150" fill="none" stroke="#e5b45c" stroke-width="34" stroke-linecap="round"/>
</svg>`

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

function icoHeader(count) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  return header
}

function icoEntry(size, length, offset) {
  const entry = Buffer.alloc(16)
  entry.writeUInt8(size >= 256 ? 0 : size, 0) // 0 means 256
  entry.writeUInt8(size >= 256 ? 0 : size, 1)
  entry.writeUInt8(0, 2) // palette colours
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(length, 8)
  entry.writeUInt32LE(offset, 12)
  return entry
}

async function render(size) {
  return sharp(Buffer.from(mark(size))).resize(size, size, { fit: 'fill' }).png({ compressionLevel: 9 }).toBuffer()
}

async function generate() {
  const frames = []
  for (const size of ICO_SIZES) frames.push({ size, data: await render(size) })

  const header = icoHeader(frames.length)
  let offset = header.length + frames.length * 16
  const directories = []
  for (const frame of frames) {
    directories.push(icoEntry(frame.size, frame.data.length, offset))
    offset += frame.data.length
  }
  const ico = Buffer.concat([header, ...directories, ...frames.map((frame) => frame.data)])
  return { ico, frames }
}

function same(file, expected) {
  try {
    return readFileSync(file).equals(expected)
  } catch {
    return false
  }
}

const check = process.argv.includes('--check')
const { ico, frames } = await generate()
const iconsDir = join(buildDir, 'icons')
const files = [
  { path: join(buildDir, 'icon.ico'), data: ico, label: 'build/icon.ico' },
  ...frames.map((frame) => ({
    path: join(iconsDir, `icon-${frame.size}.png`),
    data: frame.data,
    label: `build/icons/icon-${frame.size}.png`
  }))
]

if (check) {
  const stale = files.filter((file) => !same(file.path, file.data)).map((file) => file.label)
  if (stale.length > 0) {
    console.error(`generate-icons: ${stale.join(', ')} do not match the source artwork. Run: npm run icons`)
    process.exit(1)
  }
  console.log(`generate-icons: the icon set is up to date (${frames.length} PNG frames + icon.ico, ${ico.length} B).`)
} else {
  mkdirSync(iconsDir, { recursive: true })
  for (const file of files) writeFileSync(file.path, file.data)
  console.log(
    `generate-icons: wrote build/icon.ico (${ico.length} B) and ${frames.length} PNG frames ` +
      `(${ICO_SIZES.join('/')} px) in build/icons/.`
  )
}
