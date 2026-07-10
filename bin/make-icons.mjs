#!/usr/bin/env node
// Renders the arc reactor app icons as PNGs with zero dependencies: raw RGBA
// maths, hand-rolled PNG chunks, node:zlib for the IDAT. Run once; outputs
// are committed so clones never need to regenerate.
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'public', 'assets', 'icons')

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const clamp01 = v => Math.max(0, Math.min(1, v))
const band = (d, at, w) => clamp01(1 - Math.abs(d - at) / w)
const disc = (d, edge, soft) => (d < edge - soft ? 1 : d > edge + soft ? 0 : (edge + soft - d) / (2 * soft))

function reactor(S) {
  const buf = Buffer.alloc(S * S * 4)
  const c = S / 2
  const bg = [2, 6, 13]
  const cyan = [23, 212, 254]
  const hot = [210, 248, 255]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c + 0.5, y - c + 0.5) / c
      let glow = 0
      glow += band(d, 0.80, 0.05) * 0.95 // outer ring
      glow += band(d, 0.60, 0.022) * 0.5 // middle ring
      glow += disc(d, 0.30, 0.07)        // core
      glow += Math.max(0, 1 - d / 1.05) * 0.10 // ambient
      glow = clamp01(glow)
      const heat = disc(d, 0.16, 0.1) // white-hot centre
      let r = bg[0] + (cyan[0] - bg[0]) * glow
      let g = bg[1] + (cyan[1] - bg[1]) * glow
      let b = bg[2] + (cyan[2] - bg[2]) * glow
      r += (hot[0] - r) * heat
      g += (hot[1] - g) * heat
      b += (hot[2] - b) * heat
      const i = (y * S + x) * 4
      buf[i] = Math.round(r)
      buf[i + 1] = Math.round(g)
      buf[i + 2] = Math.round(b)
      buf[i + 3] = 255
    }
  }
  return buf
}

fs.mkdirSync(OUT, { recursive: true })
for (const size of [180, 192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`)
  fs.writeFileSync(file, png(size, reactor(size)))
  console.log('wrote', file)
}
