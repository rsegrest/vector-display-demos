// The games in vector-games, each imported through its src/embed.ts. The site's
// Vite config (and this package's test config) points these names at the games'
// folders; see demos/vector-os/arcadeGames.ts.
declare module "@vector-games/*" {
  export function createCabinet(): import("./ArcadeCabinet.js").ArcadeCabinet;
}
