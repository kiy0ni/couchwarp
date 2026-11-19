// Tells `exports` from "cloudflare:workers" which module the Worker runs.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('../src/index')
  }
}
