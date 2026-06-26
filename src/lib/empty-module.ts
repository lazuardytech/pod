// Placeholder module. Default export is an empty object and a `noop` no-arg
// function is re-exported for callers that need a no-op side effect.
const noop = (): void => {};

export default {};
export { noop };
