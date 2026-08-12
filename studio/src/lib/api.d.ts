// Type shim for the ported api.js (see that file's header comment).
//
// api.js is plain vanilla JS with JSDoc comments meant as documentation, not
// enforced types — creator.html never type-checked it. Some of those JSDoc
// `@returns` blocks describe the resolved value directly (e.g. `{ tier: string }`)
// on methods that aren't declared `async`, which TypeScript's JSDoc inference
// then takes completely literally instead of wrapping in Promise<...>, so
// callers see a non-Promise type for a value that's a Promise at runtime.
//
// Declaring every namespace as `any` here (a sibling .d.ts takes precedence
// over inferring types from the .js file) sidesteps that mismatch without
// hand-annotating 60+ methods — it matches how this file was always
// consumed (untyped) in creator.html's plain-JS frontend.
export const stream: any;
export const library: any;
export const auth: any;
export const payment: any;
export const share: any;
export const posts: any;
export const events: any;
export const participation: any;
export const docs: any;
export const dashboard: any;
