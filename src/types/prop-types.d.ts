// Minimal ambient module for `prop-types` (no @types/prop-types in package.json).
// Property named `any` is the runtime PropTypes.any checker — not TypeScript `any`.
declare module "prop-types" {
  type Checker = {
    (...args: unknown[]): Error | null;
    isRequired: Checker;
  };

  interface PropTypesAPI {
    array: Checker;
    bool: Checker;
    func: Checker;
    number: Checker;
    object: Checker;
    string: Checker;
    symbol: Checker;
    any: Checker;
    arrayOf: (type: Checker) => Checker;
    element: Checker;
    elementType: Checker;
    instanceOf: (expectedClass: unknown) => Checker;
    node: Checker;
    objectOf: (type: Checker) => Checker;
    oneOf: (expectedValues: readonly unknown[]) => Checker;
    oneOfType: (types: Checker[]) => Checker;
    shape: (shape: Record<string, Checker | undefined>) => Checker;
    exact: (shape: Record<string, Checker | undefined>) => Checker;
    checkPropTypes: (...args: unknown[]) => void;
    resetWarningCache: () => void;
  }

  const PropTypes: PropTypesAPI;
  export default PropTypes;
}
