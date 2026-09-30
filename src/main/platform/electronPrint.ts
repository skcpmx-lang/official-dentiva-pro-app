import { BrowserWindow } from 'electron'
import type { Logger, PdfJob, PdfResult, PrintHost, PrintJob, PrinterInfo, PrintResult } from './types'
import { AppError } from '@shared/errors'

/**
 * Windows printing integration.
 *
 * Documents are rendered in a hidden, sandboxed `BrowserWindow` that loads the exact same HTML the
 * print-preview iframe displays, so preview and paper output cannot diverge. Layout (page size,
 * margins, columns) lives in the document CSS; the host only selects the printer, the paper size and
 * the number of copies.
 */

const LOAD_TIMEOUT_MS = 20_000
const MICRONS_PER_INCH = 25_400

export interface PrintHostOptions {
  logger: Logger
  /** Overridable for tests: creates the offscreen window that renders the document. */
  createWindow?: () => BrowserWindow
}

function htmlDataUrl(html: string): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`
}

async function renderWindow(options: PrintHostOptions, html: string): Promise<BrowserWindow> {
  const window =
    options.createWindow?.() ??
    new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        offscreen: false,
        webSecurity: true,
        spellcheck: false
      }
    })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError('E_PRINT', 'The document took too long to prepare for printing.')), LOAD_TIMEOUT_MS)
    window.webContents.once('did-finish-load', () => {
      clearTimeout(timer)
      resolve()
    })
    window.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      clearTimeout(timer)
      reject(new AppError('E_PRINT', `The document could not be prepared for printing (${errorDescription}).`, { detail: { errorCode } }))
    })
    void window.loadURL(htmlDataUrl(html))
  })

  try {
    await window.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true', true)
  } catch (error) {
    options.logger.warn('Font readiness check failed; continuing with system fallback fonts', { reason: error instanceof Error ? error.message : String(error) })
  }
  // Give the compositor a moment to lay out the (already loaded) document before printing.
  await new Promise((resolve) => setTimeout(resolve, 60))
  return window
}

export function electronPrintHost(options: PrintHostOptions): PrintHost {
  let cachedPrinters: PrinterInfo[] | null = null

  return {
    async listPrinters(): Promise<PrinterInfo[]> {
      const window = BrowserWindow.getAllWindows()[0] ?? (await renderWindow(options, '<html><body></body></html>'))
      try {
        const printers = await window.webContents.getPrintersAsync()
        cachedPrinters = printers.map((printer) => {
          const options = (printer.options ?? {}) as Record<string, string>
          const defaultFlag = options['printer-is-default']
          const statusValue = Number(options['printer-state'] ?? '0')
          return {
            name: printer.name,
            displayName: printer.displayName,
            description: printer.description,
            status: Number.isFinite(statusValue) ? statusValue : 0,
            isDefault: defaultFlag === 'true' || defaultFlag === '1',
            options
          }
        })
        return cachedPrinters
      } catch (error) {
        options.logger.warn('Printer enumeration failed', { reason: error instanceof Error ? error.message : String(error) })
        return cachedPrinters ?? []
      }
    },

    async getDefaultPrinter(): Promise<string | null> {
      const printers = cachedPrinters ?? (await this.listPrinters())
      const flagged = printers.find((printer) => printer.isDefault)
      return flagged?.name ?? printers[0]?.name ?? null
    },

    async print(job: PrintJob): Promise<PrintResult> {
      const printerName = job.printerName ?? (await this.getDefaultPrinter())
      if (!printerName) {
        throw new AppError('E_PRINT', 'No printer is available. Connect a printer or save the document as a PDF instead.')
      }
      const window = await renderWindow(options, job.html)
      try {
        const result = await new Promise<PrintResult>((resolve) => {
          window.webContents.print(
            {
              silent: true,
              deviceName: printerName,
              printBackground: true,
              color: true,
              landscape: job.landscape ?? false,
              copies: job.copies ?? 1,
              scaleFactor: job.scaleBp ? Math.max(10, Math.min(200, Math.round(job.scaleBp / 100))) : 100,
              pagesPerSheet: 1,
              collate: true,
              margins: { marginType: 'none' },
              pageSize: job.pageSizeMicrons ? { width: job.pageSizeMicrons.width, height: job.pageSizeMicrons.height } : undefined
            },
            (success, failureReason) => resolve({ success, failureReason, printerName })
          )
        })
        if (!result.success) {
          options.logger.warn('Print job reported failure', { printerName, reason: result.failureReason })
        }
        return result
      } finally {
        if (!window.isDestroyed()) window.destroy()
      }
    },

    async renderPdf(job: PdfJob): Promise<PdfResult> {
      const window = await renderWindow(options, job.html)
      try {
        const data = await window.webContents.printToPDF({
          printBackground: true,
          landscape: job.landscape ?? false,
          // printToPDF expresses page size and margins in inches.
          pageSize: {
            width: job.pageSizeMicrons.width / MICRONS_PER_INCH,
            height: job.pageSizeMicrons.height / MICRONS_PER_INCH
          },
          margins: {
            top: job.marginsMicrons.top / MICRONS_PER_INCH,
            right: job.marginsMicrons.right / MICRONS_PER_INCH,
            bottom: job.marginsMicrons.bottom / MICRONS_PER_INCH,
            left: job.marginsMicrons.left / MICRONS_PER_INCH
          },
          preferCSSPageSize: true
        })
        if (data.byteLength === 0) throw new AppError('E_PRINT', 'The PDF could not be generated because the document rendered empty.')
        return { data: new Uint8Array(data) }
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError('E_PRINT', 'The PDF could not be generated. Try again, or print the document instead.', {
          detail: { reason: error instanceof Error ? error.message : String(error) }
        })
      } finally {
        if (!window.isDestroyed()) window.destroy()
      }
    }
  }
}
