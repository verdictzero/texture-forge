/* Points bare `three` imports at the stub, so the smoke test needs no
   node_modules and no install step — the same promise the game makes. */
export function resolve(specifier, context, next) {
  if (specifier === 'three')
    return { url: new URL('./three-stub.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
