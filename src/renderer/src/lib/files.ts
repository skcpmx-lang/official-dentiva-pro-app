/**
 * Reading a picked file into the base64 the main process expects.
 *
 * Blobs in current Chromium expose `arrayBuffer()`; the fallback keeps the same code working under jsdom
 * (and on any engine that only offers `FileReader`), so the upload path is exercised by the renderer tests
 * instead of being silently untested.
 */
export async function readFileAsBase64(file: File): Promise<string> {
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer()
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}

