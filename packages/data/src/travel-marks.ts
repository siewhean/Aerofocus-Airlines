import type { TravelMarkDesign } from "@aerofocus/core";

/**
 * Sourced travel-mark catalogue (FR-048). Empty until each country's design is researched and its
 * source documented; until then every arrival uses the generic design. Add entries as:
 * { id, country, category, label, sourceRef } — sourceRef must cite the documented practice.
 */
export const TRAVEL_MARK_DESIGNS: readonly TravelMarkDesign[] = [];
