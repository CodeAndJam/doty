/**
 * The embedder, in its own process.
 *
 * onnxruntime's native sessions cannot be released safely at exit: releasing the
 * 300M encoder from the main process printed a `Napi::Error` abort from its
 * finaliser on quit (TODO.md). A utility process is killed rather than
 * finalised, so the abort has nothing left to abort, and the encoder's memory
 * leaves with it.
 *
 * This file is the entry point and nothing else: the protocol it speaks lives in
 * `embedder-protocol.ts`, which is testable without Electron.
 */
import { loadEmbedder } from './embedder'
import { createEmbedderHandler, type EmbedderRequest } from './embedder-protocol'

const handler = createEmbedderHandler(loadEmbedder)
const port = process.parentPort

port.on('message', (event) => {
  void handler
    .handle(event.data as EmbedderRequest)
    .then((reply) => port.postMessage(reply))
    .catch(() => {
      // The port is closing: there is nobody left to answer.
    })
})
