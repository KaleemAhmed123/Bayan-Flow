// Stand-in for packages that are reachable from a dependency's require graph but
// never called by BayanFlow. Bundling them would ship megabytes of dead code.
export default {};
