// Test-time stub for Next's `server-only` marker package.
// It throws at build time to keep server code out of client bundles; in tests
// we want to import the module directly, so this resolves to an empty module.
export {};
