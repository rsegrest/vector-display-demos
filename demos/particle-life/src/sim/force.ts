// Force between two particles at a normalized distance (1 = the interaction radius).
// Inside the repulsion radius every pair pushes apart, so particles never collapse onto each other.
// Beyond it, the force rises to the attraction value and falls back to zero at the interaction radius.
export function interactionForce(normalizedDistance: number, attraction: number, repulsionRadius: number): number {
  if (normalizedDistance < repulsionRadius) return normalizedDistance / repulsionRadius - 1;
  if (normalizedDistance < 1) {
    return attraction * (1 - Math.abs(2 * normalizedDistance - 1 - repulsionRadius) / (1 - repulsionRadius));
  }
  return 0;
}
