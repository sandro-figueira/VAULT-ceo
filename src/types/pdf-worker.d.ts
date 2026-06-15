// Vite emits the pdf.js worker as a URL asset via the `?url` suffix.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const src: string
  export default src
}
