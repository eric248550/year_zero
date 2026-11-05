import { Droplets, FlaskConical, Hammer, Wheat } from "lucide-react";
import type { ResourceId } from "@genesis/schemas";

/**
 * Icon and colour per resource; labels come from the translator
 * (`term.resource`). Kept outside "use client" modules so server components
 * can read it directly.
 */
export const RESOURCE_META: Record<ResourceId, { icon: typeof Wheat; text: string; bar: string }> = {
  food: { icon: Wheat, text: "text-food", bar: "bg-food" },
  water: { icon: Droplets, text: "text-water", bar: "bg-water" },
  materials: { icon: Hammer, text: "text-materials", bar: "bg-materials" },
  knowledge: { icon: FlaskConical, text: "text-knowledge", bar: "bg-knowledge" },
};
