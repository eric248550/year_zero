import { hashValue, type ContentBundle, type EventDefinition, type Storyline } from "@genesis/schemas";

/** Build an immutable content bundle with a content-addressed version. */
export function makeContentBundle(events: readonly EventDefinition[], storylines: readonly Storyline[]): ContentBundle {
  const sortedEvents = [...events].sort((a, b) => (a.id < b.id ? -1 : 1));
  const sortedStorylines = [...storylines].sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    version: `content-${hashValue({ e: sortedEvents, s: sortedStorylines }).slice(0, 10)}`,
    events: sortedEvents,
    storylines: sortedStorylines,
  };
}
