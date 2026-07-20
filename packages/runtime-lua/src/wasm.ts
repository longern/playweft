import luaWasmModule from "wasmoon/dist/glue.wasm";

declare global {
  // The patched Wasmoon bootstrap consumes this build-time compiled module.
  // Cloudflare Workers reject on-demand WebAssembly compilation in a request.
  // eslint-disable-next-line no-var
  var __PLAYWEFT_LUA_WASM_MODULE__: WebAssembly.Module | undefined;
}

globalThis.__PLAYWEFT_LUA_WASM_MODULE__ = luaWasmModule;
