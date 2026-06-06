import log from 'electron-log/main'

// log.initialize() enables the renderer→main IPC transport (electron-log v5).
// Safe to call before app.whenReady(); idempotent.
log.initialize()

const isDev = process.env['NODE_ENV'] === 'development'

log.transports.file.level = isDev ? 'debug' : 'info'
log.transports.console.level = isDev ? 'debug' : 'warn'

export { log as logger }
export default log
